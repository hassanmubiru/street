// packages/client/src/ai.ts
// AI streaming over an SSE-style response body. Parses `data:` lines from a
// fetch ReadableStream; framework-agnostic and testable with a mock stream.

import { StreetApiError } from './errors.js';
import { buildUrl, type StreetClientConfig, type FetchLike } from './http.js';

/** Parse an SSE text buffer into complete `data:` payloads, returning the remainder. */
export function parseSseChunk(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buffer;
  let idx: number;
  // SSE events are separated by a blank line (\n\n).
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (data) events.push(data);
  }
  return { events, rest };
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

/**
 * Stream an AI chat completion. Yields text tokens as they arrive. The server is
 * expected to send SSE `data:` lines; a literal `[DONE]` ends the stream.
 */
export async function* streamChat(
  config: StreetClientConfig,
  params: { messages: ChatMessage[]; model?: string; path?: string; signal?: AbortSignal },
): AsyncGenerator<string, void, unknown> {
  const doFetch: FetchLike = config.fetch ?? (globalThis as { fetch?: FetchLike }).fetch!;
  const url = buildUrl(config.baseUrl, params.path ?? '/ai/chat');
  const headers: Record<string, string> = {
    'content-type': 'application/json', accept: 'text/event-stream', ...config.headers,
  };
  const token = config.getToken ? await config.getToken() : undefined;
  if (token) headers['authorization'] = `Bearer ${token}`;

  const init: RequestInit = {
    method: 'POST', headers,
    body: JSON.stringify({ messages: params.messages, ...(params.model ? { model: params.model } : {}), stream: true }),
  };
  if (config.credentials) init.credentials = config.credentials;
  if (params.signal) init.signal = params.signal;

  const res = await doFetch(url, init);
  if (!res.ok) throw new StreetApiError(res.status, `AI stream failed with status ${res.status}`);
  if (!res.body) return;

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;
    for (const ev of events) {
      if (ev === '[DONE]') return;
      yield ev;
    }
  }
}
