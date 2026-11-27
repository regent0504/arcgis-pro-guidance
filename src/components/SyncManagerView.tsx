import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { RefreshCw, Save, Trash2, ExternalLink } from 'lucide-react';
import {
  CHAPTER_KEYS,
  CHAPTER_LABELS,
  type ChapterKey,
  type SyncStatusResponse,
} from '../lib/types';

interface SyncManagerViewProps {
  onStatsChanged?: () => void;
}

const INTERVAL_OPTIONS = [
  { minutes: 60, label: '每 1 小時' },
  { minutes: 360, label: '每 6 小時' },
  { minutes: 1440, label: '每天（24 小時）' },
  { minutes: 10080, label: '每週（7 天）' },
];

export function SyncManagerView({ onStatsChanged }: SyncManagerViewProps) {
  const [statusData, setStatusData] = useState<SyncStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Schedule form state
  const [enabled, setEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(1440);
  const [targetChapters, setTargetChapters] = useState<ChapterKey[]>([
    'get-started',
    'tool-reference',
    'arcpy',
  ]);
  const [batchSize, setBatchSize] = useState(5);
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'zh-cn'>('en');
  const [savingConfig, setSavingConfig] = useState(false);
  const [configNotice, setConfigNotice] = useState<string | null>(null);

  // Single-page sync state
  const [singlePath, setSinglePath] = useState('get-started/get-started.html');
  const [singleLang, setSingleLang] = useState<'en' | 'zh-cn'>('en');
  const [syncingSingle, setSyncingSingle] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Batch sync state
  const [runningBatch, setRunningBatch] = useState(false);

  const loadSyncStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sync/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SyncStatusResponse;
      setStatusData(data);
      setEnabled(data.config.enabled);
      setIntervalMinutes(data.config.intervalMinutes);
      setTargetChapters(data.config.targetChapters);
      setBatchSize(data.config.batchSize);
      setPreferredLanguage(data.config.preferredLanguage);
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法讀取同步狀態');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSyncStatus();
  }, [loadSyncStatus]);

  const toggleChapter = (key: ChapterKey) => {
    setTargetChapters((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev; // Keep at least one chapter selected
        return prev.filter((c) => c !== key);
      }
      return [...prev, key];
    });
  };

  const handleSaveConfig = async (e: FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setConfigNotice(null);
    try {
      const res = await fetch('/api/sync/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          intervalMinutes,
          targetChapters,
          batchSize,
          preferredLanguage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '儲存失敗');
      setStatusData(data.status);
      setConfigNotice('自動同步排程已儲存並即時生效。');
      onStatsChanged?.();
    } catch (err) {
      setConfigNotice(err instanceof Error ? err.message : '儲存失敗');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSinglePageSync = async (e: FormEvent) => {
    e.preventDefault();
    if (!singlePath.trim()) {
      setActionNotice('請輸入官方文件相對路徑或 https://doc.esri.com/... 網址。');
      return;
    }
    setSyncingSingle(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/sync/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: singlePath.trim(), language: singleLang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '單頁同步失敗');
      setStatusData(data.status);
      setActionNotice(data.log?.summary || '單頁同步已完成');
      onStatsChanged?.();
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : '單頁同步失敗');
    } finally {
      setSyncingSingle(false);
    }
  };

  const handleRunBatch = async () => {
    if (runningBatch) return;
    setRunningBatch(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/sync/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '批次同步啟動失敗');
      setStatusData(data.status);
      setActionNotice(data.log?.summary || '批次同步已完成');
      onStatsChanged?.();
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : '批次同步失敗');
    } finally {
      setRunningBatch(false);
    }
  };

  const handleRemoveOverride = async (docPath: string) => {
    try {
      const res = await fetch(`/api/sync/override?path=${encodeURIComponent(docPath)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '移除失敗');
      setStatusData(data.status);
      setActionNotice(`已還原 ${docPath} 為離線基礎版本。`);
      onStatsChanged?.();
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : '還原失敗');
    }
  };

  const statusLabel = (s: string) => {
    if (s === 'success') return '完成';
    if (s === 'partial') return '部分更新';
    if (s === 'unreachable') return '來源未連線';
    return '失敗';
  };

  const statusColor = (s: string) => {
    if (s === 'success') return 'text-emerald-700';
    if (s === 'partial') return 'text-amber-700';
    return 'text-red-700';
  };

  if (loading && !statusData) {
    return (
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {actionNotice && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-slate-800">
          {actionNotice}
        </div>
      )}

      {/* Top Row: Automated Schedule + Instant Single-Page / Batch Triggers */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        {/* Left: Schedule Configuration */}
        <form
          onSubmit={handleSaveConfig}
          className="lg:col-span-7 flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 space-y-5"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">自動化同步排程設定</h2>
                <p className="text-xs text-slate-500">
                  定時對官方 <code className="font-mono">doc.esri.com</code> 進行 SHA-256 內容雜湊比對，偵測到異動時自動更新結構化索引並保留原始基底檔。
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#005E95] focus:ring-[#005E95]"
                />
                啟用自動排程
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
              <div className="sm:col-span-4 space-y-1.5">
                <label htmlFor="sync-interval" className="block text-xs font-medium text-slate-700">
                  同步頻率
                </label>
                <select
                  id="sync-interval"
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#005E95] focus:outline-none"
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.minutes} value={opt.minutes}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3 space-y-1.5">
                <label htmlFor="sync-batch" className="block text-xs font-medium text-slate-700">
                  每次巡檢頁數
                </label>
                <input
                  id="sync-batch"
                  type="number"
                  min={1}
                  max={20}
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-[#005E95] focus:outline-none"
                />
              </div>

              <div className="sm:col-span-5 space-y-1.5">
                <label htmlFor="sync-lang" className="block text-xs font-medium text-slate-700">
                  來源語系優先序
                </label>
                <select
                  id="sync-lang"
                  value={preferredLanguage}
                  onChange={(e) => setPreferredLanguage(e.target.value as 'en' | 'zh-cn')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#005E95] focus:outline-none"
                >
                  <option value="en">英文最新 (en/latest)</option>
                  <option value="zh-cn">官方中文 (zh-cn/latest)</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-medium text-slate-700">監控目標章節</span>
              <div className="flex flex-wrap gap-2">
                {CHAPTER_KEYS.map((key) => {
                  const checked = targetChapters.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleChapter(key)}
                      aria-pressed={checked}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        checked
                          ? 'border-[#005E95] bg-sky-50 text-[#005E95]'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {CHAPTER_LABELS[key].zh} ({key})
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="text-xs text-slate-500 tabular-nums">
              {statusData?.nextRunAt
                ? `下次自動巡檢：${new Date(statusData.nextRunAt).toLocaleString('zh-TW', { hour12: false })}`
                : '自動排程目前為停用狀態'}
            </div>
            <div className="flex items-center gap-3">
              {configNotice && <span className="text-xs text-emerald-700">{configNotice}</span>}
              <button
                type="submit"
                disabled={savingConfig}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#005E95] px-4 py-2 text-xs font-medium text-white hover:bg-[#004a77] disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                {savingConfig ? '儲存中...' : '儲存排程設定'}
              </button>
            </div>
          </div>
        </form>

        {/* Right: Manual Triggers */}
        <div className="lg:col-span-5 flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 space-y-5">
          <form onSubmit={handleSinglePageSync} className="space-y-3">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-900">單頁即時抓取與解析</h2>
              <p className="text-xs text-slate-500">
                貼上官方 <code className="font-mono">doc.esri.com</code> 網址或相對路徑，立即重新解析並覆寫索引。
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="single-sync-path" className="block text-xs font-medium text-slate-700">
                官方頁面路徑或 URL
              </label>
              <input
                id="single-sync-path"
                type="text"
                value={singlePath}
                onChange={(e) => setSinglePath(e.target.value)}
                placeholder="https://doc.esri.com/en/arcgis-pro/latest/get-started/get-started.html"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#005E95] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label="單頁同步語系"
                value={singleLang}
                onChange={(e) => setSingleLang(e.target.value as 'en' | 'zh-cn')}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#005E95] focus:outline-none"
              >
                <option value="en">英文 latest</option>
                <option value="zh-cn">中文 latest</option>
              </select>
              <button
                type="submit"
                disabled={syncingSingle}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${syncingSingle ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {syncingSingle ? '同步解析中...' : '立即抓取此頁'}
              </button>
            </div>
          </form>

          <div className="border-t border-slate-200 pt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">立即執行增量批次巡檢</h3>
                <p className="text-xs text-slate-500">
                  依照上方目標章節檢查最新 {batchSize} 頁版本異動
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRunBatch()}
                disabled={runningBatch || statusData?.isRunning}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${runningBatch ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {runningBatch ? '巡檢中...' : '執行批次巡檢'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Live Synced Overrides Table */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              已同步更新的頁面覆寫層（{statusData?.overrideCount ?? 0} 頁）
            </h2>
            <p className="text-xs text-slate-500">
              這些頁面已即時套用至 /api/page 與 /llms-full.txt 輸出，不影響原始離線備份檔。
            </p>
          </div>
        </div>

        {!statusData || statusData.overrides.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            目前尚無即時覆寫頁面，所有 API 回應皆直接由既有的 16,567 頁離線語料庫提供服務。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-5 py-2.5 font-medium">文件路徑</th>
                  <th className="px-4 py-2.5 font-medium">狀態</th>
                  <th className="px-4 py-2.5 font-medium">卡片變化</th>
                  <th className="px-4 py-2.5 font-medium">雜湊指紋</th>
                  <th className="px-4 py-2.5 font-medium">同步時間</th>
                  <th className="px-5 py-2.5 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statusData.overrides.map((ov) => (
                  <tr key={ov.path} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900">{ov.titleEn}</div>
                      <div className="font-mono text-[11px] text-slate-500">{ov.path}</div>
                    </td>
                    <td className="px-4 py-3 text-emerald-700 font-medium">
                      {ov.changeStatus === 'added' ? '新增頁面' : '已更新'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700 tabular-nums">
                      {ov.previousCardCount} → {ov.cardCount}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">{ov.contentHash}</td>
                    <td className="px-4 py-3 font-mono text-slate-600 tabular-nums">
                      {new Date(ov.syncedAt).toLocaleString('zh-TW', { hour12: false })}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3">
                        <a
                          href={ov.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[#005E95] hover:underline"
                        >
                          來源
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleRemoveOverride(ov.path)}
                          aria-label={`還原 ${ov.path}`}
                          className="inline-flex items-center gap-1 text-slate-500 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          還原
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sync Run History Table */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">同步執行紀錄</h2>
        </div>

        {!statusData || statusData.recentLogs.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            尚無執行紀錄。可點擊上方「立即抓取此頁」或「執行批次巡檢」驗證 Esri 同步管線。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-5 py-2.5 font-medium">執行時間</th>
                  <th className="px-4 py-2.5 font-medium">觸發方式</th>
                  <th className="px-4 py-2.5 font-medium">結果狀態</th>
                  <th className="px-4 py-2.5 font-medium">統計</th>
                  <th className="px-5 py-2.5 font-medium">摘要</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statusData.recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                      {new Date(log.finishedAt).toLocaleString('zh-TW', { hour12: false })}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {log.trigger === 'manual-page'
                        ? '單頁同步'
                        : log.trigger === 'manual-batch'
                        ? '手動批次'
                        : '排程自動'}
                    </td>
                    <td className={`px-4 py-3 font-medium whitespace-nowrap ${statusColor(log.status)}`}>
                      {statusLabel(log.status)}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                      查 {log.checkedCount} / 更 {log.updatedCount} / 敗 {log.failedCount}
                    </td>
                    <td className="px-5 py-3 text-slate-700">{log.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
