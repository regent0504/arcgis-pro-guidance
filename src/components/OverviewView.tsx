import { useState } from 'react';
import { Check, Copy, ExternalLink, ArrowRight } from 'lucide-react';
import {
  CHAPTER_KEYS,
  CHAPTER_LABELS,
  type ChapterKey,
  type CorpusStatsResponse,
} from '../lib/types';

interface OverviewViewProps {
  stats: CorpusStatsResponse | null;
  loading: boolean;
  onNavigate: (tab: 'overview' | 'explorer' | 'playground' | 'sync', chapter?: ChapterKey) => void;
}

type SnippetMode = 'cursor' | 'curl' | 'python' | 'openapi';

export function OverviewView({ stats, loading, onNavigate }: OverviewViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [snippetMode, setSnippetMode] = useState<SnippetMode>('cursor');

  const origin =
    typeof window !== 'undefined' ? window.location.origin : stats?.baseUrl || 'http://localhost:3000';

  const copyText = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
    } catch {
      // Fallback copy for restricted iframe contexts
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
    }
  };

  const primaryEndpoints = [
    {
      id: 'llms-index',
      name: '標準 AI 文件索引',
      path: '/llms.txt',
      url: `${origin}/llms.txt`,
      format: 'Markdown (llms.txt 規範)',
      purpose: '提供 Cursor、Claude、Windsurf 讀取的完整導覽目錄與 API 說明',
    },
    {
      id: 'llms-full',
      name: '串流全文語料',
      path: '/llms-full.txt?chapter=get-started&limit=25',
      url: `${origin}/llms-full.txt?chapter=get-started&limit=25`,
      format: 'Streaming Markdown',
      purpose: '支援 chapter、q、limit 篩選參數，直接串流輸出結構化文件全文',
    },
    {
      id: 'api-search',
      name: '雙語檢索接口',
      path: '/api/search?q=Buffer&limit=10',
      url: `${origin}/api/search?q=Buffer&limit=10`,
      format: 'JSON',
      purpose: '中英文工具名稱、參數與 ArcGIS 錯誤碼（如 000732）即時搜尋',
    },
    {
      id: 'api-page',
      name: '單頁結構化文件',
      path: '/api/page?path=tool-reference/analysis/buffer.html&format=markdown',
      url: `${origin}/api/page?path=tool-reference/analysis/buffer.html&format=markdown`,
      format: 'JSON / Markdown',
      purpose: '取回指定官方頁面的完整參數表、有序步驟、語法範例與同步狀態',
    },
    {
      id: 'api-openapi',
      name: 'OpenAPI 3.1 規格書',
      path: '/api/openapi.json',
      url: `${origin}/api/openapi.json`,
      format: 'OpenAPI JSON',
      purpose: '直接匯入 ChatGPT Actions、Agent 工具或 MCP 閘道器自動生成工具定義',
    },
  ];

  const snippets: Record<SnippetMode, { title: string; code: string }> = {
    cursor: {
      title: 'Cursor / Windsurf / Claude 規則引用',
      code: `# 在 Cursor (@Docs) 或系統提示詞加入以下入口
Documentation Index: ${origin}/llms.txt
Full Context (ArcPy): ${origin}/llms/arcpy.txt
Tool Lookup API: ${origin}/api/search?q=<keyword>&limit=10
Page Markdown API: ${origin}/api/page?path=<relative-path>&format=markdown`,
    },
    curl: {
      title: 'cURL 快速驗證命令',
      code: `# 1. 取得 llms.txt 標準索引
curl -s "${origin}/llms.txt" | head -n 30

# 2. 搜尋地理處理工具（支援繁體中文、英文與錯誤碼）
curl -s "${origin}/api/search?q=Buffer&chapter=tool-reference&limit=5"

# 3. 取得單頁 AI 專用 Markdown 全文
curl -s "${origin}/api/page?path=tool-reference/analysis/buffer.html&format=markdown"`,
    },
    python: {
      title: 'Python / RAG 管線串接範例',
      code: `import requests

BASE = "${origin}"

# 搜尋相關官方頁面
hits = requests.get(f"{BASE}/api/search", params={"q": "緩衝區", "limit": 3}).json()
top_path = hits["items"][0]["path"]

# 直接取回 LLM 友好的結構化 Markdown 內容
md = requests.get(f"{BASE}/api/page", params={"path": top_path, "format": "markdown"}).text
print(md[:800])`,
    },
    openapi: {
      title: 'Agent / OpenAPI 工具註冊網址',
      code: `OpenAPI 3.1 Schema URL:
${origin}/api/openapi.json

建議流程：
1. 先呼叫 GET /api/search?q=<關鍵字> 確認精確 path
2. 再呼叫 GET /api/page?path=<path>&format=markdown 取得完整參數與範例
3. 開發 .NET Add-in 時呼叫 GET /api/sdk?q=<類別或方法名>`,
    },
  };

  return (
    <div className="space-y-8">
      {/* Hero Summary Band */}
      <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between border-b border-slate-200 pb-6">
        <div className="max-w-2xl space-y-2">
          <p className="text-xs font-medium text-sky-700">
            Esri ArcGIS Pro 官方文件 AI 閘道 · 繁體中文與英文雙語索引
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            將 ArcGIS Pro 說明文件轉化為 AI 工具可直接讀取的結構化 API 與 llms-full.txt
          </h1>
          <p className="text-sm leading-relaxed text-slate-600">
            整合已收錄的完整離線語料庫，提供標準 <code className="font-mono text-slate-800">/llms.txt</code>、可篩選串流的{' '}
            <code className="font-mono text-slate-800">/llms-full.txt</code>、高精準度檢索 REST API，並內建官方頁面差異比對與排程同步引擎。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('explorer')}
            className="inline-flex items-center gap-2 rounded-lg bg-[#005E95] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#004a77] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#005E95] whitespace-nowrap shrink-0"
          >
            探索文件知識庫
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('sync')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 whitespace-nowrap shrink-0"
          >
            管理自動同步
          </button>
        </div>
      </section>

      {/* Corpus Key Metrics Strip (Seamless 1px grid on both 2x2 mobile and 4x1 desktop) */}
      <section
        aria-label="知識庫覆蓋統計"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-4"
      >
        <div className="bg-white p-5">
          <div className="text-xs font-medium text-slate-500">已收錄官方頁面</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {loading ? '—' : (stats?.report.official_pages ?? 0).toLocaleString('en-US')}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            5 大核心章節 · 100% 索引覆蓋
          </div>
        </div>
        <div className="bg-white p-5">
          <div className="text-xs font-medium text-slate-500">結構化知識卡片</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {loading ? '—' : (stats?.report.cards ?? 0).toLocaleString('en-US')}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            含參數表、步驟、語法與錯誤碼
          </div>
        </div>
        <div className="bg-white p-5">
          <div className="text-xs font-medium text-slate-500">.NET SDK API 成員</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {loading ? '—' : (stats?.report.sdk_member_urls ?? 0).toLocaleString('en-US')}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            即時反查類別、方法與屬性連結
          </div>
        </div>
        <div className="bg-white p-5">
          <div className="text-xs font-medium text-slate-500">即時同步狀態</div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {loading ? '—' : (stats?.overrideCount ?? 0).toLocaleString('en-US')}
            </span>
            {!loading && (
              <span className="text-xs font-medium text-slate-500">頁已即時覆寫</span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {stats?.autoSyncEnabled ? '排程已啟用' : '排程已暫停'} ·{' '}
            {stats?.lastSyncAt
              ? `上次同步 ${new Date(stats.lastSyncAt).toLocaleTimeString('zh-TW', { hour12: false })}`
              : '尚未執行連線同步'}
          </div>
        </div>
      </section>

      {/* Primary AI Endpoints Table */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">AI 閱讀入口與 API 端點</h2>
            <p className="text-xs text-slate-500">
              所有公開讀取端點皆已開啟跨來源讀取（CORS），可直接貼入 AI IDE、Agent 或腳本使用。
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('playground')}
            className="text-xs font-medium text-[#005E95] hover:underline whitespace-nowrap shrink-0"
          >
            前往 API 測試台 →
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="px-4 py-3">端點名稱</th>
                <th className="px-4 py-3">路徑</th>
                <th className="px-4 py-3">輸出格式</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {primaryEndpoints.map((ep) => (
                <tr key={ep.id} className="transition-colors hover:bg-slate-50/80">
                  <td className="px-4 py-3.5 align-top">
                    <div className="font-medium text-slate-900">{ep.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{ep.purpose}</div>
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <code
                      title={ep.url}
                      className="block max-w-lg break-all font-mono text-xs text-[#005E95]"
                    >
                      GET {ep.path}
                    </code>
                  </td>
                  <td className="px-4 py-3.5 align-top text-xs text-slate-600 whitespace-nowrap">
                    {ep.format}
                  </td>
                  <td className="px-4 py-3.5 align-top text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyText(ep.id, ep.url)}
                        aria-label={`複製 ${ep.name} 網址`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        {copiedId === ep.id ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                            已複製
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                            複製網址
                          </>
                        )}
                      </button>
                      <a
                        href={ep.path}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`開啟 ${ep.name}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0"
                      >
                        檢視
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Two-Column Split: Chapter Exports + Integration Snippets */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        {/* Chapter llms.txt bundles */}
        <div className="lg:col-span-7 flex flex-col rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">分章節 llms 匯出與涵蓋範圍</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              依需求選擇單一章節的精簡語料，避免超過 LLM 上下文長度上限。
            </p>
          </div>
          <div className="divide-y divide-slate-100 flex-1">
            {CHAPTER_KEYS.map((key) => {
              const meta = CHAPTER_LABELS[key];
              const count = stats?.report.by_chapter[key] ?? 0;
              const chapterUrl = `${origin}/llms/${key}.txt`;
              return (
                <div
                  key={key}
                  className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/70 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <span>{meta.zh}</span>
                      <span className="text-slate-300" aria-hidden="true">
                        /
                      </span>
                      <span className="font-mono text-xs text-slate-500">{key}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 truncate">{meta.description}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-xs font-medium text-slate-700 tabular-nums">
                      {count.toLocaleString('en-US')} 頁
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText(`ch-${key}`, chapterUrl)}
                      aria-label={`複製 ${meta.zh} llms 匯出網址`}
                      className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                    >
                      {copiedId === `ch-${key}` ? '已複製' : '複製 .txt'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('explorer', key)}
                      aria-label={`瀏覽 ${meta.zh}`}
                      className="text-xs font-medium text-[#005E95] hover:underline whitespace-nowrap shrink-0"
                    >
                      瀏覽
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Tool Integration Snippets */}
        <div className="lg:col-span-5 flex flex-col rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5">
            <h2 className="text-base font-semibold text-slate-900">快速串接範例</h2>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
              {(
                [
                  ['cursor', 'Cursor / AI'],
                  ['curl', 'cURL'],
                  ['python', 'Python'],
                  ['openapi', 'OpenAPI'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={snippetMode === mode}
                  onClick={() => setSnippetMode(mode)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    snippetMode === mode
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-between p-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">
                  {snippets[snippetMode].title}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(`snip-${snippetMode}`, snippets[snippetMode].code)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#005E95] hover:underline whitespace-nowrap shrink-0"
                >
                  {copiedId === `snip-${snippetMode}` ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      已複製範例
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      複製程式碼
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
                <code>{snippets[snippetMode].code}</code>
              </pre>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              資料來源涵蓋官方 3.7 繁體化正文、3.8 英文對照參數表，以及透過自動同步引擎即時更新的最新官方頁面。
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
