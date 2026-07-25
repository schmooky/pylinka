/**
 * v1 node catalog schemas (REQUIREMENTS.md §16). Ports / defaults / structural /
 * impact / eval-time / rng-class only — codegen bodies are stubbed here and land
 * with the compiler milestone (task C4). See docs/QUESTIONS.md for the three
 * spec ambiguities resolved during authoring (param.ref output type, math.*
 * polymorphism, dynamic structural references).
 *
 * M2-only nodes (curl, curlField, drawnVectorField, drawnArea, math.expression,
 * tex.ordered/animated) are intentionally absent. field.vortex was promoted to
 * v1 on owner request; field.turbulence, field.obstacle and the output.collide*
 * family were added after v1 froze (see docs/QUESTIONS.md).
 */
import type { Literal, NodeCodegen, NodeSchema, PortSpec } from '../types.js';

/** Placeholder emitted until the compiler package fills in real codegen (C4). */
const TODO_CODEGEN: NodeCodegen = () => {
  throw new Error('codegen not implemented yet (M1.2 / task C4)');
};

// ---- literal helpers (defaults for input ports) --------------------------
const f = (v: number): Literal => ({ t: 'f32', v });
const v2 = (x: number, y: number): Literal => ({ t: 'vec2', v: [x, y] });
const col = (v: string): Literal => ({ t: 'color', v });
const boolean = (v: boolean): Literal => ({ t: 'bool', v });

const inPort = (id: string, type: PortSpec['type'], defaultValue: Literal): PortSpec => ({
  id,
  type,
  defaultValue,
});
const outPort = (id: string, type: PortSpec['type']): PortSpec => ({ id, type });

/** Build a schema with sensible defaults for the boilerplate fields. */
function schema(s: Omit<NodeSchema, 'codegen' | 'structural'> & Partial<Pick<NodeSchema, 'structural' | 'codegen'>>): NodeSchema {
  return {
    structural: [],
    codegen: TODO_CODEGEN,
    ...s,
  };
}

/**
 * Frame of reference for the position-like ports of the interaction nodes.
 * 'world' = absolute px (the default, and what a cursor knob wants).
 * 'emitter' = offsets from the emitter, so geometry follows a moving emitter
 * and an effect stays portable between canvas sizes.
 */
const SPACE_OPTIONS = ['world', 'emitter'];

// The GSAP-named ease set (§13.9), shared by every structural `ease` param.
const EASE_OPTIONS = [
  'linear',
  'power1.in',
  'power1.out',
  'power1.inOut',
  'power2.in',
  'power2.out',
  'power2.inOut',
  'power3.in',
  'power3.out',
  'sine.in',
  'sine.out',
  'sine.inOut',
  'expo.out',
  'back.out',
];

// ===========================================================================
// input.* — pure sources (no inputs)
// ===========================================================================
const inputs: NodeSchema[] = [
  schema({ kind: 'input.position', label: 'Position', namespace: 'input', evalTime: 'both', impact: 'low', inputs: [], outputs: [outPort('out', 'vec2')] }),
  schema({ kind: 'input.velocity', label: 'Velocity', namespace: 'input', evalTime: 'both', impact: 'low', inputs: [], outputs: [outPort('out', 'vec2')] }),
  schema({ kind: 'input.age', label: 'Age', namespace: 'input', evalTime: 'update', impact: 'low', inputs: [], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'input.ageNormalized', label: 'Age (normalized)', namespace: 'input', evalTime: 'update', impact: 'low', inputs: [], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'input.life', label: 'Life', namespace: 'input', evalTime: 'both', impact: 'low', inputs: [], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'input.time', label: 'Time', namespace: 'input', evalTime: 'update', impact: 'low', inputs: [], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'input.frame', label: 'Frame', namespace: 'input', evalTime: 'update', impact: 'low', inputs: [], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'input.spawnIndex', label: 'Spawn index', namespace: 'input', evalTime: 'init', impact: 'low', inputs: [], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'input.emitterPosition', label: 'Emitter position', namespace: 'input', evalTime: 'both', impact: 'low', inputs: [], outputs: [outPort('out', 'vec2')] }),
  schema({ kind: 'input.emitterVelocity', label: 'Emitter velocity', namespace: 'input', evalTime: 'both', impact: 'low', inputs: [], outputs: [outPort('out', 'vec2')] }),
];

