import { type IncomingMessage, type ServerResponse } from 'node:http';
import type { MiddlewareFn } from '../core/types.js';
import type { Constructor } from '../core/types.js';
import type { PluginModule } from '../platform/plugins/sdk.js';
export interface StreetAppOptions {
    port?: number;
    host?: string;
    globalMiddlewares?: MiddlewareFn[];
    requestTimeoutMs?: number;
    maxBodyBytes?: number;
    uploadsDir?: string;
}
export interface StreetApp {
    listen(port?: number, host?: string): Promise<void>;
    close(): Promise<void>;
    registerController(ctor: Constructor): void;
    use(mw: MiddlewareFn): void;
    openApiSpec(): object;
    /** Load a marketplace plugin: runs onLoad with a sandboxed app view. */
    loadPlugin(plugin: PluginModule): Promise<void>;
    /** Unload a plugin: runs onUnload and restores the middleware stack. */
    unloadPlugin(plugin: PluginModule): Promise<void>;
    /** Internal: direct in-process request handler. Used by edge adapter and tests. */
    _handleRequest(req: IncomingMessage, res: ServerResponse): void;
}
export declare function streetApp(options?: StreetAppOptions): StreetApp;
//# sourceMappingURL=server.d.ts.map