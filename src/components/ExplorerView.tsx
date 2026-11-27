import { useEffect, useState, useCallback } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  CHAPTER_KEYS,
  CHAPTER_LABELS,
  type ChapterKey,
  type PageDetail,
  type SdkMember,
  type SearchResultItem,
} from '../lib/types';

interface ExplorerViewProps {
  initialChapter?: ChapterKey | 'all';
  onStatsChanged?: () => void;
}

type SearchScope = 'docs' | 'sdk';
type InspectorFormat = 'cards' | 'markdown' | 'json';

const QUICK_QUERIES = ['Buffer', '緩衝區', '000732', 'FerrousMinerals', 'Project'];
const QUICK_SDK_QUERIES = ['EditOperation', 'MapView', 'Geodatabase', 'FeatureLayer'];

export function ExplorerView({ initialChapter = 'all', onStatsChanged }: ExplorerViewProps) {
  const [scope, setScope] = useState<SearchScope>('docs');
  const [query, setQuery] = useState('');
  const [chapter, setChapter] = useState<ChapterKey | 'all'>(initialChapter);
  const [offset, setOffset] = useState(0);
  const limit = 20;

  // Docs search state
  const [docTotal, setDocTotal] = useState(0);
  const [docItems, setDocItems] = useState<SearchResultItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // SDK search state
  const [sdkTotal, setSdkTotal] = useState(0);
  const [sdkItems, setSdkItems] = useState<SdkMember[]>([]);

  // Page inspector state
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pageDetail, setPageDetail] = useState<PageDetail | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [inspectorFormat, setInspectorFormat] = useState<InspectorFormat>('cards');

  // Sync / copy feedback
  const [syncingPage, setSyncingPage] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setChapter(initialChapter);
    setOffset(0);
  }, [initialChapter]);

  const fetchResults = useCallback(async () => {
    setSearchLoading(true);
    setSearchError(null);
    try {
      if (scope === 'docs') {
        const params = new URLSearchParams({
          q: query,
          chapter,
          limit: String(limit),
          offset: String(offset),
        });
        const res = await fetch(`/api/search?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setDocTotal(data.total ?? 0);
        setDocItems(data.items ?? []);
        if (!selectedPath && data.items?.length > 0) {
          setSelectedPath(data.items[0].path);
        }
      } else {
        const params = new URLSearchParams({
          q: query,
          limit: String(limit),
          offset: String(offset),
        });
        const res = await fetch(`/api/sdk?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSdkTotal(data.total ?? 0);
        setSdkItems(data.items ?? []);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : '搜尋失敗');
    } finally {
      setSearchLoading(false);
    }
  }, [scope, query, chapter, offset, selectedPath]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchResults();
    }, 150);
    return () => clearTimeout(timer);
  }, [fetchResults]);

  const loadPageDetail = useCallback(async (docPath: string) => {
    setPageLoading(true);
    setPageError(null);
    setSyncMessage(null);
    try {
      const res = await fetch(`/api/page?path=${encodeURIComponent(docPath)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as PageDetail;
      setPageDetail(data);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : '無法讀取頁面詳情');
      setPageDetail(null);
    } finally {
      setPageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (scope === 'docs' && selectedPath) {
      void loadPageDetail(selectedPath);
    }
  }, [scope, selectedPath, loadPageDetail]);

  const handleSyncCurrentPage = async () => {
    if (!selectedPath || syncingPage) return;
    setSyncingPage(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/sync/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath, language: 'en' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '同步失敗');
      }
      setSyncMessage(data.log?.summary || '已完成同步檢查');
      await loadPageDetail(selectedPath);
      onStatsChanged?.();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : '同步失敗');
    } finally {
      setSyncingPage(false);
    }
  };

  const handleCopyPayload = async () => {
    if (!pageDetail) return;
    const text =
      inspectorFormat === 'json'
        ? JSON.stringify(pageDetail, null, 2)
        : pageDetail.markdown;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const totalCount = scope === 'docs' ? docTotal : sdkTotal;
  const pageStart = totalCount === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + limit, totalCount);

  return (
    <div className="space-y-5">
      {/* Search Header Bar */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Scope segmented toggle */}
          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 self-start" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'docs'}
              onClick={() => {
                setScope('docs');
                setOffset(0);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                scope === 'docs'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              文件知識庫 (16,567)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'sdk'}
              onClick={() => {
                setScope('sdk');
                setOffset(0);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                scope === 'sdk'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              .NET SDK 成員索引 (29,029)
            </button>
          </div>

          {/* Search input */}
          <div className="relative flex-1 lg:max-w-xl">
            <label htmlFor="explorer-search-input" className="sr-only">
              搜尋 ArcGIS Pro 文件或 SDK 成員
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="explorer-search-input"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
              placeholder={
                scope === 'docs'
                  ? '輸入中文主題、英文工具名、ArcPy 函式或錯誤碼（例：Buffer、000732）'
                  : '輸入 .NET 類別或成員名稱（例：EditOperation Abort、MapView）'
              }
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#005E95] focus:outline-none focus:ring-2 focus:ring-[#005E95]/15"
            />
          </div>
        </div>

        {/* Chapter filters (Docs mode) & Quick query buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          {scope === 'docs' ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="章節篩選">
              <button
                type="button"
                onClick={() => {
                  setChapter('all');
                  setOffset(0);
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  chapter === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                全部章節
              </button>
              {CHAPTER_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setChapter(key);
                    setOffset(0);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    chapter === key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {CHAPTER_LABELS[key].zh}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              收錄 ArcGIS Pro SDK for .NET 官方 API 成員名稱與精確文件連結
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">快速查詢：</span>
            {(scope === 'docs' ? QUICK_QUERIES : QUICK_SDK_QUERIES).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setQuery(q);
                  setOffset(0);
                }}
                className="font-mono text-xs text-[#005E95] hover:underline whitespace-nowrap shrink-0"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </section>

      {searchError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          查詢發生錯誤：{searchError}
        </div>
      )}

      {/* Main Content Area: Docs Split Pane vs SDK Table */}
      {scope === 'docs' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
          {/* Left: Result List */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-600">
              <span className="tabular-nums">
                {searchLoading
                  ? '檢索中...'
                  : `共 ${docTotal.toLocaleString('en-US')} 筆結果（第 ${pageStart}–${pageEnd} 筆）`}
              </span>
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
                  aria-label="上一頁"
                  className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={offset + limit >= docTotal}
                  onClick={() => setOffset((prev) => prev + limit)}
                  aria-label="下一頁"
                  className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {docItems.length === 0 && !searchLoading ? (
              <div className="p-8 text-center text-sm text-slate-500">
                找不到符合「{query}」的官方文件。建議改用較短的關鍵詞或英文工具名稱。
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
                {docItems.map((item) => {
                  const active = selectedPath === item.path;
                  return (
                    <li key={item.path}>
                      <button
                        type="button"
                        onClick={() => setSelectedPath(item.path)}
                        className={`w-full px-4 py-3 text-left transition-colors ${
                          active
                            ? 'bg-sky-50/80 text-slate-900'
                            : 'bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={`text-sm font-medium truncate ${
                              active ? 'text-[#005E95]' : 'text-slate-900'
                            }`}
                          >
                            {item.titleZh}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400 shrink-0">
                            {item.chapterKey}
                          </span>
                        </div>
                        {item.titleEn !== item.titleZh && (
                          <div className="mt-0.5 text-xs text-slate-600 truncate">
                            {item.titleEn}
                          </div>
                        )}
                        <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-slate-400 truncate">
                          <span className="truncate">{item.path}</span>
                          {item.isLiveOverride && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-sans font-medium text-emerald-700 shrink-0">
                                已即時同步
                              </span>
                            </>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Right: Page Inspector */}
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white overflow-hidden">
            {pageLoading ? (
              <div className="p-8 space-y-3" aria-busy="true">
                <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                <div className="h-28 w-full animate-pulse rounded bg-slate-100" />
                <div className="h-28 w-full animate-pulse rounded bg-slate-100" />
              </div>
            ) : pageError ? (
              <div className="p-8 text-sm text-red-700">載入失敗：{pageError}</div>
            ) : !pageDetail ? (
              <div className="p-10 text-center text-sm text-slate-500">
                請從左側選擇任一 ArcGIS Pro 官方文件頁面以檢視結構化卡片與 AI Markdown 輸出。
              </div>
            ) : (
              <div>
                {/* Inspector Header */}
                <div className="border-b border-slate-200 p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <h2 className="text-lg font-semibold text-slate-900">
                        {pageDetail.titleZh}
                      </h2>
                      {pageDetail.titleEn !== pageDetail.titleZh && (
                        <p className="text-sm text-slate-600">{pageDetail.titleEn}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono">{pageDetail.path}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{pageDetail.cardCount} 張知識卡</span>
                        <span aria-hidden="true">·</span>
                        <span>版本 {pageDetail.contentVersion}</span>
                        {pageDetail.isLiveOverride && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-emerald-700">
                              已即時覆寫
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleSyncCurrentPage}
                        disabled={syncingPage}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${syncingPage ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        {syncingPage ? '同步中...' : '立即同步此頁'}
                      </button>
                      <a
                        href={pageDetail.sourceEnUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        Esri 原文
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    </div>
                  </div>

                  {syncMessage && (
                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700">
                      {syncMessage}
                    </div>
                  )}

                  {/* Format Switcher + Copy */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
                      {(
                        [
                          ['cards', '結構化卡片'],
                          ['markdown', 'Markdown (llms)'],
                          ['json', 'JSON API'],
                        ] as const
                      ).map(([fmt, label]) => (
                        <button
                          key={fmt}
                          type="button"
                          role="tab"
                          aria-selected={inspectorFormat === fmt}
                          onClick={() => setInspectorFormat(fmt)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            inspectorFormat === fmt
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleCopyPayload}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#005E95] hover:underline whitespace-nowrap shrink-0"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                          已複製內容
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          複製 {inspectorFormat === 'json' ? 'JSON' : 'Markdown'}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Inspector Body */}
                <div className="max-h-[560px] overflow-y-auto p-5">
                  {inspectorFormat === 'markdown' ? (
                    <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
                      {pageDetail.markdown}
                    </pre>
                  ) : inspectorFormat === 'json' ? (
                    <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
                      {JSON.stringify(
                        { ...pageDetail, markdown: '[omitted for brevity; use ?format=markdown]' },
                        null,
                        2
                      )}
                    </pre>
                  ) : pageDetail.cards.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-500">
                      此頁面目前僅收錄於目錄索引，尚未解析正文卡片。可點擊上方「立即同步此頁」從 Esri 官方網站即時擷取。
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {pageDetail.cards.map((card) => (
                        <article key={card.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
                          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                            <span className="font-semibold text-slate-900">
                              {card.section || card.topic}
                            </span>
                            <span className="text-slate-500">
                              {card.kind}
                              {card.parameter ? ` · ${card.parameter}` : ''}
                            </span>
                          </div>

                          {card.kind === '程式或語法' && card.text ? (
                            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3.5 font-mono text-xs leading-relaxed text-slate-100">
                              <code>{card.text}</code>
                            </pre>
                          ) : card.kind === '有序步驟' && card.steps ? (
                            <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
                              {card.steps.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          ) : (card.kind === '參數' || card.kind === '表格') &&
                            card.headers &&
                            card.values ? (
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse text-left text-xs">
                                <thead>
                                  <tr className="border-b border-slate-200 text-slate-500">
                                    {card.headers.map((h, i) => (
                                      <th key={i} className="py-1.5 pr-4 font-medium">
                                        {h}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    {card.values.map((v, i) => (
                                      <td
                                        key={i}
                                        className="py-2 pr-4 align-top text-slate-700 leading-relaxed"
                                      >
                                        {v}
                                      </td>
                                    ))}
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          ) : card.kind === '版本參數表' && card.parameters ? (
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse text-left text-xs">
                                <thead>
                                  <tr className="border-b border-slate-200 text-slate-500">
                                    <th className="py-1.5 pr-3 font-medium">參數</th>
                                    <th className="py-1.5 pr-3 font-medium">標籤</th>
                                    <th className="py-1.5 pr-3 font-medium">型別</th>
                                    <th className="py-1.5 font-medium">選填</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {card.parameters.map((p, idx) => (
                                    <tr key={idx}>
                                      <td className="py-1.5 pr-3 font-mono text-slate-900">
                                        {String(p.parameter ?? p.name ?? '')}
                                      </td>
                                      <td className="py-1.5 pr-3 text-slate-700">
                                        {String(p.label_en ?? p.label_zh ?? '')}
                                      </td>
                                      <td className="py-1.5 pr-3 text-slate-600">
                                        {String(p.data_type ?? p.type ?? '')}
                                      </td>
                                      <td className="py-1.5 text-slate-500">
                                        {String(p.optional_label ?? '')}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : card.resource ? (
                            <a
                              href={card.resource}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-sm text-[#005E95] hover:underline"
                            >
                              {card.text || card.resource}
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                          ) : (
                            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                              {card.text}
                            </p>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* SDK Members Table */
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-600">
            <span className="tabular-nums">
              {searchLoading
                ? '檢索 .NET SDK 成員中...'
                : `共 ${sdkTotal.toLocaleString('en-US')} 筆 SDK 成員（第 ${pageStart}–${pageEnd} 筆）`}
            </span>
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
                aria-label="上一頁 SDK 結果"
                className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={offset + limit >= sdkTotal}
                onClick={() => setOffset((prev) => prev + limit)}
                aria-label="下一頁 SDK 結果"
                className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {sdkItems.length === 0 && !searchLoading ? (
            <div className="p-8 text-center text-sm text-slate-500">
              找不到符合「{query}」的 .NET SDK API 成員。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-xs font-medium text-slate-500">
                    <th className="px-4 py-2.5">繁中名稱</th>
                    <th className="px-4 py-2.5">英文 API 符號</th>
                    <th className="px-4 py-2.5 text-right">官方文件</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sdkItems.map((m, idx) => (
                    <tr key={`${m.source}-${idx}`} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-medium text-slate-900">{m.topic}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {(m.english || []).join(' · ')}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <a
                          href={m.source}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#005E95] hover:underline"
                        >
                          開啟官方參考
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
