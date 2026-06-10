import type { VerificationArtifact } from '../verification/artifact.js';
export type DastSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export interface DastFinding {
    tool: string;
    name: string;
    severity: DastSeverity;
    url?: string;
    description?: string;
}
export interface OpenApiValidationResult {
    valid: boolean;
    errors: string[];
}
/**
 * Structurally validate an OpenAPI 3.x document well enough to drive a DAST
 * scanner: must declare `openapi: 3.x`, an `info` object with title+version,
 * and a `paths` object whose entries map HTTP methods to operation objects.
 */
export declare function validateOpenApiDocument(doc: unknown): OpenApiValidationResult;
export interface OpenApiOperationTarget {
    method: string;
    path: string;
}
/** Enumerate the (method, path) operations a scanner should exercise. */
export declare function openApiOperations(doc: unknown): OpenApiOperationTarget[];
export interface ConformanceScanOptions {
    /** Base URL of the running target, e.g. 'http://127.0.0.1:8080'. */
    baseUrl: string;
    /** HTTP methods to exercise. Default ['GET'] (no request-body synthesis). */
    methods?: string[];
    /** Optional bearer token for authenticated scans. */
    token?: string;
    /** Value substituted for path params like {id}. Default 'dast-probe'. */
    pathParamValue?: string;
    /** Per-request timeout (ms). Default 5000. */
    timeoutMs?: number;
}
/**
 * Exercise every enumerated OpenAPI operation against a live target and report
 * security/robustness findings: a 5xx response or a connection failure is a
 * High finding (the server crashed or errored on a well-formed request derived
 * from its own contract). Runs in-process with no external tooling — the
 * offline counterpart to a Schemathesis scan. Combine with {@link evaluateDastGate}.
 */
export declare function openApiConformanceScan(doc: unknown, opts: ConformanceScanOptions): Promise<DastFinding[]>;
/**
 * Parse an OWASP ZAP baseline JSON report into normalized findings, expanding
 * each alert's instances into individual URL-scoped findings.
 */
export declare function parseZapReport(report: unknown): DastFinding[];
export interface DastGateOptions {
    /** Minimum severity that fails the gate. Default 'high'. */
    failOn?: DastSeverity;
}
export interface DastGateResult {
    passed: boolean;
    /** Deterministic process exit code: 0 pass, 2 fail. */
    exitCode: number;
    failOn: DastSeverity;
    counts: Record<DastSeverity, number>;
    offending: DastFinding[];
}
/** Count findings by severity. */
export declare function summarizeFindings(findings: DastFinding[]): Record<DastSeverity, number>;
/**
 * Evaluate the DAST gate: fail (exit code 2) if any finding is at or above the
 * `failOn` severity (default 'high'); otherwise pass (exit code 0).
 */
export declare function evaluateDastGate(findings: DastFinding[], opts?: DastGateOptions): DastGateResult;
/**
 * Cause of a failed DAST run that is not itself a finding: the target never
 * became reachable, a scanner errored out, or the run exceeded its time budget.
 */
export type DastFailureCause = 'target-unavailable' | 'scan-error' | 'timeout';
/** Schema-validated `details` payload of a DAST {@link VerificationArtifact}. */
export interface DastArtifactDetails {
    /** Finding count at each severity: Critical/High/Medium/Low/Info (Req 3.7). */
    counts: Record<DastSeverity, number>;
    /** Number of OpenAPI-enumerated endpoints actually scanned. */
    endpointsScanned: number;
    /** Total endpoints that should have been scanned; 100% coverage check (Req 3.2). */
    endpointsTotal: number;
    /** The Severity Gate outcome recorded with the run (Req 3.3/3.4/3.5/3.6). */
    gate: {
        failOn: DastSeverity;
        passed: boolean;
    };
    /** Set when the run failed without producing findings (Req 3.8/3.9). */
    failureCause?: DastFailureCause;
    /** The scanners the run drove, e.g. schemathesis, zap-baseline, zap-api. */
    tools: string[];
}
/** Run metadata accompanying the collected findings. */
export interface DastArtifactMeta {
    endpointsScanned: number;
    endpointsTotal: number;
    /** Present iff the run failed outside the finding stream (Req 3.8/3.9). */
    failureCause?: DastFailureCause;
}
/**
 * Build a DAST {@link VerificationArtifact} from collected findings plus run
 * metadata. The Severity Gate is evaluated via {@link evaluateDastGate}; the
 * artifact records per-severity counts (Req 3.7), endpoint coverage (Req 3.2),
 * the gate outcome (Req 3.3), and — when the run failed outside the finding
 * stream — the failure cause (Req 3.8/3.9).
 *
 * Status assignment (via the shared {@link classify} engine):
 *  - a `failureCause` ⇒ BLOCKED, with the cause mapped to a `blockedReason`
 *    (`timeout` also sets `timedOut`); the build fails (exit code 2).
 *  - otherwise the gate must pass AND every endpoint must have been scanned for
 *    a clean (exit code 0) VERIFIED run; a gate failure or incomplete coverage
 *    yields a non-zero exit code and a PARTIAL status.
 *
 * Pure and deterministic: the timestamp is the only non-input-derived field.
 */
export declare function buildDastArtifact(findings: DastFinding[], meta: DastArtifactMeta, gateOpts?: DastGateOptions): VerificationArtifact;
//# sourceMappingURL=dast.d.ts.map