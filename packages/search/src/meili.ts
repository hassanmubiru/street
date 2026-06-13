// packages/search/src/meili.ts
// Meilisearch-backed SearchProvider. Implements the same SearchProvider contract
// as the in-memory and Postgres providers, so application code is unchanged.
//
// Documents are flattened ({ id, text, ...attributes }) so attributes become
// filterable/facetable fields. Filter/facet attributes must be declared via
// `filterableAttributes` (set once on the index). Meilisearch indexes
// asynchronously; write operations wait for the enqueued task to finish so
// reads are consistent.

import type {
  SearchProvider, SearchDocument, SearchResult, SearchHit, FacetValue, ResolvedSearchOptions, AttributeValue,
} from './index.js';
import { tokenize } from './index.js';

export type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface MeilisearchProviderOptions {
  host: string;
  apiKey?: string;
  index: string;
  /** Attributes that may be used in filters/facets (declared on the index). */
  filterableAttributes?: string[];
  fetch?: FetchLike;
  /** Max ms to wait for an indexing task. Default 5000. */
  taskTimeoutMs?: number;
}

export class MeilisearchProvider implements SearchProvider {
  readonly name = 'meilisearch';
  private readonly host: string;
  private readonly apiKey: string | undefined;
  private readonly index: string;
  private readonly filterable: string[];
  private readonly fetch: FetchLike;
  private readonly taskTimeoutMs: number;
  private settingsReady: Promise<void> | null = null;

  constructor(options: MeilisearchProviderOptions) {
    this.host = options.host.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.index = options.index;
    this.filterable = options.filterableAttributes ?? [];
    const g = (globalThis as { fetch?: unknown }).fetch;
    this.fetch = options.fetch ?? (g as FetchLike);
    if (typeof this.fetch !== 'function') throw new Error('MeilisearchProvider: no fetch available');
    this.taskTimeoutMs = options.taskTimeoutMs ?? 5000;
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) };
  }

  private async call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetch(`${this.host}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`meilisearch ${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  }

  private async waitForTask(enqueued: Record<string, unknown>): Promise<void> {
    const uid = enqueued['taskUid'] ?? enqueued['uid'];
    if (uid === undefined) return;
    const deadline = Date.now() + this.taskTimeoutMs;
    for (;;) {
      const task = await this.call('GET', `/tasks/${uid}`);
      const status = String(task['status']);
      if (status === 'succeeded') return;
      if (status === 'failed' || status === 'canceled') {
        throw new Error(`meilisearch task ${uid} ${status}: ${JSON.stringify(task['error'] ?? {})}`);
      }
      if (Date.now() > deadline) throw new Error(`meilisearch task ${uid} timed out`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  private ensureSettings(): Promise<void> {
    if (!this.settingsReady) {
      this.settingsReady = (async () => {
        // Create the index (idempotent) and declare filterable attributes.
        try {
          await this.waitForTask(await this.call('POST', '/indexes', { uid: this.index, primaryKey: 'id' }));
        } catch {
          // index may already exist; ignore
        }
        if (this.filterable.length > 0) {
          await this.waitForTask(
            await this.call('PUT', `/indexes/${this.index}/settings/filterable-attributes`, this.filterable),
          );
        }
      })();
    }
    return this.settingsReady;
  }

  async index(doc: SearchDocument): Promise<void> {
    await this.indexAll([doc]);
  }

  async indexAll(docs: SearchDocument[]): Promise<void> {
    if (docs.length === 0) return;
    await this.ensureSettings();
    const payload = docs.map((d) => ({ id: d.id, text: d.text, ...(d.attributes ?? {}) }));
    await this.waitForTask(await this.call('POST', `/indexes/${this.index}/documents`, payload));
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureSettings();
    await this.waitForTask(await this.call('DELETE', `/indexes/${this.index}/documents/${encodeURIComponent(id)}`));
    return true;
  }

  async clear(): Promise<void> {
    await this.ensureSettings();
    await this.waitForTask(await this.call('DELETE', `/indexes/${this.index}/documents`));
  }

  async search(query: string, options: ResolvedSearchOptions): Promise<SearchResult> {
    await this.ensureSettings();
    const filter = Object.entries(options.filter).map(([k, v]) => `${k} = ${JSON.stringify(String(v))}`);
    const body: Record<string, unknown> = {
      q: query,
      limit: options.limit,
      offset: options.offset,
      showRankingScore: true,
    };
    if (filter.length) body['filter'] = filter;
    if (options.facets.length) body['facets'] = options.facets;

    const json = await this.call('POST', `/indexes/${this.index}/search`, body);
    const rawHits = (json['hits'] as Array<Record<string, unknown>>) ?? [];
    const hits: SearchHit[] = rawHits.map((h, i) => ({
      id: String(h['id']),
      score: typeof h['_rankingScore'] === 'number' ? (h['_rankingScore'] as number) : 1 - i / Math.max(1, rawHits.length),
      document: hitToDocument(h),
    }));

    const result: SearchResult = {
      hits,
      total: Number(json['estimatedTotalHits'] ?? json['totalHits'] ?? hits.length),
    };

    const dist = json['facetDistribution'] as Record<string, Record<string, number>> | undefined;
    if (options.facets.length && dist) {
      result.facets = {};
      for (const field of options.facets) {
        const buckets = dist[field] ?? {};
        result.facets[field] = Object.entries(buckets)
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1)) as FacetValue[];
      }
    }
    return result;
  }

  async suggest(prefix: string, limit: number): Promise<string[]> {
    const p = prefix.toLowerCase();
    if (p.length === 0) return [];
    await this.ensureSettings();
    const json = await this.call('POST', `/indexes/${this.index}/search`, { q: prefix, limit: 50 });
    const hits = (json['hits'] as Array<Record<string, unknown>>) ?? [];
    const freq = new Map<string, number>();
    for (const h of hits) {
      for (const tok of new Set(tokenize(String(h['text'] ?? '')))) {
        if (tok.startsWith(p)) freq.set(tok, (freq.get(tok) ?? 0) + 1);
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([term]) => term);
  }
}

function hitToDocument(h: Record<string, unknown>): SearchDocument {
  const attributes: Record<string, AttributeValue> = {};
  for (const [k, v] of Object.entries(h)) {
    if (k === 'id' || k === 'text' || k.startsWith('_')) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') attributes[k] = v;
  }
  return { id: String(h['id']), text: String(h['text'] ?? ''), attributes };
}
