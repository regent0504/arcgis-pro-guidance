import type { CatalogEntry, ChapterKey, SdkMember, SearchResultItem } from './types';
import { extractChapterFromPath } from './urlSafety';

export interface SearchQueryOptions {
  query: string;
  chapter?: ChapterKey | 'all';
  limit?: number;
  offset?: number;
  overridePaths?: Map<string, { syncedAt: string; titleEn: string; titleZh: string }>;
}

/**
 * Tokenizes a bilingual search query (Traditional Chinese, English identifiers, ArcGIS error codes).
 */
export function tokenizeQuery(raw: string): string[] {
  return raw
    .trim()
    .toLowerCase()
    .split(/[\s,;:]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Scores and ranks catalog entries against bilingual search tokens.
 * Pure, deterministic, fast (<15ms over 16,567 entries).
 */
export function searchCatalogEntries(
  entries: readonly CatalogEntry[],
  options: SearchQueryOptions
): { total: number; items: SearchResultItem[] } {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const chapterFilter = options.chapter && options.chapter !== 'all' ? options.chapter : null;
  const tokens = tokenizeQuery(options.query);

  const scored: SearchResultItem[] = [];

  for (const entry of entries) {
    const chapterKey = extractChapterFromPath(entry.path);
    if (chapterFilter && chapterKey !== chapterFilter) continue;

    const titleEn = entry.english[entry.english.length - 1] || entry.path;
    const titleZh = entry.chapter[entry.chapter.length - 1] || titleEn;
    const override = options.overridePaths?.get(entry.path);

    if (tokens.length === 0) {
      scored.push({
        path: entry.path,
        chapterKey,
        titleZh: override?.titleZh || titleZh,
        titleEn: override?.titleEn || titleEn,
        breadcrumbsZh: entry.chapter,
        breadcrumbsEn: entry.english,
        sourceEnUrl: `https://doc.esri.com/en/arcgis-pro/latest/${entry.path}`,
        score: override ? 10 : 1,
        matchedFields: [],
        isLiveOverride: Boolean(override),
        syncedAt: override?.syncedAt,
      });
      continue;
    }

    const lowerPath = entry.path.toLowerCase();
    const lowerTitleEn = titleEn.toLowerCase();
    const lowerTitleZh = titleZh.toLowerCase();
    const lowerBreadEn = entry.english.join(' ').toLowerCase();
    const lowerBreadZh = entry.chapter.join(' ').toLowerCase();

    let score = 0;
    let allMatched = true;
    const matchedFields = new Set<string>();

    for (const token of tokens) {
      let tokenScore = 0;

      if (lowerTitleEn === token || lowerTitleZh === token) {
        tokenScore += 100;
        matchedFields.add('title');
      } else if (lowerTitleEn.includes(token)) {
        tokenScore += 55;
        matchedFields.add('title_en');
      } else if (lowerTitleZh.includes(token)) {
        tokenScore += 55;
        matchedFields.add('title_zh');
      }

      if (lowerPath.includes(token)) {
        tokenScore += 35;
        matchedFields.add('path');
      }

      if (lowerBreadEn.includes(token)) {
        tokenScore += 18;
        matchedFields.add('category_en');
      }

      if (lowerBreadZh.includes(token)) {
        tokenScore += 18;
        matchedFields.add('category_zh');
      }

      if (tokenScore === 0) {
        allMatched = false;
        break;
      }
      score += tokenScore;
    }

    if (!allMatched) continue;

    // Slight boost for shorter exact tool pages (e.g., buffer.html over buffer-wizard-error.html)
    score += Math.max(0, 15 - Math.floor(entry.path.length / 10));
    if (override) score += 5;

    scored.push({
      path: entry.path,
      chapterKey,
      titleZh: override?.titleZh || titleZh,
      titleEn: override?.titleEn || titleEn,
      breadcrumbsZh: entry.chapter,
      breadcrumbsEn: entry.english,
      sourceEnUrl: `https://doc.esri.com/en/arcgis-pro/latest/${entry.path}`,
      score,
      matchedFields: Array.from(matchedFields),
      isLiveOverride: Boolean(override),
      syncedAt: override?.syncedAt,
    });
  }

  if (tokens.length > 0) {
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  }

  return {
    total: scored.length,
    items: scored.slice(offset, offset + limit),
  };
}

/**
 * Searches the 29,029 ArcGIS Pro .NET SDK member index entries.
 */
export function searchSdkMembers(
  members: readonly SdkMember[],
  rawQuery: string,
  limit = 25,
  offset = 0
): { total: number; items: SdkMember[] } {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safeOffset = Math.max(offset, 0);
  const tokens = tokenizeQuery(rawQuery);

  if (tokens.length === 0) {
    return {
      total: members.length,
      items: members.slice(safeOffset, safeOffset + safeLimit),
    };
  }

  const matches: Array<{ member: SdkMember; score: number }> = [];

  for (const m of members) {
    const enText = (m.english || []).join(' ').toLowerCase();
    const zhText = (m.topic || '').toLowerCase();
    let score = 0;
    let allMatch = true;

    for (const token of tokens) {
      if (enText.startsWith(token)) {
        score += 60;
      } else if (enText.includes(token)) {
        score += 30;
      } else if (zhText.includes(token)) {
        score += 25;
      } else {
        allMatch = false;
        break;
      }
    }

    if (allMatch) {
      matches.push({ member: m, score });
    }
  }

  matches.sort((a, b) => b.score - a.score || a.member.topic.localeCompare(b.member.topic));

  return {
    total: matches.length,
    items: matches.slice(safeOffset, safeOffset + safeLimit).map((m) => m.member),
  };
}
