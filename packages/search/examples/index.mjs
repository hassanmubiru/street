// Runnable example: indexing, ranked search, filters, facets, and suggestions.
//
//   npm run example -w packages/search
//
// Uses the in-memory provider (no database required).

import { SearchService } from '@streetjs/search';

const search = new SearchService();

await search.indexAll([
  { id: 'p1', text: 'Quick brown leather boots', attributes: { category: 'shoes', color: 'brown' } },
  { id: 'p2', text: 'Red running shoes quick', attributes: { category: 'shoes', color: 'red' } },
  { id: 'p3', text: 'Brown wool scarf', attributes: { category: 'accessories', color: 'brown' } },
  { id: 'p4', text: 'Quick quick energy drink', attributes: { category: 'food', color: 'green' } },
]);

console.log('search "quick" (ranked by term frequency):');
for (const h of (await search.search('quick')).hits) {
  console.log(`  ${h.id}  score=${h.score}  "${h.document.text}"`);
}

console.log('\nsearch "brown" filtered to category=shoes:');
console.log((await search.search('brown', { filter: { category: 'shoes' } })).hits.map((h) => h.id));

console.log('\nsearch "quick" with color facets:');
const faceted = await search.search('quick', { facets: ['color'] });
console.log('  hits:', faceted.hits.map((h) => h.id));
console.log('  facets.color:', faceted.facets.color);

console.log('\nsuggest "qu":', await search.suggest('qu'));
console.log('suggest "br":', await search.suggest('br'));

console.log('\npagination (limit 1):');
const page1 = await search.search('quick', { limit: 1 });
const page2 = await search.search('quick', { limit: 1, offset: 1 });
console.log('  page1:', page1.hits.map((h) => h.id), 'page2:', page2.hits.map((h) => h.id), 'total:', page1.total);
