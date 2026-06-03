import 'reflect-metadata';
import type { MiddlewareFn } from '../core/types.js';
/**
 * Role hierarchy: maps each role to the roles it inherits from.
 * e.g. { admin: ['editor'], editor: ['viewer'], viewer: [] }
 */
export type RoleHierarchy = Record<string, string[]>;
/**
 * Method decorator: attach required roles to a route handler.
 */
export declare function Roles(...roles: string[]): MethodDecorator;
/**
 * Method decorator: attach required permissions to a route handler.
 */
export declare function Permissions(...perms: string[]): MethodDecorator;
export declare class RbacService {
    /**
     * Flattened permission sets per role, computed once at construction time.
     * Map<role, Set<permission>>
     */
    private readonly _rolePerms;
    /**
     * @param hierarchy Role → inherited-roles map.
     * @param rolePermissions Optional per-role explicit permission strings.
     *        e.g. { admin: ['users:read', 'users:write'], viewer: ['users:read'] }
     */
    constructor(hierarchy: RoleHierarchy, rolePermissions?: Record<string, string[]>);
    private _flattenPerms;
    /**
     * Check if any of `userRoles` satisfies the required role
     * (including via inheritance).
     */
    hasRole(userRoles: string[], requiredRole: string): boolean;
    private _isInherited;
    /**
     * Check if any of `userRoles` has the required permission
     * (including via inherited roles).
     */
    hasPermission(userRoles: string[], permission: string): boolean;
}
/**
 * Middleware factory that reads @Roles / @Permissions metadata from the route
 * handler and enforces them against ctx.user.roles.
 *
 * Because middleware runs before the handler, we attach the guard to the
 * global middleware pipeline and read metadata from the handler stored in
 * ctx.state['routeHandler'].
 */
export declare function rbacGuard(service: RbacService): MiddlewareFn;
//# sourceMappingURL=rbac.d.ts.map