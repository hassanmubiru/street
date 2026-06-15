// Zero-dependency site audit for the Jekyll docs/ site:
//  • collects every page's permalink + front-matter (title/description) presence
//  • collects internal links ("](/...)" and href="/...") and flags any that
//    don't resolve to a known permalink (broken internal links)
// Emits a summary; writes nothing (the caller redirects output into a report).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DOCS = 'docs';
const pages = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e.startsWith('_') || e === 'assets' || e === 'vendor' || e === 'node_modules') continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (e.endsWith('.md') || e.endsWith('.html')) pages.push(p);
  }
}
walk(DOCS);

function frontMatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim();
  }
  return fm;
}

const permalinks = new Set(['/']);
const meta = [];
for (const p of pages) {
  const src = readFileSync(p, 'utf8');
  const fm = frontMatter(src);
  const rel = relative(DOCS, p);
  let permalink = fm?.permalink;
  if (permalink) {
    permalinks.add(permalink.replace(/\/$/, '') || '/');
    permalinks.add(permalink);
  }
  meta.push({ rel, permalink: permalink ?? null, title: fm?.title ?? null, description: fm?.description ?? null, hasFm: !!fm });
}

// Normalize a link to a comparable permalink form.
const norm = (l) => {
  let s = l.split('#')[0].split('?')[0];
  s = s.replace(/^\{\{\s*site\.baseurl\s*\}\}/, '').replace(/^\/street/, '');
  if (s === '') s = '/';
  return s.replace(/\/$/, '') || '/';
};

const internalBroken = [];
const linkRe = /\]\((\/[^)\s]*)\)|href=["'](\/[^"'#]*|\{\{\s*site\.baseurl\s*\}\}\/[^"'#]*)["']/g;
// A link resolves if it matches a known permalink OR a real file path
// (docs/<path>.md|.html or docs/<path>/index.md) — Jekyll serves both.
function fileResolves(n) {
  const base = n.replace(/^\//, '').replace(/\/$/, '');
  if (base === '') return true;
  const candidates = [
    join(DOCS, base + '.md'), join(DOCS, base + '.html'),
    join(DOCS, base, 'index.md'), join(DOCS, base, 'index.html'),
  ];
  return candidates.some((c) => { try { return statSync(c).isFile(); } catch { return false; } });
}
for (const p of pages) {
  const src = readFileSync(p, 'utf8');
  for (const m of src.matchAll(linkRe)) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    if (/\.(png|svg|jpg|jpeg|gif|ico|css|js|json|xml|webmanifest|txt)$/i.test(raw)) continue; // assets
    const n = norm(raw);
    const resolves = permalinks.has(n) || permalinks.has(n + '/') || fileResolves(n) || /\.md$/.test(raw) && fileResolves(n);
    if (!resolves) internalBroken.push({ from: relative(DOCS, p), link: raw, normalized: n });
  }
}

const missingTitle = meta.filter((m) => m.hasFm && !m.title);
const missingDesc = meta.filter((m) => m.hasFm && !m.description);
const noFm = meta.filter((m) => !m.hasFm && m.rel.endsWith('.md'));

console.log(`PAGES=${pages.length} PERMALINKS=${permalinks.size}`);
console.log(`MISSING_TITLE=${missingTitle.length} MISSING_DESC=${missingDesc.length} NO_FRONTMATTER=${noFm.length}`);
console.log(`BROKEN_INTERNAL_LINKS=${internalBroken.length}`);
console.log('---BROKEN---');
for (const b of internalBroken.slice(0, 60)) console.log(`${b.from}  ->  ${b.link}`);
console.log('---NO_FM---');
for (const m of noFm.slice(0, 40)) console.log(m.rel);
console.log('---MISSING_DESC---');
for (const m of missingDesc.slice(0, 40)) console.log(`${m.rel} (${m.permalink ?? 'no permalink'})`);
