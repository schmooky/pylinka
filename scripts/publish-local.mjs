#!/usr/bin/env node
/**
 * Publish the workspace packages to npm from this machine, with a token.
 *
 *   NPM_TOKEN=npm_xxx pnpm release:local            # build, check, publish
 *   pnpm release:local --dry-run                     # show what would go out
 *
 * CI normally publishes through OIDC trusted publishing (.github/workflows/
 * release.yml). That only works for a package that already exists on npm, so a
 * brand-new package's first version has to go out from here. After that, add
 * the package's Trusted Publisher on npmjs.com and let CI take over.
 *
 * What it does:
 *   1. refuses to run off an up-to-date, clean `main` (pass --any-branch to skip)
 *   2. lists each public package whose local version is not on npm yet
 *   3. pnpm build, typecheck, lint, test (pass --skip-checks to skip)
 *   4. `changeset publish`: pnpm publishes each new version (rewriting
 *      `workspace:` ranges) and creates a git tag per package
 *
 * The token is read from NPM_TOKEN and never written to disk: the temporary
 * npmrc holds the literal `${NPM_TOKEN}` placeholder, which npm expands from
 * the environment at publish time. It is deleted when the script ends.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipChecks = args.has('--skip-checks');
const anyBranch = args.has('--any-branch');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const sh = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();

function run(cmd, cmdArgs, env = process.env) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', env });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} exited with ${r.status}`);
}

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

// ---- 1. git state -----------------------------------------------------------
if (!anyBranch) {
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') fail(`on branch "${branch}"; switch to main (or pass --any-branch).`);
  if (sh('git', ['status', '--porcelain']) !== '')
    fail('the working tree has changes; commit or stash them first.');
  try {
    sh('git', ['fetch', '--quiet', 'origin', 'main']);
  } catch {
    fail('could not fetch origin/main.');
  }
  if (sh('git', ['rev-parse', 'HEAD']) !== sh('git', ['rev-parse', 'origin/main'])) {
    fail('main is not at origin/main; run `git pull` first.');
  }
}

// ---- 2. what is unpublished -----------------------------------------------------
const packages = readdirSync(join(root, 'packages'))
  .map((dir) => join(root, 'packages', dir, 'package.json'))
  .filter((p) => existsSync(p))
  .map((p) => JSON.parse(readFileSync(p, 'utf8')))
  .filter((pkg) => !pkg.private);

const pending = [];
for (const pkg of packages) {
  let published = false;
  try {
    sh('npm', ['view', `${pkg.name}@${pkg.version}`, 'version']);
    published = true;
  } catch {
    // npm view exits non-zero for a version (or package) that does not exist
  }
  console.log(`${published ? '  on npm  ' : '→ publish '} ${pkg.name}@${pkg.version}`);
  if (!published) pending.push(pkg);
}

if (pending.length === 0) {
  console.log('\nNothing to publish: every package version is already on npm.');
  process.exit(0);
}
if (pending.some((p) => p.version === '0.0.0')) {
  fail(
    'a package is still at 0.0.0. Merge the "chore: version packages" PR first, so it gets its real version.',
  );
}
if (dryRun) {
  console.log('\nDry run: nothing was built or published.');
  process.exit(0);
}

// ---- 3. token + checks --------------------------------------------------------
if (!process.env.NPM_TOKEN) {
  fail(
    'set NPM_TOKEN to an npm token with publish rights, e.g. `NPM_TOKEN=npm_xxx pnpm release:local`.',
  );
}
run('pnpm', ['build']);
if (!skipChecks) {
  run('pnpm', ['typecheck']);
  run('pnpm', ['lint']);
  run('pnpm', ['test']);
}

// ---- 4. publish ---------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'pylinka-publish-'));
const npmrc = join(dir, 'npmrc');
// the placeholder, not the token: npm reads it from the environment
writeFileSync(npmrc, '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n', { mode: 0o600 });
try {
  run('pnpm', ['exec', 'changeset', 'publish'], {
    ...process.env,
    // npm reads NPM_CONFIG_*, pnpm reads npm_config_*: set both
    NPM_CONFIG_USERCONFIG: npmrc,
    npm_config_userconfig: npmrc,
    // provenance needs a CI OIDC identity; a laptop has none
    NPM_CONFIG_PROVENANCE: 'false',
    npm_config_provenance: 'false',
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`
✔ Published. Next:
  git push --follow-tags          # the per-package release tags changeset made
  For a package that was new on npm, add its Trusted Publisher on npmjs.com
  (repo schmooky/pylinka, workflow release.yml, environment npm-publish)
  so CI can publish its next versions.`);
