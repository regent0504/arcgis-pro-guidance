/**
 * Uploads the objects listed in .cloudflare/r2-manifest.json to the R2 bucket, skipping
 * objects whose sha256 matches what was uploaded last time (tracked in R2 at _manifest.json).
 *
 *   npx tsx scripts/upload-r2.ts           # remote bucket (needs CLOUDFLARE_API_TOKEN)
 *   npx tsx scripts/upload-r2.ts --local   # local bucket used by `wrangler dev`
 *
 * Corpus shards and overrides use content-addressed keys, so a new build never overwrites
 * an object the live Worker is still reading.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BUCKET = process.env.R2_BUCKET || 'arcgis-pro-guidance';
const LOCAL = process.argv.includes('--local');
const ROOT = process.cwd();
const OUT = path.join(ROOT, '.cloudflare');
const REMOTE_MANIFEST_KEY = '_manifest.json';

interface ManifestEntry {
  key: string;
  file: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

function wrangler(args: string[], opts: { quiet?: boolean } = {}): string {
  const fullArgs = ['wrangler', 'r2', 'object', ...args, LOCAL ? '--local' : '--remote'];
  return execFileSync('npx', fullArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function readRemoteManifest(): Map<string, string> {
  const tmp = path.join(os.tmpdir(), `r2-manifest-${process.pid}.json`);
  try {
    wrangler(['get', `${BUCKET}/${REMOTE_MANIFEST_KEY}`, '--file', tmp], { quiet: true });
    const parsed = JSON.parse(fs.readFileSync(tmp, 'utf8')) as { objects: ManifestEntry[] };
    return new Map(parsed.objects.map((o) => [o.key, o.sha256]));
  } catch {
    return new Map(); // first upload, or manifest missing
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function main(): void {
  const manifestPath = path.join(OUT, 'r2-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Missing .cloudflare/r2-manifest.json — run `npm run build:cf` first.');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    builtAt: string;
    objects: ManifestEntry[];
  };

  const previous = readRemoteManifest();
  let uploaded = 0;
  let skipped = 0;

  for (const obj of manifest.objects) {
    if (previous.get(obj.key) === obj.sha256) {
      skipped++;
      continue;
    }
    const mib = (obj.bytes / 1024 / 1024).toFixed(1);
    console.log(`[r2] put ${obj.key} (${mib} MiB)`);
    wrangler([
      'put',
      `${BUCKET}/${obj.key}`,
      '--file',
      path.join(OUT, obj.file),
      '--content-type',
      obj.contentType,
    ], { quiet: true });
    uploaded++;
  }

  // Record what is now in the bucket (merging keys from earlier builds that we did not touch).
  const merged = new Map(previous);
  for (const obj of manifest.objects) merged.set(obj.key, obj.sha256);
  const tmp = path.join(os.tmpdir(), `r2-manifest-new-${process.pid}.json`);
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      builtAt: manifest.builtAt,
      objects: Array.from(merged, ([key, sha256]) => ({ key, sha256 })),
    })
  );
  wrangler(['put', `${BUCKET}/${REMOTE_MANIFEST_KEY}`, '--file', tmp, '--content-type', 'application/json'], {
    quiet: true,
  });
  fs.rmSync(tmp, { force: true });

  console.log(`[r2] done: ${uploaded} uploaded, ${skipped} unchanged (${LOCAL ? 'local' : 'remote'} bucket ${BUCKET})`);
}

main();
