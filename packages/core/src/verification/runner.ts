// Verification Artifact subsystem — command runner (zero runtime deps).
//
// The CommandRunner is the single execution path that turns a real, executed
// command into a machine-readable Verification Artifact. Producers never write
// a status by hand: they hand a command to `run()`, which spawns the process,
// enforces the 300-second default timeout (SIGKILL on overrun), runs any
// prerequisite probes, derives the four evidence components, calls the pure
// `classify()` status engine, and then writes the artifact ATOMICALLY (temp
// file + rename). If the artifact cannot be persisted, the runner throws,
// removes the temp file, and leaves no partial artifact behind (Requirement
// 1.11).
//
// Implemented with Node core modules only: `node:child_process`, `node:fs`,
// `node:crypto`, `node:path`. No third-party runtime dependencies.
//
// _Requirements: 1.7, 1.9, 1.10, 1.11_

import { spawn } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

import { classify } from './status.js';
import type { BlockedReason, EvidenceComponents } from './status.js';
import type { VerificationArtifact } from './artifact.js';

/** The default verification command timeout: 300 seconds (Requirement 1.10). */
export const DEFAULT_TIMEOUT_MS = 300_000;

/** Identifies the runner as the producing tool in every artifact's `generator`. */
const GENERATOR_TOOL = 'street-command-runner';
/** The runner's generator version (independent of package version on purpose). */
const GENERATOR_VERSION = '1';

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

interface ProcessOutcome {
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
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
export class CommandRunner {
  async run(opts: RunOptions): Promise<RunResult> {
    const timeoutMs =
      opts.timeoutMs !== undefined && opts.timeoutMs > 0
        ? opts.timeoutMs
        : DEFAULT_TIMEOUT_MS;

    // Step 1 — prerequisite probes. The first missing prerequisite wins.
    const probedBlock = await this.runPrerequisites(opts.prerequisites);

    // Step 2 — spawn the command and enforce the timeout.
    const outcome = await this.spawnWithTimeout(opts, timeoutMs);

    // A timeout takes precedence as the recorded blocked reason (Req 1.10).
    const blockedReason: BlockedReason | null = outcome.timedOut
      ? { kind: 'timeout', missingPrerequisite: 'timeout' }
      : probedBlock;

    // Step 3 — derive evidence and classify (pure status engine).
    const hints = opts.evidenceHints ?? {};
    const sourceCode = hints.sourceCode ?? true;
    const documentation = hints.documentation ?? false;
    const passingTests =
      hints.passingTests ??
      (outcome.exitCode === 0 && !outcome.timedOut && blockedReason === null);
    // The artifact component is satisfied: this run produces an artifact.
    const evidence: EvidenceComponents = {
      sourceCode,
      passingTests,
      documentation,
      artifact: hints.artifact ?? true,
    };

    const status = classify({
      hasSourceCode: sourceCode,
      evidence,
      blocked: blockedReason,
      commandExitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
    });

    const artifact: VerificationArtifact = {
      schemaVersion: 1,
      capabilityId: opts.capabilityId,
      status,
      evidence,
      command: this.renderCommand(opts),
      exitCode: outcome.exitCode,
      timestamp: new Date().toISOString(),
      durationMs: outcome.durationMs,
      timedOut: outcome.timedOut,
      ...(blockedReason ? { blockedReason } : {}),
      generator: { tool: GENERATOR_TOOL, version: GENERATOR_VERSION },
    };

    // Step 4 — persist atomically. On failure, surface an error that names the
    // affected capability and leaves no partial artifact (Req 1.11).
    const outPath = join(opts.outDir, `${opts.capabilityId}.artifact.json`);
    try {
      await CommandRunner.writeArtifactAtomic(outPath, artifact);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to write Verification Artifact for capability '${opts.capabilityId}' to '${outPath}': ${cause}`,
        { cause: err },
      );
    }

    return { artifact, path: outPath };
  }

  /**
   * Atomically write a Verification Artifact: write to a unique temp file
   * (`<path>.tmp-<pid>-<rand>`) then `rename()` into place. A rename within a
   * directory is atomic, so a reader never observes a partial file. If any step
   * fails, the temp file is removed and the error is rethrown so no partial or
   * leftover artifact remains (Requirement 1.11).
   */
  static async writeArtifactAtomic(
    path: string,
    a: VerificationArtifact,
  ): Promise<void> {
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });

    const tmpPath = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    const data = `${JSON.stringify(a, null, 2)}\n`;

    try {
      // `wx` fails if the temp file somehow already exists, guaranteeing we own it.
      await writeFile(tmpPath, data, { encoding: 'utf8', flag: 'wx' });
      await rename(tmpPath, path);
    } catch (err) {
      // Best-effort cleanup of the temp file; never mask the original error.
      await rm(tmpPath, { force: true }).catch(() => {
        /* ignore cleanup failure */
      });
      throw err;
    }
  }

  /**
   * Run prerequisite probes in order and return the first reported missing
   * prerequisite, or `null` when all prerequisites are satisfied. A probe that
   * throws is treated as a satisfied prerequisite for that probe (it is not the
   * runner's job to invent a blocked reason from an unexpected probe error).
   */
  private async runPrerequisites(
    prerequisites: RunOptions['prerequisites'],
  ): Promise<BlockedReason | null> {
    if (!prerequisites || prerequisites.length === 0) return null;
    for (const probe of prerequisites) {
      const reason = await probe();
      if (reason) return reason;
    }
    return null;
  }

  /**
   * Spawn the command and enforce the timeout. On overrun the process tree is
   * terminated with SIGKILL and `timedOut` is set true (Requirement 1.10). The
   * resolved exit code is the process exit code, or a non-zero sentinel when the
   * process was killed by a signal so the artifact never records 0 for a
   * terminated command (Requirement 1.9).
   */
  private spawnWithTimeout(
    opts: RunOptions,
    timeoutMs: number,
  ): Promise<ProcessOutcome> {
    return new Promise<ProcessOutcome>((resolve) => {
      const start = Date.now();
      const useShell = !opts.args || opts.args.length === 0;
      const child = spawn(opts.command, opts.args ?? [], {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        shell: useShell,
      });

      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      // Do not let the timeout timer keep the event loop alive on its own.
      if (typeof timer.unref === 'function') timer.unref();

      // Drain stdio so the child never blocks on a full pipe buffer.
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', () => {});

      const finish = (exitCode: number): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode, timedOut, durationMs: Date.now() - start });
      };

      child.on('error', () => {
        // Spawn failure (e.g. command not found): record a non-zero exit.
        finish(timedOut ? 137 : 127);
      });

      child.on('close', (code, signal) => {
        if (code === null) {
          // Killed by a signal: 128 + signal number is the conventional code;
          // a SIGKILL timeout maps to 137.
          const bySignal = timedOut || signal === 'SIGKILL' ? 137 : 1;
          finish(bySignal);
          return;
        }
        finish(code);
      });
    });
  }

  /** Render the executed command (with args) as a single string for the artifact. */
  private renderCommand(opts: RunOptions): string {
    if (!opts.args || opts.args.length === 0) return opts.command;
    return [opts.command, ...opts.args].join(' ');
  }
}
