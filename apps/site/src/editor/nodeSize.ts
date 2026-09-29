/**
 * How tall a graph node draws — shared by the node component and the
 * auto-layout, so a layout leaves room for what the node actually shows.
 */
import type { Graph, Node } from '@pylinka/graph';
import { getSchema, V1_CATALOG } from '@pylinka/graph';

export const HEADER_H = 30;
export const ROW_H = 26;
export const STRUCT_H = 30;
export const EASE_H = 56; // taller structural row: the `ease` param draws its curve inline
export const WIDTH = 210;

/** Structural rows are fixed-height except `ease`, which shows a curve plot. */
export const structuralRowH = (key: string) => (key === 'ease' ? EASE_H : STRUCT_H);
export const structuralTotalH = (specs: readonly { key: string }[]) =>
  specs.reduce((a, s) => a + structuralRowH(s.key), 0);

/** The preview a node shows under its ports, if any. */
export type BodyPreview = 'tex' | 'life' | 'spawn' | 'spray' | 'dist' | 'noise' | 'force' | 'motion';

/** Height each preview adds below the ports (canvas + caption + margins). */
export const PREVIEW_H: Record<BodyPreview, number> = {
  tex: 48,
  life: 52,
  spawn: 62,
  spray: 62,
  dist: 62,
  noise: 50,
  // trajectories are usually taller than wide; a strip would flatten them
  force: 110,
  motion: 110,
};

const FIELD_KINDS = new Set(['field.gravity', 'field.directional', 'field.radial', 'field.vortex', 'field.drag']);

export function bodyPreviewOf(node: Node, graph: Graph): BodyPreview | undefined {
  const k = node.kind;
  if (k.startsWith('tex.')) return 'tex';
  if (k === 'gen.spin') return 'life';
  if (k.startsWith('shape.')) return 'spawn';
  if (k === 'gen.randomVec2') return 'spray';
  if (k === 'gen.randomRange' || k === 'gen.random') return 'dist';
  if (k === 'gen.noise' || k === 'gen.frameRandom') return 'noise';
  if (FIELD_KINDS.has(k)) return 'force';
  if (k === 'output.initVelocity') return 'motion';
  if (k === 'output.addForce' || k === 'output.drag') {
    // a force wired from a field node is previewed on that field node instead
    const src = graph.edges.find((e) => e.to.nodeId === node.id);
    const from = src && graph.nodes.find((n) => n.id === src.from.nodeId);
    return from && FIELD_KINDS.has(from.kind) ? undefined : 'force';
  }
  return undefined;
}

/** Drawn height of a node, previews included when they are switched on. */
export function nodeHeight(node: Node, graph: Graph, previews = true): number {
  // a knob draws its own face (header, readout, three range rows, output)
  if (node.kind === 'param.ref') return 180;
  const schema = getSchema(V1_CATALOG, node.kind);
  if (!schema) return 60;
  const body =
    HEADER_H +
    schema.inputs.length * ROW_H +
    structuralTotalH(schema.structural) +
    schema.outputs.length * ROW_H +
    8;
  const p = previews ? bodyPreviewOf(node, graph) : undefined;
  return body + (p ? PREVIEW_H[p] : 0);
}
