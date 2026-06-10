import type { VerificationStatus, EvidenceComponents, BlockedReason } from './status.js';
/**
 * The single Verification Artifact record (Requirement 1.7). Conforms to the
 * JSON Schema enforced by {@link validateArtifact}.
 */
export interface VerificationArtifact {
    /** Schema version discriminator; always 1 for this schema. */
    schemaVersion: 1;
    /** Dotted capability identifier, e.g. `cloud.deploy.kubernetes`. */
    capabilityId: string;
    /** The single assigned Verification Status. */
    status: VerificationStatus;
    /** Present/absent flags for each of the four evidence components. */
    evidence: EvidenceComponents;
    /** The exact command that was executed to produce this artifact. */
    command: string;
    /** The exit code of the executed command (Requirements 1.7 / 1.9). */
    exitCode: number;
    /** ISO-8601 timestamp of the verification run (Requirement 1.7). */
    timestamp: string;
    /** Wall-clock duration of the command in milliseconds. */
    durationMs?: number;
    /** True when the command was terminated for exceeding its timeout. */
    timedOut?: boolean;
    /** Present iff `status === 'BLOCKED'` — records the missing prerequisite. */
    blockedReason?: BlockedReason;
    /** Area-specific, schema-validated payload (counts, params, reports). */
    details?: Record<string, unknown>;
    /**
     * Identifies the command/tool that produced the artifact. Its presence marks
     * the artifact as command-produced rather than hand-authored (Requirement 1.8).
     */
    generator: {
        tool: string;
        version: string;
    };
}
/** Result of validating a candidate against the Verification Artifact schema. */
export interface ArtifactValidationResult {
    valid: boolean;
    errors: string[];
}
/**
 * Validate a candidate value against the Verification Artifact JSON Schema.
 *
 * Enforces all required fields, value constraints, `additionalProperties:
 * false`, and the conditional rule that `status === 'BLOCKED'` requires a
 * `blockedReason`. The `generator` object is mandatory, which is what marks the
 * artifact as command-produced rather than hand-authored (Requirement 1.8).
 *
 * Pure and deterministic: never throws, always returns a result.
 */
export declare function validateArtifact(a: unknown): ArtifactValidationResult;
//# sourceMappingURL=artifact.d.ts.map