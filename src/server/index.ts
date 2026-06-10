import { buildApp } from './app.js';
import { config } from './config.js';
import { closeDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { startJobs, stopJobs } from './jobs/boss.js';

async function main(): Promise<void> {
  const cfg = config();
  console.log(`\n🐄 Establo starting — RUN_MODE=${cfg.runMode}`);

  const applied = await runMigrations();
  if (applied.length > 0) console.log(`✓ Applied migrations: ${applied.join(', ')}`);

  if (!cfg.jobsInline) {
    await startJobs();
  } else {
    console.log('✓ JOBS_INLINE=true — jobs run inline (no pg-boss workers)');
  }

  const app = await buildApp();
  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  console.log(`✓ Server listening on http://localhost:${cfg.port}`);
  if (cfg.isMock) {
    console.log(`  Dashboard (dev):  http://localhost:5173/app`);
    console.log(`  Simulator (dev):  http://localhost:5173/app/simulator`);
  }

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down…`);
    await app.close();
    await stopJobs();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
