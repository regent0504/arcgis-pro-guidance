/**
 * Formats and helpers shared by the Cloudflare build script and the Worker.
 * Must stay free of Node.js-only APIs.
 */

/** Entry in the offset index: base corpus shard + byte ranges, and/or a live-sync override. */
export interface OffsetRecord {
  /** R2 key of the JSONL shard holding the page's cards. */
  k?: string;
  /** [byteStart, byteLength] ranges inside the shard. */
  o?: Array<[number, number]>;
  /** R2 key of the live-sync override JSON, which replaces the base cards. */
  ov?: string;
}

const FIELD_SEP = '\t';
const LIST_SEP = '\u001f';

function clean(value: string): string {
  // Tabs, newlines and the list separator would corrupt the row format.
  return value.replace(/[\t\n\r\u001f]/g, ' ');
}

/** Encodes one row; string[] fields are joined with \x1f. */
export function encodeTsvRow(fields: Array<string | string[] | undefined>): string {
  return fields
    .map((f) => (Array.isArray(f) ? f.map(clean).join(LIST_SEP) : clean(f ?? '')))
    .join(FIELD_SEP);
}

/** Splits a TSV blob into rows of fields. */
export function decodeTsvRows(blob: string): string[][] {
  if (!blob) return [];
  return blob.split('\n').map((line) => line.split(FIELD_SEP));
}

export function splitList(field: string | undefined): string[] {
  return field ? field.split(LIST_SEP) : [];
}
