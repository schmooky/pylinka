/**
 * Keeping React Flow's coordinates in step with the store's.
 *
 * React Flow owns the position of every node it renders. The editor also keeps
 * positions — graph nodes in `positions`, annotations on the project — and the
 * two are only rebuilt together when the graph STRUCTURE changes. Anything that
 * moves a node without adding or removing one therefore updated the store while
 * the canvas carried on drawing the old coordinates: undo and redo of a move,
 * but equally an import, a reset, or a re-layout.
 *
 * Rather than remember to handle each of those, the canvas reconciles against
 * the store whenever the store's geometry changes. During a drag React Flow is
 * the one moving things and the store only catches up on drag stop, so the
 * reconcile that follows is a no-op — it can only ever fire for a change the
 * canvas did not make itself.
 */
import type { Node as RFNode } from '@xyflow/react';
import { FRAME_PREFIX, NOTE_PREFIX } from './graphAdapter';
import type { Annotations } from './types';

export interface XY {
  x: number;
  y: number;
}

/**
 * Where the store says each React Flow node belongs. Graph nodes are keyed by
 * bare id, annotations by their prefixed React Flow id.
 */
export function geometryOf(
  positions: Record<string, XY>,
  annotations: Annotations | undefined,
): Map<string, XY> {
  const out = new Map<string, XY>();
  for (const [id, p] of Object.entries(positions)) out.set(id, p);
  for (const f of annotations?.frames ?? []) out.set(FRAME_PREFIX + f.id, { x: f.x, y: f.y });
  for (const n of annotations?.notes ?? []) out.set(NOTE_PREFIX + n.id, { x: n.x, y: n.y });
  return out;
}

/**
 * A cheap value that changes exactly when some node's stored position does.
 * Used as an effect key, so it has to be stable for an unchanged layout and
 * order-independent — `positions` is a plain object whose key order shifts as
 * nodes come and go.
 */
export function geometrySignature(
  positions: Record<string, XY>,
  annotations: Annotations | undefined,
): string {
  const parts: string[] = [];
  for (const [id, p] of geometryOf(positions, annotations)) parts.push(`${id}:${p.x},${p.y}`);
  return parts.sort().join('|');
}

/**
 * React Flow nodes with any stale coordinate corrected. Returns the SAME array
 * when everything already agrees, so an effect can hand the result straight to
 * `setNodes` without causing a render on every unrelated store change.
 *
 * Nodes the store has no opinion about are left alone: a node mid-add has its
 * position written after the graph commit, and dropping it to (0, 0) in that
 * window would make it jump.
 */
export function reconcilePositions<T extends RFNode>(nodes: T[], want: Map<string, XY>): T[] {
  let changed = false;
  const next = nodes.map((n) => {
    const p = want.get(n.id);
    if (p === undefined || (p.x === n.position.x && p.y === n.position.y)) return n;
    changed = true;
    return { ...n, position: { x: p.x, y: p.y } };
  });
  return changed ? next : nodes;
}
