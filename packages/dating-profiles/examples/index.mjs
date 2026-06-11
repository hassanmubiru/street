// Runnable example: profiles, likes, and reciprocal matching.
//
//   node examples/index.mjs
//
// Demonstrates that profile bios are encrypted at rest via the core FieldCipher
// and that a match is recorded the moment two users have liked each other.

import { randomBytes } from 'node:crypto';
import { FieldCipher, Keyring, isEncryptedField } from 'streetjs';
import { ProfileService } from '@streetjs/dating-profiles';

// A FieldCipher backed by a single-version keyring (rotate by adding versions).
const cipher = new FieldCipher(Keyring.fromKey(randomBytes(32)));
const profiles = new ProfileService({ cipher });

// 1) Create two profiles. The `bio` is stored encrypted, never in the clear.
const ada = await profiles.create({ userId: 'ada', displayName: 'Ada', bio: 'loves hiking' });
await profiles.create({ userId: 'lin', displayName: 'Lin', bio: 'enjoys jazz' });

console.log('Ada bio stored as EncryptedField:', isEncryptedField(ada.bio));
console.log('Ciphertext contains plaintext?:', JSON.stringify(ada.bio).includes('loves hiking'));
console.log('Authorized decrypt of Ada bio:', await profiles.readBio('ada'));

// 2) One-sided like — no match yet.
console.log('ada likes lin ->', await profiles.like('ada', 'lin')); // { matched: false }
console.log('match?', await profiles.isMatch('ada', 'lin')); // false

// 3) Reciprocal like — a match is recorded (R11.2).
console.log('lin likes ada ->', await profiles.like('lin', 'ada')); // { matched: true }
console.log('match?', await profiles.isMatch('lin', 'ada')); // true
console.log('Ada matches:', await profiles.matches('ada'));
