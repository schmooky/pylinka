/**
 * What the interpreted backend can actually run.
 *
 * This backend does not evaluate a graph. It recognises node PATTERNS and
 * drives a fixed set of uniforms from them, which is what makes it small and
 * lets it live-edit without recompiling — and also means a node it does not
 * recognise contributes nothing. Silently: the effect simply comes out wrong,
 * with no error, until you notice and switch to a compiled backend, which does
 * evaluate the graph and implements the whole catalog.
 *
 * This is the list, so an editor can say so on the node instead of leaving
 * someone to work it out. `webgl-support.test.ts` holds it against the source
 * of `params.ts`, so support added there without a line here fails the build.
 */
import type { System } from '@pylinka/graph';

/** Node kinds `extractParams` reads. Everything else is inert here. */
export const INTERPRETED_KINDS: ReadonlySet<string> = new Set([
  'field.directional',
  'field.drag',
  'field.gravity',
  'field.obstacle',
  'field.radial',
  'field.turbulence',
  'field.vortex',
  'gen.alphaOverLife',
  'gen.colorOverLife',
  'gen.curveOverLife',
  'gen.numberOverLife',
  'gen.randomRange',
  'gen.randomVec2',
  'gen.rotationOverLife',
  'gen.scaleOverLife',
  'gen.spin',
  'math.radians',
  'output.collideCircle',
  'output.collidePlane',
  'output.collideRect',
  'output.deathBurst',
  'output.initLife',
  'output.initRotation',
  'output.initVelocity',
  'output.spawnPosition',
  'output.writeAlpha',
  'output.writeRotation',
  'output.writeScale',
  'param.ref',
  'shape.burstRing',
  'shape.circle',
  'shape.point',
  'shape.polygonalChain',
  'shape.rectangle',
  'shape.torus',
]);

/**
 * Kinds that carry no meaning of their own here.
 *
 * `output.addForce`, `output.drag` and `output.writeColor` are not in the set
 * above because this backend reads the FIELD or RAMP node behind them rather
 * than the output itself — the effect still lands, so calling them unsupported
 * would be a lie. `tex.*` is the same: the texture is bound outside the graph.
 */
const CARRIED_BY_THEIR_SOURCE: ReadonlySet<string> = new Set([
  'output.addForce',
  'output.drag',
  'output.writeColor',
  'tex.single',
  'tex.random',
]);

/** Is this node kind understood by the interpreted backend? */
export function isInterpreted(kind: string): boolean {
  return INTERPRETED_KINDS.has(kind) || CARRIED_BY_THEIR_SOURCE.has(kind);
}

/** Every node in `system` this backend will ignore, by id. */
export function unsupportedNodes(system: System): string[] {
  return system.graph.nodes.filter((n) => !isInterpreted(n.kind)).map((n) => n.id);
}
