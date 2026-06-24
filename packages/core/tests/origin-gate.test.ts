import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import fc from 'fast-check';

import { isOriginAllowed } from '../src/websocket/server.js';

// Feature: security-hardening, Property 3: An upgrade passes the origin gate iff its origin is permitted
//
// For any upgrade request (with a generated `Origin` and `Host`) and any
// `allowedOrigins` configuration, the origin gate SHALL permit the upgrade if and
// only if:
//   - the `Origin` header is absent; OR
//   - when `allowedOrigins` is configured (non-empty), the normalized `Origin` is a
//     member of the normalized `allowedOrigins`; OR
//   - when `allowedOrigins` is unconfigured/empty, the normalized `Origin` equals the
//     server's derived self-origin.
// A malformed (unparseable) `Origin` SHALL be rejected.
//
// Validates: Requirements 3.2, 3.3, 3.4, 3.7

// ---- minimal fake IncomingMessage ------------------------------------------

/**
 * Minimal fake `IncomingMessage` exposing only the surface `isOriginAllowed`
 * reads: `headers.origin`, `headers.host`, and `socket.encrypted`. An `undefined`
 * `origin` / `host` is modeled by omitting the header key entirely (mirroring how
 * Node populates `req.headers`).
 */
function makeReq(
  origin: string | undefined,
  host: string | undefined,
  encrypted: boolean,
): IncomingMessage {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.origin = origin;
  if (host !== undefined) headers.host = host;
  return { headers, socket: { encrypted } } as unknown as IncomingMessage;
}

// ---- independent oracle -----------------------------------------------------

/**
 * Independent normalization via `node:url` (re-derived here rather than importing
 * the module helper, so the oracle does not merely echo the implementation).
 * Returns `null` when the value cannot be parsed as a URL.
 */
function norm(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** The Property 3 predicate, expressed independently from `isOriginAllowed`. */
function oracle(
  origin: string | undefined,
  host: string | undefined,
  encrypted: boolean,
  allowedOrigins: string[] | undefined,
): boolean {
  if (origin === undefined) return true; // absent Origin => allowed
  const o = norm(origin);
  if (o === null) return false; // malformed Origin => rejected
  if (allowedOrigins && allowedOrigins.length > 0) {
    const set = new Set(
      allowedOrigins.map(norm).filter((x): x is string => x !== null),
    );
    return set.has(o); // configured list => membership (Req 3.3 / 3.4)
  }
  // unconfigured/empty => must equal derived self-origin (Req 3.2)
  const self = host === undefined ? null : norm(`${encrypted ? 'https' : 'http'}://${host}`);
  return self !== null && o === self;
}

// ---- generators -------------------------------------------------------------

// Hosts used both to derive the server's self-origin and (via the matching valid
// origins below) to produce same-origin and cross-origin Origin candidates.
const KNOWN_HOSTS = [
  'example.com',
  'example.com:8080',
  'localhost:3000',
  'api.test.io',
  'sub.example.com:443',
  '127.0.0.1:9000',
];

// Parseable origin strings. Overlaps with KNOWN_HOSTS-derived self origins so the
// same-origin branch is exercised, and overlaps with allowedOrigins so the
// membership branch is exercised.
const VALID_ORIGINS = [
  'http://example.com',
  'https://example.com',
  'http://localhost:3000',
  'https://api.test.io',
  'http://evil.com',
  'https://app.example.com:8080',
  'http://other.org:1234',
];

// Strings exercising the malformed / edge branch. (The oracle and implementation
// both rely on `new URL`, so they agree regardless of how each parses.)
const MALFORMED = ['', 'not a url', 'http://', '://nohost', 'ht!tp://x', 'justtext', '   '];

const originHeaderArb = fc.oneof(
  fc.constant(undefined), // absent
  fc.constantFrom(...VALID_ORIGINS), // member / non-member / same-origin
  fc.constantFrom(...MALFORMED), // malformed
);

const hostArb = fc.oneof(fc.constant(undefined), fc.constantFrom(...KNOWN_HOSTS));

const allowedOriginsArb = fc.oneof(
  fc.constant<string[] | undefined>(undefined), // unconfigured => same-origin default
  fc.constant<string[]>([]), // empty => same-origin default
  fc.array(fc.constantFrom(...VALID_ORIGINS, ...MALFORMED), { maxLength: 5 }),
);

// ---- property ---------------------------------------------------------------

describe('Property 3: an upgrade passes the origin gate iff its origin is permitted', () => {
  it('permits iff Origin is absent, a configured member, or the same-origin default', () => {
    fc.assert(
      fc.property(
        originHeaderArb,
        hostArb,
        fc.boolean(),
        allowedOriginsArb,
        (origin, host, encrypted, allowed) => {
          const req = makeReq(origin, host, encrypted);

          const actual = isOriginAllowed(req, allowed);
          const expected = oracle(origin, host, encrypted, allowed);

          assert.equal(
            actual,
            expected,
            `origin gate mismatch for origin=${JSON.stringify(origin)} host=${JSON.stringify(
              host,
            )} encrypted=${encrypted} allowedOrigins=${JSON.stringify(allowed)}`,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
