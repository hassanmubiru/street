// src/enterprise/feature-flags.ts
// Feature flag service with per-user targeting rules and TTL caching.
import { createHash } from 'node:crypto';
export const FEATURE_FLAGS_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS street_feature_flags (
  name TEXT PRIMARY KEY,
  enabled BOOLEAN DEFAULT false,
  rules JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);`;
export class FeatureFlagService {
    pool;
    ttlMs;
    cache = new Map();
    constructor(pool, ttlMs = 30_000) {
        this.pool = pool;
        this.ttlMs = ttlMs;
    }
    async isEnabled(flagName, context) {
        const record = await this._loadFlag(flagName);
        if (!record) {
            // Unknown flags are treated as disabled, but logged so misconfiguration
            // is visible rather than silently failing.
            console.warn(`[feature-flags] Unknown flag "${flagName}" — defaulting to false`);
            return false;
        }
        if (!record.enabled)
            return false;
        // No rules → globally enabled
        if (!record.rules || record.rules.length === 0)
            return true;
        // Evaluate rules (OR logic: any matching rule enables the flag)
        for (const rule of record.rules) {
            if (this._evaluateRule(rule, flagName, context)) {
                return true;
            }
        }
        return false;
    }
    invalidateCache(flagName) {
        this.cache.delete(flagName);
    }
    /**
     * Upsert a flag's enabled state (and optionally its rules) and invalidate the
     * cache so the next read reflects the change immediately.
     */
    async setFlag(flagName, enabled, rules) {
        await this.pool.query(`INSERT INTO street_feature_flags (name, enabled, rules, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (name) DO UPDATE SET enabled = $2, rules = $3, updated_at = NOW()`, [flagName, enabled, JSON.stringify(rules ?? [])]);
        this.invalidateCache(flagName);
    }
    async _loadFlag(flagName) {
        const cached = this.cache.get(flagName);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.record;
        }
        const result = await this.pool.query('SELECT name, enabled, rules FROM street_feature_flags WHERE name = $1', [flagName]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        const record = {
            name: row.name,
            enabled: Boolean(row.enabled),
            rules: Array.isArray(row.rules) ? row.rules : [],
        };
        this.cache.set(flagName, {
            record,
            expiresAt: Date.now() + this.ttlMs,
        });
        return record;
    }
    _evaluateRule(rule, flagName, context) {
        switch (rule.type) {
            case 'user_id':
                return context?.userId === rule.value;
            case 'role':
                return context?.role === rule.value;
            case 'environment':
                return process.env['NODE_ENV'] === rule.value;
            case 'percentage': {
                const userId = context?.userId;
                if (!userId)
                    return false;
                const pct = typeof rule.value === 'number' ? rule.value : Number(rule.value);
                if (isNaN(pct) || pct <= 0)
                    return false;
                if (pct >= 100)
                    return true;
                // Stable per-user hash: SHA256(flagName + userId)[0:8] % 100 < pct
                const hash = createHash('sha256')
                    .update(flagName + userId)
                    .digest('hex');
                const bucket = parseInt(hash.slice(0, 8), 16) % 100;
                return bucket < pct;
            }
            default:
                return false;
        }
    }
}
/**
 * Register `PATCH /admin/feature-flags/:name` to toggle a flag and invalidate
 * its cache. The caller supplies the admin role required (default `admin`).
 * The route is matched via a path prefix so it works on any StreetApp.
 */
export function registerFeatureFlagAdminRoute(app, service, opts = {}) {
    const adminRole = opts.adminRole ?? 'admin';
    const prefix = '/admin/feature-flags/';
    app.use(async (ctx, next) => {
        if (ctx.method !== 'PATCH' || !ctx.path.startsWith(prefix)) {
            await next();
            return;
        }
        if (!ctx.user || !ctx.user.roles.includes(adminRole)) {
            ctx.json({ error: 'Forbidden', required: [adminRole] }, 403);
            return;
        }
        const name = decodeURIComponent(ctx.path.slice(prefix.length));
        const body = (ctx.body ?? {});
        if (typeof body.enabled !== 'boolean') {
            ctx.json({ error: 'bad_request', message: 'enabled (boolean) is required' }, 400);
            return;
        }
        await service.setFlag(name, body.enabled, body.rules);
        ctx.json({ name, enabled: body.enabled });
    });
}
//# sourceMappingURL=feature-flags.js.map