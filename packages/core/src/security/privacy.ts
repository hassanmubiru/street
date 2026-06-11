// src/security/privacy.ts
// Phase 9 — Privacy_Controls (Requirement 10).
//
// Account deletion, data export, retention enforcement, and consent tracking so
// the platform can meet privacy obligations (GDPR/CCPA-style). The subsystem is
// deliberately storage-agnostic: applications register a `PersonalDataSource`
// per data domain (profiles, messages, audit, ...) and the controls fan out
// across every registered source for export and erasure. Retention is driven by
// per-record-type policies evaluated against a pluggable record store with an
// injected clock so a cycle is fully deterministic under test.
//
// Responsibilities (mapped to acceptance criteria):
//   - Export the personal data held for a user across all sources (R10.1).
//   - Delete a user's personal data so subsequent reads return nothing (R10.2).
//   - Apply a configured retention policy that removes records once they exceed
//     their retention period, on the next enforcement cycle (R10.3/R10.4).
//   - Record consent grant/withdraw decisions with purpose + timestamp (R10.5),
//     where the latest decision per (user, purpose) wins, and refuse
//     purpose-dependent processing while consent is withdrawn (R10.6).

import type { Clock } from './store.js';
import { systemClock } from './store.js';

/**
 * A registered source of personal data for one data domain. The privacy
 * controls call {@link collect} to assemble an export package and {@link erase}
 * to remove a user's data during account deletion. A source SHOULD return an
 * empty object from {@link collect} once a user's data has been erased.
 */
export interface PersonalDataSource {
  /** A stable identifier for this domain, used to namespace export output. */
  readonly name: string;
  /** Return the personal data this domain holds for `userId` (R10.1). */
  collect(userId: string): Promise<Record<string, unknown>>;
  /** Remove all personal data this domain holds for `userId` (R10.2). */
  erase(userId: string): Promise<void>;
}

/** Retention policy for a single record type (R10.3). */
export interface RetentionPolicy {
  /** The {@link RetainableRecord.type} this policy governs. */
  recordType: string;
  /** Maximum age (ms) a record of this type may reach before removal. */
  maxAgeMs: number;
}

/** A record subject to retention, identified by type + id with a creation time. */
export interface RetainableRecord {
  /** The record type, matched against {@link RetentionPolicy.recordType}. */
  type: string;
  /** A stable identifier unique within {@link type}. */
  id: string;
  /** Creation timestamp in milliseconds. */
  createdAt: number;
}

/**
 * Pluggable store of {@link RetainableRecord}s evaluated during a retention
 * cycle. Implementations may be backed by a database; the default
 * {@link InMemoryRetentionStore} keeps records in process for tests and small
 * deployments.
 */
export interface RetentionRecordStore {
  /** All currently retained records. */
  list(): Promise<RetainableRecord[]>;
  /** Remove the record identified by `type`/`id` if present. */
  remove(type: string, id: string): Promise<void>;
}

/** Default in-memory {@link RetentionRecordStore}. */
export class InMemoryRetentionStore implements RetentionRecordStore {
  // Map: type -> (id -> record).
  private readonly records = new Map<string, Map<string, RetainableRecord>>();

  /** Add (or replace) a retained record. */
  add(record: RetainableRecord): void {
    let byId = this.records.get(record.type);
    if (!byId) {
      byId = new Map<string, RetainableRecord>();
      this.records.set(record.type, byId);
    }
    byId.set(record.id, { ...record });
  }

  async list(): Promise<RetainableRecord[]> {
    const out: RetainableRecord[] = [];
    for (const byId of this.records.values()) {
      for (const record of byId.values()) out.push({ ...record });
    }
    return out;
  }

  async remove(type: string, id: string): Promise<void> {
    const byId = this.records.get(type);
    if (!byId) return;
    byId.delete(id);
    if (byId.size === 0) this.records.delete(type);
  }

  /** Number of records currently retained (primarily for tests/diagnostics). */
  size(): number {
    let total = 0;
    for (const byId of this.records.values()) total += byId.size;
    return total;
  }
}

/** A recorded consent decision for a (user, purpose) pair (R10.5). */
export interface ConsentDecision {
  /** The user the decision applies to. */
  userId: string;
  /** The defined processing purpose the decision applies to. */
  purpose: string;
  /** Whether consent is granted (`true`) or withdrawn (`false`). */
  granted: boolean;
  /** Timestamp of the decision in milliseconds. */
  ts: number;
}

/**
 * Thrown by {@link PrivacyControls.requireConsent} when processing is attempted
 * for a purpose whose latest recorded consent decision is a withdrawal (R10.6).
 */
export class ConsentRequiredError extends Error {
  /** The user whose consent is required. */
  readonly userId: string;
  /** The purpose for which consent has been withdrawn. */
  readonly purpose: string;

