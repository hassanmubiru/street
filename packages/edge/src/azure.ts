// packages/edge/src/azure.ts
// Azure Functions (v4 programming model) HTTP adapter. Converts an Azure
// HttpRequest into a Web Fetch `Request`, dispatches through Street via
// `handleEdgeRequest`, and returns an `HttpResponseInit`. No @azure/functions
// dependency — a minimal structural request type is accepted so the adapter is
// usable and testable without the Azure runtime installed.

import type { StreetApp } from '@streetjs/core';
import { handleEdgeRequest } from './adapter.js';

/** Minimal structural shape of an Azure Functions v4 HttpRequest. */
export interface AzureHttpRequest {
  method?: string;
  url?: string;
  headers: { entries?: () => IterableIterator<[string, string]>; get?: (k: string) => string | null } | Record<string, string>;
  query?: { entries?: () => IterableIterator<[string, string]> } | Record<string, string>;
  text?: () => Promise<string>;
}

export interface AzureHttpResponseInit {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function headersToObject(h: AzureHttpRequest['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if (h && typeof (h as { entries?: unknown }).entries === 'function') {
    for (const [k, v] of (h as { entries: () => IterableIterator<[string, string]> }).entries()) out[k] = v;
  } else {
    for (const [k, v] of Object.entries(h as Record<string, string>)) out[k] = v;
  }
  return out;
}

/** Convert an Azure HttpRequest into a Web Fetch Request. */
export async function azureRequestToRequest(req: AzureHttpRequest): Promise<Request> {
  const method = (req.method ?? 'GET').toUpperCase();
  const url = req.url ?? 'https://azure.local/';
  const headers = new Headers(headersToObject(req.headers));
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD' && typeof req.text === 'function') {
    try { body = await req.text(); } catch { body = undefined; }
  }
  return new Request(url, { method, headers, ...(body !== undefined ? { body } : {}) });
}

/** Convert a Web Fetch Response into an Azure HttpResponseInit. */
export async function responseToAzure(res: Response): Promise<AzureHttpResponseInit> {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, body: await res.text() };
}

/**
 * Create an Azure Functions v4 HTTP handler backed by a StreetApp.
 *
 * ```ts
 * import { app } from '@azure/functions';
 * import { streetApp } from '@streetjs/core';
 * import { createAzureHandler } from '@streetjs/edge';
 * const street = streetApp();
 * app.http('api', { route: '{*path}', handler: createAzureHandler(street) });
 * ```
 */
export function createAzureHandler(streetAppInstance: StreetApp): (req: AzureHttpRequest) => Promise<AzureHttpResponseInit> {
  return async (req: AzureHttpRequest): Promise<AzureHttpResponseInit> => {
    const request = await azureRequestToRequest(req);
    const response = await handleEdgeRequest(request, streetAppInstance);
    return responseToAzure(response);
  };
}
