import { useState } from 'react';
import { Check, Copy, Play } from 'lucide-react';

interface EndpointPreset {
  id: string;
  label: string;
  method: 'GET';
  path: string;
  description: string;
  params: Array<{
    key: string;
    label: string;
    defaultValue: string;
    placeholder: string;
  }>;
}

const PRESETS: EndpointPreset[] = [
  {
    id: 'llms-txt',
    label: '/llms.txt',
    method: 'GET',
    path: '/llms.txt',
    description: '標準 AI 文件索引入口（Markdown / text/plain）',
    params: [],
  },
  {
    id: 'llms-full',
    label: '/llms-full.txt',
    method: 'GET',
    path: '/llms-full.txt',
    description: '動態串流輸出 AI 閱讀用的完整文件集合',
    params: [
      { key: 'chapter', label: '章節', defaultValue: 'get-started', placeholder: 'get-started / arcpy / tool-reference' },
      { key: 'q', label: '關鍵字', defaultValue: '', placeholder: '選填：例如 buffer' },
      { key: 'limit', label: '頁數上限', defaultValue: '3', placeholder: '1-500' },
    ],
  },
  {
    id: 'search',
    label: '/api/search',
    method: 'GET',
    path: '/api/search',
    description: '中英文雙語全文檢索（工具名、章節、ArcGIS 錯誤碼）',
    params: [
      { key: 'q', label: '查詢詞 q', defaultValue: 'Buffer', placeholder: 'Buffer / 緩衝區 / 000732' },
      { key: 'chapter', label: '章節', defaultValue: 'all', placeholder: 'all / tool-reference / arcpy' },
      { key: 'limit', label: '筆數', defaultValue: '8', placeholder: '1-100' },
    ],
  },
  {
    id: 'page',
    label: '/api/page',
    method: 'GET',
    path: '/api/page',
    description: '依精確路徑取回單頁結構化卡片或 Markdown',
    params: [
      { key: 'path', label: '文件路徑', defaultValue: 'get-started/get-started.html', placeholder: 'tool-reference/analysis/buffer.html' },
      { key: 'format', label: '輸出格式', defaultValue: 'markdown', placeholder: 'json 或 markdown' },
    ],
  },
  {
    id: 'sdk',
    label: '/api/sdk',
    method: 'GET',
    path: '/api/sdk',
    description: '檢索 29,029 筆 ArcGIS Pro .NET SDK 類別與成員',
    params: [
      { key: 'q', label: '符號名稱', defaultValue: 'EditOperation', placeholder: 'EditOperation Abort' },
      { key: 'limit', label: '筆數', defaultValue: '10', placeholder: '1-100' },
    ],
  },
  {
    id: 'chapters',
    label: '/api/chapters',
    method: 'GET',
    path: '/api/chapters',
    description: '取得 5 大章節統計與代表性範例頁面',
    params: [],
  },
  {
    id: 'openapi',
    label: '/api/openapi.json',
    method: 'GET',
    path: '/api/openapi.json',
    description: '取得完整 OpenAPI 3.1 JSON 規格定義',
    params: [],
  },
];

