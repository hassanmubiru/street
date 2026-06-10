import type { StreetApp } from '../http/server.js';
/**
 * A node in the route tree. Structural (grouping) nodes carry an empty `method`
 * and represent a path prefix; leaf nodes carry the registered HTTP `method`
 * and the full route `path`. Every registered route therefore surfaces both its
 * HTTP method and its path (Req 7.2).
 */
export interface RouteNode {
    method: string;
    path: string;
    children?: RouteNode[];
}
/**
 * Build a hierarchical route tree from an application's registered routes.
 * Routes are sourced from the application's OpenAPI surface — the public,
 * stable view of what the router has registered — so each registered route
 * appears as a leaf showing its HTTP method and path (Req 7.2).
 *
 * Pure and deterministic: structural nodes and leaves are emitted in a stable
 * (alphabetical) order so the same registered routes always yield the same tree.
 */
export declare function buildRouteTree(app: StreetApp): RouteNode[];
/**
 * Assemble a route tree from a flat list of (method, path) operations. Exposed
 * separately from {@link buildRouteTree} so it can be exercised directly against
 * a known route set without standing up an application.
 */
export declare function assembleRouteTree(routes: ReadonlyArray<{
    method: string;
    path: string;
}>): RouteNode[];
/**
 * Flatten a route tree back to the set of registered routes (the leaves). Useful
 * for asserting that a tree reflects exactly the routes it was built from.
 */
export declare function flattenRouteTree(nodes: ReadonlyArray<RouteNode>): Array<{
    method: string;
    path: string;
}>;
/** A module dependency graph: module identifiers and directed import edges. */
export interface DepGraph {
    /** Module identifiers (paths relative to the current working directory). */
    nodes: string[];
    /** Directed edges `[importer, imported]`. */
    edges: Array<[string, string]>;
}
/**
 * Build the module dependency graph reachable from an entry source file by
 * statically walking relative `import`/`export ... from` specifiers, reusing
 * the import-walk logic from `scripts/check-cycles.mjs`. Node identifiers are
 * paths relative to the current working directory.
 *
 * Pure with respect to the file system: it reads but never writes, and the
 * result is deterministic (nodes and edges are emitted in sorted order).
 */
export declare function buildDependencyGraph(entry: string): DepGraph;
/** A request submitted through the API Inspector. */
export interface InspectorRequest {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
}
/**
 * The outcome of an API Inspector request. On success it carries the response
 * status, headers, and body (Req 7.4). On failure `ok` is false, `error` holds
 * the error indication, and `request` retains the submitted input verbatim so
 * the inspector can keep it on screen (Req 7.5).
 */
export interface InspectorResult {
    ok: boolean;
    /** The submitted request, always retained — especially on failure (Req 7.5). */
    request: InspectorRequest;
    status?: number;
    headers?: Record<string, string>;
    body?: string;
    error?: string;
}
/** Build a successful inspector result from a response (Req 7.4). */
export declare function inspectorSuccess(request: InspectorRequest, response: {
    status: number;
    headers?: Record<string, string>;
    body?: string;
}): InspectorResult;
/**
 * Build a failed inspector result. The error indication is recorded and the
 * submitted request input is retained unchanged (Req 7.5).
 */
export declare function inspectorFailure(request: InspectorRequest, error: unknown): InspectorResult;
//# sourceMappingURL=devtools.d.ts.map