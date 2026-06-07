// Quick probe of the three flagged ReDoS patterns (UNFIXED code) to confirm
// super-linear growth and pick test sizes. Throwaway.
import { base32Decode } from './dist/auth/mfa.js';
import { parseProto } from './dist/microservices/grpc/proto-parser.js';

function timeMs(fn) {
  const t0 = process.hrtime.bigint();
  try { fn(); } catch { /* base32Decode throws on '=' — timing is what matters */ }
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6;
}

function curve(label, make, run) {
  console.log(`\n== ${label} ==`);
  let prev = 0;
  for (const N of [2000, 4000, 8000, 16000, 32000]) {
    const input = make(N);
    // warm + median of 3
    const samples = [timeMs(() => run(input)), timeMs(() => run(input)), timeMs(() => run(input))];
    samples.sort((a, b) => a - b);
    const t = samples[1];
    const ratio = prev ? (t / prev).toFixed(2) : '-';
    console.log(`N=${N}\t${t.toFixed(2)} ms\tx${ratio} (vs prev N/2)`);
    prev = t;
  }
}

// B.1 — base32Decode '/=+$/g' backtracking on '='.repeat(N) + 'A'
curve('B.1 base32Decode(=*N + A)  /=+$/g', (N) => '='.repeat(N) + 'A', (s) => base32Decode(s));

// B.2 — generateGrpc basename derivation line 126: protoPath.replace(/.*\//,'').replace(/\.proto$/,'')
curve('B.2 generateGrpc basename  /.*\\//', (N) => 'a'.repeat(N), (s) => s.replace(/.*\//, '').replace(/\.proto$/, ''));

// B.3 — parseProto stripComments '/\/\*[\s\S]*?\*\//g' on '/*'.repeat(N)
curve('B.3 parseProto(/* * N)  [\\s\\S]*?', (N) => '/*'.repeat(N), (s) => parseProto(s));
