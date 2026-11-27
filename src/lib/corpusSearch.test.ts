import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCatalogEntries, searchSdkMembers, tokenizeQuery } from './corpusSearch';
import type { CatalogEntry, SdkMember } from './types';

const SAMPLE_CATALOG: CatalogEntry[] = [
  {
    path: 'tool-reference/analysis/buffer.html',
    english: ['Tool Reference', 'Analysis toolbox', 'Proximity toolset', 'Buffer'],
    chapter: ['工具參考', '分析工具箱', '鄰域分析工具集', '緩衝區'],
    included: true,
  },
  {
    path: 'tool-reference/tool-errors-and-warnings/000001-001000/tool-errors-and-warnings-00726-00750-000732.html',
    english: ['Tool Reference', 'Tool errors and warnings', '000732: Dataset does not exist'],
    chapter: ['工具參考', '工具錯誤和警告', '000732：資料集不存在'],
    included: true,
  },
  {
    path: 'get-started/get-started.html',
    english: ['Get Started'],
    chapter: ['入門'],
    included: true,
  },
  {
    path: 'arcpy/spatial-analyst/ferrousminerals.html',
    english: ['Python', 'Spatial Analyst module', 'Functions', 'FerrousMinerals'],
    chapter: ['Python', 'Spatial Analyst 模塊', '函數', 'FerrousMinerals'],
    included: true,
  },
];

test('tokenizeQuery splits spaces and punctuation cleanly', () => {
  assert.deepEqual(tokenizeQuery('  Buffer,  analysis  '), ['buffer', 'analysis']);
});

test('searchCatalogEntries ranks exact English, Chinese, and error code matches accurately', () => {
  const enResult = searchCatalogEntries(SAMPLE_CATALOG, { query: 'Buffer' });
  assert.equal(enResult.total, 1);
  assert.equal(enResult.items[0].path, 'tool-reference/analysis/buffer.html');

  const zhResult = searchCatalogEntries(SAMPLE_CATALOG, { query: '緩衝區' });
  assert.equal(zhResult.total, 1);
  assert.equal(zhResult.items[0].titleZh, '緩衝區');

  const errResult = searchCatalogEntries(SAMPLE_CATALOG, { query: '000732' });
  assert.equal(errResult.total, 1);
  assert.match(errResult.items[0].path, /000732/);

  const chapterFiltered = searchCatalogEntries(SAMPLE_CATALOG, {
    query: '',
    chapter: 'arcpy',
  });
  assert.equal(chapterFiltered.total, 1);
  assert.equal(chapterFiltered.items[0].chapterKey, 'arcpy');
});

test('searchSdkMembers matches multi-token .NET API symbols', () => {
  const members: SdkMember[] = [
    {
      topic: 'Abort 方法 (EditOperation)',
      english: ['Abort Method (EditOperation)'],
      kind: 'SDK 成員索引',
      source: 'https://doc.esri.com/en/arcgis-pro/latest/sdk/api-reference/topic9489.html',
      index_source: 'https://doc.esri.com/en/arcgis-pro/latest/sdk/api-reference/webindex.html',
    },
    {
      topic: 'Add 方法 (Map)',
      english: ['Add Method (Map)'],
      kind: 'SDK 成員索引',
      source: 'https://doc.esri.com/en/arcgis-pro/latest/sdk/api-reference/topic100.html',
      index_source: 'https://doc.esri.com/en/arcgis-pro/latest/sdk/api-reference/webindex.html',
    },
  ];

  const res = searchSdkMembers(members, 'EditOperation Abort', 10);
  assert.equal(res.total, 1);
  assert.equal(res.items[0].topic, 'Abort 方法 (EditOperation)');
});
