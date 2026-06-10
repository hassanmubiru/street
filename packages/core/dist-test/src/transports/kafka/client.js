// src/transports/kafka/client.ts
// Kafka protocol client: metadata discovery, produce, fetch, list-offsets,
// group-coordinator lookup, and offset commit/fetch. Built on KafkaConnection.
import { KafkaConnection, API } from './connection.js';
import { encodeRecordBatch, decodeRecordBatches } from './recordbatch.js';
export class KafkaProtocolError extends Error {
    code;
    constructor(code, op) {
        super(`Kafka ${op} failed with error code ${code}`);
        this.code = code;
        this.name = 'KafkaProtocolError';
    }
}
export class KafkaClient {
    bootstrap;
    clientId;
    connTimeout;
    connections = new Map();
    meta = null;
    constructor(opts = {}) {
        const list = opts.brokers ?? [`${opts.host ?? '127.0.0.1'}:${opts.port ?? 9092}`];
        this.bootstrap = list.map((b) => {
            const [host, port] = b.split(':');
            return { host: host, port: Number(port ?? 9092) };
        });
        this.clientId = opts.clientId ?? 'street-kafka';
        this.connTimeout = opts.connectTimeoutMs ?? 10_000;
    }
    async _conn(host, port) {
        const key = `${host}:${port}`;
        let conn = this.connections.get(key);
        if (conn?.connected)
            return conn;
        conn = new KafkaConnection({ host, port, clientId: this.clientId, connectTimeoutMs: this.connTimeout });
        await conn.connect();
        this.connections.set(key, conn);
        return conn;
    }
    async _anyConn() {
        let lastErr;
        for (const b of this.bootstrap) {
            try {
                return await this._conn(b.host, b.port);
            }
            catch (e) {
                lastErr = e;
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error('No Kafka brokers reachable');
    }
    /** Metadata v1: brokers (with rack), controller id, topics with partitions. */
    async metadata(topics) {
        const conn = await this._anyConn();
        const r = await conn.request(API.METADATA, 1, (w) => {
            w.int32(topics.length);
            for (const t of topics)
                w.string(t);
        });
        const brokerCount = r.int32();
        const brokers = [];
        for (let i = 0; i < brokerCount; i++) {
            const nodeId = r.int32();
            const host = r.string();
            const port = r.int32();
            r.string(); // rack (nullable)
            brokers.push({ nodeId, host, port });
        }
        const controllerId = r.int32();
        const topicCount = r.int32();
        const tmeta = [];
        for (let i = 0; i < topicCount; i++) {
            const error = r.int16();
            const name = r.string();
            r.int8(); // is_internal
            const pCount = r.int32();
            const partitions = [];
            for (let p = 0; p < pCount; p++) {
                const perr = r.int16();
                const partition = r.int32();
                const leader = r.int32();
                const replicas = r.array((rd) => rd.int32());
                const isr = r.array((rd) => rd.int32());
                partitions.push({ error: perr, partition, leader, replicas, isr });
            }
            tmeta.push({ error, name, partitions });
        }
        this.meta = { brokers, controllerId, topics: tmeta };
        return this.meta;
    }
    _brokerById(nodeId) {
        const b = this.meta?.brokers.find((x) => x.nodeId === nodeId);
        if (!b)
            throw new Error(`Kafka broker ${nodeId} not found in metadata`);
        return b;
    }
    /** Resolve the leader broker for a topic-partition. */
    async leaderFor(topic, partition) {
        if (!this.meta)
            await this.metadata([topic]);
        let tm = this.meta.topics.find((t) => t.name === topic);
        if (!tm) {
            await this.metadata([topic]);
            tm = this.meta.topics.find((t) => t.name === topic);
        }
        let pm = tm?.partitions.find((p) => p.partition === partition);
        // Cold-start hardening: right after broker startup / topic creation a
        // partition can briefly have no elected leader (leader < 0) or a transient
        // error. Refresh metadata with short backoff before giving up.
        for (let attempt = 0; (pm === undefined || pm.leader < 0 || pm.error !== 0) && attempt < 25; attempt++) {
            await new Promise((r) => setTimeout(r, 200));
            await this.metadata([topic]);
            tm = this.meta.topics.find((t) => t.name === topic);
            pm = tm?.partitions.find((p) => p.partition === partition);
        }
        if (!pm || pm.leader < 0)
            throw new Error(`No leader for ${topic}-${partition}`);
        return this._brokerById(pm.leader);
    }
    /**
     * Wait until a topic is fully ready to produce/consume: it exists with at
     * least `minPartitions`, and EVERY partition has a healthy state (error 0,
     * an elected leader >= 0, and a non-empty in-sync replica set). This closes
     * the cold-start race where `metadata()` returns a topic whose partitions
     * have no leader yet (LEADER_NOT_AVAILABLE), causing transient produce
     * failures. Polls with backoff until ready or `timeoutMs` elapses.
     */
    async awaitTopicReady(topic, minPartitions = 1, timeoutMs = 15_000) {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const meta = await this.metadata([topic]);
            const tm = meta.topics.find((t) => t.name === topic);
            const ready = tm !== undefined
                && tm.error === 0
                && tm.partitions.length >= minPartitions
                && tm.partitions.every((p) => p.error === 0 && p.leader >= 0 && p.isr.length >= 1);
            if (ready)
                return;
            if (Date.now() > deadline) {
                throw new Error(`Kafka topic "${topic}" not ready within ${timeoutMs}ms (no elected leader on all partitions)`);
            }
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    /** Allocate a producer id + epoch for the idempotent producer (InitProducerId v0). */
    async initProducerId() {
        // Cold-start hardening: the transaction coordinator (__transaction_state)
        // may report COORDINATOR_LOAD_IN_PROGRESS / NOT_AVAILABLE right after broker
        // boot; retry transiently rather than failing the producer.
        return this._withCoordinatorRetry(async () => {
            const conn = await this._anyConn();
            const r = await conn.request(API.INIT_PRODUCER_ID, 0, (w) => {
                w.string(null); // transactional_id (non-transactional)
                w.int32(60_000); // transaction_timeout_ms
            });
            r.int32(); // throttle_time_ms
            const err = r.int16();
            if (err !== 0)
                throw new KafkaProtocolError(err, 'initProducerId');
            const producerId = r.int64();
            const producerEpoch = r.int16();
            return { producerId, producerEpoch };
        });
    }
    /** Produce records to a topic-partition (acks=all). Returns base offset.
     *  When idempotent fields are supplied, the RecordBatch carries the producer
     *  id/epoch/sequence so the broker can de-duplicate retries. */
    async produce(topic, partition, records, opts = {}) {
        const leader = await this.leaderFor(topic, partition);
        const conn = await this._conn(leader.host, leader.port);
        const batch = encodeRecordBatch(records, {
            producerId: opts.producerId,
            producerEpoch: opts.producerEpoch,
            baseSequence: opts.baseSequence,
        });
        const r = await conn.request(API.PRODUCE, 3, (w) => {
            w.string(null); // transactional_id
            w.int16(opts.acks ?? -1); // acks (-1 = all)
            w.int32(opts.timeoutMs ?? 30_000);
            w.int32(1); // topic count
            w.string(topic);
            w.int32(1); // partition count
            w.int32(partition);
            w.bytes(batch); // records
        });
        // Produce Response v3: [responses(name,[partitions(index,error_code,base_offset,log_append_time_ms)])] throttle_time_ms
        const topicCount = r.int32();
        let baseOffset = -1n;
        let perr = 0;
        for (let i = 0; i < topicCount; i++) {
            r.string(); // name
            const pCount = r.int32();
            for (let p = 0; p < pCount; p++) {
                r.int32(); // index
                const err = r.int16();
                const bo = r.int64();
                r.int64(); // log_append_time_ms
                if (err !== 0)
                    perr = err;
                baseOffset = bo;
            }
        }
        r.int32(); // throttle_time_ms (end of response in v1+)
        if (perr !== 0)
            throw new KafkaProtocolError(perr, 'produce');
        return baseOffset;
    }
    /** Fetch records from a topic-partition starting at `fetchOffset`. */
    async fetch(topic, partition, fetchOffset, opts = {}) {
        const leader = await this.leaderFor(topic, partition);
        const conn = await this._conn(leader.host, leader.port);
        const maxBytes = opts.maxBytes ?? 1_048_576;
        const r = await conn.request(API.FETCH, 4, (w) => {
            w.int32(-1); // replica_id
            w.int32(opts.maxWaitMs ?? 1000); // max_wait_ms
            w.int32(1); // min_bytes
            w.int32(maxBytes); // max_bytes
            w.int8(0); // isolation_level (read_uncommitted)
            w.int32(1); // topic count
            w.string(topic);
            w.int32(1); // partition count
            w.int32(partition);
            w.int64(fetchOffset); // fetch_offset
            w.int32(maxBytes); // partition_max_bytes
        });
        r.int32(); // throttle_time_ms
        const topicCount = r.int32();
        let records = [];
        let highWatermark = 0n;
        for (let i = 0; i < topicCount; i++) {
            r.string(); // topic
            const pCount = r.int32();
            for (let p = 0; p < pCount; p++) {
                r.int32(); // partition
                const err = r.int16();
                highWatermark = r.int64();
                r.int64(); // last_stable_offset
                const abortedCount = r.int32();
                for (let a = 0; a < Math.max(0, abortedCount); a++) {
                    r.int64();
                    r.int64();
                }
                const recordSet = r.bytes();
                if (err !== 0)
                    throw new KafkaProtocolError(err, 'fetch');
                if (recordSet && recordSet.length > 0) {
                    records = records.concat(decodeRecordBatches(recordSet).filter((rec) => (rec.offset ?? 0n) >= fetchOffset));
                }
            }
        }
        return { records, highWatermark };
    }
    /** List offsets: timestamp -1 = latest (end), -2 = earliest (start). */
    async listOffset(topic, partition, timestamp) {
        const leader = await this.leaderFor(topic, partition);
        const conn = await this._conn(leader.host, leader.port);
        const r = await conn.request(API.LIST_OFFSETS, 1, (w) => {
            w.int32(-1); // replica_id
            w.int32(1); // topic count
            w.string(topic);
            w.int32(1); // partition count
            w.int32(partition);
            w.int64(timestamp);
        });
        const topicCount = r.int32();
        let offset = -1n;
        for (let i = 0; i < topicCount; i++) {
            r.string();
            const pCount = r.int32();
            for (let p = 0; p < pCount; p++) {
                r.int32();
                const err = r.int16();
                r.int64();
                const off = r.int64();
                if (err !== 0)
                    throw new KafkaProtocolError(err, 'listOffsets');
                offset = off;
            }
        }
        return offset;
    }
    /** Find the group coordinator broker for a consumer group. Retries on
     *  transient coordinator errors (14 LOAD_IN_PROGRESS, 15 NOT_AVAILABLE,
     *  16 NOT_COORDINATOR) while the internal __consumer_offsets topic initialises
     *  and a coordinator is elected (cold-start hardening). */
    async findCoordinator(groupId) {
        let lastErr;
        for (let attempt = 0; attempt < 12; attempt++) {
            const conn = await this._anyConn();
            const r = await conn.request(API.FIND_COORDINATOR, 0, (w) => { w.string(groupId); });
            const err = r.int16();
            if (err === 0) {
                const nodeId = r.int32();
                const host = r.string();
                const port = r.int32();
                return { nodeId, host, port };
            }
            lastErr = new KafkaProtocolError(err, 'findCoordinator');
            if (!KafkaClient.TRANSIENT_COORDINATOR_ERRORS.has(err))
                throw lastErr;
            await new Promise((res) => setTimeout(res, Math.min(250 * (attempt + 1), 1500)));
        }
        throw lastErr instanceof Error ? lastErr : new KafkaProtocolError(15, 'findCoordinator');
    }
    /** Transient consumer-group coordinator errors that should be retried during cold start. */
    static TRANSIENT_COORDINATOR_ERRORS = new Set([14, 15, 16]);
    /**
     * Run a coordinator-dependent operation, retrying (with fresh coordinator
     * resolution) on transient coordinator errors. Closes the cold-start race
     * where OFFSET_COMMIT/OFFSET_FETCH hit COORDINATOR_LOAD_IN_PROGRESS or
     * NOT_COORDINATOR while __consumer_offsets is still loading.
     */
    async _withCoordinatorRetry(op) {
        let lastErr;
        for (let attempt = 0; attempt < 12; attempt++) {
            try {
                return await op();
            }
            catch (e) {
                lastErr = e;
                const code = e instanceof KafkaProtocolError ? e.code : undefined;
                if (code !== undefined && KafkaClient.TRANSIENT_COORDINATOR_ERRORS.has(code)) {
                    await new Promise((res) => setTimeout(res, Math.min(250 * (attempt + 1), 1500)));
                    continue;
                }
                throw e;
            }
        }
        throw lastErr instanceof Error ? lastErr : new KafkaProtocolError(16, 'coordinatorOp');
    }
    /** Commit an offset for a consumer group (group offset storage). */
    async commitOffset(groupId, topic, partition, offset) {
        return this._withCoordinatorRetry(async () => {
            const coord = await this.findCoordinator(groupId);
            const conn = await this._conn(coord.host, coord.port);
            const r = await conn.request(API.OFFSET_COMMIT, 2, (w) => {
                w.string(groupId);
                w.int32(-1); // generation_id
                w.string(''); // member_id
                w.int64(-1n); // retention_time_ms
                w.int32(1); // topic count
                w.string(topic);
                w.int32(1); // partition count
                w.int32(partition);
                w.int64(offset);
                w.string(null); // committed metadata
            });
            const topicCount = r.int32();
            for (let i = 0; i < topicCount; i++) {
                r.string();
                const pCount = r.int32();
                for (let p = 0; p < pCount; p++) {
                    r.int32();
                    const err = r.int16();
                    if (err !== 0)
                        throw new KafkaProtocolError(err, 'offsetCommit');
                }
            }
        });
    }
    /** Fetch the committed offset for a consumer group (-1 if none). */
    async fetchOffset(groupId, topic, partition) {
        return this._withCoordinatorRetry(async () => {
            const coord = await this.findCoordinator(groupId);
            const conn = await this._conn(coord.host, coord.port);
            const r = await conn.request(API.OFFSET_FETCH, 1, (w) => {
                w.string(groupId);
                w.int32(1); // topic count
                w.string(topic);
                w.int32(1); // partition count
                w.int32(partition);
            });
            const topicCount = r.int32();
            let committed = -1n;
            for (let i = 0; i < topicCount; i++) {
                r.string();
                const pCount = r.int32();
                for (let p = 0; p < pCount; p++) {
                    r.int32();
                    const off = r.int64();
                    r.string();
                    const err = r.int16();
                    if (err !== 0)
                        throw new KafkaProtocolError(err, 'offsetFetch');
                    committed = off;
                }
            }
            return committed;
        });
    }
    close() {
        for (const c of this.connections.values())
            c.close();
        this.connections.clear();
    }
}
/** The internal Kafka topic that stores committed consumer-group offsets. */
const CONSUMER_OFFSETS_TOPIC = '__consumer_offsets';
/**
 * Coordinator Readiness Gate (Req 9.1/9.2).
 *
 * Before a consumer begins consuming, wait up to `timeoutMs` (default 30s) for
 * BOTH:
 *   1. a successful `FindCoordinator` response for the consumer group, AND
 *   2. `__consumer_offsets` stability — the topic exists and EVERY partition
 *      has a live leader (error 0, leader >= 0).
 *
 * On success the result reports `ready: true`. On timeout the result reports
 * `ready: false`: the caller MUST NOT begin consuming. The gate performs only
 * read-only metadata/coordinator lookups and never commits, fetches, or resets
 * offsets, so committed consumer offsets are always preserved
 * (`offsetsPreserved: true`).
 *
 * Built on `KafkaClient.findCoordinator` + metadata partition-leader checks
 * (mirrors `awaitTopicReady`).
 */
export class CoordinatorReadinessGate {
    client;
    timeoutMs;
    group;
    pollIntervalMs;
    constructor(client, opts) {
        this.client = client;
        this.timeoutMs = opts.timeoutMs ?? 30_000;
        this.group = opts.group;
        this.pollIntervalMs = opts.pollIntervalMs ?? 250;
    }
    /**
     * Wait for readiness within the budget. Resolves with a result describing
     * what was observed; never throws on broker unavailability (a failed probe
     * simply does not advance readiness). On timeout `ready` is false and no
     * consuming should follow.
     */
    async await() {
        const start = Date.now();
        const deadline = start + this.timeoutMs;
        let findCoordinatorOk = false;
        let offsetsTopicStable = false;
        for (;;) {
            if (!findCoordinatorOk) {
                try {
                    await this.client.findCoordinator(this.group);
                    findCoordinatorOk = true;
                }
                catch {
                    findCoordinatorOk = false;
                }
            }
            if (findCoordinatorOk && !offsetsTopicStable) {
                offsetsTopicStable = await this._offsetsTopicStable();
            }
            if (findCoordinatorOk && offsetsTopicStable) {
                return {
                    ready: true,
                    findCoordinatorOk,
                    offsetsTopicStable,
                    waitedMs: Date.now() - start,
                    offsetsPreserved: true,
                };
            }
            if (Date.now() >= deadline) {
                // Timeout: do not begin consuming. Committed offsets are untouched.
                return {
                    ready: false,
                    findCoordinatorOk,
                    offsetsTopicStable,
                    waitedMs: Date.now() - start,
                    offsetsPreserved: true,
                };
            }
            const remaining = deadline - Date.now();
            await new Promise((r) => setTimeout(r, Math.min(this.pollIntervalMs, Math.max(0, remaining))));
        }
    }
    /** __consumer_offsets is stable: topic exists, no error, and every partition has a live leader. */
    async _offsetsTopicStable() {
        try {
            const meta = await this.client.metadata([CONSUMER_OFFSETS_TOPIC]);
            const tm = meta.topics.find((t) => t.name === CONSUMER_OFFSETS_TOPIC);
            return (tm !== undefined &&
                tm.error === 0 &&
                tm.partitions.length >= 1 &&
                tm.partitions.every((p) => p.error === 0 && p.leader >= 0));
        }
        catch {
            return false;
        }
    }
}
export { encodeRecordBatch, decodeRecordBatches };
//# sourceMappingURL=client.js.map