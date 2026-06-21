// @streetjs/plugin-htmx — dependency-free view engine.
//
// A tiny, owned template engine (no third-party runtime dependency), consistent
// with the StreetJS "minimal dependencies" philosophy. Supports:
//   {{ path }}    HTML-escaped interpolation
//   {{{ path }}}  raw (unescaped) interpolation
//   {{> name }}   partial include (resolved via a partial resolver)
//   layouts       a layout template with a {{{ body }}} placeholder
//
// Loops/conditionals are intentionally omitted in v1 — compose lists by rendering
// partials in the controller. See the docs roadmap.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ESC: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/** HTML-escape a value (null/undefined render as empty string). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Resolve a dotted path (e.g. "user.name") against a data object. */
export function lookup(data: Record<string, unknown>, path: string): unknown {
  if (path === '.') return data;
  let cur: unknown = data;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export type PartialResolver = (name: string) => string | undefined;

const MAX_PARTIAL_DEPTH = 16;

/**
 * Render a template string against `data`. Partials are resolved via `resolve`
 * (returns the partial's source, or undefined if unknown). Pure and synchronous.
 */
export function renderTemplate(
  src: string,
  data: Record<string, unknown> = {},
  resolve: PartialResolver = () => undefined,
  depth = 0,
): string {
  if (depth > MAX_PARTIAL_DEPTH) {
    throw new Error('[htmx] partial include depth exceeded (possible cycle)');
  }
  // 1) partials: {{> name }}
  let out = src.replace(/\{\{>\s*([\w./-]+)\s*\}\}/g, (_m, name: string) => {
    const partialSrc = resolve(name);
    if (partialSrc == null) throw new Error(`[htmx] unknown partial: "${name}"`);
    return renderTemplate(partialSrc, data, resolve, depth + 1);
  });
  // 2) raw: {{{ path }}}
  out = out.replace(/\{\{\{\s*([\w.$-]+)\s*\}\}\}/g, (_m, path: string) =>
    String(lookup(data, path) ?? ''),
  );
  // 3) escaped: {{ path }}
  out = out.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_m, path: string) =>
    escapeHtml(lookup(data, path)),
  );
  return out;
}

export interface ViewEngineOptions {
  /** Root directory containing layouts/, partials/, pages/. */
  viewsDir: string;
  /** Default layout name under layouts/ (without extension). Omit for no layout. */
  layout?: string;
  /** File extension for templates. Default: ".html". */
  ext?: string;
  /** Cache compiled template sources in memory. Default: true. */
  cache?: boolean;
}

/** A bounded in-memory view engine over a views directory. */
export class ViewEngine {
  private readonly viewsDir: string;
  private readonly defaultLayout?: string;
  private readonly ext: string;
  private readonly useCache: boolean;
  private readonly fileCache = new Map<string, string>();

  constructor(opts: ViewEngineOptions) {
    this.viewsDir = opts.viewsDir;
    this.defaultLayout = opts.layout;
    this.ext = opts.ext ?? '.html';
    this.useCache = opts.cache ?? true;
  }

  private read(relNoExt: string): string {
    const abs = join(this.viewsDir, relNoExt + this.ext);
    if (this.useCache && this.fileCache.has(abs)) return this.fileCache.get(abs)!;
    if (!existsSync(abs)) throw new Error(`[htmx] template not found: ${relNoExt}${this.ext}`);
    const src = readFileSync(abs, 'utf8');
    if (this.useCache) this.fileCache.set(abs, src);
    return src;
  }

  private resolver(): PartialResolver {
    return (name) => {
      try { return this.read('partials/' + name); } catch { return undefined; }
    };
  }

  /** Render a partial under partials/ (no layout). */
  partial(name: string, data: Record<string, unknown> = {}): string {
    return renderTemplate(this.read('partials/' + name), data, this.resolver());
  }

  /** Render a raw HTML fragment string (passthrough; here for API symmetry). */
  fragment(html: string): string {
    return html;
  }

  /**
   * Render a page under pages/. When `layout` is provided (or a default layout is
   * set and `wrap` is true), the page is injected into the layout's {{{ body }}}.
   * Pass `wrap: false` (e.g. for an HTMX request) to return just the page fragment.
   */
  view(
    page: string,
    data: Record<string, unknown> = {},
    opts: { layout?: string | null; wrap?: boolean } = {},
  ): string {
    const resolve = this.resolver();
    const body = renderTemplate(this.read('pages/' + page), data, resolve);
    const wrap = opts.wrap ?? true;
    const layoutName = opts.layout === null ? undefined : (opts.layout ?? this.defaultLayout);
    if (!wrap || !layoutName) return body;
    const layoutSrc = this.read('layouts/' + layoutName);
    return renderTemplate(layoutSrc, { ...data, body }, resolve);
  }

  /** Clear the in-memory template cache (e.g. for dev hot-reload). */
  clearCache(): void { this.fileCache.clear(); }
}
