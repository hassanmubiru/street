import { type KafkaBroker, type KafkaConnectionOptions } from './connection.js';
import { encodeRecordBatch, decodeRecordBatches, type KafkaRecord } from './recordbatch.js';
export interface PartitionMeta {
    error: number;
    partition: number;
    leader: number;
    replicas: number[];
    isr: number[];
}
export interface TopicMeta {
    error: number;
    name: string;
    partitions: PartitionMeta[];
}
export interface ClusterMeta {
    brokers: KafkaBroker[];
    controllerId: number;
    topics: TopicMeta[];
}
export interface KafkaClientOptions extends KafkaConnectionOptions {
    brokers?: string[];
}
export declare class KafkaProtocolError extends Error {
    readonly code: number;
    constructor(code: number, op: string);
}
export declare class KafkaClient {
    private readonly bootstrap;
    private readonly clientId;
    private readonly connTimeout;
    private readonly connections;
    private meta;
    constructor(opts?: KafkaClientOptions);
    private _conn;
    private _anyConn;
    /** Metadata v1: brokers (with rack), controller id, topics with partitions. */
    metadata(topics: string[]): Promise<ClusterMeta>;
    private _brokerById;
    /** Resolve the leader broker for a topic-partition. */
    leaderFor(topic: string, partition: number): Promise<KafkaBroker>;
    /**
     * Wait until a topic is fully ready to produce/consume: it exists with at
     * least `minPartitions`, and EVERY partition has a healthy state (error 0,
     * an elected leader >= 0, and a non-empty in-sync replica set). This closes
     * the cold-start race where `metadata()` returns a topic whose partitions
     * have no leader yet (LEADER_NOT_AVAILABLE), causing transient produce
     * failures. Polls with backoff until ready or `timeoutMs` elapses.
     */
    awaitTopicReady(topic: string, minPartitions?: number, timeoutMs?: number): Promise<void>;
    /** Allocate a producer id + epoch for the idempotent producer (InitProducerId v0). */
    initProducerId(): Promise<{
        producerId: bigint;
        producerEpoch: number;
    }>;
    /** Produce records to a topic-partition (acks=all). Returns base offset.
     *  When idempotent fields are supplied, the RecordBatch carries the producer
     *  id/epoch/sequence so the broker can de-duplicate retries. */
    produce(topic: string, partition: number, records: KafkaRecord[], opts?: {
        acks?: number;
        timeoutMs?: number;
        producerId?: bigint;
        producerEpoch?: number;
        baseSequence?: number;
    }): Promise<bigint>;
    /** Fetch records from a topic-partition starting at `fetchOffset`. */
    fetch(topic: string, partition: number, fetchOffset: bigint, opts?: {
        maxWaitMs?: number;
        maxBytes?: number;
    }): Promise<{
        records: KafkaRecord[];
        highWatermark: bigint;
    }>;
    /** List offsets: timestamp -1 = latest (end), -2 = earliest (start). */
    listOffset(topic: string, partition: number, timestamp: bigint): Promise<bigint>;
    /** Find the group coordinator broker for a consumer group. Retries on
     *  transient coordinator errors (14 LOAD_IN_PROGRESS, 15 NOT_AVAILABLE,
     *  16 NOT_COORDINATOR) while the internal __consumer_offsets topic initialises
     *  and a coordinator is elected (cold-start hardening). */
    findCoordinator(groupId: string): Promise<KafkaBroker>;
    /** Transient consumer-group coordinator errors that should be retried during cold start. */
    private static readonly TRANSIENT_COORDINATOR_ERRORS;
    /**
     * Run a coordinator-dependent operation, retrying (with fresh coordinator
     * resolution) on transient coordinator errors. Closes the cold-start race
     * where OFFSET_COMMIT/OFFSET_FETCH hit COORDINATOR_LOAD_IN_PROGRESS or
     * NOT_COORDINATOR while __consumer_offsets is still loading.
     */
    private _withCoordinatorRetry;
    /** Commit an offset for a consumer group (group offset storage). */
    commitOffset(groupId: string, topic: string, partition: number, offset: bigint): Promise<void>;
    /** Fetch the committed offset for a consumer group (-1 if none). */
    fetchOffset(groupId: string, topic: string, partition: number): Promise<bigint>;
    close(): void;
}
export interface CoordinatorGateResult {
    /** True only when both FindCoordinator succeeded and __consumer_offsets is stable within the budget. */
    ready: boolean;
    /** A successful FindCoordinator response was observed. */
    findCoordinatorOk: boolean;
    /** __consumer_offsets exists with every partition reporting a live leader. */
    offsetsTopicStable: boolean;
    /** Total time spent waiting, in milliseconds. */
    waitedMs: number;
    /** Committed consumer offsets were left untouched (always true: the gate never commits/fetches/resets). */
    offsetsPreserved: boolean;
}
export interface CoordinatorReadinessGateOptions {
    /** Total readiness budget. Defaults to 30_000 ms (Req 9.1). */
    timeoutMs?: number;
    /** Consumer group whose coordinator must be resolvable. */
    group: string;
    /** Poll backoff between readiness probes. Defaults to 250 ms. */
    pollIntervalMs?: number;
}
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
export declare class CoordinatorReadinessGate {
    private readonly client;
    private readonly timeoutMs;
    private readonly group;
    private readonly pollIntervalMs;
    constructor(client: KafkaClient, opts: CoordinatorReadinessGateOptions);
    /**
     * Wait for readiness within the budget. Resolves with a result describing
     * what was observed; never throws on broker unavailability (a failed probe
     * simply does not advance readiness). On timeout `ready` is false and no
     * consuming should follow.
     */
    await(): Promise<CoordinatorGateResult>;
    /** __consumer_offsets is stable: topic exists, no error, and every partition has a live leader. */
    private _offsetsTopicStable;
}
export { encodeRecordBatch, decodeRecordBatches };
export type { KafkaRecord };
//# sourceMappingURL=client.d.ts.map