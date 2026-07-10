/**
 * Record every recipe to a looping webm + jpg poster, using headless Chromium to
 * render the live WebGL effect (apps/site /capture page) and Playwright's video
 * recording. Re-encoded/trimmed with ffmpeg.
 *
 *   pnpm --filter @pylinka/site dev            # serve the site (port 5212)
 *   pnpm --filter @pylinka/gen-previews gen     # then run this
 *
 * Output: apps/site/public/recipes/<slug>/card.{webm,jpg}
 */
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../apps/site/public/recipes');
const SITE = process.env.SITE || 'http://localhost:5212';
const W = 560;
const H = 360;
const RECORD_MS = 3600;
const TRIM_START = 1.1;
const TRIM_DUR = 2.4;

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
});

const p0 = await browser.newPage();
await p0.goto(`${SITE}/capture`, { waitUntil: 'load' });
await p0.waitForFunction(() => Array.isArray(window.__slugs), { timeout: 20000 });
const slugs = await p0.evaluate(() => window.__slugs);
await p0.close();
console.log(`recording ${slugs.length} recipes at ${W}x${H}…`);

for (const slug of slugs) {
  const dir = join(OUT, slug);
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`${SITE}/capture?slug=${slug}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(RECORD_MS);
    await page.screenshot({ path: join(dir, 'card.jpg'), type: 'jpeg', quality: 78 }).catch(() => {});
  } catch (e) {
    console.warn('  render failed', slug, String(e));
  }
  await page.close();
  await ctx.close(); // flushes the recorded video

  const raw = readdirSync(dir).find((f) => f.endsWith('.webm') && f !== 'card.webm');
  if (raw) {
    const rawPath = join(dir, raw);
    const outPath = join(dir, 'card.webm');
    try {
      execFileSync(
        'ffmpeg',
        ['-y', '-ss', String(TRIM_START), '-i', rawPath, '-t', String(TRIM_DUR), '-an',
         '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '42', '-row-mt', '1', outPath],
        { stdio: 'ignore' },
      );
      rmSync(rawPath);
    } catch {
      renameSync(rawPath, outPath);
    }
  }
  console.log('  ✓', slug);
}

await browser.close();
console.log('previews written to', OUT);
