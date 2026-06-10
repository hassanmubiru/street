// src/devx/devtools.ts
// Pure, zero-runtime-dependency data builders that back the Interactive
// Developer Experience tools (Route Explorer, Dependency Graph Visualizer,
// API Inspector). Everything here uses only Node core modules so it can live
// in @streetjs/core; the browser bundle (@streetjs/devtools) consumes these
// builders to render the visual experience.
//
// - buildRouteTree(app)        → Route Explorer data (Req 7.2)
// - buildDependencyGraph(entry) → Dependency Graph Visualizer data (Req 7.3)
// - InspectorResult model       → API Inspector data (Req 7.4 / 7.5)
import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { openApiOperations } from '../security/dast.js';
/** Split a route path into its non-empty segments. `/` → []. */
function pathSegments(path) {
    return path.split('/').filter((s) => s.length > 0);
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
export function buildRouteTree(app) {
    const routes = openApiOperations(app.openApiSpec());
    return assembleRouteTree(routes);
}
/**
 * Assemble a route tree from a flat list of (method, path) operations. Exposed
 * separately from {@link buildRouteTree} so it can be exercised directly against
 * a known route set without standing up an application.
 */
export function assembleRouteTree(routes) {
    const root = { method: '', path: '' };
    // De-duplicate identical (method, path) pairs while preserving the set.
    const seen = new Set();
    const unique = routes.filter((r) => {
        const key = `${r.method.toUpperCase()} ${r.path}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    for (const route of unique) {
        const segments = pathSegments(route.path);
        let node = root;
        let prefix = '';
        for (const segment of segments) {
            prefix += `/${segment}`;
            node.children ??= [];
            let child = node.children.find((c) => c.method === '' && c.path === prefix);
            if (!child) {
                child = { method: '', path: prefix };
                node.children.push(child);
            }
            node = child;
        }
        // Attach the route itself as a leaf under its terminal structural node.
        node.children ??= [];
        node.children.push({ method: route.method.toUpperCase(), path: route.path || '/' });
    }
    sortRouteNodes(root.children ?? []);
    return root.children ?? [];
}
/** Recursively sort nodes: structural nodes by path, then leaves by method. */
function sortRouteNodes(nodes) {
    nodes.sort((a, b) => {
        const aLeaf = a.method !== '';
        const bLeaf = b.method !== '';
        if (aLeaf !== bLeaf)
            return aLeaf ? 1 : -1; // structural groups before leaves
        if (a.path !== b.path)
            return a.path < b.path ? -1 : 1;
        return a.method < b.method ? -1 : a.method > b.method ? 1 : 0;
    });
    for (const node of nodes) {
        if (node.children)
            sortRouteNodes(node.children);
    }
}
/**
 * Flatten a route tree back to the set of registered routes (the leaves). Useful
 * for asserting that a tree reflects exactly the routes it was built from.
 */
export function flattenRouteTree(nodes) {
    const out = [];
    const walk = (list) => {
        for (const node of list) {
            if (node.method !== '')
                out.push({ method: node.method, path: node.path });
            if (node.children)
                walk(node.children);
        }
    };
    walk(nodes);
    return out;
}
// Static import/export specifier scanners — mirrors scripts/check-cycles.mjs.
const IMPORT_RE = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /import\s+['"]([^'"]+)['"]/g;
/**
 * Resolve a relative ESM specifier (which uses `.js` extensions in TS source)
 * to a concrete `.ts`/`.tsx` file on disk. Returns null for bare/package
 * imports (e.g. `node:fs`), which are outside the source dependency graph.
 * Ported from `scripts/check-cycles.mjs`.
 */
function resolveSpecifier(fromFile, spec) {
    if (!spec.startsWith('.'))
        return null;
    const base = resolve(dirname(fromFile), spec);
    const candidates = [];
    if (base.endsWith('.js')) {
        const noExt = base.slice(0, -3);
        candidates.push(`${noExt}.ts`, `${noExt}.tsx`);
    }
    candidates.push(`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'));
    for (const c of candidates) {
        if (existsSync(c) && statSync(c).isFile())
            return c;
    }
    return null;
}
/** Extract the set of resolved relative-import targets from a source file. */
function importsOf(file) {
    const src = readFileSync(file, 'utf8');
    const targets = new Set();
    for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src)) !== null) {
            const spec = m[1];
            if (!spec)
                continue;
            const target = resolveSpecifier(file, spec);
            if (target)
                targets.add(target);
        }
    }
    return [...targets];
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
export function buildDependencyGraph(entry) {
    const start = resolve(entry);
    const cwd = process.cwd();
    const rel = (p) => relative(cwd, p) || p;
    const visited = new Set();
    const edgeSet = new Set();
    const edges = [];
    if (!existsSync(start) || !statSync(start).isFile()) {
        return { nodes: [], edges: [] };
    }
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
        const file = queue.shift();
        for (const target of importsOf(file)) {
            const from = rel(file);
            const to = rel(target);
            const key = `${from}\u0000${to}`;
            if (!edgeSet.has(key)) {
                edgeSet.add(key);
                edges.push([from, to]);
            }
            if (!visited.has(target)) {
                visited.add(target);
                queue.push(target);
            }
        }
    }
    const nodes = [...visited].map(rel).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    edges.sort((a, b) => (a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return { nodes, edges };
}
/** Build a successful inspector result from a response (Req 7.4). */
export function inspectorSuccess(request, response) {
    return {
        ok: true,
        request,
        status: response.status,
        headers: response.headers ?? {},
        body: response.body ?? '',
    };
}
/**
 * Build a failed inspector result. The error indication is recorded and the
 * submitted request input is retained unchanged (Req 7.5).
 */
export function inspectorFailure(request, error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
        ok: false,
        request,
        error: message || 'Request failed',
    };
}
//# sourceMappingURL=devtools.js.map