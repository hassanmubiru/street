// src/security/encrypted-field.ts
// Field-level encryption (Phase 5, R6).
//
// Provides an `EncryptedField<T>` type and a `FieldCipher` for encrypting
// selected sensitive fields (message content, phone numbers, addresses, private
// notes, profile metadata) at rest using AES-256-GCM — reusing the exact GCM
// layout already proven in `vault.ts`/`session.ts`.
//
// The design layers **envelope encryption** on top of the raw GCM primitive:
//   * a fresh per-value Data Encryption Key (DEK) encrypts the plaintext;
//   * the DEK is itself wrapped (encrypted) under a Key Encryption Key (KEK);
//   * KEKs live in a versioned `Keyring`, the highest version being "current".
//
// Because each envelope records the KEK version used to wrap its DEK, rotating
// the KEK (adding a higher version) never requires re-encrypting historical
// data: old envelopes still carry the version whose KEK can unwrap their DEK
// (R6.6). Any alteration of the ciphertext, its auth tag, or the wrapped DEK
// causes GCM authentication to fail, so `decrypt` throws and never returns
// plaintext (R6.7).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV for GCM (matches session.ts/vault.ts)
const TAG_LEN = 16; // 128-bit auth tag
const KEY_LEN = 32; // AES-256 → 32-byte keys (DEK and KEK)

/** A single versioned Key Encryption Key. `kek` MUST be 32 bytes (AES-256). */
export interface KeyringEntry {
  version: number;
  kek: Buffer;
}

/**
 * Versioned set of Key Encryption Keys. The entry with the highest version is
 * treated as "current" and used to wrap DEKs for new writes; older versions are
 * retained so values encrypted before a rotation remain decryptable (R6.5/6.6).
 */
export class Keyring {
  private readonly byVersion = new Map<number, KeyringEntry>();
  private readonly currentEntry: KeyringEntry;

  constructor(entries: KeyringEntry[]) {
    if (!entries || entries.length === 0) {
      throw new Error('Keyring: at least one KeyringEntry is required');
    }

    let current: KeyringEntry | undefined;
    for (const entry of entries) {
      if (!Number.isInteger(entry.version) || entry.version < 0) {
        throw new Error(`Keyring: invalid version ${String(entry.version)} (must be a non-negative integer)`);
      }
      if (!Buffer.isBuffer(entry.kek) || entry.kek.length !== KEY_LEN) {
        throw new Error(`Keyring: KEK for version ${entry.version} must be a ${KEY_LEN}-byte Buffer`);
      }
      if (this.byVersion.has(entry.version)) {
        throw new Error(`Keyring: duplicate KEK version ${entry.version}`);
      }
      this.byVersion.set(entry.version, entry);
      if (!current || entry.version > current.version) current = entry;
    }

    this.currentEntry = current!;
  }

  /** The current (highest-version) KEK, used to wrap DEKs for new writes. */
  current(): KeyringEntry {
    return this.currentEntry;
  }

  /** Look up a KEK by version, or `undefined` if no such version exists (R6.6). */
  get(version: number): KeyringEntry | undefined {
    return this.byVersion.get(version);
  }

  /** Convenience factory: build a single-entry keyring from a raw 32-byte key. */
  static fromKey(kek: Buffer, version = 1): Keyring {
    return new Keyring([{ version, kek }]);
  }
}

/**
 * Serialized ciphertext envelope (the stored value). All binary fields are
 * base64-encoded so the envelope is JSON-safe.
 */
export interface EncryptedEnvelope {
  /** KEK version used to wrap the DEK (R6.5/6.6). */
  v: number;
  /** base64 of the DEK wrapped under the KEK: [iv][tag][ciphertext]. */
  wrappedDek: string;
  /** base64 data IV used to encrypt the plaintext. */
  iv: string;
  /** base64 GCM auth tag over the data ciphertext (R6.7). */
  tag: string;
  /** base64 AES-256-GCM ciphertext of the plaintext value (R6.2). */
  ct: string;
}

/**
 * Branded type marking a field value as encrypted-at-rest (R6.1). The phantom
 * `__t` carries the plaintext type `T` for static safety without ever holding
 * the plaintext at runtime.
 */
export type EncryptedField<T> = {
  readonly __enc: 'EncryptedField';
  envelope: EncryptedEnvelope;
  /** Phantom marker for the plaintext type; never populated at runtime. */
  __t?: T;
};

/** Type guard: does `value` look like a serialized {@link EncryptedField}? */
export function isEncryptedField<T = unknown>(value: unknown): value is EncryptedField<T> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.__enc !== 'EncryptedField') return false;
  const env = v.envelope as Record<string, unknown> | undefined;
  return (
    typeof env === 'object' &&
    env !== null &&
    typeof env.v === 'number' &&
    typeof env.wrappedDek === 'string' &&
    typeof env.iv === 'string' &&
    typeof env.tag === 'string' &&
    typeof env.ct === 'string'
  );
}

