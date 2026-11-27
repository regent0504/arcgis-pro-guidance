/**
 * Cloudflare Worker entry for the ArcGIS Pro Docs AI Gateway.
 *
 * - Search/offset indexes are bundled into the Worker as text modules (built by
 *   scripts/build-cloudflare.ts) and parsed once at startup, outside the per-request CPU budget.
 * - Page cards are read from R2 with byte-range GETs into the JSONL corpus shards.
 * - Full llms-full.txt / llms/<chapter>.txt bundles are prebuilt and streamed from R2.
 * - Everything else falls through to the static frontend (dist/) via the ASSETS binding.
 */
import catalogTsv from '../../.cloudflare/worker-data/catalog.tsv';
import sdkTsv from '../../.cloudflare/worker-data/sdk.tsv';
import offsetsJson from '../../.cloudflare/worker-data/offsets.jsontext';
import metaJson from '../../.cloudflare/worker-data/meta.jsontext';
import { generateLlmsTxtIndex } from '../lib/markdownFormat';
import { buildPageDetail } from '../lib/pageDetail';
import { PreparedCatalogIndex, PreparedSdkIndex } from '../lib/preparedSearch';
import {
  CHAPTER_KEYS,
  CHAPTER_LABELS,
  type CatalogEntry,
  type ChapterKey,
  type CollectionReport,
  type DocCard,
  type GitHubActionsSchedule,
  type GitHubActionsScheduledRun,
  type PageDetail,
  type SyncPageOverride,
  type SyncStatusResponse,
} from '../lib/types';
import { normalizeEsriDocPath } from '../lib/urlSafety';
import { buildOpenApiSpec } from '../server/openApiSpec';
import { decodeTsvRows, splitList, type OffsetRecord } from './shared';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CORPUS: R2Bucket;
  PUBLIC_BASE_URL?: string;
}

interface Meta {
  builtAt: string;
  report: CollectionReport;
  featuredPages: CatalogEntry[];
  agentsGuidance: string;
  sync: SyncStatusResponse;
}

// ---------------------------------------------------------------------------
// Startup: parse bundled indexes once per isolate
// ---------------------------------------------------------------------------

const META = JSON.parse(metaJson) as Meta;
const OFFSETS = JSON.parse(offsetsJson) as Record<string, OffsetRecord>;

const CATALOG = new PreparedCatalogIndex(
  decodeTsvRows(catalogTsv).map(([path, english, chapter]) => ({
    path,
    english: splitList(english),
    chapter: splitList(chapter),
    included: true,
  }))
);

const SDK = new PreparedSdkIndex(
  decodeTsvRows(sdkTsv).map(([topic, english, kind, source, indexSource]) => ({
    topic,
    english: splitList(english),
    kind,
    source,
    index_source: indexSource,
  }))
);

const OVERRIDE_MAP = new Map(
  META.sync.overrides.map((o) => [
    o.path,
    { syncedAt: o.syncedAt, titleEn: o.titleEn, titleZh: o.titleZh },
  ])
);

/** Free plan allows 50 subrequests per request; keep dynamic bundles well under that. */
const MAX_DYNAMIC_BUNDLE_PAGES = 40;

const GITHUB_WORKFLOW_PATH = 'regent90/arcgis-pro-guidance/actions/workflows/sync-and-deploy.yml';
const GITHUB_ACTIONS_SCHEDULE: GitHubActionsSchedule = {
  dailyTimeTaipei: '03:30',
  workflowUrl: `https://github.com/${GITHUB_WORKFLOW_PATH}`,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PUBLIC_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function resolveBaseUrl(request: Request, env: Env): string {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  return new URL(request.url).origin;
}

function json(data: unknown, init: { status?: number; cors?: boolean; cache?: string } = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': init.cache ?? 'public, max-age=300',
      ...(init.cors === false ? {} : PUBLIC_CORS),
    },
  });
}

function text(body: BodyInit, status = 200, cache = 'public, max-age=300') {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': cache, ...PUBLIC_CORS },
  });
}

