// admin-pbt.test.ts
// Property-based tests for authorization and audit invariants (async).
//
//   P1 (audit completeness): audit count equals the number of state-changing
//      operations actually applied (no-ops don't log).
//   P2 (suspension dominates): a suspended user is denied every permission.
//   P3 (grant monotonicity): granting a permission never removes prior access.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { AdminService } from '../index.js';

describe('Property: admin authorization & audit invariants', () => {
  it('P2: suspended users are denied everything', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}:[a-z]{1,6}$/), { maxLength: 6 }),
        fc.stringMatching(/^[a-z]{1,6}:[a-z]{1,6}$/),
        async (perms, probe) => {
          let n = 0;
          const a = new AdminService({ now: () => ++n, idGen: () => `id${n}` });
          await a.createRole('root', { name: 'role', permissions: perms.length ? perms : ['*'] });
          const u = await a.createUser('root', { email: 'u@e.com', roles: ['role'] });
          await a.suspendUser('root', u.id);
          assert.equal(await a.can(u.id, probe), false);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('P3: granting permissions is monotonic (never revokes prior access)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.stringMatching(/^[a-z]{1,5}:[a-z]{1,5}$/), { minLength: 1, maxLength: 8 }),
        async (grants) => {
          let n = 0;
          const a = new AdminService({ now: () => ++n, idGen: () => `id${n}` });
          await a.createRole('root', { name: 'r', permissions: [] });
          const u = await a.createUser('root', { email: 'u@e.com', roles: ['r'] });

          const allowedSoFar: string[] = [];
          for (const g of grants) {
            await a.grantPermission('root', 'r', g);
            allowedSoFar.push(g);
            for (const p of allowedSoFar) assert.equal(await a.can(u.id, p), true, `lost access to ${p}`);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('P1: audit count equals applied state changes', async () => {
    const opArb = fc.oneof(
      fc.record({ t: fc.constant('createRole' as const), name: fc.stringMatching(/^[a-z]{1,6}$/) }),
      fc.record({ t: fc.constant('suspend' as const) }),
      fc.record({ t: fc.constant('activate' as const) }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 25 }), async (ops) => {
        let n = 0;
        const a = new AdminService({ now: () => ++n, idGen: () => `id${n}_${++n}` });
        let applied = 1; // initial createUser
        const roles = new Set<string>();
        const u = await a.createUser('root', { email: 'u@e.com' });

        for (const op of ops) {
          if (op.t === 'createRole') {
            if (roles.has(op.name)) continue;
            await a.createRole('root', { name: op.name });
            roles.add(op.name);
            applied++;
          } else if (op.t === 'suspend') {
            const before = (await a.getUser(u.id))!.status;
            await a.suspendUser('root', u.id);
            if (before !== 'suspended') applied++;
          } else {
            const before = (await a.getUser(u.id))!.status;
            await a.activateUser('root', u.id);
            if (before !== 'active') applied++;
          }
        }
        assert.equal(await a.auditCount(), applied);
      }),
      { numRuns: 150 },
    );
  });
});
