import type { MiddlewareFn } from '../core/types.js';
export declare class InjectedFaultError extends Error {
    constructor(message?: string);
}
export interface FaultPolicy {
    /** Probability [0,1] that a call fails. Default 0. */
    errorRate?: number;
    /** Fixed latency (ms) added before each call resolves. Default 0. */
    latencyMs?: number;
    /** Begin failing only after this many calls have been made. */
    failAfter?: number;
    /** Deterministically fail every Nth call (1-based). */
    failEvery?: number;
    /** Seed for the probabilistic error-rate decisions. Default 1. */
    seed?: number;
    /** Error factory for injected failures. Default throws InjectedFaultError. */
    error?: () => Error;
}
/**
 * Injects configured faults (latency, probabilistic errors, fail-after-N,
 * fail-every-N) into async operations. Counts every attempt so policies are
 * applied consistently; with a fixed `seed`, error-rate decisions are
 * reproducible.
 */
export declare class FaultInjector {
    private calls;
    private readonly rand;
    private readonly policy;
    constructor(policy?: FaultPolicy);
    /** Number of attempts observed so far. */
    get callCount(): number;
    /** Decide whether the current (already-incremented) call should fail. */
    private shouldFail;
    /** Run an operation under the fault policy: optional latency, then maybe throw. */
    run<T>(op: () => Promise<T> | T): Promise<T>;
    /** Wrap a function so every invocation runs under {@link run}. */
    wrap<A extends unknown[], R>(fn: (...args: A) => Promise<R> | R): (...args: A) => Promise<R>;
    /** Reset the call counter (PRNG state is preserved). */
    reset(): void;
}
/**
 * HTTP chaos middleware: injects latency and synthetic `503` responses
 * (via {@link ServiceUnavailableException}) according to the policy, so you can
 * exercise client retry/timeout behaviour against a live server.
 */
export declare function chaosMiddleware(policy?: FaultPolicy): MiddlewareFn;
/**
 * Retry an operation with exponential backoff. Provided as the resilience
 * counterpart to {@link FaultInjector} so tests can prove that injected faults
 * are survived. Returns the first success or throws the last error.
 */
export declare function retryWithBackoff<T>(op: () => Promise<T>, opts?: {
    retries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}): Promise<T>;
//# sourceMappingURL=chaos.d.ts.map