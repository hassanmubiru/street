const x = require('fs').readFileSync('/tmp/sitemap.xml', 'utf8');
const base = 'https://hassanmubiru.github.io/StreetJS/';
const locs = [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(base, '/'));
console.log('total URLs:', locs.length);
console.log('valid XML root:', x.includes('<urlset'));
console.log('all correct base:', locs.every(u => u.startsWith('/')));
console.log('has lastmod:', /<lastmod>/.test(x));

// flag anything that looks non-public
const flag = locs.filter(u => /AUDIT|REPORT|CERTIF|ROLLBACK|GAP|READINESS|HARDENING|VERIFICATION|WORKFLOW|README|strategy|LAUNCH|PROGRAM|THREAT|\.html$|decision-records|certification/i.test(u));
console.log('\n--- POSSIBLY NON-PUBLIC / .html / internal (' + flag.length + ') ---');
flag.forEach(u => console.log('  ', u));

// list all .html (uppercase or odd) entries
const htmls = locs.filter(u => u.endsWith('.html'));
console.log('\n--- all .html entries (' + htmls.length + ') ---');
htmls.forEach(u => console.log('  ', u));
