// Dating App — StreetJS reference application.
// A dating backend over @streetjs/dating-profiles: encrypted profiles, likes,
// and reciprocal matching. Bios are encrypted at rest via the core FieldCipher.
// Exported as createDating(); run for HTTP.

import { createServer as createHttp } from 'node:http';
import { randomBytes } from 'node:crypto';
import { ProfileService } from '@streetjs/dating-profiles';
import { FieldCipher, Keyring } from 'streetjs';

export function createDating(opts = {}) {
  const cipher = opts.cipher ?? new FieldCipher(Keyring.fromKey(randomBytes(32)));
  const profiles = new ProfileService({ cipher });

  const http = createHttp((req, res) => {
    if (req.url === '/health/live' || req.url === '/health/ready') return json(res, 200, { status: 'ok' });
    json(res, 404, { error: 'not found' });
  });

  return { profiles, http, listen(p = 0) { return new Promise((r) => http.listen(p, () => r(http.address().port))); }, close() { return new Promise((r) => http.close(r)); } };
}

function json(res, code, body) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createDating();
  const port = await app.listen(Number(process.env.PORT) || 3000);
  console.log(`[dating] listening on http://0.0.0.0:${port}`);
}