function intParam(url: URL, name: string, fallback: number): number {
  const n = Number.parseInt(url.searchParams.get(name) ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseChapter(raw: string | null | undefined): ChapterKey | null {
  return raw && (CHAPTER_KEYS as readonly string[]).includes(raw) ? (raw as ChapterKey) : null;
}

async function readBaseCards(env: Env, record: OffsetRecord | undefined): Promise<DocCard[]> {
  if (!record?.k || !record.o) return [];
  const cards: DocCard[] = [];
  for (const [offset, length] of record.o) {
    const obj = await env.CORPUS.get(record.k, { range: { offset, length } });
    if (!obj) continue;
    for (const line of (await obj.text()).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        cards.push(JSON.parse(trimmed) as DocCard);
      } catch {
        // ignore malformed line
      }
    }
  }
  return cards;
}

async function getPageDetail(env: Env, relPath: string): Promise<PageDetail | null> {
  const record = OFFSETS[relPath];
  const catalogEntry = CATALOG.byPath.get(relPath);
  let override: SyncPageOverride | undefined;
  if (record?.ov) {
    const obj = await env.CORPUS.get(record.ov);
    if (obj) override = (await obj.json()) as SyncPageOverride;
  }
  const baseCards = override ? [] : await readBaseCards(env, record);
  return buildPageDetail({ relPath, catalogEntry, baseCards, override });
}

async function streamR2Object(env: Env, key: string): Promise<Response> {
  const obj = await env.CORPUS.get(key);
  if (!obj) return text(`Bundle not found: ${key}. Run the deploy workflow to upload it.`, 503, 'no-store');
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      ETag: obj.httpEtag,
      ...PUBLIC_CORS,
    },
  });
}

