// examples/03-background-jobs/src/main.ts
// Background Jobs example with Street Framework
// Demonstrates: @Job decorator, JobQueue, CronScheduler, DLQ

import 'reflect-metadata';
import {
  streetApp,
  PgPool,
  JobQueue,
  Job,
  CronScheduler,
  STREET_JOBS_MIGRATION_SQL,
  STREET_DLQ_MIGRATION_SQL,
  type JobContext,
} from '@streetjs/core';

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env['PORT'] ?? '3002', 10);
const PG_HOST = process.env['PG_HOST'] ?? 'localhost';
const PG_DATABASE = process.env['PG_DATABASE'] ?? 'street_jobs_example';
const PG_USER = process.env['PG_USER'] ?? 'postgres';
const PG_PASSWORD = process.env['PG_PASSWORD'] ?? '';

// ── Database ──────────────────────────────────────────────────────────────────

const pool = new PgPool({
  host: PG_HOST,
  port: 5432,
  database: PG_DATABASE,
  user: PG_USER,
  password: PG_PASSWORD,
  maxConnections: 10,
});

// ── Job Handlers ──────────────────────────────────────────────────────────────

interface EmailJobData {
  to: string;
  subject: string;
  body: string;
}

/**
 * @Job('send-email') — Handles email delivery jobs.
 * In a real application, call an email provider (SendGrid, SES, etc.).
 */
@Job('send-email')
class SendEmailJob {
  async run(data: EmailJobData, ctx: JobContext): Promise<void> {
    console.log(
      `[send-email] Attempt ${ctx.attempt}: sending to "${data.to}" — subject: "${data.subject}"`,
    );
    // Simulate async work (replace with real email provider call)
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    console.log(`[send-email] ✓ Delivered to ${data.to} (job ${ctx.jobId})`);
  }
}

interface ReportJobData {
  reportType: string;
  userId: string;
}

/**
 * @Job('generate-report') — Generates and stores a report.
 */
@Job('generate-report')
class GenerateReportJob {
  async run(data: ReportJobData, ctx: JobContext): Promise<void> {
    console.log(
      `[generate-report] Attempt ${ctx.attempt}: generating "${data.reportType}" for user ${data.userId}`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    console.log(`[generate-report] ✓ Report ready (job ${ctx.jobId})`);
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Run migrations
  await pool.query(STREET_JOBS_MIGRATION_SQL);
  await pool.query(STREET_DLQ_MIGRATION_SQL);
  console.log('✓ Job queue migrations applied');

  // Create queue with retry configuration
  const queue = new JobQueue(pool, {
    pollIntervalMs: 2000,
    concurrency: 3,
    maxRetries: 3,
  });

  // Configure DLQ handler
  queue.onDeadLetter(async (job) => {
    console.error(
      `💀 Dead letter: job "${job.name}" (id=${job.id}) failed after max retries.`,
      '\n   Data:', JSON.stringify(job.data),
      '\n   Error:', job.error,
    );
  });

  // Register job handlers
  queue.register(new SendEmailJob());
  queue.register(new GenerateReportJob());

  // ── CronScheduler ─────────────────────────────────────────────────────────

  const cron = new CronScheduler();

  // Enqueue a report job every minute (for demo — use a real schedule in production)
  cron.schedule('* * * * *', async () => {
    console.log('[cron] Enqueuing scheduled monthly summary report...');
    await queue.enqueue('generate-report', {
      reportType: 'monthly-summary',
      userId: 'system',
    });
  });

  cron.start();
  console.log('✓ CronScheduler started');

  // ── HTTP Server ────────────────────────────────────────────────────────────

  const app = streetApp({ port: PORT });

  // POST /jobs/email — Enqueue an email job
  app.use(async (ctx, next) => {
    if (ctx.method === 'POST' && ctx.path === '/jobs/email') {
      const body = ctx.body as { to?: string; subject?: string; body?: string } | null;
      if (!body?.to || !body?.subject) {
        ctx.json({ error: 'to and subject are required' }, 400);
        return;
      }
      const jobId = await queue.enqueue('send-email', {
        to: body.to,
        subject: body.subject,
        body: body.body ?? '',
      });
      ctx.json({ jobId, status: 'queued' }, 202);
      return;
    }

    // POST /jobs/report — Enqueue a report job
    if (ctx.method === 'POST' && ctx.path === '/jobs/report') {
      const body = ctx.body as { reportType?: string; userId?: string } | null;
      if (!body?.reportType || !body?.userId) {
        ctx.json({ error: 'reportType and userId are required' }, 400);
        return;
      }
      const jobId = await queue.enqueue('generate-report', {
        reportType: body.reportType,
        userId: body.userId,
      });
      ctx.json({ jobId, status: 'queued' }, 202);
      return;
    }

    // GET /jobs/status — Queue health
    if (ctx.method === 'GET' && ctx.path === '/jobs/status') {
      ctx.json({ status: 'running', message: 'Job queue is active' });
      return;
    }

    await next();
  });

  await app.listen(PORT, '0.0.0.0');
  console.log(`🚀 Jobs API running on http://localhost:${PORT}`);

  // Start processing jobs
  await queue.start();
  console.log('✓ Job queue worker started');

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down gracefully...');
    cron.stop();
    await queue.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
