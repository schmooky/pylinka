/**
 * Interpret a pylinka System's graph into WebGL2 engine parameters. This is the
 * pragmatic v1 runtime path (REQUIREMENTS §5.4 "non-GPU/interpreter preview" +
 * §13.12 WebGL2 fallback): recognised node patterns map to uniforms of a fixed
 * simulation model. Covers the common slot-VFX set — spawn shape, random init
 * velocity + life, gravity, directional wind (knob-driven), drag, colour-over-
 * life, scale-over-life. Unrecognised nodes are ignored (the effect still runs).
 */
import type { EmitterSettings, Literal, Node, ParamDef, System } from '@pylinka/graph';
import { EASE_INDEX } from './shaders.js';

export interface EngineParams {
  capacity: number;
  emitter: EmitterSettings;
  blend: 'normal' | 'add' | 'screen';
  gravity: [number, number];
  drag: number;
  windPower: number;
  windDir: number;
  /** knob names driving the wind (so runtime setKnob can update it), if any. */
  windPowerKnob?: string;
  windDirKnob?: string;
  velMin: [number, number];
  velMax: [number, number];
  lifeMin: number;
  lifeMax: number;
  shape: 0 | 1 | 2;
  shapeRadius: number;
  shapeSize: [number, number];
  colorFrom: [number, number, number, number];
  colorTo: [number, number, number, number];
  colorEase: number;
  sizeFrom: number;
  sizeTo: number;
  sizeEase: number;
}

const f = (l: Literal | undefined, d: number): number => (l?.t === 'f32' ? l.v : d);
const v2 = (l: Literal | undefined, d: [number, number]): [number, number] =>
  l?.t === 'vec2' ? [l.v[0], l.v[1]] : d;

/** '#rrggbbaa' → [r,g,b,a] in 0..1. */
export function parseColor(
  l: Literal | undefined,
  d: [number, number, number, number],
): [number, number, number, number] {
  if (l?.t !== 'color') return d;
  const s = l.v.replace('#', '');
  const h = s.length >= 8 ? s : s.padEnd(8, 'f');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), n(6)];
}

export function extractParams(
  system: System,
  params: ParamDef[],
  knobValues: Record<string, number>,
): EngineParams {
  const g = system.graph;
  const nodes = new Map(g.nodes.map((n) => [n.id, n] as const));
  const paramById = new Map(params.map((pp) => [pp.id, pp] as const));
  const source = (nodeId: string | undefined, portId: string): Node | undefined => {
    if (nodeId === undefined) return undefined;
    const e = g.edges.find((ed) => ed.to.nodeId === nodeId && ed.to.portId === portId);
    return e ? nodes.get(e.from.nodeId) : undefined;
  };
  const byKind = (kind: string) => g.nodes.find((n) => n.kind === kind);

  const p: EngineParams = {
    capacity: system.capacity,
    emitter: system.emitter,
    blend: system.blendMode,
    gravity: [0, 0],
    drag: 0,
    windPower: 0,
    windDir: 0,
    velMin: [-20, -60],
    velMax: [20, -120],
    lifeMin: 1,
    lifeMax: 1.5,
    shape: 0,
    shapeRadius: 40,
    shapeSize: [80, 80],
    colorFrom: [1, 1, 1, 1],
    colorTo: [1, 1, 1, 0],
    colorEase: 0,
    sizeFrom: 8,
    sizeTo: 0,
    sizeEase: 0,
  };

  const shapeNode = source(byKind('output.spawnPosition')?.id, 'pos');
  if (shapeNode?.kind === 'shape.circle') {
    p.shape = 1;
    p.shapeRadius = f(shapeNode.values?.radius, 40);
  } else if (shapeNode?.kind === 'shape.rectangle') {
    p.shape = 2;
    p.shapeSize = v2(shapeNode.values?.size, [80, 80]);
  }

  const velNode = source(byKind('output.initVelocity')?.id, 'vel');
  if (velNode?.kind === 'gen.randomVec2') {
    p.velMin = v2(velNode.values?.min, p.velMin);
    p.velMax = v2(velNode.values?.max, p.velMax);
  }

  const lifeNode = source(byKind('output.initLife')?.id, 'life');
  if (lifeNode?.kind === 'gen.randomRange') {
    p.lifeMin = f(lifeNode.values?.min, 1);
    p.lifeMax = f(lifeNode.values?.max, 1.5);
  } else {
    const lit = byKind('output.initLife')?.values?.life;
    if (lit?.t === 'f32') {
      p.lifeMin = lit.v;
      p.lifeMax = lit.v;
    }
  }

  for (const n of g.nodes) {
    if (n.kind === 'field.gravity') p.gravity = v2(n.values?.g, [0, 300]);
    if (n.kind === 'field.drag') p.drag = f(n.values?.coefficient, 0);
    if (n.kind === 'field.directional') {
      const strengthKnob = resolveKnob(n, 'strength', source, paramById);
      const angleKnob = resolveKnob(n, 'angle', source, paramById);
      if (strengthKnob) {
        p.windPowerKnob = strengthKnob;
        p.windPower = knobValues[strengthKnob] ?? 0;
      } else p.windPower = f(n.values?.strength, 0);
      if (angleKnob) {
        p.windDirKnob = angleKnob;
        p.windDir = knobValues[angleKnob] ?? 0;
      } else p.windDir = f(n.values?.angle, 0);
    }
  }

  const colorNode = byKind('gen.colorOverLife');
  if (colorNode) {
    p.colorFrom = parseColor(colorNode.values?.from, p.colorFrom);
    p.colorTo = parseColor(colorNode.values?.to, p.colorTo);
    p.colorEase = EASE_INDEX[colorNode.structural?.ease ?? 'linear'] ?? 0;
  }

  const scaleNode = byKind('gen.scaleOverLife');
  if (scaleNode) {
    p.sizeFrom = f(scaleNode.values?.from, 1) * 8;
    p.sizeTo = f(scaleNode.values?.to, 0) * 8;
    p.sizeEase = EASE_INDEX[scaleNode.structural?.ease ?? 'linear'] ?? 0;
  }

  return p;
}

/** Resolve the knob NAME driving a port (via param.ref edge or knobBinding). */
function resolveKnob(
  node: Node,
  portId: string,
  source: (nodeId: string | undefined, portId: string) => Node | undefined,
  paramById: Map<string, ParamDef>,
): string | undefined {
  const src = source(node.id, portId);
  if (src?.kind === 'param.ref') {
    const pid = src.structural?.param;
    return pid !== undefined ? paramById.get(pid)?.name : undefined;
  }
  const bound = node.knobBindings?.[portId];
  return bound !== undefined ? paramById.get(bound)?.name : undefined;
}
