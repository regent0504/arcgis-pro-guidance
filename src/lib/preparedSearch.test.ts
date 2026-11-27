import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { searchCatalogEntries, searchSdkMembers } from './corpusSearch';
import { PreparedCatalogIndex, PreparedSdkIndex } from './preparedSearch';
import type { CatalogEntry, SdkMember } from './types';
import { decodeTsvRows, encodeTsvRow, splitList } from '../worker/shared';

const JSONL_DIR = path.join(process.cwd(), 'JSONL 版');
const catalog = JSON.parse(fs.readFileSync(path.join(JSONL_DIR, '目錄.json'), 'utf8')) as CatalogEntry[];
const sdk = fs
  .readFileSync(path.join(JSONL_DIR, 'SDK成員索引.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as SdkMember);

const overrides = new Map([
  ['get-started/get-started.html', { syncedAt: '2026-01-01T00:00:00Z', titleEn: 'Intro', titleZh: '入門' }],
]);

test('PreparedCatalogIndex matches searchCatalogEntries on the real catalog', () => {
  const index = new PreparedCatalogIndex(catalog);
  const cases = [
    { query: 'buffer' },
    { query: '緩衝區', limit: 50 },
    { query: 'spatial join', chapter: 'tool-reference' as const, offset: 2 },
    { query: '', chapter: 'arcpy' as const, limit: 5 },
    { query: '', limit: 30, overridePaths: overrides },
    { query: 'get started', overridePaths: overrides },
    { query: 'xyzzy-no-match' },
  ];
  for (const c of cases) {
    assert.deepEqual(index.search(c), searchCatalogEntries(catalog, c), JSON.stringify(c));
  }
});

test('PreparedSdkIndex matches searchSdkMembers on the real SDK index', () => {
  const index = new PreparedSdkIndex(sdk);
  for (const [q, limit, offset] of [['EditOperation', 10, 0], ['屬性', 25, 5], ['', 25, 100], ['zzzz', 25, 0]] as const) {
    assert.deepEqual(index.search(q, limit, offset), searchSdkMembers(sdk, q, limit, offset), q);
  }
});

test('TSV rows round-trip and strip separators', () => {
  const row = encodeTsvRow(['a\tb', ['x', 'y\nz'], undefined]);
  const [decoded] = decodeTsvRows(row);
  assert.equal(decoded[0], 'a b');
  assert.deepEqual(splitList(decoded[1]), ['x', 'y z']);
  assert.equal(decoded[2], '');
});
