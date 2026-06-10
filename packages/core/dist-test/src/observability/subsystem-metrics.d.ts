import type { Counter, Gauge, Histogram, MetricsRegistry } from './prometheus.js';
import type { PgPool } from '../database/pool.js';
import type { KafkaClient, CoordinatorReadinessGate } from '../transports/kafka/client.js';
import type { RabbitMqPublisher, RabbitMqConsumer } from '../transports/rabbitmq/index.js';
import type { PluginHost } from '../platform/plugins/host.js';
/**
 * Every metric name this module exports, grouped by subsystem. Dashboards,
 * alerts, and the anti-fabrication guard reference these names; keeping them
 * here makes the exported surface explicit and testable.
 */
export declare const SUBSYSTEM_METRIC_NAMES: {
    readonly postgres: readonly ["db_pool_connections", "db_query_duration_seconds", "db_pool_acquire_seconds", "db_pool_exhausted_total"];
    readonly kafka: readonly ["kafka_messages_produced_total", "kafka_messages_consumed_total", "kafka_consumer_lag", "kafka_coordinator_wait_seconds"];
    readonly rabbitmq: readonly ["rabbitmq_messages_published_total", "rabbitmq_messages_delivered_total", "rabbitmq_queue_depth", "rabbitmq_consumer_count"];
    readonly pluginHost: readonly ["plugin_host_plugins", "plugin_install_duration_seconds", "plugin_signature_failures_total"];
};
/** Flat list of every subsystem metric name exported by this module. */
export declare function subsystemMetricNames(): string[];
/**
 * Registers and owns the PostgreSQL, Kafka, RabbitMQ, and Plugin Host metrics,
 * and exposes the underlying metric instances plus convenience instrumentation
 * methods. Once constructed against a `MetricsRegistry`, every metric below is
 * exported through that registry's `/metrics` exposition.
 */
export declare class SubsystemMetrics {
    readonly dbPoolConnections: Gauge;
    readonly dbQueryDuration: Histogram;
    readonly dbPoolAcquire: Histogram;
    readonly dbPoolExhausted: Counter;
    readonly kafkaProduced: Counter;
    readonly kafkaConsumed: Counter;
    readonly kafkaConsumerLag: Gauge;
    readonly kafkaCoordinatorWait: Histogram;
    readonly rabbitmqPublished: Counter;
    readonly rabbitmqDelivered: Counter;
    readonly rabbitmqQueueDepth: Gauge;
    readonly rabbitmqConsumerCount: Gauge;
    readonly pluginHostPlugins: Gauge;
    readonly pluginInstallDuration: Histogram;
    readonly pluginSignatureFailures: Counter;
    constructor(registry: MetricsRegistry);
    /** Record a completed query duration (seconds). */
    observeQueryDuration(seconds: number): void;
    /** Record a connection-acquire duration (seconds). */
    observeAcquireDuration(seconds: number): void;
    /** Increment the pool-exhausted counter. */
    recordPoolExhausted(): void;
    /** Set the `db_pool_connections{state}` gauge from pool counts. */
    setPoolConnections(counts: {
        idle: number;
        active: number;
        waiting: number;
    }): void;
    recordProduced(topic: string, count?: number): void;
    recordConsumed(topic: string, count?: number): void;
    setConsumerLag(topic: string, partition: number, lag: number): void;
    observeCoordinatorWait(seconds: number): void;
    recordPublished(exchange: string, count?: number): void;
    recordDelivered(queue: string, count?: number): void;
    setQueueDepth(queue: string, depth: number): void;
    setConsumerCount(queue: string, count: number): void;
    setPluginCounts(counts: {
        registered: number;
        enabled: number;
        disabled: number;
    }): void;
    observeInstallDuration(seconds: number): void;
    recordSignatureFailure(): void;
}
/**
 * Register the subsystem metrics into `registry` and return the handle used to
 * instrument the subsystems. Call once per registry. Because the metrics share
 * the registry wired to `registerMetricsRoute`, they are exported via /metrics
 * immediately (rendering as zero until instrumented).
 */
export declare function registerSubsystemMetrics(registry: MetricsRegistry): SubsystemMetrics;
/**
 * Wire a `PgPool`: observe query + acquire durations, count pool exhaustion,
 * and refresh the connection-state gauge after each acquire.
 *
 * @returns an unsubscribe function that detaches the `pool:exhausted` listener.
 */
export declare function instrumentPgPool(pool: PgPool, m: SubsystemMetrics): () => void;
/**
 * Wire a `KafkaClient`: count produced/consumed messages per topic and set
 * consumer lag (high-watermark minus the next consumed offset) on fetch.
 */
export declare function instrumentKafkaClient(client: KafkaClient, m: SubsystemMetrics): void;
/**
 * Wire a `CoordinatorReadinessGate`: observe the wait duration (seconds) every
 * time the gate is awaited, whether it becomes ready or times out.
 */
export declare function instrumentCoordinatorGate(gate: CoordinatorReadinessGate, m: SubsystemMetrics): void;
/** Wire a `RabbitMqPublisher`: count published messages per exchange. */
export declare function instrumentRabbitMqPublisher(publisher: RabbitMqPublisher, m: SubsystemMetrics, exchange: string): void;
/**
 * Wire a `RabbitMqConsumer`: count delivered messages for `queue`. The consumer
 * handler is wrapped so every delivered message is counted before handling.
 */
export declare function instrumentRabbitMqConsumer(consumer: RabbitMqConsumer, m: SubsystemMetrics, queue: string): void;
/**
 * Wire a `PluginHost`: count signature failures, observe install duration, and
 * refresh the `plugin_host_plugins{state}` gauge as plugins register/enable.
 */
export declare function instrumentPluginHost(host: PluginHost, m: SubsystemMetrics): void;
//# sourceMappingURL=subsystem-metrics.d.ts.map