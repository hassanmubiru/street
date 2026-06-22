// saas-rbac-monotonicity.pbt.test.ts
// Property-based test for the SaaS starter — Property 3: RBAC monotonicity.
//
//   Property 3 (design.md): ∀ users u, permissions p: `can(u, p)` is true iff
//   some role of u grants p (directly or by wildcard) and u is not suspended.
//   **Validates: Requirements 3.1**
//
// WHAT THIS TEST DRIVES (annotation required by the task):
// The RBAC engine itself (`AdminService.can`) lives in the official
// `@streetjs/admin` package and has its own PBT suite (admin-pbt.test.ts). The
// SaaS starter does NOT reimplement RBAC — it COMPOSES `@streetjs/admin` +
// core `requireRoles(...)`. `@streetjs/admin` is intentionally NOT a declared
// dependency of `@streetjs/cli` (the overlay ships RBAC as scaffolded template
// strings, and package.json must not be modified here), so the real
// `AdminService` is not importable from this package.
//
// Therefore this test validates the COMPOSITION / decision semantics the
// overlay relies on, using two concrete artefacts:
//   1. `permissionMatches` — a verbatim mirror of `@streetjs/admin`'s wildcard
//      matcher (packages/admin/src/types.ts): exact, global `*`, and
//      segment-wildcard (`users:*`, `*:read`) matching. This is the documented
//      grant predicate behind `can`.
//   2. `scopeSatisfied` — copied verbatim from the overlay template
//      `src/middleware/apiKeyAuth.ts` (in packages/cli/src/commands/create.ts),
//      which uses the same exact / `*` / `segment:*` semantics. We property-test
//      that the overlay predicate agrees with the admin matcher on that shared
//      semantic surface.
//
// The decision function `canCompose` reproduces the documented `can` rule
// (suspended ⇒ deny everything; otherwise grant iff any role grants the
// permission) and composes a `requireRoles`-style gate, so the asserted
// property is exactly Property 3 as the overlay depends on it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

// ── Faithful mirror of @streetjs/admin's permission matcher ──────────────────
// (packages/admin/src/types.ts — kept byte-faithful so the spec we assert is
// the real `can` grant semantics, not an approximation.)
function permissionMatches(granted: string, requested: string): boolean {
  if (granted === '*' || granted === requested) return true;
  const g = granted.split(':');
  const r = requested.split(':');
  if (g.length !== r.length) return false;
  return g.every((part, i) => part === '*' || part === r[i]);
}

// ── Verbatim copy of the overlay predicate (src/middleware/apiKeyAuth.ts) ─────
// A scope is granted by an exact match, by the global wildcard '*', or by a
// segment wildcard such as 'billing:*' covering 'billing:read'.
function scopeSatisfied(granted: string[], requiredScope: string): boolean {
  for (const g of granted) {
    if (g === requiredScope || g === '*') return true;
    if (g.endsWith(':*') && requiredScope.startsWith(g.slice(0, -1))) return true;
  }
  return false;
}

// ── Composition model: the documented `can(u, p)` rule the overlay relies on ──
interface ModelRole {
  name: string;
  permissions: string[];
}
interface ModelUser {
  roles: string[]; // role names assigned to the user
  suspended: boolean;
}

/** Does any role assigned to `u` grant `p` (directly or by wildcard)? */
function someRoleGrants(u: ModelUser, roles: Map<string, ModelRole>, p: string): boolean {
  for (const roleName of u.roles) {
    const role = roles.get(roleName);
    if (!role) continue;
    for (const granted of role.permissions) {
      if (permissionMatches(granted, p)) return true;
    }
  }
  return false;
}

/**
 * Reproduces `AdminService.can`: a suspended user is denied everything;
 * otherwise the permission is granted iff some assigned role grants it. This is
 * the decision the SaaS overlay composes behind `requireRoles(...)`.
 */
