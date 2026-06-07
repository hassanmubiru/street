#!/usr/bin/env node
// scripts/check-cycles.mjs
// Dependency-free circular-import detector for the TypeScript source tree.
// Parses static `import`/`export ... from` specifiers, resolves relative paths
// to files, builds the module graph, and reports every cycle via Tarjan's SCC
// algorithm. Exits non-zero if any cycle is found.
//
// Usage: node scripts/check-cycles.mjs [rootDir ...]   (default: packages/*/src)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const roots = process.argv.slice(2);
const defaultRoots = ['packages/core/src', 'packages/cli/src', 'packages/edge/src'];
const scanRoots = (roots.length ? roots : defaultRoots).filter(existsSync);

const IMPORT_RE = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /import\s+['"]([^'"]+)['"]/g;

/** Recursively collect .ts files (excluding .d.ts). */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collect(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Resolve a relative specifier (which uses .js extensions in ESM TS) to a real .ts file. */
function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // node:/package import — not part of our graph
  let base = resolve(dirname(fromFile), spec);
  const candidates = [];
  if (base.endsWith('.js')) {
    const noExt = base.slice(0, -3);
    candidates.push(noExt + '.ts', noExt + '.tsx');
  }
  candidates.push(base + '.ts', base + '.tsx', join(base, 'index.ts'));
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

const files = scanRoots.flatMap((r) => collect(r));
const graph = new Map(); // file -> Set<file>
for (const f of files) graph.set(f, new Set());

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const target = resolveSpecifier(f, m[1]);
      if (target && graph.has(target)) graph.get(f).add(target);
    }
  }
}

// Tarjan's strongly-connected-components.
let index = 0;
const stack = [];
const onStack = new Set();
const idx = new Map();
const low = new Map();
const sccs = [];

function strongconnect(v) {
  idx.set(v, index);
  low.set(v, index);
  index++;
  stack.push(v);
  onStack.add(v);
  for (const w of graph.get(v)) {
    if (!idx.has(w)) {
      strongconnect(w);
      low.set(v, Math.min(low.get(v), low.get(w)));
    } else if (onStack.has(w)) {
      low.set(v, Math.min(low.get(v), idx.get(w)));
    }
  }
  if (low.get(v) === idx.get(v)) {
    const comp = [];
    let w;
    do {
      w = stack.pop();
      onStack.delete(w);
      comp.push(w);
    } while (w !== v);
    sccs.push(comp);
  }
}

for (const v of graph.keys()) if (!idx.has(v)) strongconnect(v);

// A cycle exists if an SCC has >1 node, or a node imports itself.
const cycles = sccs.filter((c) => c.length > 1);
for (const v of graph.keys()) if (graph.get(v).has(v)) cycles.push([v]);

const cwd = process.cwd();
const rel = (p) => relative(cwd, p);

console.log(`Scanned ${files.length} source files across: ${scanRoots.join(', ')}`);
if (cycles.length === 0) {
  console.log('No circular dependency found!');
  process.exit(0);
} else {
  console.log(`Found ${cycles.length} circular dependency group(s):`);
  for (const c of cycles) console.log('  • ' + c.map(rel).join(' -> '));
  process.exit(1);
}
