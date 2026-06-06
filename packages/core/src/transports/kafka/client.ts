// src/transports/kafka/client.ts
// Kafka protocol client: metadata discovery, produce, fetch, list-offsets,
// group-coordinator lookup, and offset commit/fetch. Built on KafkaConnection.

import type { KafkaWriter } from './primitives.js';
import { KafkaConnection, API, type KafkaBroker, type KafkaConnectionOptions } from './connection.js';
import { encodeRecordBatch, decodeRecordBatches, type KafkaRecord } from './recordbatch.js';

export interface PartitionMeta { error: number; partition: number; leader: number; replicas: number[]; isr: number[]; }
export interface TopicMeta { error: number; name: string; partitions: PartitionMeta[]; }
export interface ClusterMeta { brokers: KafkaBroker[]; controllerId: number; topics: TopicMeta[]; }

export interface KafkaClientOptions extends KafkaConnectionOptions {
  brokers?: string[];
}

export class KafkaProtocolError extends Error {
  constructor(public readonly code: number, op: string) {
    super(`Kafka ${op} failed with error code ${code}`);
    this.name = 'KafkaProtocolError';
  }
}

export class KafkaClient {
  private readonly bootstrap: Array<{ host: string; port: number }>;
  private readonly clientId: string;
  private readonly connTimeout: number;
  private readonly connections = new Map<string, KafkaConnection>();
  private meta: ClusterMeta | null = null;

  constructor(opts: KafkaClientOptions = {}) {
    const list = opts.brokers ?? [`${opts.host ?? '127.0.0.1'}:${opts.port ?? 9092}`];
    this.bootstrap = list.map((b) => {
      const [host, port] = b.split(':');
      return { host: host!, port: Number(port ?? 9092) };
    });
    this.clientId = opts.clientId ?? 'street-kafka';
    this.connTimeout = opts.connectTimeoutMs ?? 10_000;
  }

  private async _conn(host: string, port: number): Promise<KafkaConnection> {
    const key = `${host}:${port}`;
    let conn = this.connections.get(key);
    if (conn?.connected) return conn;
    conn = new KafkaConnection({ host, port, clientId: this.clientId, connectTimeoutMs: this.connTimeout });
    await conn.connect();
    this.connections.set(key, conn);
    return conn;
  }

  private async _anyConn(): Promise<KafkaConnection> {
    let lastErr: unknown;
    for (const b of this.bootstrap) {
      try { return await this._conn(b.host, b.port); } catch (e) { lastErr = e; }
    }
    throw lastErr instanceof Error ? lastErr : new Error('No Kafka brokers reachable');
  }

  /** Metadata v1: brokers (with rack), controller id, topics with partitions. */
  async metadata(topics: string[]): Promise<ClusterMeta> {
    const conn = await this._anyConn();
    const r = await conn.request(API.METADATA, 1, (w: KafkaWriter) => {
      w.int32(topics.length);
      for (const t of topics) w.string(t);
    });
    const brokerCount = r.int32();
    const brokers: KafkaBroker[] = [];
    for (let i = 0; i < brokerCount; i++) {
      const nodeId = r.int32(); const host = r.string()!; const port = r.int32();
      r.string(); // rack (nullable)
      brokers.push({ nodeId, host, port });
    }
    const controllerId = r.int32();
    const topicCount = r.int32();
    const tmeta: TopicMeta[] = [];
    for (let i = 0; i < topicCount; i++) {
      const error = r.int16(); const name = r.string()!; r.int8(); // is_internal
      const pCount = r.int32();
      const partitions: PartitionMeta[] = [];
      for (let p = 0; p < pCount; p++) {
        const perr = r.int16(); const partition = r.int32(); const leader = r.int32();
        const replicas = r.array((rd) => rd.int32());
        const isr = r.array((rd) => rd.int32());
        partitions.push({ error: perr, partition, leader, replicas, isr });
      }
      tmeta.push({ error, name, partitions });
    }
    this.meta = { brokers, controllerId, topics: tmeta };
    return this.meta;
  }

  private _brokerById(nodeId: number): KafkaBroker {
    const b = this.meta?.brokers.find((x) => x.nodeId === nodeId);
    if (!b) throw new Error(`Kafka broker ${nodeId} not found in metadata`);
    return b;
  }

  /** Resolve the leader broker for a topic-partition. */
  async leaderFor(topic: string, partition: number): Promise<KafkaBroker> {
    if (!this.meta) await this.metadata([topic]);
    let tm = this.meta!.topics.find((t) => t.name === topic);
    if (!tm) { await this.metadata([topic]); tm = this.meta!.topics.find((t) => t.name === topic); }
    const pm = tm?.partitions.find((p) => p.partition === partition);
    if (!pm) throw new Error(`No leader for ${topic}-${partition}`);
    return this._brokerById(pm.leader);
  }

  close(): void {
    for (const c of this.connections.values()) c.close();
    this.connections.clear();
  }
}

export { encodeRecordBatch, decodeRecordBatches };
export type { KafkaRecord };