// ===========================================================================
// param.* — knob reads (structural = which knob; see QUESTIONS.md)
// ===========================================================================
const params: NodeSchema[] = [
  schema({
    kind: 'param.ref',
    label: 'Param',
    namespace: 'param',
    evalTime: 'both',
    impact: 'low',
    inputs: [],
    outputs: [outPort('out', 'f32')],
    structural: [{ key: 'param', options: [], default: '' }],
  }),
];

// ===========================================================================
// gen.* — generators
// ===========================================================================
const gens: NodeSchema[] = [
  schema({ kind: 'gen.random', label: 'Random', namespace: 'gen', evalTime: 'inferred', impact: 'low', rngClass: 'stable', inputs: [], outputs: [outPort('out', 'f32')] }),
  schema({
    kind: 'gen.randomRange',
    label: 'Random range',
    namespace: 'gen',
    evalTime: 'inferred',
    impact: 'low',
    rngClass: 'stable',
    inputs: [inPort('min', 'f32', f(0)), inPort('max', 'f32', f(1))],
    outputs: [outPort('out', 'f32')],
  }),
  schema({
    kind: 'gen.randomVec2',
    label: 'Random vec2',
    namespace: 'gen',
    evalTime: 'inferred',
    impact: 'low',
    rngClass: 'stable',
    inputs: [inPort('min', 'vec2', v2(0, 0)), inPort('max', 'vec2', v2(1, 1))],
    outputs: [outPort('out', 'vec2')],
  }),
  schema({ kind: 'gen.frameRandom', label: 'Frame random', namespace: 'gen', evalTime: 'update', impact: 'low', rngClass: 'frame', inputs: [], outputs: [outPort('out', 'f32')] }),
  schema({
    kind: 'gen.curveOverLife',
    label: 'Curve over life',
    namespace: 'gen',
    evalTime: 'update',
    impact: 'low',
    inputs: [inPort('from', 'f32', f(0)), inPort('to', 'f32', f(1))],
    outputs: [outPort('out', 'f32')],
    structural: [{ key: 'ease', options: EASE_OPTIONS, default: 'linear' }],
  }),
  schema({
    kind: 'gen.colorOverLife',
    label: 'Color over life',
    namespace: 'gen',
    evalTime: 'update',
    impact: 'low',
    inputs: [inPort('from', 'color', col('#ffffffff')), inPort('to', 'color', col('#ffffff00'))],
    outputs: [outPort('out', 'color')],
    structural: [{ key: 'ease', options: EASE_OPTIONS, default: 'linear' }],
  }),
  schema({
    kind: 'gen.scaleOverLife',
    label: 'Scale over life',
    namespace: 'gen',
    evalTime: 'update',
    impact: 'low',
    inputs: [inPort('from', 'f32', f(1)), inPort('to', 'f32', f(0))],
    outputs: [outPort('out', 'f32')],
    structural: [{ key: 'ease', options: EASE_OPTIONS, default: 'linear' }],
  }),
  schema({
    kind: 'gen.ease',
    label: 'Ease',
    namespace: 'gen',
    evalTime: 'inferred',
    impact: 'low',
    inputs: [inPort('t', 'f32', f(0))],
    outputs: [outPort('out', 'f32')],
    structural: [{ key: 'ease', options: EASE_OPTIONS, default: 'power2.out' }],
  }),
  schema({
    kind: 'gen.noise',
    label: 'Noise',
    namespace: 'gen',
    evalTime: 'both',
    impact: 'medium',
    impactNote: 'Value noise costs several ALU ops per sample; heavy at high particle counts on low-tier devices.',
    inputs: [inPort('scale', 'f32', f(1)), inPort('speed', 'f32', f(1))],
    outputs: [outPort('out', 'f32')],
  }),
];

