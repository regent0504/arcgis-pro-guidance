import type { CatalogEntry, ChapterKey, SdkMember, SearchResultItem } from './types';
import { tokenizeQuery, type SearchQueryOptions } from './corpusSearch';
import { extractChapterFromPath } from './urlSafety';

/**
 * Catalog search with all lowercase haystacks computed once up front.
 *
 * Scoring is identical to `searchCatalogEntries`, but per-query work drops from ~20 ms to
 * ~1–3 ms over 16,567 pages, which keeps Cloudflare Workers (10 ms CPU on Free) happy.
 * Build the index once (e.g. at Worker startup) and reuse it for every request.
 */
export class PreparedCatalogIndex {
  readonly entries: CatalogEntry[];
  readonly byPath: Map<string, CatalogEntry>;
  private readonly chapterKey: ChapterKey[];
  private readonly titleEn: string[];
  private readonly titleZh: string[];
  private readonly lowPath: string[];
  private readonly lowTitleEn: string[];
  private readonly lowTitleZh: string[];
  private readonly lowBreadEn: string[];
  private readonly lowBreadZh: string[];

  constructor(entries: CatalogEntry[]) {
    const n = entries.length;
    this.entries = entries;
    this.byPath = new Map();
    this.chapterKey = new Array(n);
    this.titleEn = new Array(n);
    this.titleZh = new Array(n);
    this.lowPath = new Array(n);
    this.lowTitleEn = new Array(n);
    this.lowTitleZh = new Array(n);
    this.lowBreadEn = new Array(n);
    this.lowBreadZh = new Array(n);

    for (let i = 0; i < n; i++) {
      const e = entries[i];
      this.byPath.set(e.path, e);
      const tEn = e.english[e.english.length - 1] || e.path;
      const tZh = e.chapter[e.chapter.length - 1] || tEn;
      this.chapterKey[i] = extractChapterFromPath(e.path);
      this.titleEn[i] = tEn;
      this.titleZh[i] = tZh;
      this.lowPath[i] = e.path.toLowerCase();
      this.lowTitleEn[i] = tEn.toLowerCase();
      this.lowTitleZh[i] = tZh.toLowerCase();
      this.lowBreadEn[i] = e.english.join(' ').toLowerCase();
      this.lowBreadZh[i] = e.chapter.join(' ').toLowerCase();
    }
  }

  search(options: SearchQueryOptions): { total: number; items: SearchResultItem[] } {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);
    const chapterFilter = options.chapter && options.chapter !== 'all' ? options.chapter : null;
    const tokens = tokenizeQuery(options.query);
    const overrides = options.overridePaths;

    // Collect (index, score, matchedFields) cheaply; build result objects only for the page shown.
    const hits: Array<{ i: number; score: number; fields: string[] }> = [];

    for (let i = 0; i < this.entries.length; i++) {
      if (chapterFilter && this.chapterKey[i] !== chapterFilter) continue;
      const override = overrides?.get(this.entries[i].path);

      if (tokens.length === 0) {
        hits.push({ i, score: override ? 10 : 1, fields: [] });
        continue;
      }

      let score = 0;
      let allMatched = true;
      const fields = new Set<string>();

      for (const token of tokens) {
        let tokenScore = 0;
        const tEn = this.lowTitleEn[i];
        const tZh = this.lowTitleZh[i];

        if (tEn === token || tZh === token) {
          tokenScore += 100;
          fields.add('title');
        } else if (tEn.includes(token)) {
          tokenScore += 55;
          fields.add('title_en');
        } else if (tZh.includes(token)) {
          tokenScore += 55;
          fields.add('title_zh');
        }
        if (this.lowPath[i].includes(token)) {
          tokenScore += 35;
          fields.add('path');
        }
        if (this.lowBreadEn[i].includes(token)) {
          tokenScore += 18;
          fields.add('category_en');
        }
        if (this.lowBreadZh[i].includes(token)) {
          tokenScore += 18;
          fields.add('category_zh');
        }
        if (tokenScore === 0) {
          allMatched = false;
          break;
        }
        score += tokenScore;
      }

      if (!allMatched) continue;
      score += Math.max(0, 15 - Math.floor(this.entries[i].path.length / 10));
      if (override) score += 5;
      hits.push({ i, score, fields: Array.from(fields) });
    }

    if (tokens.length > 0) {
      hits.sort(
        (a, b) =>
          b.score - a.score || this.entries[a.i].path.localeCompare(this.entries[b.i].path)
      );
    }

    const items = hits.slice(offset, offset + limit).map(({ i, score, fields }) => {
      const e = this.entries[i];
      const override = overrides?.get(e.path);
      return {
        path: e.path,
        chapterKey: this.chapterKey[i],
        titleZh: override?.titleZh || this.titleZh[i],
        titleEn: override?.titleEn || this.titleEn[i],
        breadcrumbsZh: e.chapter,
        breadcrumbsEn: e.english,
        sourceEnUrl: `https://doc.esri.com/en/arcgis-pro/latest/${e.path}`,
        score,
        matchedFields: fields,
        isLiveOverride: Boolean(override),
        syncedAt: override?.syncedAt,
      } satisfies SearchResultItem;
    });

    return { total: hits.length, items };
  }
}

/** SDK member search with precomputed lowercase text; same scoring as `searchSdkMembers`. */
export class PreparedSdkIndex {
  readonly members: SdkMember[];
  private readonly enText: string[];
  private readonly zhText: string[];

  constructor(members: SdkMember[]) {
    this.members = members;
    this.enText = members.map((m) => (m.english || []).join(' ').toLowerCase());
    this.zhText = members.map((m) => (m.topic || '').toLowerCase());
  }

  search(rawQuery: string, limit = 25, offset = 0): { total: number; items: SdkMember[] } {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = Math.max(offset, 0);
    const tokens = tokenizeQuery(rawQuery);

    if (tokens.length === 0) {
      return {
        total: this.members.length,
        items: this.members.slice(safeOffset, safeOffset + safeLimit),
      };
    }

    const matches: Array<{ i: number; score: number }> = [];
    for (let i = 0; i < this.members.length; i++) {
      const en = this.enText[i];
      const zh = this.zhText[i];
      let score = 0;
      let allMatch = true;
      for (const token of tokens) {
        if (en.startsWith(token)) score += 60;
        else if (en.includes(token)) score += 30;
        else if (zh.includes(token)) score += 25;
        else {
          allMatch = false;
          break;
        }
      }
      if (allMatch) matches.push({ i, score });
    }

    matches.sort(
      (a, b) =>
        b.score - a.score || this.members[a.i].topic.localeCompare(this.members[b.i].topic)
    );

    return {
      total: matches.length,
      items: matches.slice(safeOffset, safeOffset + safeLimit).map((m) => this.members[m.i]),
    };
  }
}
