// Verification Artifact subsystem — shared status types (zero runtime deps).
//
// These are the shared type definitions used across the verification
// subsystem. The `classify()` status engine that consumes `ClassifyInput`
// lives alongside these types (task 1.1). This module uses only Node core
// concepts and declares no runtime dependencies.

/**
 * The four — and only four — Verification Statuses a capability may hold
 * (Requirement 1.1).
 */
export type VerificationStatus =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'NOT_IMPLEMENTED';

/**
 * The four evidence components a VERIFIED capability must have, recorded as
 * present/absent for each (Requirements 1.3 / 1.4).
 */
export interface EvidenceComponents {
  /** Capability has source code. */
  sourceCode: boolean;
  /** Automated tests executed and exited with code 0. */
  passingTests: boolean;
  /** Published documentation exists. */
  documentation: boolean;
  /** A Verification Artifact was produced by an executed command. */
  artifact: boolean;
}

/**
 * Records the specific external prerequisite that prevented verification
 * (Requirements 1.5 / 1.10).
 */
export interface BlockedReason {
  /** Identifier of the specific missing external prerequisite. */
  missingPrerequisite: string;
  /** The category of the missing prerequisite. */
  kind: 'service' | 'credential' | 'runtime' | 'timeout';
}

/**
 * Input to the status engine's `classify()` function.
 */
export interface ClassifyInput {
  hasSourceCode: boolean;
  evidence: EvidenceComponents;
  /** Set when an external prerequisite is unavailable. */
  blocked?: BlockedReason | null;
  /** The exit code of the executed verification command (Requirement 1.9). */
  commandExitCode: number;
  /** True if the command was killed for exceeding the timeout (Requirement 1.10). */
  timedOut: boolean;
}

/**
 * Assign exactly one Verification Status using the REQUIRED precedence
 * (Requirement 1.2):
 *
 *   NOT_IMPLEMENTED → BLOCKED → VERIFIED → PARTIAL
 *
 * Rules:
 *  - no source code                              → NOT_IMPLEMENTED (Req 1.6)
 *  - timed out OR a blocked reason is set        → BLOCKED         (Req 1.5/1.10)
 *  - all four evidence present AND exit code 0   → VERIFIED        (Req 1.3)
 *  - otherwise (≥1 but <4 evidence, or non-zero
 *    exit code)                                  → PARTIAL         (Req 1.4/1.9)
 *
 * Pure and deterministic: the same input always yields the same status.
 */
export function classify(input: ClassifyInput): VerificationStatus {
  // Precedence step 1 — NOT_IMPLEMENTED: no source code (Req 1.6).
  if (!input.hasSourceCode) {
    return 'NOT_IMPLEMENTED';
  }

  // Precedence step 2 — BLOCKED: timed out or an external prerequisite is
  // missing (Req 1.5 / 1.10).
  if (input.timedOut || (input.blocked !== undefined && input.blocked !== null)) {
    return 'BLOCKED';
  }

  // Precedence step 3 — VERIFIED: all four evidence components present AND the
  // verification command exited 0 (Req 1.3).
  const { evidence } = input;
  const allEvidencePresent =
    evidence.sourceCode &&
    evidence.passingTests &&
    evidence.documentation &&
    evidence.artifact;
  if (allEvidencePresent && input.commandExitCode === 0) {
    return 'VERIFIED';
  }

  // Precedence step 4 — PARTIAL: at least one but not all evidence components,
  // or a non-zero exit code (Req 1.4 / 1.9).
  return 'PARTIAL';
}