// ===========================================================================
// math.* — see QUESTIONS.md re: polymorphism (v1 = scalar arithmetic + vec helpers)
// ===========================================================================
const maths: NodeSchema[] = [
  schema({ kind: 'math.add', label: 'Add', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('a', 'f32', f(0)), inPort('b', 'f32', f(0))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.sub', label: 'Subtract', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('a', 'f32', f(0)), inPort('b', 'f32', f(0))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.mul', label: 'Multiply', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('a', 'f32', f(1)), inPort('b', 'f32', f(1))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.div', label: 'Divide', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('a', 'f32', f(1)), inPort('b', 'f32', f(1))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.mad', label: 'Multiply-add', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('a', 'f32', f(1)), inPort('b', 'f32', f(1)), inPort('c', 'f32', f(0))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.mix', label: 'Mix', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('a', 'f32', f(0)), inPort('b', 'f32', f(1)), inPort('t', 'f32', f(0.5))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.clamp', label: 'Clamp', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('x', 'f32', f(0)), inPort('min', 'f32', f(0)), inPort('max', 'f32', f(1))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.min', label: 'Min', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('a', 'f32', f(0)), inPort('b', 'f32', f(0))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.max', label: 'Max', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('a', 'f32', f(0)), inPort('b', 'f32', f(0))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.sin', label: 'Sin', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('x', 'f32', f(0))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.cos', label: 'Cos', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('x', 'f32', f(0))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.abs', label: 'Abs', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('x', 'f32', f(0))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.length', label: 'Length', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('v', 'vec2', v2(0, 0))], outputs: [outPort('out', 'f32')] }),
  schema({ kind: 'math.normalize', label: 'Normalize', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('v', 'vec2', v2(0, 0))], outputs: [outPort('out', 'vec2')] }),
  schema({ kind: 'math.rotate2d', label: 'Rotate 2D', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('v', 'vec2', v2(1, 0)), inPort('angle', 'f32', f(0))], outputs: [outPort('out', 'vec2')] }),
  schema({ kind: 'math.splat', label: 'Splat', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('x', 'f32', f(0))], outputs: [outPort('out', 'vec2')] }),
  schema({ kind: 'math.makeVec2', label: 'Make vec2', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('x', 'f32', f(0)), inPort('y', 'f32', f(0))], outputs: [outPort('out', 'vec2')] }),
  schema({ kind: 'math.makeVec4', label: 'Make vec4', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('x', 'f32', f(0)), inPort('y', 'f32', f(0)), inPort('z', 'f32', f(0)), inPort('w', 'f32', f(0))], outputs: [outPort('out', 'vec4')] }),
  schema({ kind: 'math.component', label: 'Component', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('v', 'vec2', v2(0, 0))], outputs: [outPort('out', 'f32')], structural: [{ key: 'index', options: ['x', 'y'], default: 'x' }] }),
  schema({ kind: 'math.swizzle', label: 'Swizzle', namespace: 'math', evalTime: 'inferred', impact: 'low', inputs: [inPort('v', 'vec2', v2(0, 0))], outputs: [outPort('out', 'vec2')], structural: [{ key: 'pattern', options: ['xy', 'yx', 'xx', 'yy'], default: 'xy' }] }),
];

