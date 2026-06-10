export declare const FEATURE_FLAGS_MIGRATION_SQL = "CREATE TABLE IF NOT EXISTS street_feature_flags (\n  name TEXT PRIMARY KEY,\n  enabled BOOLEAN DEFAULT false,\n  rules JSONB DEFAULT '[]',\n  updated_at TIMESTAMPTZ DEFAULT NOW()\n);";
export interface FeatureFlagRule {
    type: 'user_id' | 'role' | 'environment' | 'percentage';
    value: string | number;
}
export interface GenericPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
    }>;
}
export declare class FeatureFlagService {
    private readonly pool;
    private readonly ttlMs;
    private readonly cache;
    constructor(pool: GenericPool, ttlMs?: number);
    isEnabled(flagName: string, context?: {
        userId?: string;
        role?: string;
        environment?: string;
    }): Promise<boolean>;
    invalidateCache(flagName: string): void;
    /**
     * Upsert a flag's enabled state (and optionally its rules) and invalidate the
     * cache so the next read reflects the change immediately.
     */
    setFlag(flagName: string, enabled: boolean, rules?: FeatureFlagRule[]): Promise<void>;
    private _loadFlag;
    private _evaluateRule;
}
interface FlagAdminApp {
    use(mw: (ctx: FlagAdminCtx, next: () => Promise<void>) => Promise<void>): void;
}
interface FlagAdminCtx {
    method: string;
    path: string;
    body: unknown;
    user: {
        roles: string[];
    } | null;
    json(data: unknown, status?: number): void;
}
/**
 * Register `PATCH /admin/feature-flags/:name` to toggle a flag and invalidate
 * its cache. The caller supplies the admin role required (default `admin`).
 * The route is matched via a path prefix so it works on any StreetApp.
 */
export declare function registerFeatureFlagAdminRoute(app: FlagAdminApp, service: FeatureFlagService, opts?: {
    adminRole?: string;
}): void;
export {};
//# sourceMappingURL=feature-flags.d.ts.map