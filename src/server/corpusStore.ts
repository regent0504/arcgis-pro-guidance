import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type {
  CatalogEntry,
  ChapterKey,
  CollectionReport,
  DocCard,
  PageDetail,
  SdkMember,
  SyncPageOverride,
} from '../lib/types';
import { CHAPTER_KEYS } from '../lib/types';
import { formatPageAsLlmMarkdown } from '../lib/docFormatter';
import {
  extractChapterFromPath,
  extractRelativePathFromSourceUrl,
  normalizeEsriDocPath,
} from '../lib/urlSafety';

interface PageSpan {
  file: string; // relative to JSONL root, e.g. "get-started/001.jsonl"
  offsets: Array<[number, number]>; // [byteStart, byteLength] per line or merged span
}

interface PersistedOffsetCache {
  version: number;
  builtAt: string;
  pageCount: number;
  spans: Record<string, PageSpan>;
}

const OFFSET_CACHE_VERSION = 1;

export class CorpusStore {
  readonly rootDir: string;
  readonly jsonlDir: string;
  readonly dataDir: string;
  readonly offsetCachePath: string;

  report: CollectionReport;
  catalog: CatalogEntry[] = [];
  catalogMap = new Map<string, CatalogEntry>();
  sdkMembers: SdkMember[] = [];
  agentsGuidance = '';

  private pageSpans = new Map<string, PageSpan>();
  private indexReady = false;
  private indexingPromise: Promise<void> | null = null;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    this.jsonlDir = path.join(this.rootDir, 'JSONL 版');
    this.dataDir = path.join(this.rootDir, 'data');
    this.offsetCachePath = path.join(this.dataDir, 'page-offsets.json');