// ===========================================================================
// field.* — analytic force generators (M2-only fields omitted)
// ===========================================================================
const fields: NodeSchema[] = [
  schema({ kind: 'field.gravity', label: 'Gravity', namespace: 'field', evalTime: 'update', impact: 'low', inputs: [inPort('g', 'vec2', v2(0, 300))], outputs: [outPort('force', 'vec2')] }),
  schema({ kind: 'field.directional', label: 'Directional (wind)', namespace: 'field', evalTime: 'update', impact: 'low', inputs: [inPort('strength', 'f32', f(0)), inPort('angle', 'f32', f(0))], outputs: [outPort('force', 'vec2')] }),
  schema({ kind: 'field.radial', label: 'Radial', namespace: 'field', evalTime: 'update', impact: 'low', inputs: [inPort('center', 'vec2', v2(0, 0)), inPort('strength', 'f32', f(0))], outputs: [outPort('force', 'vec2')] }),
  schema({ kind: 'field.drag', label: 'Drag', namespace: 'field', evalTime: 'update', impact: 'low', inputs: [inPort('coefficient', 'f32', f(1))], outputs: [outPort('drag', 'f32')] }),
  // promoted from M2 (2026-07-11, owner request): swirl around emitter+center;
  // strength = tangential px/s² (sign = direction), pull = inward suction,
  // radius = linear falloff distance (0 = global)
  schema({ kind: 'field.vortex', label: 'Vortex', namespace: 'field', evalTime: 'update', impact: 'medium', inputs: [inPort('center', 'vec2', v2(0, 0)), inPort('strength', 'f32', f(300)), inPort('pull', 'f32', f(0)), inPort('radius', 'f32', f(240))], outputs: [outPort('force', 'vec2')] }),
  // curl of animated value noise (divergence-free swirls); scale = noise cell px
  schema({ kind: 'field.turbulence', label: 'Turbulence', namespace: 'field', evalTime: 'update', impact: 'medium', inputs: [inPort('strength', 'f32', f(200)), inPort('scale', 'f32', f(120)), inPort('speed', 'f32', f(1))], outputs: [outPort('force', 'vec2')] }),
  // A moving body that shoves the field aside. `center`/`velocity` are ABSOLUTE
  // world (like field.radial, unlike field.vortex) so they can be bound to live
  // vec2 knobs — a cursor, or an object flying through the field. `carry` drags
  // particles toward the body's own velocity, which is what makes a bow wave and
  // a wake read as motion rather than as a static push.
  schema({
    kind: 'field.obstacle',
    label: 'Obstacle (push)',
    namespace: 'field',
    evalTime: 'update',
    impact: 'low',
    inputs: [
      inPort('center', 'vec2', v2(0, 0)),
      inPort('velocity', 'vec2', v2(0, 0)),
      inPort('radius', 'f32', f(140)),
      inPort('strength', 'f32', f(2400)),
      inPort('softness', 'f32', f(0.5)),
      inPort('swirl', 'f32', f(0)),
      inPort('carry', 'f32', f(0)),
    ],
    outputs: [outPort('force', 'vec2')],
    structural: [{ key: 'space', options: SPACE_OPTIONS, default: 'world' }],
  }),
];

// ===========================================================================
// shape.* — spawn shapes (emitter-relative, feed output.spawnPosition)
// ===========================================================================
const shapes: NodeSchema[] = [
  schema({ kind: 'shape.point', label: 'Point', namespace: 'shape', evalTime: 'init', impact: 'low', inputs: [inPort('offset', 'vec2', v2(0, 0))], outputs: [outPort('pos', 'vec2')] }),
  schema({ kind: 'shape.circle', label: 'Circle', namespace: 'shape', evalTime: 'init', impact: 'low', inputs: [inPort('radius', 'f32', f(50))], outputs: [outPort('pos', 'vec2')] }),
  schema({ kind: 'shape.torus', label: 'Torus', namespace: 'shape', evalTime: 'init', impact: 'low', inputs: [inPort('innerRadius', 'f32', f(20)), inPort('outerRadius', 'f32', f(50))], outputs: [outPort('pos', 'vec2')] }),
  schema({ kind: 'shape.rectangle', label: 'Rectangle', namespace: 'shape', evalTime: 'init', impact: 'low', inputs: [inPort('size', 'vec2', v2(100, 100))], outputs: [outPort('pos', 'vec2')] }),
  schema({ kind: 'shape.burstRing', label: 'Burst ring', namespace: 'shape', evalTime: 'init', impact: 'low', inputs: [inPort('radius', 'f32', f(50))], outputs: [outPort('pos', 'vec2')] }),
  schema({ kind: 'shape.polygonalChain', label: 'Polygonal chain', namespace: 'shape', evalTime: 'init', impact: 'low', inputs: [inPort('start', 'vec2', v2(0, 0)), inPort('end', 'vec2', v2(100, 0))], outputs: [outPort('pos', 'vec2')] }),
];

