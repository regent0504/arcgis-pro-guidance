import { useEffect, useState, useCallback } from 'react';
import {
  BookOpen,
  Compass,
  ExternalLink,
  Menu,
  RefreshCw,
  Terminal,
  X,
} from 'lucide-react';
import type { ChapterKey, CorpusStatsResponse } from './lib/types';
import { OverviewView } from './components/OverviewView';
import { ExplorerView } from './components/ExplorerView';
import { ApiPlaygroundView } from './components/ApiPlaygroundView';
import { SyncManagerView } from './components/SyncManagerView';

type TabKey = 'overview' | 'explorer' | 'playground' | 'sync';

const NAV_ITEMS: Array<{ key: TabKey; label: string; subtitle: string }> = [
  { key: 'overview', label: '總覽與 llms.txt', subtitle: 'AI 入口端點與快速串接' },
  { key: 'explorer', label: '文件知識庫檢索', subtitle: '16,567 頁正文與 SDK 索引' },
  { key: 'playground', label: 'API 測試台', subtitle: '結構化查詢與 Markdown 預覽' },
  { key: 'sync', label: '自動同步引擎', subtitle: 'Esri 官方更新比對與排程' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [explorerChapter, setExplorerChapter] = useState<ChapterKey | 'all'>('all');
  const [stats, setStats] = useState<CorpusStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const data = (await res.json()) as CorpusStatsResponse;
      setStats(data);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const handleNavigate = (tab: TabKey, chapter?: ChapterKey) => {
    if (chapter) {
      setExplorerChapter(chapter);
    } else if (tab === 'explorer') {
      setExplorerChapter('all');
    }
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  const currentNav = NAV_ITEMS.find((n) => n.key === activeTab) ?? NAV_ITEMS[0];

  const renderIcon = (key: TabKey) => {
    switch (key) {
      case 'overview':
        return <Compass className="h-4 w-4 shrink-0" aria-hidden="true" />;
      case 'explorer':
        return <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />;
      case 'playground':
        return <Terminal className="h-4 w-4 shrink-0" aria-hidden="true" />;
      case 'sync':
        return <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 bg-white">
        <div className="flex h-16 items-center border-b border-slate-200 px-5">
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              handleNavigate('overview');
            }}
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            ArcGIS Docs AI
          </a>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="主要導覽">
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleNavigate(item.key)}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-sky-50 text-[#005E95]'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {renderIcon(item.key)}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4 space-y-2 text-xs text-slate-500">
          <div className="flex items-center justify-between">
            <span>標準索引入口</span>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[#005E95] hover:underline"
            >
              /llms.txt
            </a>
          </div>
          <div className="flex items-center justify-between">
            <span>OpenAPI 規格</span>
            <a
              href="/api/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[#005E95] hover:underline"
            >
              openapi.json
            </a>
          </div>
          <div className="pt-1 font-mono text-[11px] text-slate-400 tabular-nums">
            {stats
              ? `${stats.report.official_pages.toLocaleString('en-US')} 頁 · ${stats.report.cards.toLocaleString('en-US')} 卡`
              : '載入索引統計中...'}
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="行動版導覽選單">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <span className="text-base font-bold text-slate-900 whitespace-nowrap">
                ArcGIS Docs AI
              </span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="關閉導覽選單"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {NAV_ITEMS.map((item) => {
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleNavigate(item.key)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium ${
                      active
                        ? 'bg-sky-50 text-[#005E95]'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {renderIcon(item.key)}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary action on right */}
        <header className="sticky top-0 z-30 flex h-14 lg:h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 backdrop-blur px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="開啟導覽選單"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="font-medium text-slate-400 hidden sm:inline whitespace-nowrap">
                ArcGIS Docs AI
              </span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-slate-900 truncate">
                {currentNav.label}
              </span>
            </div>
          </div>

          <a
            href="/llms.txt"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#005E95] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#004a77] whitespace-nowrap shrink-0"
          >
            開啟 llms.txt
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {activeTab === 'overview' && (
            <OverviewView stats={stats} loading={statsLoading} onNavigate={handleNavigate} />
          )}
          {activeTab === 'explorer' && (
            <ExplorerView initialChapter={explorerChapter} onStatsChanged={loadStats} />
          )}
          {activeTab === 'playground' && <ApiPlaygroundView />}
          {activeTab === 'sync' && <SyncManagerView onStatsChanged={loadStats} />}
        </main>
      </div>
    </div>
  );
}