/**
 * Encrypts and decrypts field values using envelope encryption over a versioned
 * {@link Keyring}. A fresh DEK is generated per `encrypt` call, used to
 * AES-256-GCM the plaintext, then itself wrapped under the current KEK.
 */
export class FieldCipher {
  private readonly keyring: Keyring;

  constructor(keyring: Keyring) {
    this.keyring = keyring;
  }

  /**
   * Encrypt `value` into an {@link EncryptedField}. Generates a per-value DEK,
   * encrypts the JSON-serialized plaintext under it, and wraps the DEK under the
   * keyring's current KEK (R6.2/6.5).
   */
  encrypt<T>(value: T): EncryptedField<T> {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error('FieldCipher: value is not JSON-serializable (e.g. undefined or a function)');
    }

    const entry = this.keyring.current();

    // 1) Per-value DEK encrypts the plaintext.
    const dek = randomBytes(KEY_LEN);
    const dataIv = randomBytes(IV_LEN);
    const dataCipher = createCipheriv(ALGO, dek, dataIv);
    const ct = Buffer.concat([dataCipher.update(Buffer.from(serialized, 'utf8')), dataCipher.final()]);
    const dataTag = dataCipher.getAuthTag();

    // 2) Wrap the DEK under the current KEK. Layout: [iv][tag][ciphertext].
    const wrapIv = randomBytes(IV_LEN);
    const wrapCipher = createCipheriv(ALGO, entry.kek, wrapIv);
    const wrappedKey = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
    const wrapTag = wrapCipher.getAuthTag();
    const wrappedDek = Buffer.concat([wrapIv, wrapTag, wrappedKey]).toString('base64');

    return {
      __enc: 'EncryptedField',
      envelope: {
        v: entry.version,
        wrappedDek,
        iv: dataIv.toString('base64'),
        tag: dataTag.toString('base64'),
        ct: ct.toString('base64'),
      },
    };
  }

  /**
   * Decrypt an {@link EncryptedField} back to its plaintext value. Unwraps the
   * DEK using the KEK version recorded in the envelope (so rotated keyrings
   * still decrypt old data, R6.6), then decrypts the ciphertext. Any tampering
   * with the wrapped DEK, IV, tag, or ciphertext causes GCM authentication to
   * fail and this method to throw without returning plaintext (R6.3/6.7).
   */
  decrypt<T>(field: EncryptedField<T>): T {
    if (!isEncryptedField<T>(field)) {
      throw new Error('FieldCipher: value is not a valid EncryptedField');
    }
    const env = field.envelope;

    const entry = this.keyring.get(env.v);
    if (!entry) {
      throw new Error(`FieldCipher: no KEK available for envelope version ${env.v}`);
    }

    // 1) Unwrap the DEK with the envelope's KEK version.
    const dek = this.unwrapDek(env.wrappedDek, entry.kek);

    // 2) Decrypt the data ciphertext under the DEK.
    let plaintext: string;
    try {
      const iv = Buffer.from(env.iv, 'base64');
      const tag = Buffer.from(env.tag, 'base64');
      const ct = Buffer.from(env.ct, 'base64');
      const decipher = createDecipheriv(ALGO, dek, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
      plaintext = decrypted.toString('utf8');
    } catch {
      throw new Error('FieldCipher: decryption failed — data may be tampered or the key is incorrect');
    }

    try {
      return JSON.parse(plaintext) as T;
    } catch {
      throw new Error('FieldCipher: decrypted payload is not valid JSON — data may be tampered');
    }
  }

  /** Unwrap a base64 [iv][tag][ciphertext] DEK blob using the given KEK. */
  private unwrapDek(wrappedDek: string, kek: Buffer): Buffer {
    try {
      const buf = Buffer.from(wrappedDek, 'base64');
      if (buf.length < IV_LEN + TAG_LEN + 1) {
        throw new Error('wrapped DEK too short');
      }
      const wrapIv = buf.subarray(0, IV_LEN);
      const wrapTag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const wrappedKey = buf.subarray(IV_LEN + TAG_LEN);
      const decipher = createDecipheriv(ALGO, kek, wrapIv);
      decipher.setAuthTag(wrapTag);
      const dek = Buffer.concat([decipher.update(wrappedKey), decipher.final()]);
      if (dek.length !== KEY_LEN) {
        throw new Error('unwrapped DEK has wrong length');
      }
      return dek;
    } catch {
      throw new Error('FieldCipher: failed to unwrap DEK — data may be tampered or the KEK is incorrect');
    }
  }
}
