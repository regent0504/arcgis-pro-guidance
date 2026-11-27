/**
 * Builds everything the Cloudflare deployment needs from the local corpus.
 *
 *   npx tsx scripts/build-cloudflare.ts
 *
 * Output (all under .cloudflare/, which is git-ignored):
 *   worker-data/*         search + offset indexes bundled INTO the Worker as text modules.
 *                         They are parsed once at Worker startup (1 s budget), so requests
 *                         stay inside the Free plan's 10 ms CPU limit.
 *   r2/<key>              objects to upload to the R2 bucket (corpus shards, overrides, bundles)
 *   r2-manifest.json      list of R2 keys + sha256, used by scripts/upload-r2.ts
 *
 * The frontend itself is built separately by `vite build` into dist/ (Worker static assets).
 *
 * R2 corpus keys are content-addressed (corpus/<sha>/...), so uploading a new corpus never
 * breaks the Worker version that is still live: new keys are uploaded first, then the Worker
 * (with offset indexes pointing at the new keys) is deployed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CHAPTER_KEYS, type CatalogEntry, type ChapterKey, type SdkMember } from '../src/lib/types';
import { buildPageDetail, selectFeaturedPages } from '../src/lib/pageDetail';
import { CorpusStore } from '../src/server/corpusStore';
import { SyncEngine } from '../src/server/syncEngine';
import { encodeTsvRow, type OffsetRecord } from '../src/worker/shared';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '.cloudflare');
const WORKER_DATA = path.join(OUT, 'worker-data');
const R2_OUT = path.join(OUT, 'r2');

interface ManifestEntry {
  key: string;
  file: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

const manifest: ManifestEntry[] = [];

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function addR2(key: string, file: string, contentType: string): void {
  manifest.push({
    key,
    file: path.relative(OUT, file),
    sha256: sha256File(file),
    bytes: fs.statSync(file).size,
    contentType,
  });
}

async function main(): Promise<void> {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(WORKER_DATA, { recursive: true });
  fs.mkdirSync(R2_OUT, { recursive: true });

  const store = new CorpusStore(ROOT);
  await store.waitForIndex();
  const sync = new SyncEngine(store, { autoSchedule: false });
  const status = sync.getStatus();

  console.log(
    `[build] catalog=${store.catalog.length} indexedPages=${store.getIndexedPageCount()} sdk=${store.sdkMembers.length} overrides=${status.overrideCount}`
  );

  // 1. Corpus shards → R2 (content-addressed) and per-bucket byte-offset indexes → assets
  const shardKeyByFile = new Map<string, string>();
  for (const chapter of CHAPTER_KEYS) {
    const dir = path.join(store.jsonlDir, chapter);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
      const src = path.join(dir, name);
      const hash = sha256File(src).slice(0, 16);
      const key = `corpus/${hash}/${chapter}/${name}`;
      const dest = path.join(R2_OUT, key);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      addR2(key, dest, 'application/x-ndjson; charset=utf-8');
      shardKeyByFile.set(`${chapter}/${name}`, key);
    }
  }

  // Override pages → R2 (content-addressed by their content hash)
  const overrideKeyByPath = new Map<string, string>();
  for (const o of status.overrides) {
    const full = sync.getOverride(o.path);
    if (!full) continue;
    const key = `overrides/${full.contentHash}/${o.path}.json`;
    const dest = path.join(R2_OUT, key);
    writeJson(dest, full);
    addR2(key, dest, 'application/json; charset=utf-8');
    overrideKeyByPath.set(o.path, key);
  }

  // Offset index: path → { k: r2Key, o: [[start, len], ...] } and/or { ov: r2Key } for overrides
  const offsets: Record<string, OffsetRecord> = {};
  for (const entry of store.catalog) {
    const ovKey = overrideKeyByPath.get(entry.path);
    const span = store.getPageSpan(entry.path);
    const value: OffsetRecord = {};
    if (span) {
      const key = shardKeyByFile.get(span.file);
      if (key) {
        value.k = key;
        value.o = span.offsets;
      }
    }
    if (ovKey) value.ov = ovKey;
    if (Object.keys(value).length > 0) {
      offsets[entry.path] = value;
    }
  }
  // Overrides for pages that are not in the catalog (newly added pages)
  for (const [p, key] of overrideKeyByPath) {
    if (!offsets[p]) offsets[p] = { ov: key };
  }
  fs.writeFileSync(path.join(WORKER_DATA, 'offsets.jsontext'), JSON.stringify(offsets));

  // 2. Catalog for search, one TSV row per page: path \t english (\x1f-joined) \t chapter (\x1f-joined)
  fs.writeFileSync(
    path.join(WORKER_DATA, 'catalog.tsv'),
    store.catalog.map((e) => encodeTsvRow([e.path, e.english, e.chapter])).join('\n')
  );

  // 3. SDK member index, one TSV row per member: topic \t english \t kind \t source \t index_source
  fs.writeFileSync(
    path.join(WORKER_DATA, 'sdk.tsv'),
    store.sdkMembers
      .map((m: SdkMember) => encodeTsvRow([m.topic, m.english, m.kind, m.source, m.index_source]))
      .join('\n')
  );

  // 4. Meta: report, featured pages, guidance, sync status
  const builtAt = new Date().toISOString();
  fs.writeFileSync(path.join(WORKER_DATA, 'meta.jsontext'), JSON.stringify({
    builtAt,
    report: store.report,
    featuredPages: store.getFeaturedPages(),
    agentsGuidance: store.agentsGuidance,
    sync: {
      ...status,
      // On Cloudflare the sync runs on a GitHub Actions schedule, not inside the server.
      isRunning: false,
      nextRunAt: null,
    },
  }));

  // 5. Full Markdown bundles → R2 (served for /llms-full.txt and /llms/<chapter>.txt)
  const bundleDir = path.join(R2_OUT, 'bundles');
  fs.mkdirSync(path.join(bundleDir, 'llms'), { recursive: true });
  const fullFile = path.join(bundleDir, 'llms-full.txt');
  const fullFd = fs.openSync(fullFile, 'w');
  const chapterFds = new Map<ChapterKey, number>();
  const header = (scope: string, count: number) =>
    [
      `# ArcGIS Pro Documentation — Full AI Context Bundle (${scope})`,
      '',
      `- Included Pages: ${count.toLocaleString('en-US')}`,
      `- Corpus Coverage: ${store.report.official_pages.toLocaleString('en-US')} pages, ${store.report.cards.toLocaleString('en-US')} cards`,
      `- Live Synced Overrides: ${status.overrideCount}`,
      `- Built At: ${builtAt}`,
      `- Tip: use /api/search?q=... and /api/page?path=...&format=markdown for targeted lookups, or /llms-full.txt?q=keyword for a filtered bundle.`,
      '',
      '---',
      '',
    ].join('\n');

  fs.writeSync(fullFd, header('llms-full.txt', store.catalog.length));
  for (const chapter of CHAPTER_KEYS) {
    const fd = fs.openSync(path.join(bundleDir, 'llms', `${chapter}.txt`), 'w');
    fs.writeSync(fd, header(`llms/${chapter}.txt`, store.report.by_chapter[chapter] ?? 0));
    chapterFds.set(chapter, fd);
  }

  let written = 0;
  for (const entry of store.catalog) {
    const detail = await store.getPageDetail(entry.path, sync.getOverride(entry.path));
    if (!detail) continue;
    const chunk = `${detail.markdown}\n---\n\n`;
    fs.writeSync(fullFd, chunk);
    const fd = chapterFds.get(detail.chapterKey);
    if (fd !== undefined) fs.writeSync(fd, chunk);
    if (++written % 2000 === 0) console.log(`[build] bundled ${written} pages`);
  }
  fs.closeSync(fullFd);
  for (const fd of chapterFds.values()) fs.closeSync(fd);

  addR2('bundles/llms-full.txt', fullFile, 'text/plain; charset=utf-8');
  for (const chapter of CHAPTER_KEYS) {
    addR2(
      `bundles/llms/${chapter}.txt`,
      path.join(bundleDir, 'llms', `${chapter}.txt`),
      'text/plain; charset=utf-8'
    );
  }

  writeJson(path.join(OUT, 'r2-manifest.json'), { builtAt, objects: manifest });

  // Sanity check that buildPageDetail is deterministic between Node and Worker paths
  const sample = store.catalogMap.get('tool-reference/analysis/buffer.html') as CatalogEntry | undefined;
  if (sample) {
    const cards = await store.readBasePageCards(sample.path);
    const d = buildPageDetail({ relPath: sample.path, catalogEntry: sample, baseCards: cards, override: sync.getOverride(sample.path) });
    console.log(`[build] sample page ${sample.path}: ${d?.cardCount ?? 0} cards`);
  }

  const totalR2 = manifest.reduce((n, m) => n + m.bytes, 0);
  console.log(
    `[build] done: ${manifest.length} R2 objects (${(totalR2 / 1024 / 1024).toFixed(1)} MiB), featured=${selectFeaturedPages(store.catalog, store.catalogMap).length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
