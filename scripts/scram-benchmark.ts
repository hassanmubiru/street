// scripts/scram-benchmark.ts
// Benchmark SCRAM-SHA-256 authentication performance at various iteration counts.
//
// Usage: npx tsx scripts/scram-benchmark.ts

import { pbkdf2Sync, createHmac, createHash, randomBytes } from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

const ITERATION_COUNTS = [
  4_096,     // PostgreSQL default
  10_000,    // Common minimum
  100_000,   // OWASP recommended minimum
  310_000,   // OWASP 2023 recommended for PBKDF2-HMAC-SHA256
  1_000_000, // 1M — mid-high
  10_000_000, // 10M — current max in validation
] as const;

const SAMPLES = 30;      // samples per iteration count
const WARMUP = 5;        // warmup runs before sampling

const PASSWORD = 'benchmark-password-abc123';
const SALT = randomBytes(16);
const NONCE = randomBytes(18).toString('base64url');

// ─── Benchmark helpers ────────────────────────────────────────────────────────

function scramAuth(password: string, salt: Buffer, iterations: number, nonce: string): Buffer {
  // Replicate the SASLContinue handler computation
  const normalizedPassword = password.normalize('NFKC');
  const saltedPassword = pbkdf2Sync(normalizedPassword, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverFirstMessage = `r=${nonce},s=${salt.toString('base64')},i=${iterations}`;
  const clientFinalMessageWithoutProof = `c=biws,r=${nonce}`;
  const authMessage = `n=${PASSWORD},r=${nonce},${serverFirstMessage},${clientFinalMessageWithoutProof}`;
  const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();
  // XOR (inlined for benchmark accuracy)
  const out = Buffer.allocUnsafe(clientKey.length);
  for (let i = 0; i < clientKey.length; i++) {
    out[i] = clientKey[i]! ^ clientSignature[i]!;
  }
  return out;
}

function bench(fn: () => void, samples: number): { min: number; avg: number; max: number; total: number } {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = process.hrtime.bigint();
    fn();
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1_000_000); // ms
  }
  const total = times.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...times),
    avg: total / times.length,
    max: Math.max(...times),
    total,
  };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

console.log('='.repeat(80));
console.log('SCRAM-SHA-256 Authentication Performance Benchmark');
console.log(`Samples per iteration count: ${SAMPLES} (after ${WARMUP} warmup runs)`);
console.log(`Password length: ${PASSWORD.length} chars`);
console.log(`Salt length: ${SALT.length} bytes`);
console.log('='.repeat(80));
console.log();

// Warmup: execute at lowest iteration count to let V8 JIT settle
console.log('Warming up...');
for (let i = 0; i < WARMUP; i++) {
  pbkdf2Sync(PASSWORD, SALT, 4096, 32, 'sha256');
  scramAuth(PASSWORD, SALT, 4096, NONCE);
}
console.log('Done.\n');

// Header
console.log(
  '  Iterations  |  PBKDF2 avg (ms)  |  PBKDF2 min→max   |  Full auth avg (ms) |  Full auth min→max  |  Factor vs 4096'
);
console.log('-'.repeat(105));

const PBKDF2_BASELINE = 4096;

for (const iterations of ITERATION_COUNTS) {
  // Benchmark raw PBKDF2
  const pbkdf2Result = bench(() => {
    pbkdf2Sync(PASSWORD, SALT, iterations, 32, 'sha256');
  }, SAMPLES);

  // Benchmark full SCRAM auth
  const fullResult = bench(() => {
    scramAuth(PASSWORD, SALT, iterations, NONCE);
  }, SAMPLES);

  const factor = (fullResult.avg / (ITERATION_COUNTS[0]! === PBKDF2_BASELINE
    ? bench(() => scramAuth(PASSWORD, SALT, PBKDF2_BASELINE, NONCE), SAMPLES).avg
    : ((results: Record<number, number>) => results[PBKDF2_BASELINE]!)((() => {
      // We'll compute factor vs 4096 after collecting all results
      return 1;
    })()))
  ).toFixed(2));

  console.log(
    `  ${String(iterations).padStart(9)}  |` +
    `  ${pbkdf2Result.avg.toFixed(2).padStart(12)} ms  |` +
    `  ${pbkdf2Result.min.toFixed(1)}→${pbkdf2Result.max.toFixed(1)}   |` +
    `  ${fullResult.avg.toFixed(2).padStart(13)} ms  |` +
    `  ${fullResult.min.toFixed(1)}→${fullResult.max.toFixed(1)}   |` +
    `  ${(fullResult.avg > 0).toFixed(2)}x` // placeholder, recompute below
  );
}

// ─── Second pass: compute accurate factors ────────────────────────────────────

console.log('\nRe-running with accurate factor computation...\n');
console.log(
  '  Iterations  |  PBKDF2 avg (ms)  |  Full auth avg (ms) |  Full auth min→max  |  Factor vs 4096'
);
console.log('-'.repeat(90));

// Get baseline
const baselineResult = bench(() => {
  scramAuth(PASSWORD, SALT, PBKDF2_BASELINE, NONCE);
}, SAMPLES);
const baselineAvg = baselineResult.avg;

let prevAvg = 0;

for (const iterations of ITERATION_COUNTS) {
  const pbkdf2Result = bench(() => {
    pbkdf2Sync(PASSWORD, SALT, iterations, 32, 'sha256');
  }, SAMPLES);

  const fullResult = bench(() => {
    scramAuth(PASSWORD, SALT, iterations, NONCE);
  }, SAMPLES);

  const factor = (fullResult.avg / baselineAvg).toFixed(2);
  const prevFactor = prevAvg > 0 ? (fullResult.avg / prevAvg).toFixed(2) : '-';

  console.log(
    `  ${String(iterations).padStart(9)}  |` +
    `  ${pbkdf2Result.avg.toFixed(2).padStart(12)} ms  |` +
    `  ${fullResult.avg.toFixed(2).padStart(14)} ms  |` +
    `  ${fullResult.min.toFixed(1)}→${fullResult.max.toFixed(1)}   |` +
    `  ${factor.padStart(7)}x`
  );

  prevAvg = fullResult.avg;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log();
console.log(`  Baseline (4096 iterations):     ${baselineAvg.toFixed(2)} ms per auth`);
console.log(`  Current min (4096):             ${baselineAvg.toFixed(2)} ms`);
console.log(`  Current max limit (10,000,000): estimated ${(baselineAvg * (10_000_000 / 4096)).toFixed(0)} ms`);
console.log();
console.log('  Recommendations:');
console.log('    • 4096   — PostgreSQL default, ~2-4ms per auth');
console.log('    • 10,000 — ~5-10ms, reasonable for most apps');
console.log('    • 100,000 — ~50-100ms, strong security per OWASP');
console.log('    • 310,000 — ~150-300ms, OWASP 2023 recommendation');
console.log('    • 1,000,000 — ~500ms-1s, may cause connection timeout under load');
console.log('    • 10,000,000 — ~5-10s, too slow for production (exceeds most timeouts)');
console.log();
console.log(`  Auth flow overhead (non-PBKDF2): ~${(baselineResult.total / SAMPLES - bench(() => {
    pbkdf2Sync(PASSWORD, SALT, 4096, 32, 'sha256');
  }, 1).avg).toFixed(3)} ms (HMACs + SHA-256 + XOR)`);
