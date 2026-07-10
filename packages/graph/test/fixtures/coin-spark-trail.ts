/**
 * The §14 golden project "Coin Spark Trail" as a typed fixture. This is the
 * compiler's north star and the graph package's slot-assignment reference.
 * Kept byte-faithful to REQUIREMENTS.md §14.1.
 */
import type { Asset, ParamDef, PylinkaProject, System, SystemBundle } from '../../src/index.js';

export const coinTrailParams: ParamDef[] = [
  // NOTE: §14.1 prints `min: 0`, but a log scale requires min > 0 (V012 / §11.1);
  // corrected to 1 here. See docs/QUESTIONS.md (§14.1 vs V012).
  { id: 'p1', name: 'windPower', type: 'f32', min: 1, max: 200, scale: 'log', default: { t: 'f32', v: 10 }, unit: 'px/s²', group: 'Wind' },
  { id: 'p2', name: 'windDir', type: 'f32', min: -3.14159, max: 3.14159, scale: 'linear', default: { t: 'f32', v: 0 }, unit: 'rad', group: 'Wind' },
];

export const coinTrailAssets: Asset[] = [
  {
    id: 'a1',
    name: 'spark',
    width: 32,
    height: 32,
    pixiAssetKey: 'vfx/spark',
    source: { kind: 'inline', src: 'data:image/png;base64,iVBORw0K' },
  },
];

export const coinTrailSystem: System = {
  id: 's1',
  name: 'sparks',
  capacity: 8192,
  blendMode: 'add',
  enabled: true,
  space: 'world',
  emitter: { mode: 'flow', rate: 200, rateOverDistance: 0.8 },
  graph: {
    nodes: [
      { id: 'n1', kind: 'shape.point', values: { offset: { t: 'vec2', v: [0, 0] } } },
      { id: 'n2', kind: 'output.spawnPosition' },
      { id: 'n3', kind: 'gen.randomRange', values: { min: { t: 'f32', v: 0.5 }, max: { t: 'f32', v: 1.2 } } },
      { id: 'n4', kind: 'output.initLife' },
      { id: 'n5', kind: 'gen.randomVec2', values: { min: { t: 'vec2', v: [-30, -80] }, max: { t: 'vec2', v: [30, -160] } } },
      { id: 'n6', kind: 'output.initVelocity' },
      { id: 'n7', kind: 'field.gravity', values: { g: { t: 'vec2', v: [0, 300] } } },
      { id: 'n8', kind: 'output.addForce' },
      { id: 'n9', kind: 'param.ref', structural: { param: 'p1' } },
      { id: 'n10', kind: 'param.ref', structural: { param: 'p2' } },
      { id: 'n11', kind: 'field.directional' },
      { id: 'n12', kind: 'output.addForce' },
      { id: 'n13', kind: 'gen.colorOverLife', structural: { ease: 'power2.out' }, values: { from: { t: 'color', v: '#fff2a8ff' }, to: { t: 'color', v: '#ff2a0000' } } },
      { id: 'n14', kind: 'output.writeColor' },
    ],
    edges: [
      { id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } },
      { id: 'e2', from: { nodeId: 'n3', portId: 'out' }, to: { nodeId: 'n4', portId: 'life' } },
      { id: 'e3', from: { nodeId: 'n5', portId: 'out' }, to: { nodeId: 'n6', portId: 'vel' } },
      { id: 'e4', from: { nodeId: 'n7', portId: 'force' }, to: { nodeId: 'n8', portId: 'force' } },
      { id: 'e5', from: { nodeId: 'n9', portId: 'out' }, to: { nodeId: 'n11', portId: 'strength' } },
      { id: 'e6', from: { nodeId: 'n10', portId: 'out' }, to: { nodeId: 'n11', portId: 'angle' } },
      { id: 'e7', from: { nodeId: 'n11', portId: 'force' }, to: { nodeId: 'n12', portId: 'force' } },
      { id: 'e8', from: { nodeId: 'n13', portId: 'out' }, to: { nodeId: 'n14', portId: 'color' } },
    ],
  },
};

export const coinTrailBundle: SystemBundle = {
  system: coinTrailSystem,
  params: coinTrailParams,
  assets: coinTrailAssets,
};

export const coinTrailProject: PylinkaProject = {
  format: 'pylinka/v1',
  version: 1,
  catalogVersion: 1,
  id: 'uuid',
  name: 'Coin Spark Trail',
  createdAt: '2026-07-10T00:00:00Z',
  updatedAt: '2026-07-10T00:00:00Z',
  params: coinTrailParams,
  assets: coinTrailAssets,
  systems: [coinTrailSystem],
  editor: {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodePositions: { n1: { x: 40, y: 80 }, n5: { x: 40, y: 200 } },
  },
};