export function ApiPlaygroundView() {
  const [selectedId, setSelectedId] = useState<string>('search');
  const preset = PRESETS.find((p) => p.id === selectedId) ?? PRESETS[0];

  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>(() => {
    const initial: Record<string, Record<string, string>> = {};
    for (const p of PRESETS) {
      initial[p.id] = {};
      for (const field of p.params) {
        initial[p.id][field.key] = field.defaultValue;
      }
    }
    return initial;
  });

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [contentType, setContentType] = useState<string>('');
  const [responseBody, setResponseBody] = useState<string>('');
  const [byteSize, setByteSize] = useState<number>(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);

  const currentValues = paramValues[preset.id] ?? {};

  const buildRequestPath = () => {
    const qs = new URLSearchParams();
    for (const field of preset.params) {
      const val = (currentValues[field.key] ?? '').trim();
      if (val) qs.set(field.key, val);
    }
    const queryStr = qs.toString();
    return queryStr ? `${preset.path}?${queryStr}` : preset.path;
  };

  const requestPath = buildRequestPath();
  const fullUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${requestPath}` : requestPath;

  const executeRequest = async () => {
    setLoading(true);
    setErrorText(null);
    const start = performance.now();
    try {
      const res = await fetch(requestPath);
      const elapsed = Math.round(performance.now() - start);
      const ct = res.headers.get('content-type') || 'text/plain';
      const rawText = await res.text();
      setStatus(res.status);
      setLatencyMs(elapsed);
      setContentType(ct);
      setByteSize(new Blob([rawText]).size);

      if (ct.includes('application/json')) {
        try {
          setResponseBody(JSON.stringify(JSON.parse(rawText), null, 2));
        } catch {
          setResponseBody(rawText);
        }
      } else {
        setResponseBody(rawText);
      }
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : '請求失敗');
      setStatus(null);
      setLatencyMs(null);
    } finally {
      setLoading(false);
    }
  };

  const copyString = async (text: string, which: 'curl' | 'body') => {
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
    if (which === 'curl') {
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 1800);
    } else {
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 1800);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
      {/* Endpoint Selector */}
      <aside className="lg:col-span-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">可用 API 端點</h2>
          <p className="text-xs text-slate-500">選擇任一接口即可即時送出真實請求</p>
        </div>
        <div className="divide-y divide-slate-100">
          {PRESETS.map((p) => {
            const active = p.id === preset.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`w-full px-4 py-3 text-left transition-colors ${
                  active ? 'bg-sky-50/80' : 'bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-mono text-xs font-semibold ${
                      active ? 'text-[#005E95]' : 'text-slate-900'
                    }`}
                  >
                    {p.label}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">{p.method}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{p.description}</p>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Request Builder & Live Response */}
      <div className="lg:col-span-8 space-y-5">
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-mono text-base font-semibold text-slate-900">
                {preset.method} {preset.path}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">{preset.description}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => copyString(`curl -s "${fullUrl}"`, 'curl')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                {copiedCurl ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    已複製 cURL
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    複製 cURL
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => void executeRequest()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#005E95] px-4 py-2 text-xs font-medium text-white hover:bg-[#004a77] disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                {loading ? '請求中...' : '發送請求'}
              </button>
            </div>
          </div>

          {preset.params.length > 0 && (
            <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
              {preset.params.map((field) => (
                <div key={field.key} className="space-y-1">
                  <label
                    htmlFor={`param-${preset.id}-${field.key}`}
                    className="block text-xs font-medium text-slate-700"
                  >
                    {field.label}
                  </label>
                  <input
                    id={`param-${preset.id}-${field.key}`}
                    type="text"
                    value={currentValues[field.key] ?? ''}
                    placeholder={field.placeholder}
                    onChange={(e) =>
                      setParamValues((prev) => ({
                        ...prev,
                        [preset.id]: {
                          ...(prev[preset.id] ?? {}),
                          [field.key]: e.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#005E95] focus:outline-none focus:ring-2 focus:ring-[#005E95]/15"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 break-all">
            {fullUrl}
          </div>
        </section>

        {/* Response Output */}
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-slate-600 tabular-nums">
              <span className="font-semibold text-slate-900">回應內容</span>
              {status !== null && (
                <>
                  <span
                    className={`font-mono font-semibold ${
                      status >= 200 && status < 300 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    HTTP {status}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{latencyMs} ms</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{(byteSize / 1024).toFixed(1)} KB</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-500">{contentType.split(';')[0]}</span>
                </>
              )}
            </div>
            {responseBody && (
              <button
                type="button"
                onClick={() => copyString(responseBody, 'body')}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#005E95] hover:underline whitespace-nowrap shrink-0"
              >
                {copiedBody ? '已複製回應' : '複製回應'}
              </button>
            )}
          </div>

          {errorText ? (
            <div className="p-5 text-sm text-red-700">請求錯誤：{errorText}</div>
          ) : responseBody ? (
            <pre className="max-h-[520px] overflow-auto bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
              {responseBody}
            </pre>
          ) : (
            <div className="p-10 text-center text-sm text-slate-500">
              點擊「發送請求」即可即時呼叫本服務 API 並檢視原始回應。
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