    fs.mkdirSync(this.dataDir, { recursive: true });
    this.report = this.loadReport();
    this.loadCatalog();
    this.loadAgentsGuidance();
    // Load SDK members & byte-offset index asynchronously right after boot so port 3000 opens instantly
    this.indexingPromise = this.initializeAsyncIndexes();
  }

  isIndexReady(): boolean {
    return this.indexReady;
  }

  getIndexedPageCount(): number {
    return this.pageSpans.size;
  }

  async waitForIndex(): Promise<void> {
    if (this.indexingPromise) {
      await this.indexingPromise;
    }
  }

  private loadReport(): CollectionReport {
    const reportPath = path.join(this.jsonlDir, '收錄報告.json');
    if (fs.existsSync(reportPath)) {
      return JSON.parse(fs.readFileSync(reportPath, 'utf8')) as CollectionReport;
    }
    return {
      official_pages: 0,
      indexed_pages: 0,
      cards: 0,
      by_chapter: {},
      by_type: {},
      by_language: {},
      missing: [],
      excluded: [],
      content_pages: 0,
      sdk_member_urls: 0,
    };
  }

  private loadCatalog(): void {
    const catalogPath = path.join(this.jsonlDir, '目錄.json');
    if (!fs.existsSync(catalogPath)) return;
    const raw = fs.readFileSync(catalogPath, 'utf8');
    this.catalog = JSON.parse(raw) as CatalogEntry[];
    this.catalogMap.clear();
    for (const entry of this.catalog) {
      this.catalogMap.set(entry.path, entry);
    }
  }

  private loadAgentsGuidance(): void {
    const agentsPath = path.join(this.jsonlDir, 'AGENTS.md');
    if (fs.existsSync(agentsPath)) {
      this.agentsGuidance = fs.readFileSync(agentsPath, 'utf8');
    }
  }

  private async initializeAsyncIndexes(): Promise<void> {
    try {
      await this.loadSdkMembersAsync();
      if (this.tryLoadOffsetCache()) {
        this.indexReady = true;
        return;
      }
      await this.buildByteOffsetIndex();
      this.saveOffsetCache();
      this.indexReady = true;
    } catch (err) {
      console.error('[CorpusStore] Background index error:', err);
      this.indexReady = true;
    }
  }

  private async loadSdkMembersAsync(): Promise<void> {
    const sdkPath = path.join(this.jsonlDir, 'SDK成員索引.jsonl');
    if (!fs.existsSync(sdkPath)) return;
    const members: SdkMember[] = [];
    const stream = fs.createReadStream(sdkPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        members.push(JSON.parse(trimmed) as SdkMember);
      } catch {
        // skip malformed line
      }
    }
    this.sdkMembers = members;
  }

  private tryLoadOffsetCache(): boolean {
    if (!fs.existsSync(this.offsetCachePath)) return false;
    try {
      const raw = fs.readFileSync(this.offsetCachePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedOffsetCache;
      if (parsed.version !== OFFSET_CACHE_VERSION || !parsed.spans) return false;
      this.pageSpans.clear();
      for (const [k, v] of Object.entries(parsed.spans)) {
        this.pageSpans.set(k, v);
      }
      return this.pageSpans.size > 0;
    } catch {
      return false;
    }
  }

  private saveOffsetCache(): void {
    try {
      const spansObj: Record<string, PageSpan> = {};
      for (const [k, v] of this.pageSpans.entries()) {
        spansObj[k] = v;
      }
      const payload: PersistedOffsetCache = {
        version: OFFSET_CACHE_VERSION,
        builtAt: new Date().toISOString(),
        pageCount: this.pageSpans.size,
        spans: spansObj,
      };
      fs.writeFileSync(this.offsetCachePath, JSON.stringify(payload), 'utf8');
    } catch (err) {
      console.error('[CorpusStore] Failed to write offset cache:', err);
    }
  }

  /**
   * Streams every JSONL shard once to record exact byte ranges per official page path.
   * Merges contiguous byte ranges so reading a full page requires only 1 disk read!
   */
  private async buildByteOffsetIndex(): Promise<void> {
    this.pageSpans.clear();

    for (const chapter of CHAPTER_KEYS) {
      const chapterDir = path.join(this.jsonlDir, chapter);
      if (!fs.existsSync(chapterDir)) continue;
      const files = fs
        .readdirSync(chapterDir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort();

      for (const fileName of files) {
        const relFile = `${chapter}/${fileName}`;
        const absFile = path.join(chapterDir, fileName);
        await this.scanJsonlFileOffsets(absFile, relFile);
      }
    }
  }

  private async scanJsonlFileOffsets(absFile: string, relFile: string): Promise<void> {
    const fd = fs.openSync(absFile, 'r');
    const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
    const buf = Buffer.allocUnsafe(CHUNK_SIZE);

    let fileOffset = 0;
    let leftover = Buffer.alloc(0);

    try {
      while (true) {
        const bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, fileOffset);
        if (bytesRead === 0) break;

        const slice = buf.subarray(0, bytesRead);
        const combined = leftover.length > 0 ? Buffer.concat([leftover, slice]) : slice;
        const combinedBaseOffset = fileOffset - leftover.length;

        let lineStart = 0;
        let newlineIdx = combined.indexOf(0x0a, lineStart);
        while (newlineIdx !== -1) {
          const lineLen = newlineIdx - lineStart;
          if (lineLen > 2) {
            const lineStr = combined.subarray(lineStart, newlineIdx).toString('utf8');
            this.recordLineSpan(lineStr, relFile, combinedBaseOffset + lineStart, lineLen);
          }
          lineStart = newlineIdx + 1;
          newlineIdx = combined.indexOf(0x0a, lineStart);
        }

        leftover = Buffer.from(combined.subarray(lineStart));
        fileOffset += bytesRead;
        // Yield periodically so HTTP requests stay responsive
        await new Promise((resolve) => setImmediate(resolve));
      }

      if (leftover.length > 2) {
        const lineStr = leftover.toString('utf8');
        this.recordLineSpan(lineStr, relFile, fileOffset - leftover.length, leftover.length);
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  private recordLineSpan(lineStr: string, relFile: string, byteStart: number, byteLen: number): void {
    // Fast regex extraction of source_en avoids full JSON.parse of 173,475 lines during boot!
    const match = lineStr.match(/"source_en"\s*:\s*"([^"]+)"/);
    const rawUrl = match?.[1];
    if (!rawUrl) return;
    const relPath = extractRelativePathFromSourceUrl(rawUrl);
    if (!relPath) return;

    let entry = this.pageSpans.get(relPath);
    if (!entry) {
      entry = { file: relFile, offsets: [[byteStart, byteLen]] };
      this.pageSpans.set(relPath, entry);
      return;
    }

    // If contiguous in the same file (99.9% of cases), coalesce into a single [start, totalLen] read!
    if (entry.file === relFile) {
      const last = entry.offsets[entry.offsets.length - 1];
      const expectedNext = last[0] + last[1];
      if (byteStart - expectedNext <= 2) {
        last[1] = byteStart + byteLen - last[0];
        return;
      }
      entry.offsets.push([byteStart, byteLen]);
    }
  }

  /**
   * Reads structured cards for a single page from the local JSONL corpus using O(1) byte offsets.
   */
  async readBasePageCards(rawPath: string): Promise<DocCard[]> {
    const relPath = normalizeEsriDocPath(rawPath);
    if (!relPath) return [];

    if (!this.indexReady) {
      await this.waitForIndex();
    }

    const span = this.pageSpans.get(relPath);
    if (!span) return [];

    const absFile = path.resolve(this.jsonlDir, span.file);
    // Strict directory confinement check
    if (!absFile.startsWith(this.jsonlDir + path.sep)) {
      return [];
    }
    if (!fs.existsSync(absFile)) return [];

    const cards: DocCard[] = [];
    const fd = fs.openSync(absFile, 'r');
    try {
      for (const [start, length] of span.offsets) {
        const chunk = Buffer.allocUnsafe(length);
        fs.readSync(fd, chunk, 0, length, start);
        const text = chunk.toString('utf8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            cards.push(JSON.parse(trimmed) as DocCard);
          } catch {
            // ignore malformed line
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }

    return cards;
  }

  /**
   * Resolves a full PageDetail combining catalog metadata, base JSONL cards, and any live synced override.
   */
  async getPageDetail(
    rawPath: string,
    override?: SyncPageOverride
  ): Promise<PageDetail | null> {
    const relPath = normalizeEsriDocPath(rawPath);
    if (!relPath) return null;

    const catalogEntry = this.catalogMap.get(relPath);
    const cards = override ? override.cards : await this.readBasePageCards(relPath);

    if (!catalogEntry && !override && cards.length === 0) {
      return null;
    }

    const chapterKey = extractChapterFromPath(relPath);
    const titleEn =
      override?.titleEn ||
      catalogEntry?.english[catalogEntry.english.length - 1] ||
      cards[0]?.english ||
      relPath;
    const titleZh =
      override?.titleZh ||
      catalogEntry?.chapter[catalogEntry.chapter.length - 1] ||
      cards[0]?.topic ||
      titleEn;
    const breadcrumbsEn = catalogEntry?.english ?? [chapterKey, titleEn];
    const breadcrumbsZh = catalogEntry?.chapter ?? cards[0]?.chapter ?? [titleZh];
    const sourceEnUrl =
      override?.sourceEnUrl ||
      cards[0]?.source_en ||
      `https://doc.esri.com/en/arcgis-pro/latest/${relPath}`;
    const sourceUrl =
      override?.sourceUrl ||
      cards[0]?.source ||
      sourceEnUrl;
    const contentVersion =
      cards[0]?.content_version || (override ? 'live-sync' : '3.7');

    const markdown = formatPageAsLlmMarkdown({
      path: relPath,
      titleZh,
      titleEn,
      breadcrumbsZh,
      breadcrumbsEn,
      sourceUrl,
      sourceEnUrl,
      contentVersion,
      syncedAt: override?.syncedAt,
      cards,
    });

    return {
      path: relPath,
      chapterKey,
      titleZh,
      titleEn,
      breadcrumbsZh,
      breadcrumbsEn,
      sourceUrl,
      sourceEnUrl,
      contentVersion,
      syncedAt: override?.syncedAt,
      isLiveOverride: Boolean(override),
      cardCount: cards.length,
      cards,
      markdown,
    };
  }

  /**
   * Lists curated featured pages across chapters for /llms.txt and UI quick shortcuts.
   */
  getFeaturedPages(): CatalogEntry[] {
    const preferredPaths = [
      'get-started/get-started.html',
      'get-started/whats-new-in-arcgis-pro.html',
      'get-started/arcgis-pro-system-requirements.html',
      'get-started/release-notes.html',
      'get-started/pro-quickstart-tutorials.html',
      'help/main/welcome-to-the-arcgis-pro-app-help.html',
      'help/projects/what-is-a-project.html',
      'tool-reference/analysis/buffer.html',
      'tool-reference/analysis/clip.html',
      'tool-reference/analysis/spatial-join.html',
      'tool-reference/data-management/project.html',
      'tool-reference/data-management/calculate-field.html',
      'tool-reference/conversion/feature-class-to-feature-class.html',
      'arcpy/get-started/what-is-arcpy-.htm',
      'arcpy/spatial-analyst/ferrousminerals.html',
      'sdk/index.html',
    ];

    const picked: CatalogEntry[] = [];
    const seen = new Set<string>();

    for (const p of preferredPaths) {
      const found = this.catalogMap.get(p);
      if (found && !seen.has(found.path)) {
        picked.push(found);
        seen.add(found.path);
      }
    }

    // Fill up to 24 featured pages across chapters
    for (const entry of this.catalog) {
      if (picked.length >= 24) break;
      if (!seen.has(entry.path)) {
        picked.push(entry);
        seen.add(entry.path);
      }
    }

    return picked;
  }

  /**
   * Returns a balanced sample of important pages to check during an incremental batch sync.
   */
  selectPagesForBatchSync(targetChapters: ChapterKey[], batchSize: number): string[] {
    const priorityCandidates = [
      'get-started/get-started.html',
      'get-started/whats-new-in-arcgis-pro.html',
      'get-started/release-notes.html',
      'get-started/arcgis-pro-system-requirements.html',
      'help/main/welcome-to-the-arcgis-pro-app-help.html',
      'tool-reference/analysis/buffer.html',
      'tool-reference/analysis/clip.html',
      'arcpy/spatial-analyst/ferrousminerals.html',
      'sdk/index.html',
    ];

    const allowed = new Set<ChapterKey>(targetChapters.length > 0 ? targetChapters : CHAPTER_KEYS);
    const result: string[] = [];
    const seen = new Set<string>();

    for (const p of priorityCandidates) {
      if (result.length >= batchSize) break;
      if (allowed.has(extractChapterFromPath(p)) && this.catalogMap.has(p) && !seen.has(p)) {
        result.push(p);
        seen.add(p);
      }
    }

    for (const entry of this.catalog) {
      if (result.length >= batchSize) break;
      if (allowed.has(extractChapterFromPath(entry.path)) && !seen.has(entry.path)) {
        result.push(entry.path);
        seen.add(entry.path);
      }
    }

    return result;
  }
}
