// @streetjs/dating-moderation
//
// Phase 10 dating reference package (Requirement 11.4). It provides the
// blocking and reporting surface a dating app needs, built **entirely** on the
// core `ModerationToolkit` (Phase 7, Requirement 8) — this package introduces
// no independent moderation logic. Every state-changing operation flows through
// the toolkit, so the append-only audit log, block semantics, and report queue
// guarantees proven in `@streetjs/core` hold here unchanged.
//
// Responsibilities (mapped to acceptance criteria):
//   - Reporting another user, listing the moderation queue, and resolving a
//     report (built on ModerationToolkit.report/queue/resolve) — R11.4.
//   - Blocking another user and answering "may B message A?" for the block
//     relationship between two users (built on ModerationToolkit.block/
//     canMessage) — R11.4, composing R8.2/R8.3.
//   - Surfacing the append-only moderation audit log (R8.5/R8.7).
//
// The package depends only on `@streetjs/core`; the in-memory store is the
// default, and any `ModerationStore` (e.g. a Redis-backed implementation) or a
// pre-constructed `ModerationToolkit` may be injected for production use.

import {
  ModerationToolkit,
  InMemoryModerationStore,
  type ModerationStore,
  type ModerationAuditEvent,
  type Report,
  type Clock,
} from '@streetjs/core';

/** Options for {@link DatingModeration}. */
export interface DatingModerationOptions {
  /**
   * A pre-constructed toolkit to wrap. When provided, `store` and `clock` are
   * ignored — the supplied toolkit governs storage and timestamps.
   */
  toolkit?: ModerationToolkit;
  /**
   * Backing store for a toolkit constructed by this package. Defaults to a
   * fresh {@link InMemoryModerationStore}. Ignored when `toolkit` is provided.
   */
  store?: ModerationStore;
  /**
   * Injected now-provider for deterministic timestamps under test. Ignored when
   * `toolkit` is provided.
   */
  clock?: Clock;
}

/**
 * Dating-app blocking and reporting, built on the core {@link ModerationToolkit}
 * (R11.4).
 *
 * This is a thin, intention-revealing facade: each method delegates to the
 * toolkit so the framework's moderation guarantees (block prevents the blocked
 * user from messaging the blocker, reports are queued, the audit log is
 * append-only) apply without re-implementation.
 */
export class DatingModeration {
  private readonly toolkit: ModerationToolkit;

  constructor(options: DatingModerationOptions = {}) {
    this.toolkit =
      options.toolkit ??
      new ModerationToolkit(options.store ?? new InMemoryModerationStore(), {
        clock: options.clock,
      });
  }

  /** The underlying core toolkit, exposed for advanced composition. */
  get moderation(): ModerationToolkit {
    return this.toolkit;
  }

  // ── Reporting (R11.4, built on ModerationToolkit.report) ──────────────────

  /**
   * Report another user. The report is stored and placed in the moderation
   * queue, and a `report` audit event is recorded (composes R8.1/R8.5).
   */
  async reportUser(reporter: string, target: string, reason: string): Promise<Report> {
    return this.toolkit.report(reporter, target, reason);
  }

  /** List reports awaiting moderator review (composes R8.6). */
  async reviewQueue(): Promise<Report[]> {
    return this.toolkit.queue();
  }

  /**
   * Record a moderator's resolution for a queued report (composes R8.6). Throws
   * the core `UnknownReportError` if the report id is not known.
   */
  async resolveReport(moderator: string, reportId: string, outcome: string): Promise<void> {
    return this.toolkit.resolve(moderator, reportId, outcome);
  }

  // ── Blocking (R11.4, built on ModerationToolkit.block / canMessage) ───────

  /**
   * Record that `blocker` has blocked `blocked` (composes R8.2). While the
   * block exists, `blocked` may no longer message `blocker` (R8.3).
   */
  async blockUser(blocker: string, blocked: string): Promise<void> {
    return this.toolkit.block(blocker, blocked);
  }

  /**
   * Whether `from` may send a message to `to`. A block from `to` to `from`
   * prevents it (composes R8.3): `from` may message `to` iff `to` has not
   * blocked `from`.
   */
  async canMessage(from: string, to: string): Promise<boolean> {
    return this.toolkit.canMessage(from, to);
  }

  /**
   * Whether a block exists in *either* direction between two users. Useful for
   * a dating app that should hide both users from each other once either one
   * blocks (composes R8.2/R8.3).
   */
  async isBlockedBetween(a: string, b: string): Promise<boolean> {
    const aCanMessageB = await this.toolkit.canMessage(a, b);
    const bCanMessageA = await this.toolkit.canMessage(b, a);
    return !aCanMessageB || !bCanMessageA;
  }

  // ── Audit (R8.5/R8.7) ─────────────────────────────────────────────────────

  /** The append-only moderation audit log (composes R8.5/R8.7). */
  async auditLog(): Promise<readonly ModerationAuditEvent[]> {
    return this.toolkit.audit();
  }
}

// Re-export the core moderation types this package's surface uses, so consumers
// can type their code without importing `@streetjs/core` directly.
export type { ModerationAuditEvent, Report, ModerationStore, Clock } from '@streetjs/core';
export { ModerationToolkit, InMemoryModerationStore, UnknownReportError } from '@streetjs/core';
