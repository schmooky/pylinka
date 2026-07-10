// Record only the slugs passed in SLUGS env (comma-separated) — add previews for
// new recipes without re-encoding the whole gallery. Same output as gen.mjs.
//
//   pnpm --filter @pylinka/site dev                      # serve on :5212
//   SLUGS=firework,coin-pop pnpm --filter @pylinka/gen-previews gen:slugs
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../apps/site/public/recipes');
const SITE = process.env.SITE || 'http://localhost:5212';
const SLUGS = (process.env.SLUGS || '').split(',').map((s) => s.trim()).filter(Boolean);
const W = 560, H = 360, RECORD_MS = 3600, TRIM_START = 1.1, TRIM_DUR = 2.4;

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
});

console.log(`recording ${SLUGS.length} slugs at ${W}x${H}…`);
for (const slug of SLUGS) {
  const dir = join(OUT, slug);
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  try {
    await page.goto(`${SITE}/capture?slug=${slug}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(RECORD_MS);
    await page.screenshot({ path: join(dir, 'card.jpg'), type: 'jpeg', quality: 78 }).catch(() => {});
  } catch (e) {
    console.warn('  render failed', slug, String(e));
  }
  await page.close();
  await ctx.close();

  const raw = readdirSync(dir).find((f) => f.endsWith('.webm') && f !== 'card.webm');
  if (raw) {
    const rawPath = join(dir, raw);
    const outPath = join(dir, 'card.webm');
    try {
      execFileSync('ffmpeg', ['-y', '-ss', String(TRIM_START), '-i', rawPath, '-t', String(TRIM_DUR),
        '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '42', '-row-mt', '1', outPath], { stdio: 'ignore' });
      rmSync(rawPath);
    } catch {
      renameSync(rawPath, outPath);
    }
  }
  console.log('  ✓', slug, errors.length ? `(errors: ${errors.slice(0, 2).join(' | ')})` : '');
}
await browser.close();
console.log('done →', OUT);
