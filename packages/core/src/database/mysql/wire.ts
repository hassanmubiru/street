// src/database/mysql/wire.ts
// MySQL Client/Server Protocol v4.1 wire driver.
// Pure node:net + node:crypto — no external dependencies.

import { createConnection, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { DbResult } from '../types.js';

// ─── Capability Flags ──────────────────────────────────────────────────────────
const CLIENT_PROTOCOL_41            = 0x0000_0200;
const CLIENT_SECURE_CONNECTION      = 0x0000_8000;
const CLIENT_PLUGIN_AUTH            = 0x0008_0000;
const CLIENT_PLUGIN_AUTH_LENENC_DATA= 0x0020_0000;
const CLIENT_CONNECT_WITH_DB        = 0x0000_0008;
const CLIENT_LONG_FLAG              = 0x0000_0004;

// ─── Commands ─────────────────────────────────────────────────────────────────
const COM_QUIT         = 0x01;
const COM_QUERY        = 0x03;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const COM_STMT_CLOSE   = 0x19;

// ─── MySQL FIELD TYPE constants ────────────────────────────────────────────────
const FIELD_TYPE_NULL    = 0x06;
const FIELD_TYPE_VARCHAR = 0x0f;

// ─── Auth plugins ─────────────────────────────────────────────────────────────
const PLUGIN_NATIVE   = 'mysql_native_password';
const PLUGIN_SHA2     = 'caching_sha2_password';


// ─── Helper: read length-encoded integer ─────────────────────────────────────
function readLenEncInt(buf: Buffer, offset: number): { value: number; bytesRead: number } {
  const first = buf[offset]!;
  if (first < 0xfb) return { value: first, bytesRead: 1 };
  if (first === 0xfc) return { value: buf.readUInt16LE(offset + 1), bytesRead: 3 };
  if (first === 0xfd) {
    return { value: buf.readUIntLE(offset + 1, 3), bytesRead: 4 };
  }
  // 0xfe — 8 bytes (we only support up to 32-bit safe integers here)
  return { value: buf.readUInt32LE(offset + 1), bytesRead: 9 };
}

// ─── Helper: write length-encoded integer ────────────────────────────────────
function writeLenEncInt(value: number): Buffer {
  if (value < 0xfb) {
    const b = Buffer.allocUnsafe(1);
    b[0] = value;
    return b;
  }
  if (value <= 0xffff) {
    const b = Buffer.allocUnsafe(3);
    b[0] = 0xfc;
    b.writeUInt16LE(value, 1);
    return b;
  }
  const b = Buffer.allocUnsafe(4);
  b[0] = 0xfd;
  b.writeUIntLE(value, 1, 3);
  return b;
}

// ─── Packet framing ───────────────────────────────────────────────────────────
/** Wrap body bytes in a MySQL packet header (3-byte len LE + 1-byte seq id). */
function wrapPacket(body: Buffer, seq: number): Buffer {
  const header = Buffer.allocUnsafe(4);
  header.writeUIntLE(body.length, 0, 3);
  header[3] = seq & 0xff;
  return Buffer.concat([header, body]);
}


// ─── Task 6.2: mysql_native_password auth ─────────────────────────────────────
/**
 * Compute mysql_native_password response:
 *   SHA1(password) XOR SHA1(seed + SHA1(SHA1(password)))
 */
function nativePasswordHash(password: string, seed: Buffer): Buffer {
  const sha1 = (data: Buffer | string): Buffer => {
    return createHash('sha1').update(data).digest();
  };
  const pw = Buffer.from(password, 'utf8');
  const hash1 = sha1(pw);                        // SHA1(password)
  const hash2 = sha1(hash1);                     // SHA1(SHA1(password))
  const combined = Buffer.concat([seed, hash2]); // seed + SHA1(SHA1(password))
  const hash3 = sha1(combined);                  // SHA1(seed + SHA1(SHA1(password)))
  // XOR hash1 with hash3
  const result = Buffer.allocUnsafe(20);
  for (let i = 0; i < 20; i++) {
    result[i] = hash1[i]! ^ hash3[i]!;
  }
  return result;
}

// ─── Task 6.3: caching_sha2_password auth ────────────────────────────────────
/**
 * Compute caching_sha2_password challenge response:
 *   XOR(SHA256(password), SHA256(SHA256(SHA256(password)) + seed))
 */
function sha2PasswordHash(password: string, seed: Buffer): Buffer {
  const sha256 = (data: Buffer | string): Buffer => {
    return createHash('sha256').update(data).digest();
  };
  const pw = Buffer.from(password, 'utf8');
  const A = sha256(pw);                               // SHA256(password)
  const B = sha256(A);                                // SHA256(SHA256(password))
  const C = sha256(Buffer.concat([B, seed]));         // SHA256(SHA256(SHA256(password)) + seed)
  // XOR A with C
  const result = Buffer.allocUnsafe(32);
  for (let i = 0; i < 32; i++) {
    result[i] = A[i]! ^ C[i]!;
  }
  return result;
}


// ─── Server Greeting (Handshake v10) ─────────────────────────────────────────
interface ServerGreeting {
  protocolVersion: number;
  serverVersion: string;
  connectionId: number;
  authPluginData: Buffer;  // full seed (part1 + part2)
  capabilityFlags: number;
  charset: number;
  statusFlags: number;
  authPluginName: string;
}

/** Parse a MySQL Handshake v10 packet body. */
function parseServerGreeting(body: Buffer): ServerGreeting {
  let offset = 0;

  const protocolVersion = body[offset]!;
  offset += 1;

  // Null-terminated server version string
  const versionEnd = body.indexOf(0, offset);
  const serverVersion = body.toString('utf8', offset, versionEnd);
  offset = versionEnd + 1;

  // 4-byte connection id
  const connectionId = body.readUInt32LE(offset);
  offset += 4;

  // 8-byte auth-plugin-data part 1
  const part1 = body.subarray(offset, offset + 8);
  offset += 8;

  // 1-byte filler (0x00)
  offset += 1;

  // 2-byte capability flags (lower half)
  const capLow = body.readUInt16LE(offset);
  offset += 2;

  // 1-byte charset
  const charset = body[offset]!;
  offset += 1;

  // 2-byte status flags
  const statusFlags = body.readUInt16LE(offset);
  offset += 2;

  // 2-byte capability flags (upper half)
  const capHigh = body.readUInt16LE(offset);
  offset += 2;
  const capabilityFlags = capLow | (capHigh << 16);

  // 1-byte auth plugin data length (total length of seed)
  const authPluginDataLen = body[offset]!;
  offset += 1;

  // 10-byte reserved zeros
  offset += 10;

  // auth-plugin-data part 2: max(13, authPluginDataLen - 8) bytes
  const part2Len = Math.max(13, authPluginDataLen - 8);
  const part2 = body.subarray(offset, offset + part2Len);
  offset += part2Len;

  // Combine part1 + part2 (strip trailing null from part2)
  const rawSeed = Buffer.concat([part1, part2]);
  // Seed is authPluginDataLen - 1 bytes (strip the null terminator)
  const seedLen = Math.max(0, authPluginDataLen - 1);
  const authPluginData = rawSeed.subarray(0, seedLen);

  // Null-terminated auth plugin name
  let authPluginName = '';
  if (offset < body.length) {
    const nameEnd = body.indexOf(0, offset);
    authPluginName = nameEnd === -1
      ? body.toString('utf8', offset)
      : body.toString('utf8', offset, nameEnd);
  }

  return {
    protocolVersion,
    serverVersion,
    connectionId,
    authPluginData,
    capabilityFlags,
    charset,
    statusFlags,
    authPluginName,
  };
}


// ─── HandshakeResponse41 ──────────────────────────────────────────────────────
function buildHandshakeResponse(
  user: string,
  database: string,
  authResponse: Buffer,
  authPluginName: string,
  charset = 0x21 /* utf8_general_ci */,
): Buffer {
  const userBuf = Buffer.concat([Buffer.from(user, 'utf8'), Buffer.from([0])]);
  const dbBuf   = Buffer.concat([Buffer.from(database, 'utf8'), Buffer.from([0])]);
  const pluginBuf = Buffer.concat([Buffer.from(authPluginName, 'utf8'), Buffer.from([0])]);

  const capabilities =
    CLIENT_PROTOCOL_41 |
    CLIENT_SECURE_CONNECTION |
    CLIENT_PLUGIN_AUTH |
    CLIENT_PLUGIN_AUTH_LENENC_DATA |
    CLIENT_CONNECT_WITH_DB |
    CLIENT_LONG_FLAG;

  // Build body
  const capBuf = Buffer.allocUnsafe(4);
  capBuf.writeUInt32LE(capabilities, 0);

  const maxPktBuf = Buffer.allocUnsafe(4);
  maxPktBuf.writeUInt32LE(0x40000000, 0); // 1 GB

  const charsetBuf = Buffer.from([charset]);
  const reservedBuf = Buffer.alloc(23, 0);

  const authLenBuf = writeLenEncInt(authResponse.length);

  const body = Buffer.concat([
    capBuf,
    maxPktBuf,
    charsetBuf,
    reservedBuf,
    userBuf,
    authLenBuf,
    authResponse,
    dbBuf,
    pluginBuf,
  ]);

  return wrapPacket(body, 1); // sequence id = 1
}

