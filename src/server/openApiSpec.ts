export function buildOpenApiSpec(baseUrl: string) {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return {
    openapi: '3.1.0',
    info: {
      title: 'ArcGIS Pro Docs AI Gateway API',
      version: '1.0.0',
      description:
        'Structured AI-readable documentation API and llms.txt / llms-full.txt gateway for official Esri ArcGIS Pro documentation with automated incremental syncing.',
    },
    servers: [{ url: cleanBase }],
    paths: {
      '/llms.txt': {
        get: {
          summary: 'Standard llms.txt index for AI tools',
          responses: {
            '200': {
              description: 'Plaintext Markdown index',
              content: { 'text/plain': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/llms-full.txt': {
        get: {
          summary: 'Streaming llms-full.txt Markdown bundle',
          parameters: [
            {
              name: 'chapter',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['get-started', 'help', 'tool-reference', 'arcpy', 'sdk'],
              },
              description: 'Optional chapter filter',
            },
            {
              name: 'q',
              in: 'query',
              schema: { type: 'string' },
              description: 'Optional bilingual keyword filter',
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
              description: 'Maximum pages to stream (default 25; pass limit=all for entire chapter)',
            },
          ],
          responses: {
            '200': {
              description: 'Streaming Markdown documentation bundle',
              content: { 'text/plain': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/api/stats': {
        get: {
          summary: 'Corpus coverage and sync freshness metrics',
          responses: {
            '200': { description: 'Statistics JSON' },
          },
        },
      },
      '/api/chapters': {
        get: {
          summary: 'List top-level chapters and sample pages',
          responses: {
            '200': { description: 'Chapter catalog summary JSON' },
          },
        },
      },
      '/api/search': {
        get: {
          summary: 'Bilingual search across 16,567 ArcGIS Pro documentation pages',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search query (EN/ZH/Error code)' },
            {
              name: 'chapter',
              in: 'query',
              schema: { type: 'string', enum: ['all', 'get-started', 'help', 'tool-reference', 'arcpy', 'sdk'] },
            },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { '200': { description: 'Paginated search results' } },
        },
      },
      '/api/page': {
        get: {
          summary: 'Retrieve structured cards or Markdown for a specific documentation page',
          parameters: [
            {
              name: 'path',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              example: 'tool-reference/analysis/buffer.html',
            },
            {
              name: 'format',
              in: 'query',
              schema: { type: 'string', enum: ['json', 'markdown'], default: 'json' },
            },
          ],
          responses: {
            '200': { description: 'Full structured page payload or Markdown' },
            '404': { description: 'Page not found' },
          },
        },
      },
      '/api/sdk': {
        get: {
          summary: 'Search 29,029 ArcGIS Pro .NET SDK API members',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, example: 'EditOperation Abort' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, maximum: 100 } },
          ],
          responses: { '200': { description: 'Matching SDK members' } },
        },
      },
      '/api/sync/status': {
        get: {
          summary: 'Get automated sync schedule, live overrides, and run history',
          responses: { '200': { description: 'Sync status JSON' } },
        },
      },
      '/api/sync/page': {
        post: {
          summary: 'Live-sync a single official doc.esri.com page and update the index',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['path'],
                  properties: {
                    path: { type: 'string', example: 'get-started/whats-new-in-arcgis-pro.html' },
                    language: { type: 'string', enum: ['en', 'zh-cn'], default: 'en' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Sync execution log' } },
        },
      },
      '/api/sync/run': {
        post: {
          summary: 'Trigger an incremental batch sync against doc.esri.com',
          responses: { '200': { description: 'Batch sync execution log' } },
        },
      },
    },
  };
}
