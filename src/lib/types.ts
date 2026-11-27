export type ChapterKey =
  | 'get-started'
  | 'help'
  | 'tool-reference'
  | 'arcpy'
  | 'sdk';

export const CHAPTER_KEYS: readonly ChapterKey[] = [
  'get-started',
  'help',
  'tool-reference',
  'arcpy',
  'sdk',
] as const;

export const CHAPTER_LABELS: Record<ChapterKey, { zh: string; en: string; description: string }> = {
  'get-started': {
    zh: '入門指南',
    en: 'Get Started',
    description: '安裝、系統需求、授權管理、快速入門與新版本說明',
  },
  help: {
    zh: '應用程式說明',
    en: 'Application Help',
    description: '專案、地圖、圖層、編輯、空間分析、版面配置與共享流程',
  },
  'tool-reference': {
    zh: '地理處理工具參考',
    en: 'Tool Reference',
    description: '全系列 Geoprocessing 工具參數表、環境設定、用法與錯誤碼',
  },
  arcpy: {
    zh: 'ArcPy Python 模組',
    en: 'ArcPy Reference',
    description: 'ArcPy 類別、函式、Spatial Analyst、製圖模組與程式碼範例',
  },
  sdk: {
    zh: 'ArcGIS Pro .NET SDK',
    en: 'ArcGIS Pro SDK',
    description: 'Add-in 開發入口、可擴展性模式與 29,029 筆 .NET API 成員索引',
  },
};

export interface CatalogEntry {
  path: string;
  english: string[];
  chapter: string[];
  included: boolean;
}

export interface DocCard {
  id: string;
  topic: string;
  english: string;
  chapter: string[];
  section: string;
  kind: string;
  source: string;
  source_en: string;
  edition_source?: string;
  content_version?: string;
  source_language?: string;
  text?: string;
  steps?: string[];
  parameter?: string;
  interface?: string;
  headers?: string[];
  values?: string[];
  parameters?: Array<Record<string, unknown>>;
  resource?: string;
  original?: Record<string, unknown>;
  coverage?: string;
}

export interface SdkMember {
  topic: string;
  english: string[];
  kind: string;
  source: string;
  index_source: string;
}

export interface PageDetail {
  path: string;
  chapterKey: ChapterKey;
  titleZh: string;
  titleEn: string;
  breadcrumbsZh: string[];
  breadcrumbsEn: string[];
  sourceUrl: string;
  sourceEnUrl: string;
  contentVersion: string;
  syncedAt?: string;
  isLiveOverride: boolean;
  cardCount: number;
  cards: DocCard[];
  markdown: string;
}

export interface SearchResultItem {
  path: string;
  chapterKey: ChapterKey;
  titleZh: string;
  titleEn: string;
  breadcrumbsZh: string[];
  breadcrumbsEn: string[];
  sourceEnUrl: string;
  score: number;
  matchedFields: string[];
  snippet?: string;
  matchedKinds?: string[];
  isLiveOverride?: boolean;
  syncedAt?: string;
}

export interface CollectionReport {
  official_pages: number;
  indexed_pages: number;
  cards: number;
  by_chapter: Record<string, number>;
  by_type: Record<string, number>;
  by_language: Record<string, number>;
  missing: string[];
  excluded: string[];
  content_pages: number;
  editorial_scope_pages?: string[];
  sdk_member_urls: number;
}

export interface SyncScheduleConfig {
  enabled: boolean;
  intervalMinutes: number;
  targetChapters: ChapterKey[];
  batchSize: number;
  preferredLanguage: 'en' | 'zh-cn';
  updatedAt: string;
}

export interface SyncPageOverride {
  path: string;
  sourceUrl: string;
  sourceEnUrl: string;
  titleEn: string;
  titleZh: string;
  contentHash: string;
  etag?: string;
  lastModified?: string;
  syncedAt: string;
  httpStatus: number;
  cards: DocCard[];
  previousCardCount: number;
  changeStatus: 'updated' | 'added' | 'unchanged';
}

export interface SyncRunLog {
  id: string;
  trigger: 'manual-page' | 'manual-batch' | 'scheduled';
  startedAt: string;
  finishedAt: string;
  status: 'success' | 'partial' | 'unreachable' | 'error';
  checkedCount: number;
  updatedCount: number;
  unchangedCount: number;
  failedCount: number;
  targetPaths: string[];
  summary: string;
  details: Array<{
    path: string;
    outcome: 'updated' | 'added' | 'unchanged' | 'failed';
    httpStatus?: number;
    message: string;
  }>;
}

export interface SyncStatusResponse {
  config: SyncScheduleConfig;
  isRunning: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  overrideCount: number;
  overrides: Array<{
    path: string;
    titleEn: string;
    titleZh: string;
    syncedAt: string;
    cardCount: number;
    previousCardCount: number;
    changeStatus: 'updated' | 'added' | 'unchanged';
    contentHash: string;
    sourceUrl: string;
  }>;
  recentLogs: SyncRunLog[];
}

export interface CorpusStatsResponse {
  report: CollectionReport;
  indexReady: boolean;
  indexedCardPages: number;
  overrideCount: number;
  lastSyncAt: string | null;
  autoSyncEnabled: boolean;
  baseUrl: string;
}
