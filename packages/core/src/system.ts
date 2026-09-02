/**
 * Which system a handle drives.
 *
 * Shared by all three backends and kept in its own module so the interpreted
 * WebGL path does not have to import the WebGPU one to ask the question.
 */
import type { PylinkaProject, System } from '@pylinka/graph';

/**
 * Pick the system a handle drives (same rule as the interpreted backend).
 *
 * `systemId` wins over `systemName` and exists for RE-resolving on a live
 * edit. A handle used to remember only the name it bound to, so renaming an
 * emitter meant the next `apply` could not find it, fell through to "the first
 * enabled system", and silently started rendering a DIFFERENT effect — in the
 * editor, renaming a tab made its preview turn into a second copy of another
 * one. An id survives a rename; a name is what the person edits.
 *
 * A `systemName` that matches nothing still falls back rather than throwing —
 * a game asking for an effect that has been renamed should not go down — but
 * it says so once, because the alternative is playing the wrong effect in
 * silence.
 */
export function pickSystem(
  project: PylinkaProject,
  systemName?: string,
  systemId?: string,
): System | undefined {
  const byId = systemId !== undefined ? project.systems.find((s) => s.id === systemId) : undefined;
  if (byId) return byId;
  const byName = systemName !== undefined ? project.systems.find((s) => s.name === systemName) : undefined;
  if (byName) return byName;
  if (systemName !== undefined && systemId === undefined) warnMissingSystem(project, systemName);
  return project.systems.find((s) => s.enabled) ?? project.systems[0];
}

/** Names already reported, so a per-frame `apply` cannot spam the console. */
const warnedSystems = new Set<string>();

function warnMissingSystem(project: PylinkaProject, systemName: string): void {
  if (warnedSystems.has(systemName)) return;
  warnedSystems.add(systemName);
  const have = project.systems.map((s) => s.name).join(', ');
  console.warn(
    `[pylinka] no system named "${systemName}" — falling back to the first enabled one. This project has: ${have}`,
  );
}
