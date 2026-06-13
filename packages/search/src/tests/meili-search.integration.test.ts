// meili-search.integration.test.ts
// Integration tests for the Meilisearch provider against a live instance.
// Gated on MEILI_HOST so the suite stays green without Meilisearch.
//
//   MEILI_HOST=http://127.0.0.1:7700 MEILI_KEY=street_test_key \
//   npm run test -w packages/search

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SearchService, MeilisearchProvider } from '../index.js';

const HOST = process.env['MEILI_HOST'];

describe('MeilisearchProvider (live Meilisearch)', { skip: !HOST ? 'MEILI_HOST not set' : false }, () => {
  let s: SearchService;

  before(() => {
    s = new SearchService({
      provider: new MeilisearchProvider({
        host: HOST!,
        apiKey: process.env['MEILI_KEY'],
        index: `it_search_${Date.now()}`,
        filterableAttributes: ['kind', 'color'],
      }),
    });
  });

  beforeEach(async () => {
    await s.clear();
    await s.indexAll([
      { id: '1', text: 'The quick brown fox', attributes: { kind: 'animal', color: 'brown' } },
      { id: '2', text: 'A quick red fox jumps', attributes: { kind: 'animal', color: 'red' } },
      { id: '3', text: 'Slow green turtle', attributes: { kind: 'animal', color: 'green' } },
      { id: '4', text: 'Quick running rabbits', attributes: { kind: 'animal', color: 'white' } },
      { id: '5', text: 'A red sports car', attributes: { kind: 'vehicle', color: 'red' } },
    ]);
  });

  it('full-text searches and returns documents with attributes', async () => {
    const res = await s.search('fox');
    assert.deepEqual(res.hits.map((h) => h.id).sort(), ['1', '2']);
    assert.equal(res.hits[0]!.document.attributes!['kind'], 'animal');
    assert.ok(res.total >= 2);
  });

  it('applies attribute filters', async () => {
    const res = await s.search('red', { filter: { kind: 'vehicle' } });
    assert.deepEqual(res.hits.map((h) => h.id), ['5']);
  });

  it('computes facet counts', async () => {
    const res = await s.search('quick', { facets: ['color'] });
    const total = (res.facets!['color'] ?? []).reduce((a, f) => a + f.count, 0);
    assert.ok(total >= 1);
    assert.ok(res.hits.length >= 1);
  });

  it('reflects removals', async () => {
    assert.equal(await s.remove('1'), true);
    const res = await s.search('fox');
    assert.deepEqual(res.hits.map((h) => h.id), ['2']);
  });

  it('suggests prefix terms drawn from matching documents', async () => {
    const out = await s.suggest('qu');
    assert.ok(out.includes('quick'));
  });
});
