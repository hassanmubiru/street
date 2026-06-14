// packages/client/src/errors.ts

/** Thrown when the StreetJS backend returns a non-2xx response. */
export class StreetApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Parsed response body, when available. */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'StreetApiError';
  }
}

/** Thrown for client misconfiguration (e.g. missing fetch/WebSocket). */
export class StreetClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreetClientError';
  }
}
