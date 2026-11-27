import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSafeEsriUrl,
  extractChapterFromPath,
  isAllowedEsriFetchUrl,
  normalizeEsriDocPath,
} from './urlSafety';

test('normalizeEsriDocPath accepts valid relative paths and official Esri URLs', () => {
  assert.equal(
    normalizeEsriDocPath('get-started/get-started.html'),
    'get-started/get-started.html'
  );
  assert.equal(
    normalizeEsriDocPath('https://doc.esri.com/en/arcgis-pro/latest/tool-reference/analysis/buffer.html#summary'),
    'tool-reference/analysis/buffer.html'
  );
  assert.equal(
    normalizeEsriDocPath('https://pro.arcgis.com/zh-cn/arcgis-pro/3.7/arcpy/spatial-analyst/ferrousminerals.html'),
    'arcpy/spatial-analyst/ferrousminerals.html'
  );
});

test('normalizeEsriDocPath blocks path traversal and non-Esri URLs', () => {
  assert.equal(normalizeEsriDocPath('../etc/passwd'), null);
  assert.equal(normalizeEsriDocPath('get-started/../../secret.html'), null);
  assert.equal(normalizeEsriDocPath('http://doc.esri.com/en/arcgis-pro/latest/get-started/get-started.html'), null);
  assert.equal(normalizeEsriDocPath('https://127.0.0.1/en/arcgis-pro/latest/get-started/get-started.html'), null);
  assert.equal(normalizeEsriDocPath('https://169.254.169.254/latest/meta-data/'), null);
  assert.equal(normalizeEsriDocPath('https://evil.example.com/en/arcgis-pro/latest/get-started/get-started.html'), null);
  assert.equal(normalizeEsriDocPath('javascript:alert(1)'), null);
});

test('isAllowedEsriFetchUrl enforces strict HTTPS allowlist', () => {
  assert.equal(
    isAllowedEsriFetchUrl('https://doc.esri.com/en/arcgis-pro/latest/get-started/get-started.html'),
    true
  );
  assert.equal(
    isAllowedEsriFetchUrl('https://doc.esri.com:8443/en/arcgis-pro/latest/get-started/get-started.html'),
    false
  );
  assert.equal(
    isAllowedEsriFetchUrl('https://localhost/en/arcgis-pro/latest/get-started/get-started.html'),
    false
  );
  assert.equal(
    isAllowedEsriFetchUrl('https://doc.esri.com/en/arcgis-pro/latest/../../admin.html'),
    false
  );
});

test('buildSafeEsriUrl builds canonical URLs and extractChapterFromPath maps chapters', () => {
  assert.equal(
    buildSafeEsriUrl('arcpy/mapping/map-class.html', 'en'),
    'https://doc.esri.com/en/arcgis-pro/latest/arcpy/mapping/map-class.html'
  );
  assert.equal(
    buildSafeEsriUrl('arcpy/mapping/map-class.html', 'zh-cn'),
    'https://doc.esri.com/zh-cn/arcgis-pro/latest/arcpy/mapping/map-class.html'
  );
  assert.equal(extractChapterFromPath('tool-reference/analysis/buffer.html'), 'tool-reference');
  assert.equal(extractChapterFromPath('get-started/get-started.html'), 'get-started');
});
