/**
 * Runs one incremental sync against doc.esri.com and saves the result to data/sync-state.json.
 * Used by the scheduled GitHub Actions workflow (the Cloudflare deployment is read-only, so the
 * sync happens here and the next build bakes the refreshed pages in).
 *
 *   npx tsx scripts/run-sync.ts [batchSize]
 */
import { CorpusStore } from '../src/server/corpusStore';
import { SyncEngine } from '../src/server/syncEngine';

async function main(): Promise<void> {
  const batchArg = Number.parseInt(process.argv[2] ?? '', 10);
  const store = new CorpusStore(process.cwd());
  await store.waitForIndex();
  const engine = new SyncEngine(store, { autoSchedule: false });

  if (!engine.isAutoSyncEnabled()) {
    console.log('[sync] Auto sync is disabled in data/sync-state.json (config.enabled=false); skipping.');
    return;
  }

  const log = await engine.runBatchSync('scheduled', Number.isFinite(batchArg) ? batchArg : undefined);
  console.log(`[sync] ${log.status}: ${log.summary}`);
  for (const d of log.details) {
    console.log(`  - ${d.outcome.padEnd(9)} ${d.path} ${d.message}`);
  }
  // A sync that could not reach Esri should not fail the deploy; the existing corpus is still valid.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
