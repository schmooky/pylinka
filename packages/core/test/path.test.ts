import { describe, expect, it } from 'vitest';
import { createPathDriver } from '../src/path.js';

describe('createPathDriver — emitter trajectory splines', () => {
  const line: [number, number][] = [
    [0, 0],
    [100, 0],
  ];

  it('traverses a straight segment at uniform speed', () => {
    const d = createPathDriver(line, { duration: 2, mode: 'once' });
    expect(d.length).toBeCloseTo(100, 3);
    expect(d.at(0)[0]).toBeCloseTo(0, 3);
    expect(d.at(1)[0]).toBeCloseTo(50, 1);
    expect(d.at(2)[0]).toBeCloseTo(100, 3);
    expect(d.at(99)[0]).toBeCloseTo(100, 3); // 'once' holds the end
  });

  it('loop wraps, pingpong reverses', () => {
    const loop = createPathDriver(line, { duration: 2, mode: 'loop' });
    expect(loop.at(2.5)[0]).toBeCloseTo(loop.at(0.5)[0], 3);
    const pp = createPathDriver(line, { duration: 2, mode: 'pingpong' });
    expect(pp.at(3)[0]).toBeCloseTo(50, 1); // halfway back
    expect(pp.at(4)[0]).toBeCloseTo(0, 2);
  });

  it('passes through every control point', () => {
    const pts: [number, number][] = [
      [0, 0],
      [50, 80],
      [120, 10],
      [200, 60],
    ];
    const d = createPathDriver(pts, { duration: 1, mode: 'once' });
    // sample densely and assert each control point is approached
    for (const p of pts) {
      let best = Infinity;
      for (let t = 0; t <= 1.001; t += 0.002) {
        const q = d.at(t);
        best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1]));
      }
      expect(best).toBeLessThan(1.5);
    }
  });

  it('degenerate inputs are safe', () => {
    expect(createPathDriver([]).at(1)).toEqual([0, 0]);
    expect(createPathDriver([[7, 9]]).at(5)).toEqual([7, 9]);
    // coincident points must not divide by zero
    const d = createPathDriver(
      [
        [10, 10],
        [10, 10],
      ],
      { duration: 1 },
    );
    expect(d.at(0.5)[0]).toBeCloseTo(10, 3);
  });

  it('closed path returns to its start', () => {
    const d = createPathDriver(
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      { duration: 4, mode: 'loop', closed: true },
    );
    const a = d.at(0);
    const b = d.at(4);
    expect(b[0]).toBeCloseTo(a[0], 1);
    expect(b[1]).toBeCloseTo(a[1], 1);
  });
});
