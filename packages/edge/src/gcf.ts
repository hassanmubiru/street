// packages/edge/src/gcf.ts
// Google Cloud Functions (HTTP, Express-style) adapter. GCF HTTP functions
// receive an Express-like `(req, res)` pair. This adapter shapes that request
// into a Web Fetch `Request`, dispatches through Street via `handleEdgeRequest`,
// and writes the `Response` back onto `res`. No firebase/functions-framework
// dependency — minimal structural types make it usable and testable standalone.

import type { StreetApp } from '@streetjs/core';
import { handleEdgeRequest } from './adapter.js';

/** Minimal Express-like request shape provided by the Functions Framework. */
export interface GcfRequest {
  method?: string;
  url?: string;            // path + query, e.g. "/users?a=1"
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
  body?: unknown;
}

/** Minimal Express-like response shape. */
export interface GcfResponse {
  status(code: number): GcfResponse;
  set(name: string, value: string): GcfResponse;
  send(body: string): void;
}

function buildUrl(req: GcfRequest): string {
  const hostHeader = req.headers['host'];
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) ?? 'gcf.local';
  const path = req.originalUrl ?? req.url ?? '/';
  return `https://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Convert a GCF (Express-like) request into a Web Fetch Request. */
export function gcfRequestToRequest(req: GcfRequest): Request {
  const method = (req.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.rawBody) body = req.rawBody.toString('utf8');
    else if (typeof req.body === 'string') body = req.body;
    else if (req.body != null) body = JSON.stringify(req.body);
  }
  return new Request(buildUrl(req), { method, headers, ...(body !== undefined ? { body } : {}) });
}

/**
 * Create a Google Cloud Functions HTTP handler backed by a StreetApp.
 *
 * ```ts
 * import { http } from '@google-cloud/functions-framework';
 * import { streetApp } from '@streetjs/core';
 * import { createGcfHandler } from '@streetjs/edge';
 * const street = streetApp();
 * http('api', createGcfHandler(street));
 * ```
 */
export function createGcfHandler(streetAppInstance: StreetApp): (req: GcfRequest, res: GcfResponse) => Promise<void> {
  return async (req: GcfRequest, res: GcfResponse): Promise<void> => {
    const request = gcfRequestToRequest(req);
    const response = await handleEdgeRequest(request, streetAppInstance);
    res.status(response.status);
    response.headers.forEach((value, key) => { res.set(key, value); });
    res.send(await response.text());
  };
}
