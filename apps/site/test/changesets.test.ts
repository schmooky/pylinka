/**
 * A changeset for an IGNORED package blocks every release.
 *
 * `@pylinka/site` and the example apps are in the changesets `ignore` list —
 * they are private, they are never published, and they have no version to
 * bump. A changeset naming only those packages is therefore never consumed:
 * `changeset version` leaves the file where it is, `.changeset/` never looks
 * empty, and the release action takes the "open a Version Packages PR" branch
 * forever instead of the publish one. The PR it tries to open has no diff, so
 * the job dies on `No commits between main and changeset-release/main` and
 * nothing reaches npm.
 *
 * Three such files sat on main and quietly held two releases back — the git
 * tags and CHANGELOGs said 1.4.0 and 2.0.0 while npm stayed on 1.3.0. Nothing
 * failed loudly enough to notice: every run was a red X on a workflow that
 * "only" opens a PR.
 *
 * Write the note in the PR description instead. A changelog line for a package
 * that has no changelog is not worth a stuck pipeline.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const config = JSON.parse(readFileSync(ROOT + '.changeset/config.json', 'utf8')) as {
  ignore?: string[];
};
const ignored = new Set(config.ignore ?? []);

/** Package names in a changeset's frontmatter. */
function packagesIn(md: string): string[] {
  const front = /^---\n([\s\S]*?)\n---/.exec(md);
  if (front === null) return [];
  return [...front[1]!.matchAll(/^\s*['"]([^'"]+)['"]\s*:/gm)].map((m) => m[1]!);
}

describe('changesets', () => {
  it('never name only ignored packages', () => {
    const dir = ROOT + '.changeset/';
    const stuck: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md') || file === 'README.md') continue;
      const names = packagesIn(readFileSync(dir + file, 'utf8'));
      if (names.length > 0 && names.every((n) => ignored.has(n))) stuck.push(file);
    }
    expect(
      stuck,
      `these changesets name only ignored packages, so they are never consumed and the release job can never reach publish: ${stuck.join(', ')}`,
    ).toEqual([]);
  });
});
