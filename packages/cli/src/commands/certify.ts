// packages/cli/src/commands/certify.ts
// `street certify` — the release-gate command. Runs the full certification
// battery (build, lint, typecheck, tests, and every certification suite),
// writes RELEASE-CERTIFICATION.md + certification-report.json, and exits
// non-zero if any required gate fails. Designed to be the single CI gate.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CliContext } from '../index.js';

interface GateResult {
  name: string;
  command: string;
  ok: boolean;
  durationMs: number;
  output: string;
}

interface CertifyOptions {
  /** Working directory of the @streetjs/core package (defaults to <cwd>/packages/core). */
  coreDir?: string;
  /** Skip E2E/integration gates that require live infrastructure. */
  skipInfra?: boolean;
}

const REQUIRED_GATES: Array<{ name: string; cmd: string; args: string[] }> = [
  { name: 'typecheck/lint', cmd: 'npm', args: ['run', 'lint'] },
  { name: 'build', cmd: 'npm', args: ['run', 'build'] },
  { name: 'compile-tests', cmd: 'npx', args: ['tsc'] },
  { name: 'unit+integration', cmd: 'node', args: ['--test', 'dist/src/tests/'] },
  { name: 'security-certification', cmd: 'node', args: ['--test', 'dist/tests/certification/security-certification.test.js'] },
  { name: 'observability-certification', cmd: 'node', args: ['--test', 'dist/tests/certification/observability-certification.test.js'] },
  { name: 'deployment-certification', cmd: 'node', args: ['--test', 'dist/tests/certification/deployment-certification.test.js'] },
  { name: 'enterprise-certification', cmd: 'node', args: ['--test', 'dist/tests/certification/enterprise-certification.test.js'] },
  { name: 'documentation-certification', cmd: 'node', args: ['--test', 'dist/tests/certification/documentation-certification.test.js'] },
  { name: 'repository-certification', cmd: 'node', args: ['--test', 'dist/tests/certification/repository-certification.test.js'] },
];

export class CertifyCommand {
  async execute(ctx: CliContext, opts: CertifyOptions = {}): Promise<void> {
    const coreDir = opts.coreDir ?? join(ctx.cwd, 'packages', 'core');
    const results: GateResult[] = [];

    for (const gate of REQUIRED_GATES) {
      const start = Date.now();
      const proc = spawnSync(gate.cmd, gate.args, { cwd: coreDir, encoding: 'utf8', timeout: 600_000 });
      const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
      const ok = proc.status === 0;
      results.push({ name: gate.name, command: `${gate.cmd} ${gate.args.join(' ')}`, ok, durationMs: Date.now() - start, output: output.slice(-2000) });
      const mark = ok ? '✓' : '✗';
      console.log(`[certify] ${mark} ${gate.name} (${Date.now() - start}ms)`);
      if (!ok && gate.name === 'build') break; // a broken build invalidates downstream gates
    }

    const passed = results.filter((r) => r.ok).length;
    const allPass = results.every((r) => r.ok);
    const report = {
      generatedAt: new Date().toISOString(),
      status: allPass ? 'CERTIFIED' : 'FAILED',
      gatesTotal: results.length,
      gatesPassed: passed,
      gates: results.map(({ output, ...rest }) => ({ ...rest, tail: output.split('\n').slice(-3).join(' ') })),
    };

    const jsonPath = join(ctx.cwd, 'certification-report.json');
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));

    const md = [
      '# Release Certification',
      '',
      `Generated: ${report.generatedAt}`,
      `Status: **${report.status}** (${passed}/${results.length} gates passed)`,
      '',
      '| Gate | Result | Duration |',
      '| --- | --- | --- |',
      ...results.map((r) => `| ${r.name} | ${r.ok ? '✅ pass' : '❌ fail'} | ${r.durationMs}ms |`),
      '',
    ].join('\n');
    writeFileSync(join(ctx.cwd, 'RELEASE-CERTIFICATION.md'), md);

    console.log(`[certify] report → ${jsonPath}`);
    console.log(`[certify] status: ${report.status} (${passed}/${results.length})`);
    if (!allPass) process.exitCode = 1;
  }
}
