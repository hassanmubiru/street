#!/usr/bin/env node
// One-shot maintenance helper: insert a standardized top-level `concurrency:`
// block before the top-level `jobs:` key in workflows that lack one.
// Removed after use.
import { readFileSync, writeFileSync } from 'node:fs';

// Workflows whose runs must always complete (release/deploy/admin/long-soak):
const NO_CANCEL = new Set([
  'transfer-npm-owner',
  'deploy-verify',
  'ci-cd-enforcement',
  'runtime-certification',
  'soak-scale-chaos',
]);

const files = process.argv.slice(2);
for (const file of files) {
  const stem = file.split('/').pop().replace(/\.ya?ml$/, '');
  const src = readFileSync(file, 'utf8');
  if (/^concurrency:/m.test(src)) {
    console.log(`skip (has concurrency): ${file}`);
    continue;
  }
  // Match the first top-level `jobs:` key (column 0).
  const m = src.match(/^jobs:\s*$/m);
  if (!m) {
    console.log(`skip (no top-level jobs:): ${file}`);
    continue;
  }
  const cancel = NO_CANCEL.has(stem) ? 'false' : 'true';
  const block =
    `# ── Concurrency ` + '─'.repeat(64 - 16) + '\n' +
    `concurrency:\n` +
    `  group: ${stem}-\${{ github.ref }}\n` +
    `  cancel-in-progress: ${cancel}\n\n`;
  const idx = m.index;
  const out = src.slice(0, idx) + block + src.slice(idx);
  writeFileSync(file, out);
  console.log(`added (cancel=${cancel}): ${file}`);
}
