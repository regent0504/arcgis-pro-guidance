import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ChapterKey,
  SyncPageOverride,
  SyncRunLog,
  SyncScheduleConfig,
  SyncStatusResponse,
} from '../lib/types';
import { CHAPTER_KEYS } from '../lib/types';
import { computeCardsContentHash, parseEsriHtmlToCards } from '../lib/docFormatter';
import {
  buildSafeEsriUrl,
  isAllowedEsriFetchUrl,
  normalizeEsriDocPath,
} from '../lib/urlSafety';
import type { CorpusStore } from './corpusStore';

interface PersistedSyncState {
  config: SyncScheduleConfig;
  lastRunAt: string | null;
  overrides: Record<string, SyncPageOverride>;
  logs: SyncRunLog[];
}

const DEFAULT_CONFIG: SyncScheduleConfig = {
  enabled: true,
  intervalMinutes: 1440, // Daily
  targetChapters: ['get-started', 'tool-reference', 'arcpy'],
  batchSize: 5,
  preferredLanguage: 'en',
  updatedAt: new Date().toISOString(),
};

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 4 * 1024 * 1024; // 4 MB safety cap

export class SyncEngine {
  private readonly store: CorpusStore;
  private readonly statePath: string;
  private state: PersistedSyncState;
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private nextRunAt: string | null = null;

  private readonly autoSchedule: boolean;

  /**
   * @param options.autoSchedule Run the in-process interval timer (default true). The
   *   GitHub Actions sync job passes false and triggers runs explicitly instead.
   */
  constructor(store: CorpusStore, options: { autoSchedule?: boolean } = {}) {
    this.store = store;
    this.autoSchedule = options.autoSchedule ?? true;
    this.statePath = path.join(store.dataDir, 'sync-state.json');
    this.state = this.loadState();
    this.scheduleTimer();
  }

  private loadState(): PersistedSyncState {
    if (fs.existsSync(this.statePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as PersistedSyncState;
        if (parsed && parsed.config) {
          return {
            config: { ...DEFAULT_CONFIG, ...parsed.config },
            lastRunAt: parsed.lastRunAt ?? null,
            overrides: parsed.overrides ?? {},
            logs: Array.isArray(parsed.logs) ? parsed.logs.slice(0, 50) : [],
          };
        }
      } catch (err) {
        console.error('[SyncEngine] Failed to read sync-state.json, resetting defaults:', err);
      }
    }
    return {
      config: { ...DEFAULT_CONFIG },
      lastRunAt: null,
      overrides: {},
      logs: [],
    };
  }