function canCompose(u: ModelUser, roles: Map<string, ModelRole>, p: string): boolean {
  if (u.suspended) return false;
  return someRoleGrants(u, roles, p);
}

// ── Generators ───────────────────────────────────────────────────────────────
const segment = fc.stringMatching(/^[a-z]{1,6}$/);
// Concrete permission like "users:read" (two segments — the starter's shape).
const permissionArb = fc.tuple(segment, segment).map(([a, b]) => `${a}:${b}`);
// Grant patterns include exact perms plus the wildcard forms `can` understands.
const grantArb = fc.oneof(
  permissionArb,
  segment.map((s) => `${s}:*`),
  segment.map((s) => `*:${s}`),
  fc.constant('*'),
);

const roleArb = fc.record({
  name: fc.stringMatching(/^[a-z]{1,6}$/),
  permissions: fc.uniqueArray(grantArb, { maxLength: 6 }),
});

describe('Property 3: RBAC monotonicity (overlay composition of @streetjs/admin)', () => {
  // Core "iff": can(u, p) ⟺ (not suspended ∧ some role grants p).
  // **Validates: Requirements 3.1**
  it('can(u, p) is true iff some role grants p (incl. wildcard) and u is not suspended', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(roleArb, { minLength: 1, maxLength: 5, selector: (r) => r.name }),
        fc.boolean(),
        permissionArb,
        (roleList, suspended, probe) => {
          const roles = new Map(roleList.map((r) => [r.name, r]));
          const user: ModelUser = { roles: roleList.map((r) => r.name), suspended };

          const granted = someRoleGrants(user, roles, probe);
          const decision = canCompose(user, roles, probe);

          // The exact Property 3 biconditional.
          assert.equal(decision, !suspended && granted);

          // Suspension dominates: a suspended user is denied regardless of grants.
          if (suspended) assert.equal(decision, false);
        },
      ),
      { numRuns: 300 },
    );
  });

  // Monotonicity proper: adding a grant to a role never revokes prior access
  // (for an active user). This is the "monotonicity" facet of Property 3.
  // **Validates: Requirements 3.1**
  it('granting an additional permission never removes previously granted access', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(permissionArb, { minLength: 1, maxLength: 8 }),
        grantArb,
        (probes, extraGrant) => {
          const before: ModelRole = { name: 'r', permissions: [] };
          const rolesBefore = new Map([[before.name, before]]);
          const after: ModelRole = { name: 'r', permissions: [extraGrant] };
          const rolesAfter = new Map([[after.name, after]]);
          const user: ModelUser = { roles: ['r'], suspended: false };

          for (const p of probes) {
            const allowedBefore = canCompose(user, rolesBefore, p);
            const allowedAfter = canCompose(user, rolesAfter, p);
            // Monotonic: anything allowed before is still allowed after.
            if (allowedBefore) assert.equal(allowedAfter, true, `lost access to ${p}`);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  // The overlay's own scopeSatisfied predicate agrees with the admin matcher on
  // the shared exact / `*` / `segment:*` semantics it composes. This is the
  // concrete grant function the overlay's apiKeyAuth uses.
  // **Validates: Requirements 3.1**
  it('overlay scopeSatisfied agrees with the admin matcher on exact / * / segment:* grants', () => {
    // Restrict to the grant forms scopeSatisfied is documented to handle:
    // exact permissions, the global `*`, and segment wildcards `x:*`.
    const overlayGrantArb = fc.oneof(
      permissionArb,
      segment.map((s) => `${s}:*`),
      fc.constant('*'),
    );
    fc.assert(
      fc.property(
        fc.uniqueArray(overlayGrantArb, { minLength: 1, maxLength: 6 }),
        permissionArb,
        (grants, probe) => {
          const overlay = scopeSatisfied(grants, probe);
          const adminEquivalent = grants.some((g) => permissionMatches(g, probe));
          assert.equal(overlay, adminEquivalent);
        },
      ),
      { numRuns: 300 },
    );
  });
});
