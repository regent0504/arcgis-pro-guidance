import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { searchCatalogEntries, searchSdkMembers } from './src/lib/corpusSearch';
import { generateLlmsTxtIndex } from './src/lib/docFormatter';
import { CHAPTER_KEYS, CHAPTER_LABELS, type ChapterKey } from './src/lib/types';
import { normalizeEsriDocPath } from './src/lib/urlSafety';
import { CorpusStore } from './src/server/corpusStore';
import { buildOpenApiSpec } from './src/server/openApiSpec';
import { SyncEngine } from './src/server/syncEngine';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const ROOT_DIR = process.cwd();

const store = new CorpusStore(ROOT_DIR);
const syncEngine = new SyncEngine(store);

function resolveBaseUrl(req: express.Request): string {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  }
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    typeof forwardedProto === 'string'
      ? forwardedProto.split(',')[0].trim()
      : req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${Array.isArray(host) ? host[0] : host}`;
}

function setPublicReadCors(res: express.Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function streamLlmsBundle(
  req: express.Request,
  res: express.Response,
  chapterParam?: string
): Promise<void> {
  setPublicReadCors(res);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  const queryText = typeof req.query.q === 'string' ? req.query.q : '';
  const rawLimit = typeof req.query.limit === 'string' ? req.query.limit : '';
  const isAll = rawLimit.toLowerCase() === 'all';
  const parsedLimit = Number.parseInt(rawLimit, 10);
  const effectiveLimit = isAll
    ? 500
    : Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 500)
    : chapterParam
    ? 40
    : 25;

  const chapter: ChapterKey | 'all' =
    chapterParam && (CHAPTER_KEYS as readonly string[]).includes(chapterParam)
      ? (chapterParam as ChapterKey)
      : typeof req.query.chapter === 'string' &&
        (CHAPTER_KEYS as readonly string[]).includes(req.query.chapter)
      ? (req.query.chapter as ChapterKey)
      : 'all';

  const baseUrl = resolveBaseUrl(req);
  const { total, items } = searchCatalogEntries(store.catalog, {
    query: queryText,
    chapter,
    limit: effectiveLimit,
    offset: 0,
    overridePaths: syncEngine.getOverrideMap(),
  });

  const headerLines = [
    '# ArcGIS Pro Documentation — Full AI Context Bundle (llms-full.txt)',
    '',
    `- Source Gateway: ${baseUrl}`,
    `- Chapter Filter: ${chapter}`,
    queryText ? `- Query Filter: ${queryText}` : null,
    `- Included Pages: ${items.length} of ${total.toLocaleString('en-US')} matching pages (pass ?limit=N up to 500 or use /api/page?path=...&format=markdown for exact lookup)`,
    `- Corpus Coverage: ${store.report.official_pages.toLocaleString('en-US')} pages, ${store.report.cards.toLocaleString('en-US')} cards`,
    `- Live Synced Overrides: ${syncEngine.getOverrideCount()}`,
    '',
    '---',
    '',
  ].filter((line): line is string => line !== null);

  res.write(headerLines.join('\n'));

  for (const item of items) {
    const detail = await store.getPageDetail(item.path, syncEngine.getOverride(item.path));
    if (!detail) continue;
    res.write(detail.markdown);
    res.write('\n---\n\n');
  }

  res.end();
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      indexReady: store.isIndexReady(),
      pages: store.catalog.length,
      sdkMembers: store.sdkMembers.length,
    });
  });

  // Standard llms.txt index
  app.get('/llms.txt', (req, res) => {
    setPublicReadCors(res);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const content = generateLlmsTxtIndex({
      baseUrl: resolveBaseUrl(req),
      report: store.report,
      featuredPages: store.getFeaturedPages(),
      agentsGuidance: store.agentsGuidance,
      overrideCount: syncEngine.getOverrideCount(),
      lastSyncAt: syncEngine.getLastSyncAt(),
    });
    res.send(content);
  });

  // Streaming llms-full.txt
  app.get('/llms-full.txt', async (req, res, next) => {
    try {
      await streamLlmsBundle(req, res);
    } catch (err) {
      next(err);
    }
  });

  // Per-chapter streaming /llms/:chapter.txt
  app.get('/llms/:chapter.txt', async (req, res, next) => {
    try {
      const ch = req.params.chapter;
      if (!(CHAPTER_KEYS as readonly string[]).includes(ch)) {
        res.status(404).type('text/plain').send(`Unknown chapter: ${ch}`);
        return;
      }
      await streamLlmsBundle(req, res, ch);
    } catch (err) {
      next(err);
    }
  });

  // OpenAPI 3.1 schema
  app.get('/api/openapi.json', (req, res) => {
    setPublicReadCors(res);
    res.json(buildOpenApiSpec(resolveBaseUrl(req)));
  });

  // Corpus stats & sync status summary
  app.get('/api/stats', (req, res) => {
    setPublicReadCors(res);
    res.json({
      report: store.report,
      indexReady: store.isIndexReady(),
      indexedCardPages: store.getIndexedPageCount(),
      overrideCount: syncEngine.getOverrideCount(),
      lastSyncAt: syncEngine.getLastSyncAt(),
      autoSyncEnabled: syncEngine.isAutoSyncEnabled(),
      baseUrl: resolveBaseUrl(req),
    });
  });

  // Chapter overview with sample pages
  app.get('/api/chapters', (req, res) => {
    setPublicReadCors(res);
    const baseUrl = resolveBaseUrl(req);
    const chapters = CHAPTER_KEYS.map((key) => {
      const sample = searchCatalogEntries(store.catalog, {
        query: '',
        chapter: key,
        limit: 5,
      });
      return {
        key,
        ...CHAPTER_LABELS[key],
        pageCount: store.report.by_chapter[key] ?? sample.total,
        llmsUrl: `${baseUrl}/llms/${key}.txt`,
        samplePages: sample.items.map((p) => ({
          path: p.path,
          titleZh: p.titleZh,
          titleEn: p.titleEn,
        })),
      };
    });
    res.json({ chapters, totalPages: store.report.official_pages });
  });

  // Bilingual structured search
  app.get('/api/search', (req, res) => {
    setPublicReadCors(res);
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const chapterRaw = typeof req.query.chapter === 'string' ? req.query.chapter : 'all';
    const chapter: ChapterKey | 'all' =
      chapterRaw === 'all' || (CHAPTER_KEYS as readonly string[]).includes(chapterRaw)
        ? (chapterRaw as ChapterKey | 'all')
        : 'all';
    const limit = Number.parseInt(String(req.query.limit ?? '20'), 10);
    const offset = Number.parseInt(String(req.query.offset ?? '0'), 10);

    const result = searchCatalogEntries(store.catalog, {
      query: q,
      chapter,
      limit: Number.isFinite(limit) ? limit : 20,
      offset: Number.isFinite(offset) ? offset : 0,
      overridePaths: syncEngine.getOverrideMap(),
    });

    res.json({
      query: q,
      chapter,
      total: result.total,
      limit: Math.min(Math.max(Number.isFinite(limit) ? limit : 20, 1), 100),
      offset: Math.max(Number.isFinite(offset) ? offset : 0, 0),
      items: result.items,
    });
  });

  // Single page retrieval (JSON cards or clean Markdown)
  app.get('/api/page', async (req, res, next) => {
    try {
      setPublicReadCors(res);
      const rawPath = typeof req.query.path === 'string' ? req.query.path : '';
      const format = typeof req.query.format === 'string' ? req.query.format : 'json';
      const normalized = normalizeEsriDocPath(rawPath);

      if (!normalized) {
        res.status(400).json({
          error: 'Invalid or missing path parameter. Example: tool-reference/analysis/buffer.html',
        });
        return;
      }

      const detail = await store.getPageDetail(normalized, syncEngine.getOverride(normalized));
      if (!detail) {
        res.status(404).json({ error: `Page not found in corpus: ${normalized}` });
        return;
      }

      if (format === 'markdown' || format === 'md' || format === 'txt') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(detail.markdown);
        return;
      }

      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  // .NET SDK Member index search
  app.get('/api/sdk', async (req, res, next) => {
    try {
      setPublicReadCors(res);
      if (store.sdkMembers.length === 0 && !store.isIndexReady()) {
        await store.waitForIndex();
      }
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = Number.parseInt(String(req.query.limit ?? '25'), 10);
      const offset = Number.parseInt(String(req.query.offset ?? '0'), 10);
      const result = searchSdkMembers(
        store.sdkMembers,
        q,
        Number.isFinite(limit) ? limit : 25,
        Number.isFinite(offset) ? offset : 0
      );
      res.json({
        query: q,
        total: result.total,
        items: result.items,
      });
    } catch (err) {
      next(err);
    }
  });

  // Automated Sync Status & Management Routes (same-origin, no wildcard CORS)
  app.get('/api/sync/status', (_req, res) => {
    res.json(syncEngine.getStatus());
  });

  app.put('/api/sync/config', (req, res) => {
    const body = req.body ?? {};
    const updated = syncEngine.updateConfig({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      intervalMinutes:
        typeof body.intervalMinutes === 'number' ? body.intervalMinutes : undefined,
      targetChapters: Array.isArray(body.targetChapters) ? body.targetChapters : undefined,
      batchSize: typeof body.batchSize === 'number' ? body.batchSize : undefined,
      preferredLanguage:
        body.preferredLanguage === 'en' || body.preferredLanguage === 'zh-cn'
          ? body.preferredLanguage
          : undefined,
    });
    res.json({ config: updated, status: syncEngine.getStatus() });
  });

  app.post('/api/sync/page', async (req, res) => {
    try {
      const rawPath = typeof req.body?.path === 'string' ? req.body.path : '';
      const lang = req.body?.language === 'zh-cn' ? 'zh-cn' : 'en';
      const log = await syncEngine.syncSinglePage(rawPath, lang);
      res.json({ log, status: syncEngine.getStatus() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : '同步失敗',
      });
    }
  });

  app.post('/api/sync/run', async (req, res) => {
    try {
      const batchSize =
        typeof req.body?.batchSize === 'number' ? req.body.batchSize : undefined;
      const log = await syncEngine.runBatchSync('manual-batch', batchSize);
      res.json({ log, status: syncEngine.getStatus() });
    } catch (err) {
      res.status(409).json({
        error: err instanceof Error ? err.message : '批次同步無法啟動',
      });
    }
  });

  app.delete('/api/sync/override', (req, res) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!rawPath) {
      res.status(400).json({ error: '缺少 path 參數' });
      return;
    }
    const removed = syncEngine.removeOverride(rawPath);
    if (!removed) {
      res.status(404).json({ error: '找不到指定的同步覆寫紀錄' });
      return;
    }
    res.json({ removed: true, status: syncEngine.getStatus() });
  });

  // Frontend serving (Vite dev middleware or built static assets)
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  // Error handler
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error('[Server Error]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  );

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ArcGIS Docs AI Gateway] Listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
