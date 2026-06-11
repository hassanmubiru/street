// packages/dating-profiles/src/tests/profile-service.test.ts
// Example/edge-case unit tests for ProfileService (R11.2, R11.6).
//
// The universal reciprocal-likes property (Property 24) lives in its own
// *-pbt.test.ts file per the design; these tests cover concrete behaviors:
// encrypted bio storage, directional likes, reciprocal matching, order
// independence, and input validation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { FieldCipher, Keyring, isEncryptedField } from 'streetjs';
import { ProfileService, InMemoryProfileStore } from '../index.js';

function newService(now?: () => number): ProfileService {
  const cipher = new FieldCipher(Keyring.fromKey(randomBytes(32)));
  return new ProfileService({ cipher, store: new InMemoryProfileStore(), now });
}

describe('ProfileService.create', () => {
  it('stores the bio as an EncryptedField, not plaintext', async () => {
    const service = newService();
    const profile = await service.create({ userId: 'u1', displayName: 'Ada', bio: 'loves hiking' });

    assert.equal(profile.userId, 'u1');
    assert.equal(profile.displayName, 'Ada');
    assert.ok(isEncryptedField(profile.bio), 'bio must be an EncryptedField');
    // The serialized envelope must not contain the plaintext anywhere.
    assert.ok(!JSON.stringify(profile.bio).includes('loves hiking'));
  });

  it('round-trips the bio for an authorized read', async () => {
    const service = newService();
    await service.create({ userId: 'u1', displayName: 'Ada', bio: 'loves hiking' });
    assert.equal(await service.readBio('u1'), 'loves hiking');
  });

  it('rejects a duplicate profile', async () => {
    const service = newService();
    await service.create({ userId: 'u1', displayName: 'Ada', bio: 'x' });
    await assert.rejects(() => service.create({ userId: 'u1', displayName: 'Ada2', bio: 'y' }));
  });

  it('rejects invalid input', async () => {
    const service = newService();
    await assert.rejects(() => service.create({ userId: '', displayName: 'Ada', bio: 'x' }));
    // @ts-expect-error intentionally wrong type
    await assert.rejects(() => service.create({ userId: 'u1', displayName: 'Ada', bio: 123 }));
  });
});

describe('ProfileService.like / isMatch', () => {
  it('does not match on a one-sided like', async () => {
    const service = newService();
    const r = await service.like('a', 'b');
    assert.equal(r.matched, false);
    assert.equal(await service.isMatch('a', 'b'), false);
  });

  it('records a match on reciprocal likes', async () => {
    const service = newService();
    assert.equal((await service.like('a', 'b')).matched, false);
    assert.equal((await service.like('b', 'a')).matched, true);
    assert.equal(await service.isMatch('a', 'b'), true);
  });

  it('is order independent for isMatch', async () => {
    const service = newService();
    await service.like('a', 'b');
    await service.like('b', 'a');
    assert.equal(await service.isMatch('a', 'b'), true);
    assert.equal(await service.isMatch('b', 'a'), true);
  });

  it('records each match once and is idempotent on repeated likes', async () => {
    const service = newService(() => 1000);
    await service.like('a', 'b');
    await service.like('b', 'a');
    await service.like('a', 'b'); // repeat
    const matches = await service.matches('a');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].createdAt, 1000);
  });

  it('rejects self-likes and reports no self-match', async () => {
    const service = newService();
    await assert.rejects(() => service.like('a', 'a'));
    assert.equal(await service.isMatch('a', 'a'), false);
  });
});
