import type { CliContext } from '../index.js';
export declare class AuditCommand {
    execute(ctx: CliContext): Promise<void>;
    protected runNpmAudit(cwd: string): Promise<string>;
}
//# sourceMappingURL=audit.d.ts.map