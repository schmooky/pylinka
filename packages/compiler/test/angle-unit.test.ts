/**
 * Angles are DEGREES unless the node says radians.
 *
 * Typing 45 into a radian port turns a sprite seven times round and lands
 * somewhere arbitrary, which is indistinguishable from rotation not working —
 * and that is exactly how it was reported. The unit lives on the DESTINATION
 * (`output.initRotation`, `output.writeRotation`, and `gen.spin` for its own
 * rate), so it is set once per angle rather than on every node feeding it.
 *
 * Both backends have to read a number the same way or the preview and the
 * shipped game disagree about what 45 means.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';
import { V1_CATALOG, type SystemBundle } from '@pylinka/graph';

const bundle = (nodes: SystemBundle['system']['graph']['nodes'], edges: SystemBundle['system']['graph']['edges'] = []): SystemBundle => ({
  params: [],
  assets: [],
  system: {
    id: 's', name: 'rot', capacity: 64, blendMode: 'add', enabled: true, space: 'world',
    emitter: { mode: 'flow', rate: 10 },
    graph: {
      nodes: [
        { id: 'p1', kind: 'shape.point', values: { offset: { t: 'vec2', v: [0, 0] } } },
        { id: 'p2', kind: 'output.spawnPosition' },
        { id: 'p3', kind: 'output.initLife', values: { life: { t: 'f32', v: 1 } } },
        ...nodes,
      ],
      edges: [{ id: 'pe', from: { nodeId: 'p1', portId: 'pos' }, to: { nodeId: 'p2', portId: 'pos' } }, ...edges],
    },
  },
});

const emitOf = (b: SystemBundle) => compile(b, V1_CATALOG, 'webgpu').emitSrc;

describe('angle units in the compiled backend', () => {
  it('converts a birth angle from degrees by default', () => {
    const src = emitOf(bundle([{ id: 'r', kind: 'output.initRotation', values: { rot: { t: 'f32', v: 90 } } }]));
    expect(src).toMatch(/o_initRot: f32 = radians\(/);
  });

  it('leaves it alone when the node says radians', () => {
    const src = emitOf(
      bundle([
        { id: 'r', kind: 'output.initRotation', structural: { unit: 'radians' }, values: { rot: { t: 'f32', v: 1.5 } } },
      ]),
    );
    expect(src).toContain('o_initRot: f32 =');
    expect(src).not.toMatch(/o_initRot: f32 = radians\(/);
  });

  it('does not convert twice behind a math.radians node', () => {
    // the recipes wire degrees -> math.radians -> initRotation; converting
    // again would turn a full turn into six degrees
    const src = emitOf(
      bundle(
        [
          { id: 'd', kind: 'math.radians', values: { degrees: { t: 'f32', v: 360 } } },
          { id: 'r', kind: 'output.initRotation' },
        ],
        [{ id: 'e', from: { nodeId: 'd', portId: 'out' }, to: { nodeId: 'r', portId: 'rot' } }],
      ),
    );
    expect(src).not.toMatch(/o_initRot: f32 = radians\(/);
  });
});
