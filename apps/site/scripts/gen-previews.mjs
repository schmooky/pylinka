/**
 * gen-previews — record each recipe's gallery card (webm + poster jpg).
 *
 * Drives the offline `/capture?slug=<slug>` page with Playwright (headless
 * chromium + SwiftShader WebGL), records the 560×360 viewport to webm and grabs
 * a poster frame, then writes them to `public/recipes/<slug>/`.
 *
 * Usage (from apps/site, with a dev/preview server running):
 *   CAPTURE_BASE=http://localhost:4321 pnpm gen-previews            # only missing
 *   CAPTURE_BASE=... pnpm gen-previews -- --all                     # rebake all
 *   CAPTURE_BASE=... pnpm gen-previews -- spark-jet magic-blast     # specific slugs
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.CAPTURE_BASE || 'http://localhost:4321';
const OUT = 'public/recipes';
const TMP = 'node_modules/.previews-tmp'; // same filesystem as OUT
const W = 560, H = 360;
const RECORD_MS = Number(process.env.RECORD_MS || 4200);
const POSTER_MS = 1600;

const argv = process.argv.slice(2);
const forceAll = argv.includes('--all');
const only = argv.filter((a) => !a.startsWith('--'));

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});

// discover the recipe slugs from the capture page
const probe = await browser.newPage();
await probe.goto(`${BASE}/capture`, { waitUntil: 'load', timeout: 30000 });
const allSlugs = await probe.evaluate(() => window.__slugs || []);
await probe.close();

let slugs = only.length ? only : allSlugs;
if (!forceAll && !only.length) slugs = slugs.filter((s) => !existsSync(join(OUT, s, 'card.webm')));

console.log(`gen-previews: ${slugs.length} recipe(s) at ${BASE}`);
let i = 0;
let failed = 0;
for (const slug of slugs) {
  i++;
  const dir = join(OUT, slug);
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: TMP, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/capture?slug=${encodeURIComponent(slug)}`, { waitUntil: 'load', timeout: 30000 });
    const ready = await page
      .waitForFunction(() => window.__ready === true, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(POSTER_MS);
    await page.screenshot({ path: join(dir, 'card.jpg'), type: 'jpeg', quality: 82 });
    await page.waitForTimeout(Math.max(0, RECORD_MS - POSTER_MS));
    const video = page.video();
    await ctx.close(); // finalizes the webm
    const src = await video.path();
    copyFileSync(src, join(dir, 'card.webm'));
    console.log(`[${i}/${slugs.length}] ${ready ? 'ok' : '??'} ${slug}`);
    if (!ready) failed++;
  } catch (e) {
    await ctx.close().catch(() => {});
    console.log(`[${i}/${slugs.length}] FAIL ${slug}: ${e.message}`);
    failed++;
  }
}
await browser.close();
rmSync(TMP, { recursive: true, force: true });
console.log(`done (${slugs.length - failed}/${slugs.length} ok)`);
