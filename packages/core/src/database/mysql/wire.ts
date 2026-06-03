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

