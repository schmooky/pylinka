import type { PylinkaProject } from '@pylinka/graph';

/** Default project shown on first load — the coin-spark-trail. */
export function seedProject(): PylinkaProject {
  return {
    format: 'pylinka/v1',
    version: 1,
    catalogVersion: 1,
    id: crypto.randomUUID(),
    name: 'Coin Spark Trail',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    params: [
      { id: 'p1', name: 'windPower', type: 'f32', min: 0, max: 240, scale: 'linear', default: { t: 'f32', v: 0 }, group: 'Wind' },
      { id: 'p2', name: 'windDir', type: 'f32', min: -3.14159, max: 3.14159, scale: 'linear', default: { t: 'f32', v: 0 }, group: 'Wind' },
    ],
    assets: [],
    systems: [
      {
        id: 's1', name: 'sparks', capacity: 6000, blendMode: 'add', enabled: true, space: 'world',
        emitter: { mode: 'flow', rate: 420, rateOverDistance: 1.4 },
        graph: {
          nodes: [
            { id: 'n1', kind: 'shape.point', values: { offset: { t: 'vec2', v: [0, 0] } } },
            { id: 'n2', kind: 'output.spawnPosition' },
            { id: 'n3', kind: 'gen.randomRange', values: { min: { t: 'f32', v: 0.6 }, max: { t: 'f32', v: 1.3 } } },
            { id: 'n4', kind: 'output.initLife' },
            { id: 'n5', kind: 'gen.randomVec2', values: { min: { t: 'vec2', v: [-45, -150] }, max: { t: 'vec2', v: [45, -240] } } },
            { id: 'n6', kind: 'output.initVelocity' },
            { id: 'n7', kind: 'field.gravity', values: { g: { t: 'vec2', v: [0, 340] } } },
            { id: 'n8', kind: 'output.addForce' },
            { id: 'n9', kind: 'param.ref', structural: { param: 'p1' } },
            { id: 'n10', kind: 'param.ref', structural: { param: 'p2' } },
            { id: 'n11', kind: 'field.directional' },
            { id: 'n12', kind: 'output.addForce' },
            { id: 'n13', kind: 'gen.colorOverLife', structural: { ease: 'power2.out' }, values: { from: { t: 'color', v: '#ffd27aff' }, to: { t: 'color', v: '#ff3b0000' } } },
            { id: 'n14', kind: 'output.writeColor' },
            { id: 'n15', kind: 'gen.scaleOverLife', structural: { ease: 'power2.out' }, values: { from: { t: 'f32', v: 1.6 }, to: { t: 'f32', v: 0 } } },
            { id: 'n16', kind: 'output.writeScale' },
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
            { id: 'e9', from: { nodeId: 'n15', portId: 'out' }, to: { nodeId: 'n16', portId: 'scale' } },
          ],
        },
      },
    ],
    editor: {
      viewport: { x: 0, y: 0, zoom: 1 },
      nodePositions: {
        n1: { x: 0, y: 0 }, n2: { x: 320, y: 0 },
        n3: { x: 0, y: 120 }, n4: { x: 320, y: 120 },
        n5: { x: 0, y: 250 }, n6: { x: 320, y: 250 },
        n7: { x: 0, y: 400 }, n8: { x: 320, y: 400 },
        n9: { x: -300, y: 520 }, n10: { x: -300, y: 620 },
        n11: { x: 0, y: 540 }, n12: { x: 320, y: 540 },
        n13: { x: 0, y: 690 }, n14: { x: 320, y: 690 },
        n15: { x: 0, y: 830 }, n16: { x: 320, y: 830 },
      },
    },
  };
}
