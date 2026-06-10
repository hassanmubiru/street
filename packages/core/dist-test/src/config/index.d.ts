/**
 * Database initialization strategy at bootstrap.
 *
 * - `lazy` (default): the pool is registered but NOT initialized at bootstrap.
 *   Connections are warmed up on first database use, so the app boots and serves
 *   health without requiring a provisioned PostgreSQL instance.
 * - `eager`: the pool is initialized at bootstrap (legacy behavior); a missing
 *   database prevents startup. Use for environments that must fail fast.
 * - `provisioned`: the database is treated as an externally guaranteed dependency;
 *   bootstrap does not block on it and readiness gates on first successful connection.
 */
export type DbInitMode = 'lazy' | 'eager' | 'provisioned';
export declare class AppConfig {
    port: string;
    host: string;
    pgHost: string;
    pgPort: string;
    pgDatabase: string;
    pgUser: string;
    pgPassword: string;
    jwtSecret: string;
    sessionKey: string;
    nodeEnv: string;
    uploadsDir: string;
    migrationsDir: string;
    /**
     * Database initialization strategy: `lazy` (default), `eager`, or `provisioned`.
     * Controls whether bootstrap eagerly warms the connection pool. See {@link DbInitMode}.
     * Use the {@link AppConfig.dbInitMode} getter for the validated, normalized value.
     */
    dbInitModeRaw: string;
    /**
     * Comma-separated list of allowed CORS origins.
     * In production, set this to your actual frontend domain(s).
     * Example: ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
     * Leave unset in development to allow all origins (wildcard).
     */
    allowedOrigins: string;
    /** Load all config values from environment */
    load(kek?: string): this;
    get isProduction(): boolean;
    get isDevelopment(): boolean;
    get httpPort(): number;
    get pgPortNumber(): number;
    /**
     * The validated, normalized database initialization mode.
     * Defaults to `lazy` when unset or set to an unrecognized value, so that an
     * environment without a provisioned database still boots and serves health.
     */
    get dbInitMode(): DbInitMode;
    /**
     * Returns the parsed CORS origins list.
     * Falls back to ['*'] in non-production environments so local development
     * works without configuration. In production, ALLOWED_ORIGINS must be set.
     */
    get corsOrigins(): string[];
}
//# sourceMappingURL=index.d.ts.map