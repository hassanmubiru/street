import type { CliContext } from '../index.js';
export declare class SeedCommand {
    /**
     * `street db:seed <file>`
     *
     * Runs the given seed file via StreetSeeder.  If the file has already been
     * applied (same SHA-256 hash recorded in street_seed_runs) it is skipped.
     */
    execute(ctx: CliContext): Promise<void>;
}
//# sourceMappingURL=seed.d.ts.map