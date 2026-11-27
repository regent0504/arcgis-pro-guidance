import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import {
  CHAPTER_KEYS,
  CHAPTER_LABELS,
  type CatalogEntry,
  type ChapterKey,
  type CollectionReport,
  type DocCard,
} from './types';
import { extractChapterFromPath } from './urlSafety';

/**
 * Computes a deterministic SHA-256 hash of a page's structured card contents
 * for change detection during automated syncs.
 */
export function computeCardsContentHash(cards: DocCard[]): string {
  const canonical = cards.map((card) => ({
    section: card.section,
    kind: card.kind,
    text: card.text ?? '',
    steps: card.steps ?? [],
    parameter: card.parameter ?? '',
    headers: card.headers ?? [],
    values: card.values ?? [],
  }));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Formats a single ArcGIS Pro documentation page and its structured cards into
 * clean, LLM-optimized Markdown (for /llms-full.txt and /api/page?format=markdown).
 */
export function formatPageAsLlmMarkdown(params: {
  path: string;
  titleZh: string;
  titleEn: string;
  breadcrumbsZh: string[];
  breadcrumbsEn: string[];
  sourceUrl: string;
  sourceEnUrl: string;
  contentVersion: string;
  syncedAt?: string;
  cards: DocCard[];
}): string {
  const lines: string[] = [];
  const heading =
    params.titleZh && params.titleEn && params.titleZh !== params.titleEn
      ? `${params.titleZh} (${params.titleEn})`
      : params.titleEn || params.titleZh || params.path;

  lines.push(`# ${heading}`);
  lines.push('');
  lines.push(`- Path: \`${params.path}\``);
  if (params.breadcrumbsEn.length > 0) {
    lines.push(`- Category (EN): ${params.breadcrumbsEn.join(' > ')}`);
  }
  if (params.breadcrumbsZh.length > 0) {
    lines.push(`- Category (ZH): ${params.breadcrumbsZh.join(' > ')}`);
  }
  lines.push(`- Official Source (EN): ${params.sourceEnUrl}`);
  if (params.sourceUrl && params.sourceUrl !== params.sourceEnUrl) {
    lines.push(`- Localized Source: ${params.sourceUrl}`);
  }
  lines.push(
    `- Version: ${params.contentVersion}${params.syncedAt ? ` (Live Synced: ${params.syncedAt})` : ''}`
  );
  lines.push('');

  if (params.cards.length === 0) {
    lines.push('_No structured cards indexed for this page yet. Use the sync endpoint to fetch live content._');
    lines.push('');
    return lines.join('\n');
  }

  let currentSection = '';
  for (const card of params.cards) {
    const section = card.section?.trim() || 'Overview';
    if (section !== currentSection) {
      lines.push(`## ${section}`);
      lines.push('');
      currentSection = section;
    }

    if (card.kind === '程式或語法' && card.text) {
      lines.push('```python');
      lines.push(card.text.trim());
      lines.push('```');
      lines.push('');
      continue;
    }

    if (card.kind === '有序步驟' && Array.isArray(card.steps) && card.steps.length > 0) {
      card.steps.forEach((step, idx) => {
        lines.push(`${idx + 1}. ${step.trim()}`);
      });
      lines.push('');
      continue;
    }

    if (
      (card.kind === '參數' || card.kind === '表格') &&
      Array.isArray(card.headers) &&
      Array.isArray(card.values) &&
      card.values.length > 0
    ) {
      const paramPrefix = card.parameter ? `**\`${card.parameter}\`** ` : '';
      const pairs = card.headers
        .map((h, i) => {
          const v = card.values?.[i];
          return v ? `${h}: ${v}` : null;
        })
        .filter(Boolean)
        .join(' | ');
      lines.push(`- ${paramPrefix}${pairs}`);
      continue;
    }

    if (card.kind === '版本參數表' && Array.isArray(card.parameters) && card.parameters.length > 0) {
      lines.push('| Parameter | Label | Type | Optional |');
      lines.push('| --- | --- | --- | --- |');
      for (const p of card.parameters) {
        const name = String(p.parameter ?? p.name ?? '');
        const label = String(p.label_en ?? p.label_zh ?? p.label ?? '');
        const dtype = String(p.data_type ?? p.type ?? '');
        const opt = String(p.optional_label ?? (p.optional ? 'Optional' : 'Required'));
        lines.push(`| \`${name}\` | ${label} | ${dtype} | ${opt} |`);
      }
      lines.push('');
      continue;
    }

    if (card.kind === '開發資源' && card.resource) {
      lines.push(`- [${card.text || card.section}](${card.resource})`);
      continue;
    }

    if (card.text) {
      lines.push(card.text.trim());
      lines.push('');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Generates a standards-compliant /llms.txt index following https://llmstxt.org/.
 */
export function generateLlmsTxtIndex(params: {
  baseUrl: string;
  report: CollectionReport;
  featuredPages: CatalogEntry[];
  agentsGuidance?: string;
  overrideCount: number;
  lastSyncAt: string | null;
}): string {
  const base = params.baseUrl.replace(/\/+$/, '');
  const lines: string[] = [
    '# ArcGIS Pro Documentation (AI-Readable Gateway)',
    '',
    `> Structured AI-readable index and API gateway for official Esri ArcGIS Pro documentation (${params.report.official_pages.toLocaleString('en-US')} pages, ${params.report.cards.toLocaleString('en-US')} structured knowledge cards, and ${params.report.sdk_member_urls.toLocaleString('en-US')} .NET SDK members). Maintained with automated incremental sync against doc.esri.com.`,
    '',
    '## Quick Access Endpoints',
    '',
    `- [Full Corpus Stream (llms-full.txt)](${base}/llms-full.txt): Streaming Markdown bundle (supports ?chapter=get-started|help|tool-reference|arcpy|sdk&limit=N&q=keyword)`,
    `- [OpenAPI 3.1 Specification](${base}/api/openapi.json): Machine-readable API schema for AI agents and tool runners`,
    `- [Corpus Statistics JSON](${base}/api/stats): Coverage metrics, chapter counts, and sync freshness`,
    `- [Structured Search API](${base}/api/search?q=buffer&limit=10): Bilingual (Traditional Chinese + English) search across pages and tools`,
    `- [Single Page Markdown API](${base}/api/page?path=get-started/get-started.html&format=markdown): Fetch any page as clean Markdown or structured JSON cards`,
    `- [.NET SDK Member Search API](${base}/api/sdk?q=EditOperation&limit=10): Lookup ArcGIS Pro SDK for .NET classes, methods, and properties`,
    '',
    '## Chapter Full-Text Exports',
    '',
  ];

  for (const key of CHAPTER_KEYS) {
    const meta = CHAPTER_LABELS[key];
    const count = params.report.by_chapter[key] ?? 0;
    lines.push(
      `- [${meta.en} / ${meta.zh} (${count.toLocaleString('en-US')} pages)](${base}/llms/${key}.txt): ${meta.description}`
    );
  }

  lines.push('');
  lines.push('## Core Entry Pages');
  lines.push('');

  for (const entry of params.featuredPages.slice(0, 30)) {
    const titleEn = entry.english[entry.english.length - 1] || entry.path;
    const titleZh = entry.chapter[entry.chapter.length - 1];
    const label = titleZh && titleZh !== titleEn ? `${titleEn} — ${titleZh}` : titleEn;
    lines.push(
      `- [${label}](${base}/api/page?path=${encodeURIComponent(entry.path)}&format=markdown): Official page \`${entry.path}\``
    );
  }

  lines.push('');
  lines.push('## AI Usage Guidance');
  lines.push('');
  lines.push(
    '- Prefer querying `/api/search?q=...` first to identify exact `path` values, then retrieve complete parameters and code samples via `/api/page?path=<path>&format=markdown`.'
  );
  lines.push(
    '- Always cite `sourceEnUrl` and `contentVersion`. Verify parameter spelling and Python identifiers against the official English parameter names.'
  );
  lines.push(
    `- Live Sync Status: ${params.overrideCount} pages refreshed via live sync${params.lastSyncAt ? ` (last run: ${params.lastSyncAt})` : ''}.`
  );

  if (params.agentsGuidance) {
    const firstParagraph = params.agentsGuidance
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .slice(0, 2)
      .join(' ');
    if (firstParagraph) {
      lines.push(`- Editorial Notes: ${firstParagraph}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Parses an official Esri ArcGIS Pro documentation HTML page into structured DocCards
 * compatible with the existing JSONL corpus schema.
 */
export function parseEsriHtmlToCards(params: {
  html: string;
  relativePath: string;
  sourceUrl: string;
  sourceEnUrl: string;
  language: 'en' | 'zh-cn';
}): { title: string; cards: DocCard[]; detectedVersion: string } {
  const $ = cheerio.load(params.html);

  // Remove non-content navigation, scripts, styles, headers, footers
  $('script, style, noscript, nav, footer, header, .site-nav, .toc-container, .feedback-container').remove();

  const h1Text = $('main h1, article h1, h1').first().text().replace(/\s+/g, ' ').trim();
  const docTitle =
    h1Text ||
    $('title')
      .first()
      .text()
      .replace(/—ArcGIS Pro.*$/i, '')
      .replace(/\|.*$/, '')
      .trim() ||
    params.relativePath;

  // Attempt to detect ArcGIS Pro version mentioned in meta or title
  const metaVersion =
    $('meta[name="version"]').attr('content') ||
    $('meta[name="product-version"]').attr('content') ||
    params.html.match(/ArcGIS Pro (\d+\.\d+)/i)?.[1] ||
    'latest';

  const root = $('main, article, #main-content, .content, body').first();
  const chapterKey: ChapterKey = extractChapterFromPath(params.relativePath);
  const chapterLabel = CHAPTER_LABELS[chapterKey]?.en ?? chapterKey;
  const idPrefix = crypto
    .createHash('sha1')
    .update(params.relativePath)
    .digest('hex')
    .slice(0, 14);

  const cards: DocCard[] = [];
  let currentSection = docTitle;
  let seq = 1;

  const pushCard = (partial: Omit<DocCard, 'id' | 'topic' | 'english' | 'chapter' | 'source' | 'source_en' | 'content_version' | 'source_language'>) => {
    cards.push({
      id: `live-${idPrefix}-${seq++}`,
      topic: docTitle,
      english: docTitle,
      chapter: [chapterLabel],
      source: params.sourceUrl,
      source_en: params.sourceEnUrl,
      content_version: metaVersion,
      source_language: params.language,
      ...partial,
    });
  };

  root.find('h2, h3, p, pre, ol, table').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    const $el = $(el);

    if (tag === 'h2' || tag === 'h3') {
      const heading = $el.text().replace(/\s+/g, ' ').trim();
      if (heading) {
        currentSection = heading;
      }
      return;
    }

    if (tag === 'pre') {
      const code = $el.text().trim();
      if (code && code.length > 3) {
        pushCard({
          section: currentSection,
          kind: '程式或語法',
          text: code,
        });
      }
      return;
    }

    if (tag === 'ol') {
      const steps: string[] = [];
      $el.children('li').each((__, li) => {
        const text = $(li).text().replace(/\s+/g, ' ').trim();
        if (text) steps.push(text);
      });
      if (steps.length > 0) {
        pushCard({
          section: currentSection,
          kind: '有序步驟',
          steps,
        });
      }
      return;
    }

    if (tag === 'table') {
      const headers: string[] = [];
      $el.find('thead th, tr:first-child th').each((__, th) => {
        const h = $(th).text().replace(/\s+/g, ' ').trim();
        if (h) headers.push(h);
      });

      const rows = $el.find('tbody tr').length > 0 ? $el.find('tbody tr') : $el.find('tr').slice(headers.length > 0 ? 1 : 0);
      rows.each((__, tr) => {
        const values: string[] = [];
        $(tr)
          .find('td')
          .each((___, td) => {
            values.push($(td).text().replace(/\s+/g, ' ').trim());
          });
        if (values.some(Boolean)) {
          const isParamTable =
            headers.some((h) => /parameter|參數|label|標注/i.test(h)) ||
            /parameter|syntax|參數|語法/i.test(currentSection);
          pushCard({
            section: currentSection,
            kind: isParamTable ? '參數' : '表格',
            parameter: isParamTable ? values[0] : '',
            headers: headers.length > 0 ? headers : values.map((_, idx) => `Col ${idx + 1}`),
            values,
          });
        }
      });
      return;
    }

    if (tag === 'p') {
      // Skip paragraphs nested inside li or td (already captured)
      if ($el.closest('li, td, pre').length > 0) return;
      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (text && text.length >= 12) {
        pushCard({
          section: currentSection,
          kind: '說明',
          text,
        });
      }
    }
  });

  return {
    title: docTitle,
    cards,
    detectedVersion: metaVersion,
  };
}