  constructor(userId: string, purpose: string) {
    super(`Consent required for purpose "${purpose}" but it has been withdrawn`);
    this.name = 'ConsentRequiredError';
    this.userId = userId;
    this.purpose = purpose;
  }
}

/** Options for constructing {@link PrivacyControls}. */
export interface PrivacyControlsOptions {
  /** Initial retention policies (more may be added later). */
  policies?: RetentionPolicy[];
  /** Record store backing retention enforcement; defaults to in-memory. */
  retentionStore?: RetentionRecordStore;
  /** Injected now-provider; defaults to {@link systemClock}. */
  clock?: Clock;
}

/** Composite key for a consent decision: `${userId}\u0000${purpose}`. */
function consentKey(userId: string, purpose: string): string {
  return `${userId}\u0000${purpose}`;
}

/**
 * Privacy controls implementing export, deletion, retention, and consent (R10).
 *
 * The controls hold no personal data themselves: export and deletion fan out
 * across registered {@link PersonalDataSource}s, and retention operates over a
 * {@link RetentionRecordStore}. Only consent decisions are retained in process,
 * keyed by (user, purpose) with the latest decision winning.
 */
export class PrivacyControls {
  private readonly sources: PersonalDataSource[] = [];
  private readonly policies = new Map<string, RetentionPolicy>();
  private readonly retentionStore: RetentionRecordStore;
  private readonly clock: Clock;
  // Map: `${userId}\0${purpose}` -> latest decision for that pair.
  private readonly consent = new Map<string, ConsentDecision>();

  constructor(opts: PrivacyControlsOptions = {}) {
    this.retentionStore = opts.retentionStore ?? new InMemoryRetentionStore();
    this.clock = opts.clock ?? systemClock;
    for (const policy of opts.policies ?? []) this.addRetentionPolicy(policy);
  }

  /** Register a personal-data source for export and deletion fan-out. */
  registerSource(source: PersonalDataSource): void {
    this.sources.push(source);
  }

  /** Add or replace the retention policy for a record type (R10.3). */
  addRetentionPolicy(policy: RetentionPolicy): void {
    this.policies.set(policy.recordType, { ...policy });
  }

  /**
   * Generate an export package containing the personal data the platform holds
   * for `userId`, gathered from every registered source (R10.1). Output is
   * namespaced by each source's {@link PersonalDataSource.name} so domains with
   * overlapping field names do not collide.
   */
  async exportData(userId: string): Promise<Record<string, unknown>> {
    const pkg: Record<string, unknown> = {};
    for (const source of this.sources) {
      pkg[source.name] = await source.collect(userId);
    }
    return pkg;
  }

  /**
   * Complete an account-deletion request: erase `userId`'s personal data from
   * every registered source so subsequent reads return no personal data (R10.2).
   */
  async deleteAccount(userId: string): Promise<void> {
    for (const source of this.sources) {
      await source.erase(userId);
    }
  }

  /**
   * Run a single retention enforcement cycle (R10.3/R10.4). A record is removed
   * when a policy exists for its type and its age (`now - createdAt`) exceeds
   * that policy's `maxAgeMs`; records without a policy, or not yet expired, are
   * retained. Returns the number of records removed in this cycle.
   */
  async enforceRetention(now: number = this.clock()): Promise<{ removed: number }> {
    const records = await this.retentionStore.list();
    let removed = 0;
    for (const record of records) {
      const policy = this.policies.get(record.type);
      if (!policy) continue;
      const age = now - record.createdAt;
      if (age > policy.maxAgeMs) {
        await this.retentionStore.remove(record.type, record.id);
        removed++;
      }
    }
    return { removed };
  }

  /**
   * Record a consent grant or withdrawal decision (R10.5). The latest decision
   * per (user, purpose) wins, determined by {@link ConsentDecision.ts}; on a tie
   * the most recently recorded decision wins.
   */
  setConsent(decision: ConsentDecision): void {
    const key = consentKey(decision.userId, decision.purpose);
    const existing = this.consent.get(key);
    // Latest decision wins by timestamp; ties resolve to the newer call.
    if (!existing || decision.ts >= existing.ts) {
      this.consent.set(key, { ...decision });
    }
  }

  /**
   * Whether the latest recorded decision for (user, purpose) is a grant (R10.6).
   * Returns `false` when no decision has been recorded.
   */
  hasConsent(userId: string, purpose: string): boolean {
    const decision = this.consent.get(consentKey(userId, purpose));
    return decision?.granted ?? false;
  }

  /**
   * Refuse purpose-dependent processing while consent is withdrawn (R10.6).
   * Throws {@link ConsentRequiredError} if and only if the latest recorded
   * decision for (user, purpose) is a withdrawal. When no decision has been
   * recorded the call passes (there is nothing to refuse).
   */
  requireConsent(userId: string, purpose: string): void {
    const decision = this.consent.get(consentKey(userId, purpose));
    if (decision && !decision.granted) {
      throw new ConsentRequiredError(userId, purpose);
    }
  }
}
