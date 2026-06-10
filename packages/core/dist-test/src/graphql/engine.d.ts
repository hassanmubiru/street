import type { MiddlewareFn } from '../core/types.js';
import type { StreetApp } from '../http/server.js';
import type { ServiceDefinition } from './schema.js';
/** Default HTTP path the GraphQL endpoint is served from. */
export declare const DEFAULT_GRAPHQL_PATH = "/graphql";
export type { ServiceDefinition };
export interface GraphQlEngineOptions {
    schema: ServiceDefinition;
    resolvers: Record<string, Record<string, (parent: unknown, args: unknown, ctx: unknown) => unknown>>;
    maxDepth?: number;
    maxComplexity?: number;
    introspection?: boolean;
}
export interface ExecutionResult {
    data?: unknown;
    errors?: Array<{
        message: string;
    }>;
}
/**
 * A subscription source: any async iterable (e.g. produced by an async
 * generator resolver) or a synchronous iterable of source events. A
 * subscription field resolver returns one of these from the resolver map.
 */
export type SubscriptionSource = AsyncIterable<unknown> | AsyncIterator<unknown> | Iterable<unknown>;
export declare class GraphQlEngine {
    private readonly opts;
    constructor(opts: GraphQlEngineOptions);
    /**
     * Parse a query document, select the first operation, and run the shared
     * introspection/depth/complexity guards. Returns either the prepared
     * operation or a fully-formed error result.
     */
    private prepare;
    execute(query: string, variables?: Record<string, unknown>, ctx?: unknown): Promise<ExecutionResult>;
    /**
     * Execute a GraphQL subscription operation, returning an async iterator of
     * {@link ExecutionResult} — one per source event produced by the
     * subscription field's resolver.
     *
     * The subscription field resolver in the resolver map must return a
     * {@link SubscriptionSource} (an async iterable/iterator, e.g. an async
     * generator, or a sync iterable). Each source event is mapped through the
     * remaining selection set: if the field has a sub-selection, the event is
     * resolved as the parent object of that selection; otherwise the raw event
     * value is used. Errors during preparation or per-event resolution are
     * yielded as `{ errors: [...] }` results.
     */
    executeSubscription(query: string, variables?: Record<string, unknown>, ctx?: unknown): AsyncGenerator<ExecutionResult, void, unknown>;
}
/**
 * Create a Street middleware that handles POST requests to the GraphQL
 * endpoint path as GraphQL operations. Requests using another method, or
 * POSTs to a different path, fall through to `next()`.
 *
 * Reads body (already parsed by streetApp), calls engine.execute(), returns
 * JSON. Pass `path` to serve the endpoint from somewhere other than
 * `/graphql`.
 */
export declare function graphqlMiddleware(engine: GraphQlEngine, path?: string): MiddlewareFn;
/**
 * Wire a GraphQL endpoint into a StreetApp in a single call, mirroring the
 * `registerHealthRoutes(app, registry)` / `registerMetricsRoute(app, registry)`
 * pattern. Installs `graphqlMiddleware(engine, path)` so that only POST
 * requests to the configured `path` (default `/graphql`) are handled as
 * GraphQL operations; all other requests fall through.
 *
 * @param app    - The StreetApp to register the middleware on.
 * @param engine - The GraphQlEngine that executes incoming operations.
 * @param path   - The path to serve the GraphQL endpoint from (default `/graphql`).
 */
export declare function registerGraphqlRoute(app: StreetApp, engine: GraphQlEngine, path?: string): void;
//# sourceMappingURL=engine.d.ts.map