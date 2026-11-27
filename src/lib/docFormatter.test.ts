import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCardsContentHash,
  formatPageAsLlmMarkdown,
  generateLlmsTxtIndex,
  parseEsriHtmlToCards,
} from './docFormatter';
import type { CollectionReport, DocCard } from './types';

test('formatPageAsLlmMarkdown formats descriptions, steps, parameters, and code cleanly', () => {
  const cards: DocCard[] = [
    {
      id: 'c1',
      topic: '緩衝區',
      english: 'Buffer',
      chapter: ['工具參考', '分析工具箱'],
      section: '匯總',
      kind: '說明',
      source: 'https://doc.esri.com/zh-cn/arcgis-pro/latest/tool-reference/analysis/buffer.html',
      source_en: 'https://doc.esri.com/en/arcgis-pro/latest/tool-reference/analysis/buffer.html',
      text: '在輸入圖徵周圍的指定距離內建立緩衝區多邊形。',
      content_version: '3.7',
    },
    {
      id: 'c2',
      topic: '緩衝區',
      english: 'Buffer',
      chapter: ['工具參考', '分析工具箱'],
      section: '參數',
      kind: '參數',
      source: 'https://doc.esri.com/zh-cn/arcgis-pro/latest/tool-reference/analysis/buffer.html',
      source_en: 'https://doc.esri.com/en/arcgis-pro/latest/tool-reference/analysis/buffer.html',
      parameter: 'in_features',
      headers: ['標注', '說明', '資料類型'],
      values: ['輸入圖徵', '要建立緩衝區的點、線或面圖徵。', 'Feature Layer'],
      content_version: '3.7',
    },
    {
      id: 'c3',
      topic: '緩衝區',
      english: 'Buffer',
      chapter: ['工具參考', '分析工具箱'],
      section: '程式碼範例',
      kind: '程式或語法',
      source: 'https://doc.esri.com/zh-cn/arcgis-pro/latest/tool-reference/analysis/buffer.html',
      source_en: 'https://doc.esri.com/en/arcgis-pro/latest/tool-reference/analysis/buffer.html',
      text: 'import arcpy\narcpy.analysis.Buffer("roads", "roads_buf", "100 Meters")',
      content_version: '3.7',
    },
  ];

  const md = formatPageAsLlmMarkdown({
    path: 'tool-reference/analysis/buffer.html',
    titleZh: '緩衝區',
    titleEn: 'Buffer',
    breadcrumbsZh: ['工具參考', '分析工具箱'],
    breadcrumbsEn: ['Tool Reference', 'Analysis'],
    sourceUrl: cards[0].source,
    sourceEnUrl: cards[0].source_en,
    contentVersion: '3.7',
    cards,
  });

  assert.match(md, /# 緩衝區 \(Buffer\)/);
  assert.match(md, /`in_features`/);
  assert.match(md, /```python/);
  assert.match(md, /arcpy\.analysis\.Buffer/);
});

test('parseEsriHtmlToCards extracts headings, paragraphs, ordered steps, parameters, and code', () => {
  const sampleHtml = `
    <html>
      <head><title>Buffer (Analysis)—ArcGIS Pro | Documentation</title><meta name="version" content="3.8" /></head>
      <body>
        <nav>Ignore nav</nav>
        <main>
          <h1>Buffer (Analysis)</h1>
          <h2>Summary</h2>
          <p>Creates buffer polygons around input features to a specified distance.</p>
          <h2>Workflow</h2>
          <ol>
            <li>Open the Geoprocessing pane.</li>
            <li>Select the Buffer tool and set distance.</li>
          </ol>
          <h2>Parameters</h2>
          <table>
            <thead><tr><th>Parameter</th><th>Explanation</th><th>Data Type</th></tr></thead>
            <tbody><tr><td>in_features</td><td>The input point, line, or polygon features.</td><td>Feature Layer</td></tr></tbody>
          </table>
          <h2>Code sample</h2>
          <pre>import arcpy\narcpy.analysis.Buffer("in.shp", "out.shp", "50 Meters")</pre>
        </main>
      </body>
    </html>
  `;

  const parsed = parseEsriHtmlToCards({
    html: sampleHtml,
    relativePath: 'tool-reference/analysis/buffer.html',
    sourceUrl: 'https://doc.esri.com/en/arcgis-pro/latest/tool-reference/analysis/buffer.html',
    sourceEnUrl: 'https://doc.esri.com/en/arcgis-pro/latest/tool-reference/analysis/buffer.html',
    language: 'en',
  });

  assert.equal(parsed.title, 'Buffer (Analysis)');
  assert.equal(parsed.detectedVersion, '3.8');
  assert.equal(parsed.cards.length, 4);
  assert.equal(parsed.cards[0].kind, '說明');
  assert.equal(parsed.cards[1].kind, '有序步驟');
  assert.equal(parsed.cards[2].kind, '參數');
  assert.equal(parsed.cards[2].parameter, 'in_features');
  assert.equal(parsed.cards[3].kind, '程式或語法');

  const hash1 = computeCardsContentHash(parsed.cards);
  const hash2 = computeCardsContentHash(parsed.cards);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 16);
});

test('generateLlmsTxtIndex includes standard llms.txt sections and chapter links', () => {
  const report: CollectionReport = {
    official_pages: 16567,
    indexed_pages: 16567,
    cards: 173475,
    by_chapter: { 'get-started': 135, help: 4337, 'tool-reference': 11016, arcpy: 1078, sdk: 1 },
    by_type: { '說明': 81980 },
    by_language: { '官方中文轉繁體': 15966 },
    missing: [],
    excluded: [],
    content_pages: 16567,
    sdk_member_urls: 29029,
  };

  const txt = generateLlmsTxtIndex({
    baseUrl: 'https://example.run.app',
    report,
    featuredPages: [
      {
        path: 'get-started/get-started.html',
        english: ['Get Started'],
        chapter: ['入門'],
        included: true,
      },
    ],
    overrideCount: 2,
    lastSyncAt: '2026-11-26T12:00:00Z',
  });

  assert.match(txt, /^# ArcGIS Pro Documentation/);
  assert.match(txt, /https:\/\/example\.run\.app\/llms-full\.txt/);
  assert.match(txt, /https:\/\/example\.run\.app\/llms\/tool-reference\.txt/);
  assert.match(txt, /16,567 pages/);
});
