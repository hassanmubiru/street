// @streetjs/next — Next.js server/edge helpers over @streetjs/client.
// Framework-thin and edge-compatible (fetch-based); no StreetJS core, no Next
// internals imported. Use in Server Components, Route Handlers, and middleware.

import { createStreetClient, type StreetClient, type StreetClientConfig } from '@streetjs/client';

/** Parse a Cookie header into a name→value map (edge-safe, no deps). */
export function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export interface ServerClientOptions extends Omit<StreetClientConfig, 'getToken'> {
  /** Explicit bearer token (e.g. from cookies()/headers() in an RSC). */
  token?: string | null;
  /** Raw Cookie header to extract the token from. */
  cookieHeader?: string | null;
  /** Cookie name holding the token. Default 'street_token'. */
  tokenCookie?: string;
}

/**
 * Build a StreetJS client for server-side use (Server Components, Route Handlers,
 * Edge middleware). Resolves the bearer token from an explicit `token` or from a
 * Cookie header. Defaults to `credentials: 'include'` so cookie-based sessions
 * forward automatically when no explicit token is supplied.
 */
export function createServerClient(opts: ServerClientOptions): StreetClient {
  const tokenCookie = opts.tokenCookie ?? 'street_token';
  const fromCookie = opts.cookieHeader ? parseCookies(opts.cookieHeader)[tokenCookie] : undefined;
  const token = opts.token ?? fromCookie ?? null;
  const { token: _t, cookieHeader: _c, tokenCookie: _tc, ...rest } = opts;
  void _t; void _c; void _tc;
  return createStreetClient({
    ...rest,
    credentials: rest.credentials ?? 'include',
    getToken: () => token,
  });
}

/** Build an edge-compatible client (alias — the client is already fetch-based). */
export const createEdgeClient = createServerClient;

export { createStreetClient } from '@streetjs/client';
export type { StreetClient, StreetClientConfig } from '@streetjs/client';
