// Unit tests for the SCRAM-SHA-256 client, validated against the published
// RFC 7677 test vector. Pure/offline. Run: npm test -w packages/plugin-mongodb

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  clientFirstBare, parseServerFirst, computeClientProof, verifyServerSignature, escapeUsername,
} from '../dist/scram.js';

describe('SCRAM-SHA-256 — RFC 7677 test vector', () => {
  // RFC 7677 §3: username "user", password "pencil".
  const clientNonce = 'rOprNGfwEbeRWgbNEkqO';
  const serverFirstRaw =
    'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096';

  it('builds the documented client-first-bare', () => {
    assert.equal(clientFirstBare('user', clientNonce), 'n=user,r=rOprNGfwEbeRWgbNEkqO');
  });

  it('produces the documented client proof and server signature', () => {
    const cfb = clientFirstBare('user', clientNonce);
    const serverFirst = parseServerFirst(serverFirstRaw);
    assert.equal(serverFirst.iterations, 4096);

    const proof = computeClientProof({ password: 'pencil', clientFirstBare: cfb, serverFirst });

    assert.equal(
      proof.clientFinal,
      'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=',
    );
    assert.equal(proof.serverSignature, '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  });

  it('verifies the matching server-final signature', () => {
    const cfb = clientFirstBare('user', clientNonce);
    const proof = computeClientProof({ password: 'pencil', clientFirstBare: cfb, serverFirst: parseServerFirst(serverFirstRaw) });
    const serverFinal = 'v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=';
    assert.equal(verifyServerSignature(serverFinal, proof.serverSignature), true);
    assert.equal(verifyServerSignature('v=tampered', proof.serverSignature), false);
  });
});

describe('SCRAM helpers', () => {
  it('escapes "=" and "," in usernames', () => {
    assert.equal(escapeUsername('a=b,c'), 'a=3Db=2Cc');
  });
  it('rejects a malformed server-first message', () => {
    assert.throws(() => parseServerFirst('r=only'), /malformed server-first/);
  });
});
