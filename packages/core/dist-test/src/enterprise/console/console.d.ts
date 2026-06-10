import { JwtService } from '../../security/jwt.js';
import type { ConsoleBackend, ConsoleRequest, ConsoleResponse, ConsoleRoute } from './types.js';
export interface EnterpriseConsoleOptions {
    jwt: JwtService;
    backend: ConsoleBackend;
    /** Override the route table (defaults to the full console surface). */
    routes?: ConsoleRoute[];
    /** JWT verification options (issuer/audience), forwarded to JwtService.verify. */
    jwtOptions?: {
        issuer?: string;
        audience?: string;
    };
}
export declare class EnterpriseConsole {
    private readonly jwt;
    private readonly backend;
    private readonly _routes;
    private readonly jwtOptions;
    constructor(opts: EnterpriseConsoleOptions);
    /** The registered console operations (used for OpenAPI generation, Req 6.9). */
    routes(): ReadonlyArray<ConsoleRoute>;
    /**
     * Handle a single normalized request through the full lifecycle. Returns a
     * normalized response; never throws for client errors (401/403/400/404).
     */
    handle(req: ConsoleRequest): Promise<ConsoleResponse>;
    /** Verify the Bearer token and derive the principal, or null if unauthenticated. */
    private authenticate;
    /** A principal is authorized iff it holds at least one of the route's roles. */
    private authorize;
    /** Match a method + path against the route table, extracting path params. */
    private match;
}
//# sourceMappingURL=console.d.ts.map