// ===========================================================================
// output.* — sinks. Writer classes (single / accumulating / force-like) live in
// validate.ts, not the schema (§6, §12.3).
// ===========================================================================
const outputs: NodeSchema[] = [
  schema({ kind: 'output.spawnPosition', label: 'Spawn position', namespace: 'output', evalTime: 'init', impact: 'low', inputs: [inPort('pos', 'vec2', v2(0, 0))], outputs: [] }),
  schema({ kind: 'output.initVelocity', label: 'Init velocity', namespace: 'output', evalTime: 'init', impact: 'low', inputs: [inPort('vel', 'vec2', v2(0, 0))], outputs: [] }),
  schema({ kind: 'output.initLife', label: 'Init life', namespace: 'output', evalTime: 'init', impact: 'low', inputs: [inPort('life', 'f32', f(1))], outputs: [] }),
  schema({ kind: 'output.addForce', label: 'Add force', namespace: 'output', evalTime: 'update', impact: 'low', inputs: [inPort('force', 'vec2', v2(0, 0))], outputs: [] }),
  schema({ kind: 'output.drag', label: 'Drag', namespace: 'output', evalTime: 'update', impact: 'low', inputs: [inPort('drag', 'f32', f(0))], outputs: [] }),
  schema({ kind: 'output.setVelocity', label: 'Set velocity', namespace: 'output', evalTime: 'update', impact: 'low', inputs: [inPort('vel', 'vec2', v2(0, 0))], outputs: [] }),
  schema({ kind: 'output.writePosition', label: 'Write position', namespace: 'output', evalTime: 'update', impact: 'low', inputs: [inPort('pos', 'vec2', v2(0, 0))], outputs: [] }),
  schema({ kind: 'output.writeColor', label: 'Write color', namespace: 'output', evalTime: 'update', impact: 'low', inputs: [inPort('color', 'color', col('#ffffffff'))], outputs: [] }),
  schema({ kind: 'output.writeAlpha', label: 'Write alpha', namespace: 'output', evalTime: 'update', impact: 'low', inputs: [inPort('alpha', 'f32', f(1))], outputs: [] }),
  schema({ kind: 'output.writeScale', label: 'Write scale', namespace: 'output', evalTime: 'update', impact: 'low', inputs: [inPort('scale', 'f32', f(1))], outputs: [] }),
  schema({ kind: 'output.writeRotation', label: 'Write rotation', namespace: 'output', evalTime: 'update', impact: 'low', inputs: [inPort('rot', 'f32', f(0))], outputs: [] }),
  schema({ kind: 'output.initTexIndex', label: 'Init texture index', namespace: 'output', evalTime: 'init', impact: 'low', inputs: [inPort('index', 'f32', f(0))], outputs: [] }),
  schema({
    kind: 'output.deathBurst',
    label: 'Burst on death',
    namespace: 'output',
    evalTime: 'init',
    impact: 'medium',
    impactNote:
      'Sub-emitter only: multiplies the child pool by `max` and spawns countMin..countMax particles at each parent death — an explosion where a projectile dies.',
    inputs: [
      inPort('countMin', 'f32', f(8)),
      inPort('countMax', 'f32', f(8)),
      inPort('inheritVelocity', 'f32', f(0)),
    ],
    outputs: [],
    structural: [{ key: 'max', options: ['1', '2', '4', '8', '16', '32', '64'], default: '8' }],
  }),
  schema({ kind: 'output.killIf', label: 'Kill if', namespace: 'output', evalTime: 'update', impact: 'low', inputs: [inPort('cond', 'bool', boolean(false))], outputs: [] }),
  schema({ kind: 'output.killIfOutOfRect', label: 'Kill if out of rect', namespace: 'output', evalTime: 'update', impact: 'low', inputs: [inPort('min', 'vec2', v2(0, 0)), inPort('max', 'vec2', v2(100, 100))], outputs: [] }),
  schema({ kind: 'output.reflectInRect', label: 'Reflect in rect', namespace: 'output', evalTime: 'update', impact: 'low', inputs: [inPort('min', 'vec2', v2(0, 0)), inPort('max', 'vec2', v2(100, 100))], outputs: [] }),
  // ---- solid geometry (post-integration; see §13.6 "collide" lane) ----------
  // These resolve a penetration properly — push the particle back onto the
  // surface, THEN reflect the normal component. `output.reflectInRect` only
  // flipped velocity, so a particle that overshot far in one step could flip
  // every frame and buzz along the boundary. restitution = bounciness (0 dead,
  // 1 elastic); friction = fraction of tangential speed shed per hit.
  schema({
    kind: 'output.collidePlane',
    label: 'Collide: plane (floor/wall)',
    namespace: 'output',
    evalTime: 'update',
    impact: 'low',
    inputs: [
      inPort('point', 'vec2', v2(0, 400)),
      inPort('normal', 'vec2', v2(0, -1)),
      inPort('restitution', 'f32', f(0.45)),
      inPort('friction', 'f32', f(0.1)),
    ],
    outputs: [],
    structural: [{ key: 'space', options: SPACE_OPTIONS, default: 'world' }],
  }),
  schema({
    kind: 'output.collideRect',
    label: 'Collide: rect',
    namespace: 'output',
    evalTime: 'update',
    impact: 'low',
    inputs: [
      inPort('min', 'vec2', v2(-300, -300)),
      inPort('max', 'vec2', v2(300, 300)),
      inPort('restitution', 'f32', f(0.45)),
      inPort('friction', 'f32', f(0.1)),
    ],
    outputs: [],
    // 'inside' keeps particles in the box; 'outside' makes the box a solid crate
    structural: [
      { key: 'mode', options: ['inside', 'outside'], default: 'inside' },
      { key: 'space', options: SPACE_OPTIONS, default: 'world' },
    ],
  }),
  schema({
    kind: 'output.collideCircle',
    label: 'Collide: circle',
    namespace: 'output',
    evalTime: 'update',
    impact: 'low',
    inputs: [
      inPort('center', 'vec2', v2(0, 0)),
      inPort('radius', 'f32', f(120)),
      inPort('restitution', 'f32', f(0.45)),
      inPort('friction', 'f32', f(0.1)),
      // the disc's own velocity: a moving wall kicks what it hits
      inPort('velocity', 'vec2', v2(0, 0)),
    ],
    outputs: [],
    structural: [
      { key: 'mode', options: ['outside', 'inside'], default: 'outside' },
      { key: 'space', options: SPACE_OPTIONS, default: 'world' },
    ],
  }),
];

// ===========================================================================
// tex.* — render-side texture config (asset ref is dynamic structural)
// ===========================================================================
const texs: NodeSchema[] = [
  schema({ kind: 'tex.single', label: 'Single texture', namespace: 'tex', evalTime: 'init', impact: 'low', inputs: [], outputs: [], structural: [{ key: 'asset', options: [], default: '' }] }),
  schema({ kind: 'tex.random', label: 'Random texture', namespace: 'tex', evalTime: 'init', impact: 'low', inputs: [], outputs: [], structural: [{ key: 'asset', options: [], default: '' }] }),
];

export const V1_SCHEMAS: readonly NodeSchema[] = [
  ...inputs,
  ...params,
  ...gens,
  ...maths,
  ...fields,
  ...shapes,
  ...outputs,
  ...texs,
];
