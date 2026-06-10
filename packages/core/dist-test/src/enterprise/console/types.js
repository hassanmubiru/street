// src/enterprise/console/types.ts
// Shared types for the Enterprise Console REST surface.
//
// Zero runtime dependencies — Node core only. The console handlers reuse the
// framework's JwtService (security/jwt.ts) for authentication and a small RBAC
// model for authorization, and delegate all state mutations to a ConsoleBackend
// (backend.ts) which is wired to tenancy/enterprise services in production.
export {};
//# sourceMappingURL=types.js.map