// Unit tests for the dependency-free BSON codec. Pure/offline.
// Run: npm test -w packages/plugin-mongodb

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { encodeDocument, decodeDocument, ObjectId, BsonBinary, BsonError } from '../dist/bson.js';

const roundtrip = (doc) => decodeDocument(encodeDocument(doc));

describe('BSON round-trip', () => {
  it('encodes/decodes scalar types', () => {
    const out = roundtrip({ s: 'hello', i: 42, b: true, n: null, big: 9007199254740993n });
    assert.equal(out.s, 'hello');
    assert.equal(out.i, 42);
    assert.equal(out.b, true);
    assert.equal(out.n, null);
    assert.equal(out.big, 9007199254740993n);
  });

  it('distinguishes int32 from double', () => {
    const out = roundtrip({ i: 7, f: 3.5 });
    assert.equal(out.i, 7);
    assert.equal(out.f, 3.5);
  });

  it('encodes/decodes nested documents and arrays', () => {
    const out = roundtrip({ a: [1, 'two', false], doc: { x: 1, y: { z: 2 } } });
    assert.deepEqual(out.a, [1, 'two', false]);
    assert.equal(out.doc.y.z, 2);
  });

  it('round-trips a Date', () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    const out = roundtrip({ when: d });
    assert.equal(out.when.getTime(), d.getTime());
  });

  it('round-trips an ObjectId', () => {
    const oid = ObjectId.fromHex('507f1f77bcf86cd799439011');
    const out = roundtrip({ _id: oid });
    assert.equal(out._id.toHexString(), '507f1f77bcf86cd799439011');
  });

  it('round-trips binary data', () => {
    const out = roundtrip({ blob: new BsonBinary(Buffer.from('payload')) });
    assert.equal(out.blob.data.toString('utf8'), 'payload');
    assert.equal(out.blob.subtype, 0);
  });

  it('writes a correct length header', () => {
    const buf = encodeDocument({ a: 1 });
    assert.equal(buf.readInt32LE(0), buf.length);
  });

  it('utf8 strings use byte length, not char length', () => {
    const out = roundtrip({ s: '€uro' }); // € is 3 bytes
    assert.equal(out.s, '€uro');
  });
});

describe('BSON errors', () => {
  it('rejects a buffer whose declared length mismatches', () => {
    const buf = encodeDocument({ a: 1 });
    buf.writeInt32LE(buf.length + 1, 0);
    assert.throws(() => decodeDocument(buf), BsonError);
  });

  it('rejects a key containing a NUL byte', () => {
    assert.throws(() => encodeDocument({ ['a\0b']: 1 }), BsonError);
  });

  it('rejects an invalid ObjectId hex', () => {
    assert.throws(() => ObjectId.fromHex('xyz'), BsonError);
  });
});
