// notification-pbt.test.ts
// Property-based tests for the inbox against a reference model.
//
// Properties:
//   P1 (unread accounting): unreadCount(u) always equals
//      (#notify for u where actor != u) - (#distinct marked read), and is never
//      negative. markAllRead drives it to 0.
//   P2 (recipient isolation): a recipient never sees another recipient's
//      notifications, and ordering is strictly descending by seq.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { NotificationService, type Notification } from '../index.js';

const USERS = ['u0', 'u1', 'u2'] as const;
const userArb = fc.constantFrom(...USERS);

type Action =
  | { t: 'notify'; recipient: (typeof USERS)[number]; actor: (typeof USERS)[number] }
  | { t: 'readAll'; recipient: (typeof USERS)[number] };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ t: fc.constant('notify' as const), recipient: userArb, actor: userArb }),
  fc.record({ t: fc.constant('readAll' as const), recipient: userArb }),
);

function strictlyDescending(items: Notification[]): boolean {
  for (let i = 1; i < items.length; i++) if (items[i - 1]!.seq <= items[i]!.seq) return false;
  return true;
}

describe('Property: notification inbox matches a reference model', () => {
  it('P1+P2: unread accounting, isolation, and ordering hold', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { maxLength: 60 }), async (actions) => {
        const svc = new NotificationService({ now: () => 1 });
        const unread: Record<string, number> = { u0: 0, u1: 0, u2: 0 };
        const total: Record<string, number> = { u0: 0, u1: 0, u2: 0 };

        for (const a of actions) {
          if (a.t === 'notify') {
            const created = await svc.notify({ recipientId: a.recipient, type: 't', actorId: a.actor });
            if (a.actor !== a.recipient) {
              assert.ok(created, 'non-self notify must be created');
              unread[a.recipient]!++;
              total[a.recipient]!++;
            } else {
              assert.equal(created, null, 'self-notify is suppressed');
            }
          } else {
            const changed = await svc.markAllRead(a.recipient);
            assert.equal(changed, unread[a.recipient], 'markAllRead returns the unread count');
            unread[a.recipient] = 0;
          }
        }

        for (const u of USERS) {
          assert.ok(unread[u]! >= 0);
          assert.equal(await svc.unreadCount(u), unread[u], `unreadCount(${u})`);
          const all = await svc.list(u, { limit: 1000 });
          assert.equal(all.length, total[u], `list length for ${u}`);
          assert.ok(all.every((n) => n.recipientId === u), `isolation for ${u}`);
          assert.ok(strictlyDescending(all), `ordering for ${u}`);
          const unreadList = await svc.list(u, { limit: 1000, unreadOnly: true });
          assert.equal(unreadList.length, unread[u], `unreadOnly length for ${u}`);
        }
      }),
      { numRuns: 200 },
    );
  });
});
