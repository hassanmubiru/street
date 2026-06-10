import type { BlockedReason, EvidenceComponents } from './status.js';
import type { VerificationArtifact } from './artifact.js';
/** The default verification command timeout: 300 seconds (Requirement 1.10). */
export declare const DEFAULT_TIMEOUT_MS = 300000;
/**
 * Inputs to a single verification run. The runner executes `command` (with any
 * `args`), then derives a Verification Artifact from the result.
 */
export interface RunOptions {
    /** Dotted capability identifier, e.g. `cloud.deploy.kubernetes`. */
    capabilityId: string;
    /** Shell command to execute. */
    command: string;
    /** Optional explicit argument vector; when provided the command is not run via a shell. */
    args?: string[];
    /** Working directory for the spawned process. */
    cwd?: string;
    /** Extra environment variables, merged over `process.env`. */
    env?: Record<string, string>;
    /** Command timeout in milliseconds; defaults to {@link DEFAULT_TIMEOUT_MS} (Req 1.10). */
    timeoutMs?: number;
    /** Static facts the runner cannot infer (e.g. docs present? source present?). */
    evidenceHints?: Partial<EvidenceComponents>;
    /** Prerequisite probes; if any resolves to a `BlockedReason`, the run is BLOCKED. */
    prerequisites?: Array<() => Promise<BlockedReason | null>>;
    /** Output directory for the artifact, e.g. `verification-artifacts/<area>/`. */
    outDir: string;
}
/** The result of a verification run: the artifact and the path it was written to. */
export interface RunResult {
    artifact: VerificationArtifact;
    path: string;
}
/**
 * Executes verification commands and emits Verification Artifacts.
 *
 * The lifecycle of {@link run} is:
 *  1. Run prerequisite probes — the first one that reports a missing
 *     prerequisite makes the run BLOCKED (Requirement 1.5).
 *  2. Spawn the command and enforce the timeout — on overrun the process is
 *     killed with SIGKILL and `timedOut` is set, which classifies the run as
 *     BLOCKED with a `timeout` prerequisite (Requirement 1.10).
 *  3. Derive the four evidence components and call the pure `classify()` engine
 *     to assign exactly one status (Requirements 1.3 / 1.4 / 1.9).
 *  4. Write the artifact atomically; on write failure throw, remove the temp
 *     file, and leave no partial artifact (Requirement 1.11).
 */
export declare class CommandRunner {
    run(opts: RunOptions): Promise<RunResult>;
    /**
     * Atomically write a Verification Artifact: write to a unique temp file
     * (`<path>.tmp-<pid>-<rand>`) then `rename()` into place. A rename within a
     * directory is atomic, so a reader never observes a partial file. If any step
     * fails, the temp file is removed and the error is rethrown so no partial or
     * leftover artifact remains (Requirement 1.11).
     */
    static writeArtifactAtomic(path: string, a: VerificationArtifact): Promise<void>;
    /**
     * Run prerequisite probes in order and return the first reported missing
     * prerequisite, or `null` when all prerequisites are satisfied. A probe that
     * throws is treated as a satisfied prerequisite for that probe (it is not the
     * runner's job to invent a blocked reason from an unexpected probe error).
     */
    private runPrerequisites;
    /**
     * Spawn the command and enforce the timeout. On overrun the process tree is
     * terminated with SIGKILL and `timedOut` is set true (Requirement 1.10). The
     * resolved exit code is the process exit code, or a non-zero sentinel when the
     * process was killed by a signal so the artifact never records 0 for a
     * terminated command (Requirement 1.9).
     */
    private spawnWithTimeout;
    /** Render the executed command (with args) as a single string for the artifact. */
    private renderCommand;
}
//# sourceMappingURL=runner.d.ts.map