/** llms-full.txt and llms/<chapter>.txt: prebuilt bundle, or a filtered dynamic bundle. */
async function handleBundle(
  request: Request,
  env: Env,
  url: URL,
  chapterFromPath: ChapterKey | null
): Promise<Response> {
  const q = url.searchParams.get('q') ?? '';
  const rawLimit = url.searchParams.get('limit');
  const chapter = chapterFromPath ?? parseChapter(url.searchParams.get('chapter'));

  // No filters: stream the complete prebuilt bundle from R2 (zero CPU, free egress).
  if (!q && !rawLimit) {
    return streamR2Object(env, chapter ? `bundles/llms/${chapter}.txt` : 'bundles/llms-full.txt');
  }

  const requested =
    rawLimit?.toLowerCase() === 'all' ? MAX_DYNAMIC_BUNDLE_PAGES : Number.parseInt(rawLimit ?? '', 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_DYNAMIC_BUNDLE_PAGES)
    : chapter
    ? 40
    : 25;

  const { total, items } = CATALOG.search({
    query: q,
    chapter: chapter ?? 'all',
    limit,
    offset: 0,
    overridePaths: OVERRIDE_MAP,
  });

  const header = [
    '# ArcGIS Pro Documentation — Filtered AI Context Bundle',
    '',
    `- Source Gateway: ${resolveBaseUrl(request, env)}`,
    `- Chapter Filter: ${chapter ?? 'all'}`,
    q ? `- Query Filter: ${q}` : null,
    `- Included Pages: ${items.length} of ${total.toLocaleString('en-US')} matching pages (max ${MAX_DYNAMIC_BUNDLE_PAGES} per request; omit q/limit to download the complete prebuilt bundle)`,
    `- Corpus Coverage: ${META.report.official_pages.toLocaleString('en-US')} pages, ${META.report.cards.toLocaleString('en-US')} cards`,
    `- Live Synced Overrides: ${META.sync.overrideCount}`,
    '',
    '---',
    '',
  ]
    .filter((l): l is string => l !== null)
    .join('\n');

  const parts: string[] = [header];
  for (const item of items) {
    const detail = await getPageDetail(env, item.path);
    if (detail) parts.push(detail.markdown, '\n---\n\n');
  }
  return text(parts.join(''));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function latestScheduledRun(): Promise<Response> {
  try {
    const upstream = await fetch(
      `https://api.github.com/repos/${GITHUB_WORKFLOW_PATH}/runs?branch=main&event=schedule&per_page=1`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ArcGIS-Pro-Docs-AI-Gateway',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(5000),
        cf: { cacheEverything: true, cacheTtlByStatus: { '200': 300, '201-599': -1 } },
      }
    );
    if (!upstream.ok) throw new Error(`GitHub returned HTTP ${upstream.status}`);
    const data = await upstream.json<{
      workflow_runs: Array<{
        id: number;
        created_at: string;
        status: string;
        conclusion: string | null;
      }>;
    }>();
    const run = data.workflow_runs[0];
    const result: GitHubActionsScheduledRun | null = run
      ? { id: run.id, createdAt: run.created_at, status: run.status, conclusion: run.conclusion }
      : null;
    return json(result, { cors: false, cache: 'public, max-age=60' });
  } catch {
    return json({ error: '暫時無法讀取 GitHub Actions 執行結果' }, {
      status: 503, cors: false, cache: 'no-store',
    });
  }
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response | null> {
  const p = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: PUBLIC_CORS });
  }

  // Sync is done by the scheduled GitHub Actions workflow on Cloudflare; the API is read-only.
  if (p.startsWith('/api/sync/')) {
    if (p === '/api/sync/status' && request.method === 'GET') {
      return json({ ...META.sync, githubActionsSchedule: GITHUB_ACTIONS_SCHEDULE }, {
        cors: false, cache: 'no-store',
      });
    }
    if (p === '/api/sync/scheduled-run' && request.method === 'GET') {
      return latestScheduledRun();
    }
    return json(
      {
        error:
          '此部署為唯讀：同步由 GitHub Actions 每日排程執行（.github/workflows/sync-and-deploy.yml），完成後自動重新部署。如需手動同步，請在 GitHub 的 Actions 頁面手動觸發該 workflow。',
      },
      { status: 501, cors: false, cache: 'no-store' }
    );
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  switch (p) {
    case '/api/health':
      return json(
        { ok: true, indexReady: true, pages: CATALOG.entries.length, sdkMembers: SDK.members.length, builtAt: META.builtAt },
        { cache: 'no-store' }
      );

    case '/llms.txt':
      return text(
        generateLlmsTxtIndex({
          baseUrl: resolveBaseUrl(request, env),
          report: META.report,
          featuredPages: META.featuredPages,
          agentsGuidance: META.agentsGuidance,
          overrideCount: META.sync.overrideCount,
          lastSyncAt: META.sync.lastRunAt,
        })
      );

    case '/llms-full.txt':
      return handleBundle(request, env, url, null);

    case '/api/openapi.json':
      return json(buildOpenApiSpec(resolveBaseUrl(request, env)));

    case '/api/stats':
      return json({
        report: META.report,
        indexReady: true,
        indexedCardPages: Object.keys(OFFSETS).length,
        overrideCount: META.sync.overrideCount,
        lastSyncAt: META.sync.lastRunAt,
        autoSyncEnabled: META.sync.config.enabled,
        baseUrl: resolveBaseUrl(request, env),
      });

    case '/api/chapters': {
      const baseUrl = resolveBaseUrl(request, env);
      const chapters = CHAPTER_KEYS.map((key) => {
        const sample = CATALOG.search({ query: '', chapter: key, limit: 5 });
        return {
          key,
          ...CHAPTER_LABELS[key],
          pageCount: META.report.by_chapter[key] ?? sample.total,
          llmsUrl: `${baseUrl}/llms/${key}.txt`,
          samplePages: sample.items.map((s) => ({ path: s.path, titleZh: s.titleZh, titleEn: s.titleEn })),
        };
      });
      return json({ chapters, totalPages: META.report.official_pages });
    }

    case '/api/search': {
      const q = url.searchParams.get('q') ?? '';
      const chapterRaw = url.searchParams.get('chapter') ?? 'all';
      const chapter = parseChapter(chapterRaw) ?? 'all';
      const limit = intParam(url, 'limit', 20);
      const offset = intParam(url, 'offset', 0);
      const result = CATALOG.search({ query: q, chapter, limit, offset, overridePaths: OVERRIDE_MAP });
      return json({
        query: q,
        chapter,
        total: result.total,
        limit: Math.min(Math.max(limit, 1), 100),
        offset: Math.max(offset, 0),
        items: result.items,
      });
    }

    case '/api/page': {
      const format = url.searchParams.get('format') ?? 'json';
      const normalized = normalizeEsriDocPath(url.searchParams.get('path') ?? '');
      if (!normalized) {
        return json(
          { error: 'Invalid or missing path parameter. Example: tool-reference/analysis/buffer.html' },
          { status: 400 }
        );
      }
      const detail = await getPageDetail(env, normalized);
      if (!detail) return json({ error: `Page not found in corpus: ${normalized}` }, { status: 404 });
      if (format === 'markdown' || format === 'md' || format === 'txt') return text(detail.markdown);
      return json(detail);
    }

    case '/api/sdk': {
      const q = url.searchParams.get('q') ?? '';
      const result = SDK.search(q, intParam(url, 'limit', 25), intParam(url, 'offset', 0));
      return json({ query: q, total: result.total, items: result.items });
    }
  }

  const chapterMatch = p.match(/^\/llms\/([^/]+)\.txt$/);
  if (chapterMatch) {
    const chapter = parseChapter(chapterMatch[1]);
    if (!chapter) return text(`Unknown chapter: ${chapterMatch[1]}`, 404);
    return handleBundle(request, env, url, chapter);
  }

  if (p.startsWith('/api/')) return json({ error: 'Not found' }, { status: 404 });
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      const response = await handleApi(request, env, url);
      if (response) return response;
    } catch (err) {
      console.error('[Worker Error]', err);
      return json({ error: 'Internal server error' }, { status: 500, cache: 'no-store' });
    }
    return env.ASSETS.fetch(request);
  },
};
