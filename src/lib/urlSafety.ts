import { CHAPTER_KEYS, type ChapterKey } from './types';

const ALLOWED_ESRI_HOSTS = new Set(['doc.esri.com', 'pro.arcgis.com']);

const SAFE_DOC_PATH_REGEX =
  /^(get-started|help|tool-reference|arcpy|sdk)\/[a-zA-Z0-9._/-]+\.html$/;

/**
 * Validates and normalizes an ArcGIS Pro documentation relative path
 * (e.g. "get-started/get-started.html" or a full Esri URL) into a canonical safe relative path.
 * Prevents path traversal and arbitrary host SSRF.
 */
export function normalizeEsriDocPath(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 400) return null;

  let candidate = trimmed;

  // If caller pasted a full URL, strictly validate host and extract relative path
  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }

    if (parsed.protocol !== 'https:') {
      return null;
    }
    if (!ALLOWED_ESRI_HOSTS.has(parsed.hostname.toLowerCase())) {
      return null;
    }
    if (parsed.username || parsed.password || parsed.port) {
      return null;
    }

    // Match /en/arcgis-pro/latest/<path> or /zh-cn/arcgis-pro/3.7/<path>
    const match = parsed.pathname.match(
      /^\/(?:en|zh-cn|zh-hk|zh-tw)\/arcgis-pro\/(?:latest|\d+\.\d+)\/(.+)$/i
    );
    if (!match) {
      return null;
    }
    candidate = match[1];
  }

  // Strip query string / fragment and leading slashes
  candidate = candidate.split('#')[0].split('?')[0].replace(/^\/+/, '');

  // Reject path traversal, backslashes, null bytes, or double slashes
  if (
    candidate.includes('..') ||
    candidate.includes('\\') ||
    candidate.includes('\0') ||
    candidate.includes('//')
  ) {
    return null;
  }

  if (!SAFE_DOC_PATH_REGEX.test(candidate)) {
    return null;
  }

  return candidate;
}

/**
 * Builds a strictly allowlisted HTTPS Esri documentation URL from a normalized relative path.
 */
export function buildSafeEsriUrl(
  relativePath: string,
  language: 'en' | 'zh-cn' = 'en'
): string | null {
  const normalized = normalizeEsriDocPath(relativePath);
  if (!normalized) return null;
  const langSegment = language === 'zh-cn' ? 'zh-cn' : 'en';
  const url = `https://doc.esri.com/${langSegment}/arcgis-pro/latest/${normalized}`;
  return isAllowedEsriFetchUrl(url) ? url : null;
}

/**
 * Verifies an outbound fetch URL is strictly HTTPS and points to an allowlisted Esri documentation host.
 * Rejects loopback, private IPs, metadata hosts, credentials, non-standard ports, and unexpected paths.
 */
export function isAllowedEsriFetchUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_ESRI_HOSTS.has(host)) return false;
    if (parsed.username || parsed.password || parsed.port) return false;
    if (!/^\/(?:en|zh-cn)\/arcgis-pro\/(?:latest|\d+\.\d+)\/[a-zA-Z0-9._/-]+\.html$/i.test(parsed.pathname)) {
      return false;
    }
    if (parsed.pathname.includes('..')) return false;
    return true;
  } catch {
    return false;
  }
}

export function extractChapterFromPath(relativePath: string): ChapterKey {
  const firstSegment = relativePath.split('/')[0] as ChapterKey;
  if ((CHAPTER_KEYS as readonly string[]).includes(firstSegment)) {
    return firstSegment;
  }
  return 'help';
}

export function extractRelativePathFromSourceUrl(sourceUrl: string): string | null {
  if (!sourceUrl) return null;
  return normalizeEsriDocPath(sourceUrl);
}
