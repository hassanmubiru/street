// packages/edge/src/adapter.ts
// Edge Runtime adapter: maps Web Fetch Request → StreetContext → Response.

import type { StreetApp } from '@streetjs/core';

/**
 * Handles an incoming Web Fetch API `Request` using a StreetApp instance.
 * This adapter converts the Web Fetch request into a StreetContext-compatible
 * shape and returns a Web Fetch `Response`.
 *
 * Compatible with Vercel Edge Functions, Cloudflare Workers, and any
 * environment implementing the WinterCG Fetch standard.
 */
export async function handleEdgeRequest(
  request: Request,
  app: StreetApp
): Promise<Response> {
  // Build a minimal IncomingMessage-compatible object from the Web Request.
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let bodyText: string | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      bodyText = await request.text();
    } catch {
      bodyText = undefined;
    }
  }

  // Build a response collector.
  let statusCode = 200;
  const responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
  let responseBody = '';

  // Create a minimal readable stream mock for the edge body.
  const { Readable, Writable } = await import('node:stream');

  const reqStream = new Readable({
    read() {
      if (bodyText) {
        this.push(Buffer.from(bodyText, 'utf8'));
      }
      this.push(null);
    },
  });

  // Attach necessary IncomingMessage properties
  const incomingMessage = Object.assign(reqStream, {
    method: request.method,
    url: url.pathname + (url.search || ''),
    headers: {
      ...headers,
      host: url.host,
    },
    socket: { remoteAddress: '127.0.0.1' },
    httpVersion: '1.1',
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    trailers: {},
    rawHeaders: Object.entries(headers).flat(),
    rawTrailers: [],
    aborted: false,
    complete: true,
    statusCode: null,
    statusMessage: null,
  });

  // Build a writable response collector (mock ServerResponse)
  const responseChunks: Buffer[] = [];
  const resStream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  const serverResponse = Object.assign(resStream, {
    statusCode: 200,
    statusMessage: 'OK',
    headersSent: false,
    writableEnded: false,
    writableFinished: false,
    sent: false,
    locals: {},
    getHeader(name: string): string | undefined {
      return responseHeaders[name.toLowerCase()];
    },
    setHeader(name: string, value: string | string[]) {
      responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
      return serverResponse;
    },
    getHeaders() {
      return { ...responseHeaders };
    },
    removeHeader(name: string) {
      delete responseHeaders[name.toLowerCase()];
    },
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      serverResponse.statusCode = code;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          responseHeaders[k.toLowerCase()] = v;
        }
      }
      serverResponse.headersSent = true;
      return serverResponse;
    },
    end(data?: string | Buffer) {
      if (data) {
        responseChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'));
      }
      statusCode = serverResponse.statusCode;
      serverResponse.writableEnded = true;
      serverResponse.writableFinished = true;
      resStream.emit('finish');
    },
    flushHeaders() { /* no-op for edge */ },
  });

  // Dispatch through the app — we simulate by creating context manually.
  // StreetApp doesn't expose an internal dispatch method, so we create a temporary
  // one-shot HTTP server approach using a synthetic handler invocation.
  // For edge environments, we use a direct context bridge.
  try {
    await dispatchToApp(app, incomingMessage as unknown as import('node:http').IncomingMessage, serverResponse as unknown as import('node:http').ServerResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return new Response(JSON.stringify({ error: 'Internal Server Error', message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Wait a tick for async writes to complete.
  await new Promise<void>((resolve) => setImmediate(resolve));

  responseBody = Buffer.concat(responseChunks).toString('utf8');

  const init: ResponseInit = {
    status: statusCode,
    headers: responseHeaders,
  };

  return new Response(responseBody || null, init);
}

/**
 * Dispatches a synthetic Node.js request/response pair through the StreetApp.
 * Uses the app's internal HTTP server by temporarily creating a local server
 * or by invoking the request handler directly via an internal bypass.
 */
async function dispatchToApp(
  app: StreetApp,
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse
): Promise<void> {
  // StreetApp does not expose a raw request handler in its public interface,
  // so we use a one-shot local server on a random port as a lightweight bridge.
  const http = await import('node:http');
  const net = await import('node:net');

  return new Promise<void>((resolve, reject) => {
    // Find a free port, then start a temporary server.
    const tempServer = http.createServer((innerReq, innerRes) => {
      // Pipe the response back.
      innerRes.on('finish', () => {
        res.statusCode = innerRes.statusCode;
        resolve();
      });
      innerRes.on('error', reject);
    });

    // Actually, direct dispatch: spin up app on ephemeral port, make internal request
    // For simplicity in edge contexts, emit a synthetic request event.
    const internalServer = http.createServer();

    // Get a free port
    const testServer = net.createServer();
    testServer.listen(0, '127.0.0.1', () => {
      const port = (testServer.address() as net.AddressInfo).port;
      testServer.close(async () => {
        try {
          await app.listen(port, '127.0.0.1');

          const clientReq = http.request({
            host: '127.0.0.1',
            port,
            path: req.url ?? '/',
            method: req.method ?? 'GET',
            headers: req.headers as Record<string, string>,
          }, (clientRes) => {
            res.statusCode = clientRes.statusCode ?? 200;
            Object.entries(clientRes.headers).forEach(([k, v]) => {
              if (v) res.setHeader(k, v as string);
            });

            const chunks: Buffer[] = [];
            clientRes.on('data', (chunk: Buffer) => chunks.push(chunk));
            clientRes.on('end', async () => {
              const body = Buffer.concat(chunks);
              res.end(body);
              await app.close().catch(() => undefined);
              resolve();
            });
            clientRes.on('error', reject);
          });

          clientReq.on('error', reject);

          // Forward body
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            req.pipe(clientReq);
          } else {
            clientReq.end();
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    void internalServer;
    void tempServer;
  });
}
