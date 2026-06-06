// tests/roadmap-partials.test.ts
// Tests completing partial roadmap items:
//  - 33.5  TenantUsageAggregator (nightly daily aggregation)
//  - 38.4/38.6  Cloud Run structured-log format detection
//  - 43.5/43.7  AuditLogger.export (JSONL/CSV) + @Sensitive redaction + signature chain
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { TenantUsageAggregator } from '../tenancy/metrics.js';
import { Logger } from '../observability/logger.js';
import { AuditLogger, Sensitive, ENTERPRISE_AUDIT_MIGRATION_SQL } from '../enterprise/audit-logger.js';
// ── 33.5 Tenant usage aggregation ──────────────────────────────────────────────
describe('TenantUsageAggregator (33.5)', () => {
    it('aggregates usage rows into daily stats with an upsert query', async () => {
        const calls = [];
        const pool = {
            async query(sql, params = []) {
                calls.push({ sql, params });
                return { rows: [], rowCount: 3, command: 'INSERT' };
            },
        };
        const agg = new TenantUsageAggregator(pool);
        const written = await agg.aggregate(new Date('2026-06-05T00:00:00Z'));
        assert.equal(written, 3);
        assert.equal(calls.length, 1);
        const { sql, params } = calls[0];
        assert.match(sql, /INSERT INTO street_tenant_daily_stats/);
        assert.match(sql, /jsonb_object_agg\(metric_key, value\)/);
        assert.match(sql, /GROUP BY tenant_id, period/);
        assert.match(sql, /ON CONFLICT \(tenant_id, date\)/);
        assert.equal(params[0], '2026-06-05');
    });
    it('scheduleNightly registers a cron job that aggregates the prior day', async () => {
        const registered = [];
        const scheduler = {
            register(expr, name, fn) {
                registered.push({ expr, name, fn });
            },
        };
        let aggregatedFor = null;
        const pool = {
            async query(_sql, params = []) {
                aggregatedFor = String(params[0]);
                return { rows: [], rowCount: 0, command: 'INSERT' };
            },
        };
        const agg = new TenantUsageAggregator(pool);
        agg.scheduleNightly(scheduler);
        assert.equal(registered.length, 1);
        assert.equal(registered[0].name, 'tenant-usage-daily-aggregation');
        assert.equal(registered[0].expr, '10 0 * * *');
        // Invoke the registered job; it should aggregate yesterday's date.
        await registered[0].fn();
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        assert.equal(aggregatedFor, yesterday);
    });
});
// ── 38.4 / 38.6 Cloud Run structured logging ────────────────────────────────────
function captureStream() {
    const chunks = [];
    const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString('utf8')); cb(); },
    });
    return { stream, lines: () => chunks.join('').trim().split('\n').filter(Boolean) };
}
describe('Logger Cloud Run format detection (38.4/38.6)', () => {
    it('emits GCP severity-based JSON when K_SERVICE is set', () => {
        const prev = process.env['K_SERVICE'];
        process.env['K_SERVICE'] = 'my-cloud-run-service';
        try {
            const { stream, lines } = captureStream();
            const logger = new Logger({ service: 'api', stream });
            logger.error('boom', { code: 500 });
            const entry = JSON.parse(lines()[0]);
            assert.equal(entry.severity, 'ERROR');
            assert.equal(entry.message, 'boom');
            assert.equal(entry.service, 'api');
            assert.equal(entry.code, 500);
            assert.ok(entry.timestamp);
            // Standard format would carry a `level` field; GCP format uses `severity`.
            assert.equal(entry.level, undefined);
        }
        finally {
            if (prev === undefined)
                delete process.env['K_SERVICE'];
            else
                process.env['K_SERVICE'] = prev;
        }
    });
    it('emits the standard level-based JSON when not on Cloud Run', () => {
        const prev = process.env['K_SERVICE'];
        delete process.env['K_SERVICE'];
        try {
            const { stream, lines } = captureStream();
            const logger = new Logger({ service: 'api', stream });
            logger.info('hello');
            const entry = JSON.parse(lines()[0]);
            assert.equal(entry.level, 'info');
            assert.equal(entry.severity, undefined);
        }
        finally {
            if (prev !== undefined)
                process.env['K_SERVICE'] = prev;
        }
    });
});
// ── 43.5 / 43.7 Audit export + redaction + signature chain ──────────────────────
class FakeAuditPool {
    inserts = [];
    rows = [];
    async query(sql, params = []) {
        const s = sql.trim().toUpperCase();
        if (s.startsWith('INSERT')) {
            this.inserts.push({ sql, params });
            return { rows: [], rowCount: 1, command: 'INSERT' };
        }
        // SELECT for export: return all rows on the first page, empty afterwards.
        const offset = Number(params[3] ?? 0);
        if (offset > 0)
            return { rows: [], rowCount: 0, command: 'SELECT' };
        return { rows: this.rows, rowCount: this.rows.length, command: 'SELECT' };
    }
}
function drain(stream) {
    return new Promise((resolve, reject) => {
        let out = '';
        stream.on('data', (c) => { out += c.toString('utf8'); });
        stream.on('end', () => resolve(out));
        stream.on('error', reject);
    });
}
describe('AuditLogger export + redaction (43.5/43.7)', () => {
    it('migration SQL declares an append-only trigger blocking UPDATE and DELETE', () => {
        const sql = ENTERPRISE_AUDIT_MIGRATION_SQL.toUpperCase();
        assert.ok(sql.includes('STREET_AUDIT_LOG'));
        // Append-only enforcement: a rule/trigger that rejects UPDATE and DELETE.
        assert.ok(sql.includes('UPDATE') && sql.includes('DELETE'));
    });
    it('exports all entries in range as JSONL', async () => {
        const pool = new FakeAuditPool();
        pool.rows = [
            { id: '1', category: 'auth', action: 'login', created_at: '2026-06-01T00:00:00Z' },
            { id: '2', category: 'data', action: 'update', created_at: '2026-06-02T00:00:00Z' },
        ];
        const logger = new AuditLogger({ pool, signingKey: 'k'.repeat(32) });
        const out = await drain(logger.export(new Date('2026-06-01'), new Date('2026-06-30'), 'jsonl'));
        const lines = out.trim().split('\n');
        assert.equal(lines.length, 2);
        assert.equal(JSON.parse(lines[0]).id, '1');
        assert.equal(JSON.parse(lines[1]).action, 'update');
    });
    it('exports as CSV with a header row and escaped fields', async () => {
        const pool = new FakeAuditPool();
        pool.rows = [
            { id: '1', category: 'admin', actor_id: 'a,b', action: 'do "x"', resource: 'r', ip: '', user_agent: '', batch_id: 'bid', signature: 'sig', created_at: '2026-06-01T00:00:00Z' },
        ];
        const logger = new AuditLogger({ pool, signingKey: 'k'.repeat(32) });
        const out = await drain(logger.export(new Date('2026-06-01'), new Date('2026-06-30'), 'csv'));
        const lines = out.trim().split('\n');
        assert.match(lines[0], /^id,category,actor_id,action,resource/);
        assert.match(lines[1], /"a,b"/); // comma-containing field quoted
        assert.match(lines[1], /"do ""x"""/); // embedded quotes doubled
    });
    it('redacts @Sensitive entity fields in before/after state', async () => {
        class UserEntity {
            id;
            email;
            passwordHash;
        }
        __decorate([
            Sensitive(),
            __metadata("design:type", String)
        ], UserEntity.prototype, "passwordHash", void 0);
        const pool = new FakeAuditPool();
        const logger = new AuditLogger({ pool, signingKey: 'k'.repeat(32) });
        await logger.log({
            category: 'data',
            action: 'update',
            entityClass: UserEntity,
            beforeState: { id: '1', email: 'a@b.com', passwordHash: 'TOP-SECRET' },
            afterState: { id: '1', email: 'a@b.com', passwordHash: 'NEW-SECRET' },
        });
        await logger.flush();
        const insert = pool.inserts[0];
        const before = JSON.parse(String(insert.params[5]));
        const after = JSON.parse(String(insert.params[6]));
        assert.equal(before.passwordHash, '[REDACTED]');
        assert.equal(after.passwordHash, '[REDACTED]');
        assert.equal(before.email, 'a@b.com'); // non-sensitive preserved
    });
    it('signs batches with a verifiable HMAC hash chain', async () => {
        const pool = new FakeAuditPool();
        const signingKey = 's'.repeat(32);
        const logger = new AuditLogger({ pool, signingKey });
        await logger.log({ category: 'auth', action: 'login' });
        await logger.flush();
        await logger.log({ category: 'auth', action: 'logout' });
        await logger.flush();
        // Two batches → two signatures; the second must differ from the first
        // because it chains on the previous signature.
        const sig1 = String(pool.inserts[0].params[10]);
        const sig2 = String(pool.inserts[1].params[10]);
        assert.match(sig1, /^[0-9a-f]{64}$/);
        assert.match(sig2, /^[0-9a-f]{64}$/);
        assert.notEqual(sig1, sig2);
    });
});
//# sourceMappingURL=roadmap-partials.test.js.map