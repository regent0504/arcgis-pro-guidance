import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { CHAPTER_LABELS, type ChapterKey, type DocCard } from './types';
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

export { formatPageAsLlmMarkdown, generateLlmsTxtIndex } from './markdownFormat';

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
