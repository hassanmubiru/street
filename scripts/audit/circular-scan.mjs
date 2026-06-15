// Zero-dependency circular-dependency scanner over built ESM output.
// Walks the relative-import graph reachable from each package's dist entry and
// reports any import cycle via DFS. No third-party deps (preserves StreetJS's
// dependency-minimal philosophy; replaces an external madge dependency).
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? '.');
const IMPORT_RE = /(?:import|export)\b[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function resolveImport(fromFile, spec) {
  let p = resolve(dirname(fromFile), spec);
  if (existsSync(p) && statSync(p).isFile()) return p;
  for (const ext of ['.js', '.mjs']) if (existsSync(p + ext)) return p + ext;
  // './foo' → './foo/index.js'
  for (const idx of ['index.js', 'index.mjs']) {
    const c = join(p, idx);
    if (existsSync(c)) return c;
  }
  if (p.endsWith('.js') && existsSync(p)) return p;
  return null;
}

function buildGraph(entry) {
  const graph = new Map();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (graph.has(file)) continue;
    let src = '';
    try { src = readFileSync(file, 'utf8'); } catch { graph.set(file, []); continue; }
    const deps = [];
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const target = resolveImport(file, spec);
      if (target) { deps.push(target); if (!graph.has(target)) stack.push(target); }
    }
    graph.set(file, deps);
  }
  return graph;
}

function findCycles(graph) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const cycles = [];
  const path = [];
  function dfs(node) {
    color.set(node, GRAY); path.push(node);
    for (const dep of graph.get(node) ?? []) {
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        const i = path.indexOf(dep);
        cycles.push(path.slice(i).concat(dep));
      } else if (c === WHITE) dfs(dep);
    }
    color.set(node, BLACK); path.pop();
  }
  for (const n of graph.keys()) if ((color.get(n) ?? WHITE) === WHITE) dfs(n);
  return cycles;
}

const pkgsDir = join(ROOT, 'packages');
let totalCycles = 0;
const offenders = [];
for (const name of readdirSync(pkgsDir)) {
  const pjPath = join(pkgsDir, name, 'package.json');
  if (!existsSync(pjPath)) continue;
  const entry = join(pkgsDir, name, 'dist', 'index.js');
  if (!existsSync(entry)) continue;
  const cycles = findCycles(buildGraph(entry));
  if (cycles.length) {
    totalCycles += cycles.length;
    const rel = (f) => f.replace(join(pkgsDir, name) + '/', '');
    offenders.push(`${name}: ${cycles.length} cycle(s)\n` +
      cycles.slice(0, 5).map((c, i) => `   ${i + 1}) ${c.map(rel).join(' → ')}`).join('\n'));
  }
}

if (totalCycles === 0) {
  console.log('✔ No circular dependencies across built packages.');
  process.exit(0);
}
console.log(`✖ Found ${totalCycles} circular dependency chain(s):`);
console.log(offenders.join('\n'));
process.exit(1);
