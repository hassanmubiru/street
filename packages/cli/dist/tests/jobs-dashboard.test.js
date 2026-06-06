// packages/cli/src/tests/jobs-dashboard.test.ts
// Unit tests for the jobs:dashboard renderer.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderJobsTable } from '../commands/jobs-dashboard.js';
// Strip ANSI escape codes so assertions can match plain text.
function plain(s) {
    // eslint-disable-next-line no-control-regex
    return s.replace(/\x1b\[[0-9;]*m/g, '');
}
void describe('renderJobsTable', () => {
    void it('shows a friendly message when jobs metrics are null', () => {
        const out = plain(renderJobsTable({ ts: '2024-01-01T00:00:00.000Z', jobs: null }));
        assert.ok(out.includes('no job-queue metrics available'), out);
    });
    void it('renders queue depth (pending / in-flight) and totals', () => {
        const out = plain(renderJobsTable({
            ts: '2024-01-01T00:00:00.000Z',
            jobs: { pending: 7, inFlight: 3, failed: 2, succeeded: 99, byType: {} },
        }));
        assert.ok(out.includes('pending 7'), out);
        assert.ok(out.includes('in-flight 3'), out);
        assert.ok(out.includes('succeeded 99'), out);
        assert.ok(out.includes('failed 2'), out);
    });
    void it('renders worker count and DLQ depth when present, n/a otherwise', () => {
        const withExtras = plain(renderJobsTable({
            ts: 't',
            jobs: { pending: 0, inFlight: 0, failed: 0, succeeded: 0, byType: {}, workers: 4, dlqDepth: 5 },
        }));
        assert.ok(withExtras.includes('workers 4'), withExtras);
        assert.ok(withExtras.includes('DLQ depth 5'), withExtras);
        const withoutExtras = plain(renderJobsTable({
            ts: 't',
            jobs: { pending: 0, inFlight: 0, failed: 0, succeeded: 0, byType: {} },
        }));
        assert.ok(withoutExtras.includes('workers n/a'), withoutExtras);
        assert.ok(withoutExtras.includes('DLQ depth n/a'), withoutExtras);
    });
    void it('renders a per-type stats table', () => {
        const out = plain(renderJobsTable({
            ts: 't',
            jobs: {
                pending: 0, inFlight: 0, failed: 0, succeeded: 0,
                byType: { 'send-email': { avgDurationMs: 12.34 }, 'resize-image': { avgDurationMs: 250 } },
            },
        }));
        assert.ok(out.includes('Per-Type Stats'), out);
        assert.ok(out.includes('send-email'), out);
        assert.ok(out.includes('12.34'), out);
        assert.ok(out.includes('resize-image'), out);
    });
    void it('caps history rendering at 50 entries', () => {
        const history = Array.from({ length: 80 }, (_, i) => ({
            type: `job-${i}`,
            status: i % 2 === 0 ? 'succeeded' : 'failed',
            durationMs: i,
            finishedAt: '2024-01-01T00:00:00.000Z',
        }));
        const out = plain(renderJobsTable({
            ts: 't',
            jobs: { pending: 0, inFlight: 0, failed: 0, succeeded: 0, byType: {}, history },
        }));
        assert.ok(out.includes('Recent History (last 50)'), out);
        // The 50th entry (index 49) should be present; the 51st (index 50) should not.
        assert.ok(out.includes('job-49'), 'expected job-49 to be rendered');
        assert.ok(!out.includes('job-50'), 'job-50 should be excluded by the 50-row cap');
    });
    void it('notes when no history entries are reported', () => {
        const out = plain(renderJobsTable({
            ts: 't',
            jobs: { pending: 1, inFlight: 0, failed: 0, succeeded: 0, byType: {} },
        }));
        assert.ok(out.includes('no job history entries reported'), out);
    });
});
//# sourceMappingURL=jobs-dashboard.test.js.map