import type { CatalogEntry, DocCard, PageDetail, SyncPageOverride } from './types';
import { formatPageAsLlmMarkdown } from './markdownFormat';
import { extractChapterFromPath } from './urlSafety';

/**
 * Builds a full PageDetail from catalog metadata, base corpus cards and an optional
 * live-sync override. Pure function shared by the Node server and the Cloudflare Worker.
 * Returns null when nothing is known about the path.
 */
export function buildPageDetail(params: {
  relPath: string;
  catalogEntry?: CatalogEntry;
  baseCards: DocCard[];
  override?: Pick<
    SyncPageOverride,
    'titleEn' | 'titleZh' | 'sourceEnUrl' | 'sourceUrl' | 'syncedAt' | 'cards'
  >;
}): PageDetail | null {
  const { relPath, catalogEntry, override } = params;
  const cards = override ? override.cards : params.baseCards;

  if (!catalogEntry && !override && cards.length === 0) {
    return null;
  }

  const chapterKey = extractChapterFromPath(relPath);
  const titleEn =
    override?.titleEn ||
    catalogEntry?.english[catalogEntry.english.length - 1] ||
    cards[0]?.english ||
    relPath;
  const titleZh =
    override?.titleZh ||
    catalogEntry?.chapter[catalogEntry.chapter.length - 1] ||
    cards[0]?.topic ||
    titleEn;
  const breadcrumbsEn = catalogEntry?.english ?? [chapterKey, titleEn];
  const breadcrumbsZh = catalogEntry?.chapter ?? cards[0]?.chapter ?? [titleZh];
  const sourceEnUrl =
    override?.sourceEnUrl ||
    cards[0]?.source_en ||
    `https://doc.esri.com/en/arcgis-pro/latest/${relPath}`;
  const sourceUrl = override?.sourceUrl || cards[0]?.source || sourceEnUrl;
  const contentVersion = cards[0]?.content_version || (override ? 'live-sync' : '3.7');

  const markdown = formatPageAsLlmMarkdown({
    path: relPath,
    titleZh,
    titleEn,
    breadcrumbsZh,
    breadcrumbsEn,
    sourceUrl,
    sourceEnUrl,
    contentVersion,
    syncedAt: override?.syncedAt,
    cards,
  });

  return {
    path: relPath,
    chapterKey,
    titleZh,
    titleEn,
    breadcrumbsZh,
    breadcrumbsEn,
    sourceUrl,
    sourceEnUrl,
    contentVersion,
    syncedAt: override?.syncedAt,
    isLiveOverride: Boolean(override),
    cardCount: cards.length,
    cards,
    markdown,
  };
}

const FEATURED_PAGE_PATHS = [
  'get-started/get-started.html',
  'get-started/whats-new-in-arcgis-pro.html',
  'get-started/arcgis-pro-system-requirements.html',
  'get-started/release-notes.html',
  'get-started/pro-quickstart-tutorials.html',
  'help/main/welcome-to-the-arcgis-pro-app-help.html',
  'help/projects/what-is-a-project.html',
  'tool-reference/analysis/buffer.html',
  'tool-reference/analysis/clip.html',
  'tool-reference/analysis/spatial-join.html',
  'tool-reference/data-management/project.html',
  'tool-reference/data-management/calculate-field.html',
  'tool-reference/conversion/feature-class-to-feature-class.html',
  'arcpy/get-started/what-is-arcpy-.htm',
  'arcpy/spatial-analyst/ferrousminerals.html',
  'sdk/index.html',
];

/**
 * Curated featured pages across chapters for /llms.txt and UI shortcuts (up to 24).
 */
export function selectFeaturedPages(
  catalog: readonly CatalogEntry[],
  catalogMap: ReadonlyMap<string, CatalogEntry>
): CatalogEntry[] {
  const picked: CatalogEntry[] = [];
  const seen = new Set<string>();

  for (const p of FEATURED_PAGE_PATHS) {
    const found = catalogMap.get(p);
    if (found && !seen.has(found.path)) {
      picked.push(found);
      seen.add(found.path);
    }
  }

  for (const entry of catalog) {
    if (picked.length >= 24) break;
    if (!seen.has(entry.path)) {
      picked.push(entry);
      seen.add(entry.path);
    }
  }

  return picked;
}