  private saveState(): void {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error('[SyncEngine] Failed to save sync-state.json:', err);
    }
  }

  private scheduleTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (!this.state.config.enabled || !this.autoSchedule) {
      this.nextRunAt = null;
      return;
    }

    const intervalMs = Math.max(this.state.config.intervalMinutes, 15) * 60 * 1000;
    this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();

    this.timer = setInterval(() => {
      this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      void this.runBatchSync('scheduled');
    }, intervalMs);
    this.timer.unref?.();
  }

  getOverride(relativePath: string): SyncPageOverride | undefined {
    return this.state.overrides[relativePath];
  }

  getOverrideMap(): Map<string, { syncedAt: string; titleEn: string; titleZh: string }> {
    const map = new Map<string, { syncedAt: string; titleEn: string; titleZh: string }>();
    for (const [k, v] of Object.entries(this.state.overrides)) {
      map.set(k, { syncedAt: v.syncedAt, titleEn: v.titleEn, titleZh: v.titleZh });
    }
    return map;
  }

  getOverrideCount(): number {
    return Object.keys(this.state.overrides).length;
  }

  getLastSyncAt(): string | null {
    return this.state.lastRunAt;
  }

  isAutoSyncEnabled(): boolean {
    return this.state.config.enabled;
  }

  getStatus(): SyncStatusResponse {
    const overridesList = Object.values(this.state.overrides)
      .sort((a, b) => b.syncedAt.localeCompare(a.syncedAt))
      .map((o) => ({
        path: o.path,
        titleEn: o.titleEn,
        titleZh: o.titleZh,
        syncedAt: o.syncedAt,
        cardCount: o.cards.length,
        previousCardCount: o.previousCardCount,
        changeStatus: o.changeStatus,
        contentHash: o.contentHash,
        sourceUrl: o.sourceUrl,
      }));

    return {
      config: this.state.config,
      isRunning: this.isRunning,
      nextRunAt: this.nextRunAt,
      lastRunAt: this.state.lastRunAt,
      overrideCount: overridesList.length,
      overrides: overridesList,
      recentLogs: this.state.logs.slice(0, 20),
    };
  }

  updateConfig(patch: Partial<SyncScheduleConfig>): SyncScheduleConfig {
    const validChapters = Array.isArray(patch.targetChapters)
      ? patch.targetChapters.filter((c): c is ChapterKey =>
          (CHAPTER_KEYS as readonly string[]).includes(c)
        )
      : this.state.config.targetChapters;

    const intervalMinutes =
      typeof patch.intervalMinutes === 'number' && Number.isFinite(patch.intervalMinutes)
        ? Math.min(Math.max(Math.round(patch.intervalMinutes), 15), 43_200)
        : this.state.config.intervalMinutes;

    const batchSize =
      typeof patch.batchSize === 'number' && Number.isFinite(patch.batchSize)
        ? Math.min(Math.max(Math.round(patch.batchSize), 1), 20)
        : this.state.config.batchSize;

    const preferredLanguage =
      patch.preferredLanguage === 'zh-cn' || patch.preferredLanguage === 'en'
        ? patch.preferredLanguage
        : this.state.config.preferredLanguage;

    this.state.config = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : this.state.config.enabled,
      intervalMinutes,
      targetChapters: validChapters.length > 0 ? validChapters : ['get-started'],
      batchSize,
      preferredLanguage,
      updatedAt: new Date().toISOString(),
    };

    this.saveState();
    this.scheduleTimer();
    return this.state.config;
  }

  removeOverride(rawPath: string): boolean {
    const normalized = normalizeEsriDocPath(rawPath);
    if (!normalized || !this.state.overrides[normalized]) return false;
    delete this.state.overrides[normalized];
    this.saveState();
    return true;
  }

  /**
   * Safely fetches an allowlisted official Esri documentation page with timeout,
   * redirect validation, and response size cap.
   */
  private async fetchSafeEsriHtml(
    url: string
  ): Promise<{ ok: boolean; status: number; html?: string; etag?: string; lastModified?: string; error?: string }> {
    if (!isAllowedEsriFetchUrl(url)) {
      return { ok: false, status: 400, error: 'URL rejected by Esri allowlist policy' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'ArcGIS-Pro-Docs-AI-Gateway/1.0 (+https://doc.esri.com)',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
      });

      // Handle 3xx redirects safely only if Location stays inside allowlisted Esri hosts
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return { ok: false, status: response.status, error: 'Empty redirect target' };
        }
        const resolvedRedirect = new URL(location, url).toString();
        if (!isAllowedEsriFetchUrl(resolvedRedirect)) {
          return {
            ok: false,
            status: 403,
            error: 'Redirect blocked because destination is outside Esri documentation hosts',
          };
        }
        const followRes = await fetch(resolvedRedirect, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'ArcGIS-Pro-Docs-AI-Gateway/1.0 (+https://doc.esri.com)',
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          },
        });
        if (!followRes.ok) {
          return { ok: false, status: followRes.status, error: `HTTP ${followRes.status}` };
        }
        const html = await this.readCappedText(followRes);
        return {
          ok: true,
          status: followRes.status,
          html,
          etag: followRes.headers.get('etag') ?? undefined,
          lastModified: followRes.headers.get('last-modified') ?? undefined,
        };
      }

      if (!response.ok) {
        return { ok: false, status: response.status, error: `HTTP ${response.status}` };
      }

      const html = await this.readCappedText(response);
      return {
        ok: true,
        status: response.status,
        html,
        etag: response.headers.get('etag') ?? undefined,
        lastModified: response.headers.get('last-modified') ?? undefined,
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Request timed out (10s)'
            : err.message
          : 'Network error';
      return { ok: false, status: 0, error: msg };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readCappedText(response: Response): Promise<string> {
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_HTML_BYTES) {
      throw new Error('Upstream page exceeds 4 MB safety limit');
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_HTML_BYTES) {
      throw new Error('Upstream page exceeds 4 MB safety limit');
    }
    return text;
  }

  /**
   * Synchronizes a single official ArcGIS Pro documentation page against doc.esri.com.
   */
  async syncSinglePage(
    rawPathOrUrl: string,
    language: 'en' | 'zh-cn' = this.state.config.preferredLanguage
  ): Promise<SyncRunLog> {
    const normalized = normalizeEsriDocPath(rawPathOrUrl);
    const startedAt = new Date().toISOString();

    if (!normalized) {
      throw new Error('請輸入有效的 ArcGIS Pro 官方文件路徑或 https://doc.esri.com/... 網址');
    }

    const targetUrl = buildSafeEsriUrl(normalized, language);
    const sourceEnUrl = buildSafeEsriUrl(normalized, 'en')!;
    if (!targetUrl) {
      throw new Error('網址未通過 Esri 官方網域安全驗證');
    }

    const baseCards = await this.store.readBasePageCards(normalized);
    const existingOverride = this.state.overrides[normalized];
    const previousCards = existingOverride ? existingOverride.cards : baseCards;
    const previousHash = computeCardsContentHash(previousCards);

    const fetched = await this.fetchSafeEsriHtml(targetUrl);
    const finishedAt = new Date().toISOString();

    if (!fetched.ok || !fetched.html) {
      const log: SyncRunLog = {
        id: crypto.randomUUID(),
        trigger: 'manual-page',
        startedAt,
        finishedAt,
        status: fetched.status === 0 ? 'unreachable' : 'error',
        checkedCount: 1,
        updatedCount: 0,
        unchangedCount: 0,
        failedCount: 1,
        targetPaths: [normalized],
        summary: `無法連線至 ${targetUrl}（${fetched.error || '未知錯誤'}），已保留既有離線知識庫資料。`,
        details: [
          {
            path: normalized,
            outcome: 'failed',
            httpStatus: fetched.status || undefined,
            message: fetched.error || 'Fetch failed',
          },
        ],
      };
      this.recordLog(log);
      return log;
    }

    const parsed = parseEsriHtmlToCards({
      html: fetched.html,
      relativePath: normalized,
      sourceUrl: targetUrl,
      sourceEnUrl,
      language,
    });

    const newHash = computeCardsContentHash(parsed.cards);
    const isNew = previousCards.length === 0;
    const hasChanged = isNew || newHash !== previousHash;

    const catalogEntry = this.store.catalogMap.get(normalized);
    const existingZhTitle =
      catalogEntry?.chapter[catalogEntry.chapter.length - 1] || parsed.title;

    const changeStatus: 'updated' | 'added' | 'unchanged' = isNew
      ? 'added'
      : hasChanged
      ? 'updated'
      : 'unchanged';

    if (parsed.cards.length > 0 && (hasChanged || !existingOverride)) {
      this.state.overrides[normalized] = {
        path: normalized,
        sourceUrl: targetUrl,
        sourceEnUrl,
        titleEn: language === 'en' ? parsed.title : catalogEntry?.english.at(-1) || parsed.title,
        titleZh: language === 'zh-cn' ? parsed.title : existingZhTitle,
        contentHash: newHash,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        syncedAt: finishedAt,
        httpStatus: fetched.status,
        cards: parsed.cards,
        previousCardCount: previousCards.length,
        changeStatus,
      };
    }

    const log: SyncRunLog = {
      id: crypto.randomUUID(),
      trigger: 'manual-page',
      startedAt,
      finishedAt,
      status: 'success',
      checkedCount: 1,
      updatedCount: changeStatus === 'unchanged' ? 0 : 1,
      unchangedCount: changeStatus === 'unchanged' ? 1 : 0,
      failedCount: 0,
      targetPaths: [normalized],
      summary:
        changeStatus === 'unchanged'
          ? `已比對 ${normalized}（${parsed.cards.length} 張卡片），內容與既有快取一致。`
          : `已成功同步 ${normalized}，解析 ${parsed.cards.length} 張結構化卡片並即時寫入索引（版本 ${parsed.detectedVersion}）。`,
      details: [
        {
          path: normalized,
          outcome: changeStatus,
          httpStatus: fetched.status,
          message:
            changeStatus === 'unchanged'
              ? `Hash ${newHash} 未變更`
              : `卡片數 ${previousCards.length} → ${parsed.cards.length} (Hash ${newHash})`,
        },
      ],
    };

    this.recordLog(log);
    return log;
  }

  /**
   * Executes an incremental batch sync across configured target chapters.
   */
  async runBatchSync(
    trigger: 'manual-batch' | 'scheduled',
    overrideBatchSize?: number
  ): Promise<SyncRunLog> {
    if (this.isRunning) {
      throw new Error('已有同步作業正在執行中，請稍候完成。');
    }

    this.isRunning = true;
    const startedAt = new Date().toISOString();
    const batchSize = Math.min(
      Math.max(overrideBatchSize ?? this.state.config.batchSize, 1),
      15
    );
    const targetPaths = this.store.selectPagesForBatchSync(
      this.state.config.targetChapters,
      batchSize
    );

    const details: SyncRunLog['details'] = [];
    let updatedCount = 0;
    let unchangedCount = 0;
    let failedCount = 0;

    try {
      for (const relPath of targetPaths) {
        const targetUrl = buildSafeEsriUrl(relPath, this.state.config.preferredLanguage);
        const sourceEnUrl = buildSafeEsriUrl(relPath, 'en');
        if (!targetUrl || !sourceEnUrl) {
          failedCount++;
          details.push({ path: relPath, outcome: 'failed', message: 'Invalid path' });
          continue;
        }

        const baseCards = await this.store.readBasePageCards(relPath);
        const existingOverride = this.state.overrides[relPath];
        const previousCards = existingOverride ? existingOverride.cards : baseCards;
        const previousHash = computeCardsContentHash(previousCards);

        const fetched = await this.fetchSafeEsriHtml(targetUrl);
        if (!fetched.ok || !fetched.html) {
          failedCount++;
          details.push({
            path: relPath,
            outcome: 'failed',
            httpStatus: fetched.status || undefined,
            message: fetched.error || 'Fetch failed',
          });
          continue;
        }

        const parsed = parseEsriHtmlToCards({
          html: fetched.html,
          relativePath: relPath,
          sourceUrl: targetUrl,
          sourceEnUrl,
          language: this.state.config.preferredLanguage,
        });

        const newHash = computeCardsContentHash(parsed.cards);
        const isNew = previousCards.length === 0;
        const hasChanged = isNew || newHash !== previousHash;
        const changeStatus: 'updated' | 'added' | 'unchanged' = isNew
          ? 'added'
          : hasChanged
          ? 'updated'
          : 'unchanged';

        if (parsed.cards.length > 0 && hasChanged) {
          const catalogEntry = this.store.catalogMap.get(relPath);
          this.state.overrides[relPath] = {
            path: relPath,
            sourceUrl: targetUrl,
            sourceEnUrl,
            titleEn:
              this.state.config.preferredLanguage === 'en'
                ? parsed.title
                : catalogEntry?.english.at(-1) || parsed.title,
            titleZh:
              this.state.config.preferredLanguage === 'zh-cn'
                ? parsed.title
                : catalogEntry?.chapter.at(-1) || parsed.title,
            contentHash: newHash,
            etag: fetched.etag,
            lastModified: fetched.lastModified,
            syncedAt: new Date().toISOString(),
            httpStatus: fetched.status,
            cards: parsed.cards,
            previousCardCount: previousCards.length,
            changeStatus,
          };
          updatedCount++;
        } else {
          unchangedCount++;
        }

        details.push({
          path: relPath,
          outcome: changeStatus,
          httpStatus: fetched.status,
          message:
            changeStatus === 'unchanged'
              ? `未變更 (${parsed.cards.length} 張卡片)`
              : `已更新：${previousCards.length} → ${parsed.cards.length} 張卡片`,
        });
      }

      const finishedAt = new Date().toISOString();
      const status: SyncRunLog['status'] =
        failedCount === 0
          ? 'success'
          : failedCount === targetPaths.length
          ? 'unreachable'
          : 'partial';

      const log: SyncRunLog = {
        id: crypto.randomUUID(),
        trigger,
        startedAt,
        finishedAt,
        status,
        checkedCount: targetPaths.length,
        updatedCount,
        unchangedCount,
        failedCount,
        targetPaths,
        summary:
          status === 'unreachable'
            ? `批次檢查 ${targetPaths.length} 頁時無法連線至 doc.esri.com，已維持本機離線索引運作。`
            : `已檢查 ${targetPaths.length} 頁：更新 ${updatedCount} 頁、無異動 ${unchangedCount} 頁、失敗 ${failedCount} 頁。`,
        details,
      };

      this.recordLog(log);
      return log;
    } finally {
      this.isRunning = false;
    }
  }

  private recordLog(log: SyncRunLog): void {
    this.state.lastRunAt = log.finishedAt;
    this.state.logs = [log, ...this.state.logs].slice(0, 50);
    this.saveState();
  }
}
