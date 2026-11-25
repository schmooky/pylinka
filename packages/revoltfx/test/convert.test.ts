import { describe, expect, it } from 'vitest';
import { V1_CATALOG, validateGraph } from '@pylinka/graph';
import type { Node, PylinkaProject, System } from '@pylinka/graph';
import { compile } from '@pylinka/compiler';
import { parseProject, serializeProject } from '@pylinka/format';
import { convertBundle, convertEffect, listEffects, sanitizeBundle, type RfxBundle, type RfxEmitter } from '../src/index.js';
import { NOW, bundle, emitterNamed, sheet } from './helpers.js';

const converted = convertBundle(bundle, { sheet, now: NOW });
const all = converted.emitters;
const seqs = converted.sequences;
const every = [...Object.values(converted.emitters), ...Object.values(converted.sequences)];

function nodesOf(s: System, kind: string): Node[] {
  return s.graph.nodes.filter((n) => n.kind === kind);
}

function only(s: System, kind: string): Node {
  const list = nodesOf(s, kind);
  expect(list, `${s.name} should have one ${kind}`).toHaveLength(1);
  return list[0]!;
}

/** The literal (or wire source kind) feeding `node.port`. */
function input(s: System, node: Node, port: string): unknown {
  const edge = s.graph.edges.find((e) => e.to.nodeId === node.id && e.to.portId === port);
  if (edge) return { from: s.graph.nodes.find((n) => n.id === edge.from.nodeId)!.kind };
  return node.values?.[port]?.v;
}

/** A minimal emitter: sanitized defaults plus overrides. */
type Overrides = Partial<Omit<RfxEmitter, 'particleSettings'>> & { particleSettings?: Partial<RfxEmitter['particleSettings']> };
function single(overrides: Overrides): RfxBundle {
  const base = sanitizeBundle({ emitters: [{ id: 1, name: 'probe' } as RfxEmitter], sequences: [] }).emitters[0]!;
  const e = { ...base, ...overrides, particleSettings: { ...base.particleSettings, ...overrides.particleSettings } } as RfxEmitter;
  return { emitters: [e], sequences: [], useBlendModes: true };
}

describe('the official RevoltFX example bundle', () => {
  it('converts every emitter and sequence', () => {
    const { emitters, sequences } = listEffects(bundle);
    expect(emitters).toHaveLength(76);
    expect(sequences).toHaveLength(10);
    expect(Object.keys(all)).toHaveLength(76);
    expect(Object.keys(seqs)).toHaveLength(10);
  });

  it('produces systems that validate and compile for WebGPU and WebGL2', () => {
    let count = 0;
    for (const fx of every) {
      for (const system of fx.project.systems) {
        const b = { system, params: fx.project.params, assets: [] };
        const diags = validateGraph(b, V1_CATALOG);
        expect(diags.filter((d) => d.severity === 'error' || d.code === 'W103_DEAD_NODE'), `${fx.name}/${system.name}`).toEqual([]);
        expect(() => compile(b, V1_CATALOG, 'webgpu')).not.toThrow();
        expect(() => compile(b, V1_CATALOG, 'webgl2')).not.toThrow();
        count++;
      }
    }
    expect(count).toBeGreaterThan(100);
  });

  it('round-trips each project through @pylinka/format', async () => {
    for (const fx of every) {
      const { project, diagnostics } = parseProject(await serializeProject(fx.project, { inlineAssets: false }), V1_CATALOG);
      expect(diagnostics).toEqual([]);
      expect(project.systems.map((s) => s.name)).toEqual(fx.project.systems.map((s) => s.name));
      expect(project.subEmitters).toEqual(fx.project.subEmitters);
    }
  });

  it('is deterministic for a fixed timestamp', () => {
    const again = convertBundle(bundle, { sheet, now: NOW });
    expect(JSON.stringify(again) === JSON.stringify(converted)).toBe(true);
  });

  it('does not mutate the input bundle', () => {
    const copy = JSON.stringify(bundle);
    convertBundle(bundle, { sheet, now: NOW });
    expect(JSON.stringify(bundle)).toBe(copy);
  });

  it('only draw order is left unsupported', () => {
    const features = new Set(every.flatMap((fx) => fx.issues.filter((i) => i.level === 'unsupported').map((i) => i.feature)));
    expect([...features]).toEqual(['particle.addOnTop']);
  });

  it('every emitter that uses useChilds gets trail children on its particles', () => {
    const withChilds = bundle.emitters.filter((e) => e.particleSettings.useChilds && e.particleSettings.childs.length > 0).map((e) => e.name);
    expect(withChilds.length).toBeGreaterThan(0);
    for (const name of withChilds) {
      const project = all[name]!.project;
      const root = project.systems.find((s) => s.name === name)!;
      const trails = project.systems.filter(
        (s) => project.subEmitters?.[s.id] === root.id && ['alive', 'birth'].includes(String(only(s, 'output.deathBurst').structural?.on)),
      );
      expect(trails.length, name).toBeGreaterThan(0);
    }
  });
});

describe('emitters', () => {
  it('side-torch: emitter childs start with it and adopt its rotation', () => {
    const fx = all['side-torch']!;
    const torch = emitterNamed('side-torch');
    expect(fx.project.systems).toHaveLength(1 + torch.childs.length);
    const [root, ...children] = fx.timeline.emits;
    expect(root!.system).toBe('side-torch');
    expect(root!.rotation).toBeCloseTo(-Math.PI / 2);
    for (const c of children) {
      expect(c.adoptRotationOf).toBe(0);
      expect(c.parent).toBe(0);
      expect(c.at).toBe(0);
    }
    // every top-level system rotates through its own knob
    expect(fx.project.params).toHaveLength(fx.timeline.emits.length);
  });

  it('side-torch: anchors and texture size reach the scale', () => {
    const fx = all['side-torch']!;
    const tex = fx.textures['side-torch']!;
    expect(tex).toMatchObject({ kind: 'sprite', frames: ['fx-light01'], anchorX: 0.3, anchorY: 0.5 });
    const src = sheet.frames['fx-light01']!.sourceSize!;
    // anchorX 0.3 pads the width by 0.4·w so the anchor lands in the middle
    expect(tex.box.side).toBe(Math.ceil(Math.max(src.w * 1.4, src.h)));
  });

  it('maps a circle core with a fixed direction, distance motion and fade-in', () => {
    const fx = convertEffect(single({
      core: { type: 'circle', params: { radius: 20, radial: false, angle: 0, uniform: false, width: 0, height: 0 } },
      rotation: 1,
      particleSettings: {
        useMotion: true, distanceMin: 100, distanceMax: 100, distanceEase: 'linear',
        useAlpha: true, fadeIn: true, fadeInDurationFac: 0.25, fadeInEase: 'linear',
        alphaStartMin: 1, alphaStartMax: 1, alphaEndMin: 0, alphaEndMax: 0, alphaEase: 'linear',
        durationMin: 2, durationMax: 2,
      },
    }), 'probe', { now: NOW });
    const s = fx.project.systems[0]!;
    expect(input(s, only(s, 'output.initLife'), 'life')).toBe(2);
    expect(input(s, only(s, 'output.spawnPosition'), 'pos')).toEqual({ from: 'math.makeVec2' });
    // linear distance needs no drag: v = 0.64·D / life
    expect(nodesOf(s, 'output.drag')).toHaveLength(0);
    // no report for anything here: it is all exact
    expect(fx.issues.filter((i) => i.level !== 'warning')).toEqual([]);
  });

  it('gravity mode: px/frame → px/s and px/frame² → px/s², floor → collidePlane', () => {
    const fx = convertEffect(single({
      useGravity: true, gravity: 0.5, useFloor: true, floorY: 600,
      particleSettings: { useMotion: true, moveSpeedMin: 4, moveSpeedMax: 4, bounceFacMin: 0.5, bounceFacMax: 0.5, frictionMin: 0.1, frictionMax: 0.1 },
    }), 'probe', { now: NOW, sheet });
    const s = fx.project.systems[0]!;
    const gravity = only(s, 'field.gravity');
    expect(gravity.values?.g?.v).toEqual([0, 0.5 * 3600]);
    const plane = only(s, 'output.collidePlane');
    expect(plane.values?.point?.v).toEqual([0, 600]);
    expect(plane.values?.restitution?.v).toBe(0.5);
    expect(plane.values?.friction?.v).toBeCloseTo(0.1);
  });

  it('walks an eased distance tween exactly: pos += D·(E(next) − E(now))', () => {
    const fx = convertEffect(single({ particleSettings: { useMotion: true, distanceMin: 50, distanceMax: 150, distanceEase: 'easeOutCubic' } }), 'probe', { now: NOW, sheet });
    const s = fx.project.systems[0]!;
    expect(nodesOf(s, 'output.drag')).toHaveLength(0);
    expect(input(s, only(s, 'output.writePosition'), 'pos')).toEqual({ from: 'math.makeVec2' });
    expect(nodesOf(s, 'gen.ease').map((n) => n.structural?.ease)).toEqual(['power2.out', 'power2.out']);
    expect(nodesOf(s, 'input.dt')).toHaveLength(1);
    expect(fx.issues.filter((i) => i.level !== 'warning')).toEqual([]);
  });

  it('a non-preset distance ease is a fitted curve, reported with its error', () => {
    const fx = convertEffect(single({ particleSettings: { useMotion: true, distanceMin: 50, distanceMax: 150, distanceEase: 'easeOutQuint' } }), 'probe', { now: NOW, sheet });
    const s = fx.project.systems[0]!;
    expect(nodesOf(s, 'gen.ease').every((n) => n.structural?.ease?.startsWith('curve('))).toBe(true);
    // a fit within 0.001 is not worth a report; anything worse would be one
    const issue = fx.issues.find((i) => i.feature === 'ease');
    expect(issue?.error ?? 0).toBeLessThan(0.005);
  });

  it('a spawn clock with a fixed count is exact; random ranges are reported without the player', () => {
    const fixed = convertEffect(single({ spawnCountMin: 3, spawnCountMax: 3, spawnFrequencyMin: 0.2, spawnFrequencyMax: 0.2 }), 'probe', { now: NOW, sheet });
    expect(fixed.project.systems[0]!.emitter).toEqual({ mode: 'burst', rate: 0, burst: { count: 3, interval: 0.2, immediate: true } });
    const random = convertEffect(
      single({ spawnCountMin: 3, spawnCountMax: 6, spawnFrequencyMin: 0.05, spawnFrequencyMax: 0.12, infinite: false, duration: 2 }),
      'probe',
      { now: NOW, sheet },
    );
    // Rnd.integer(3, 6) is 3..5; intervals round up to whole 60 fps frames
    expect(random.project.systems[0]!.emitter).toEqual({
      mode: 'burst',
      rate: 0,
      burst: { count: 3, countMax: 5, interval: 3 / 60, intervalMax: 8 / 60, immediate: true },
      duration: 2,
    });
    expect(random.issues.filter((i) => i.level !== 'warning')).toEqual([]);
    // the player gets the raw clock either way
    expect(random.timeline.emits[0]!.clock).toMatchObject({ countMin: 3, countMax: 6, particleFac: 1 });
  });

  it("drive: 'runtime' leaves the clock to the player", () => {
    const fx = convertEffect(single({ spawnCountMin: 3, spawnCountMax: 6, infinite: false, duration: 2 }), 'probe', { now: NOW, sheet, drive: 'runtime' });
    expect(fx.project.systems[0]!.emitter).toEqual({ mode: 'flow', rate: 0 });
    expect(fx.issues.some((i) => i.feature === 'emitter.spawnClock' || i.feature === 'emitter.duration')).toBe(false);
  });

  it('a one-shot emitter (duration 0, not infinite) becomes once', () => {
    const fx = convertEffect(single({ infinite: false, duration: 0, spawnCountMin: 12, spawnCountMax: 12 }), 'probe', { now: NOW, sheet });
    expect(fx.project.systems[0]!.emitter).toMatchObject({ mode: 'once', burst: { count: 12 } });
  });

  it('a uniform ring steps its angle with the spawn index', () => {
    const fx = convertEffect(single({
      core: { type: 'ring', params: { radius: 50, radial: true, angle: Math.PI * 2, uniform: true, width: 0, height: 0 } },
      spawnCountMin: 8, spawnCountMax: 8,
    }), 'probe', { now: NOW, sheet });
    const s = fx.project.systems[0]!;
    expect(nodesOf(s, 'input.spawnIndex')).toHaveLength(1);
    expect(fx.issues.some((i) => i.feature === 'core.ring.uniform')).toBe(false);
  });

  it('multiply blend maps to multiply', () => {
    const fx = convertEffect(single({ particleSettings: { blendMode: 2 } }), 'probe', { now: NOW, sheet });
    expect(fx.project.systems[0]!.blendMode).toBe('multiply');
    expect(fx.issues.filter((i) => i.level !== 'warning')).toEqual([]);
  });

  it('useBlendModes: false draws everything normal', () => {
    const b = single({ particleSettings: { blendMode: 1 } });
    b.useBlendModes = false;
    expect(convertEffect(b, 'probe', { now: NOW, sheet }).project.systems[0]!.blendMode).toBe('normal');
  });

  it('spin: rotation += rad/frame × 60 × dt, from wherever the particle started', () => {
    const fx = convertEffect(
      single({ core: { type: 'circle', params: { radius: 10, radial: true, angle: 0, uniform: false, width: 0, height: 0 } }, particleSettings: { useRotation: true, rotationSpeedMin: 0.1, rotationSpeedMax: 0.1, randomRotationDirection: true } }),
      'probe',
      { now: NOW, sheet },
    );
    const s = fx.project.systems[0]!;
    const write = only(s, 'output.writeRotation');
    expect(write.structural).toEqual({ unit: 'radians' });
    expect(input(s, write, 'rot')).toEqual({ from: 'math.add' });
    expect(nodesOf(s, 'input.rotation')).toHaveLength(1);
    expect(nodesOf(s, 'math.abs')).toHaveLength(1);
    expect(fx.issues.filter((i) => i.level !== 'warning')).toEqual([]);
  });

  it('align turns each sprite to its velocity heading', () => {
    const fx = convertEffect(single({ useGravity: true, gravity: 0.3, particleSettings: { useMotion: true, moveSpeedMin: 5, moveSpeedMax: 5, align: true } }), 'probe', { now: NOW, sheet });
    const s = fx.project.systems[0]!;
    expect(input(s, only(s, 'output.writeRotation'), 'rot')).toEqual({ from: 'math.atan2' });
  });

  it('a radial box rotates each sprite to its own heading at birth', () => {
    const fx = convertEffect(single({ core: { type: 'box', params: { radius: 0, radial: true, angle: 0, uniform: false, width: 100, height: 40 } } }), 'probe', { now: NOW, sheet });
    const s = fx.project.systems[0]!;
    expect(input(s, only(s, 'output.initRotation'), 'rot')).toEqual({ from: 'math.atan2' });
    expect(fx.issues.filter((i) => i.level !== 'warning')).toEqual([]);
  });

  it('separate X/Y scale tweens become writeScaleXY', () => {
    const fx = convertEffect(
      single({ particleSettings: { useScale: true, uniformScale: false, scaleXStartMin: 1, scaleXStartMax: 1, scaleXEndMin: 2, scaleXEndMax: 2, scaleYStartMin: 0.5, scaleYStartMax: 0.5, scaleYEndMin: 0, scaleYEndMax: 0, scaleYEase: 'easeInQuad' } }),
      'probe',
      { now: NOW, sheet },
    );
    const s = fx.project.systems[0]!;
    expect(nodesOf(s, 'output.writeScale')).toHaveLength(0);
    expect(input(s, only(s, 'output.writeScaleXY'), 'scale')).toEqual({ from: 'math.makeVec2' });
    expect(nodesOf(s, 'gen.numberOverLife').map((n) => n.structural?.ease).sort()).toEqual(['linear', 'power1.in']);
  });

  it('autoRotation turns the spawn angle with input.time, from the emitter\'s start', () => {
    const fx = convertEffect(single({ autoRotation: 0.05, core: { type: 'circle', params: { radius: 0, radial: false, angle: 0, uniform: false, width: 0, height: 0 } }, particleSettings: { useMotion: true, distanceMin: 100, distanceMax: 100 } }), 'probe', { now: NOW, sheet });
    const s = fx.project.systems[0]!;
    const time = only(s, 'input.time');
    expect(s.graph.edges.some((e) => e.from.nodeId === time.id)).toBe(true);
    expect(nodesOf(s, 'math.mul').some((n) => n.values?.b?.v === 0.05 * 60)).toBe(true);
    expect(fx.issues.filter((i) => i.level !== 'warning')).toEqual([]);
  });

  it('warns when no spritesheet data is given', () => {
    const fx = convertEffect(single({}), 'probe', { now: NOW });
    expect(fx.issues.some((i) => i.feature === 'texture.size' && i.level === 'warning')).toBe(true);
    expect(fx.textures.probe!.box.side).toBe(64);
  });

  it('throws on an unknown effect name', () => {
    expect(() => convertEffect(bundle, 'no-such-effect')).toThrow(/no emitter or sequence/);
  });
});

describe('sub-emitters', () => {
  const parents = bundle.emitters.filter((e) => e.particleSettings.useSpawns && e.particleSettings.spawn.onComplete.some((s) => s.type === 0));

  it('the fixture has death spawns to test', () => {
    expect(parents.length).toBeGreaterThan(0);
  });

  it('a death spawn becomes a linked child with output.deathBurst', () => {
    for (const p of parents) {
      const fx = all[p.name]!;
      const project = fx.project as PylinkaProject;
      const links = Object.entries(project.subEmitters ?? {});
      expect(links.length, p.name).toBeGreaterThan(0);
      for (const [childId, parentId] of links) {
        const child = project.systems.find((s) => s.id === childId)!;
        const parent = project.systems.find((s) => s.id === parentId)!;
        expect(child, p.name).toBeDefined();
        expect(parent, p.name).toBeDefined();
        const burst = only(child, 'output.deathBurst');
        expect(['death', 'birth']).toContain(burst.structural?.on);
        const max = Number(burst.structural?.max);
        expect(Number(burst.values?.countMax?.v)).toBeLessThan(max + 0.5);
        // pool = parent capacity × burst max, matching the engines
        expect(child.capacity).toBe(parent.capacity * max);
        // children never fire on their own
        expect(child.emitter).toEqual({ mode: 'flow', rate: 0 });
      }
    }
  });

  it('a spawned one-shot emitter keeps its count range, uniform over integers', () => {
    const b: RfxBundle = sanitizeBundle({
      emitters: [
        { id: 1, name: 'parent', particleSettings: { useSpawns: true, spawn: { onComplete: [{ type: 0, id: 2, scale: 1, adoptRotation: false, containerId: '' }], onStart: [], onBounce: [], onHalfway: [] } } } as unknown as RfxEmitter,
        { id: 2, name: 'debris', infinite: false, duration: 0, spawnCountMin: 4, spawnCountMax: 9 } as RfxEmitter,
      ],
      sequences: [],
    });
    const fx = convertEffect(b, 'parent', { now: NOW, sheet });
    const debris = fx.project.systems.find((s) => s.name === 'debris')!;
    const burst = only(debris, 'output.deathBurst');
    // Rnd.integer(4, 9) is 4..8
    expect(burst.values?.countMin?.v).toBeCloseTo(3.501);
    expect(burst.values?.countMax?.v).toBeCloseTo(8.499);
    expect(burst.structural).toEqual({ max: '8', on: 'death' });
    expect(fx.issues.some((i) => i.feature === 'spawn.continuous')).toBe(false);
  });

  it('the same emitter spawned twice gets two systems', () => {
    const spawn = { type: 0 as const, id: 2, scale: 1, adoptRotation: false, containerId: '' };
    const b: RfxBundle = sanitizeBundle({
      emitters: [
        { id: 1, name: 'parent', particleSettings: { useSpawns: true, spawn: { onComplete: [spawn], onStart: [spawn], onBounce: [], onHalfway: [] } } } as unknown as RfxEmitter,
        { id: 2, name: 'flash', infinite: false, duration: 0 } as RfxEmitter,
      ],
      sequences: [],
    });
    const fx = convertEffect(b, 'parent', { now: NOW, sheet });
    expect(fx.project.systems.map((s) => s.name)).toEqual(['parent', 'flash', 'flash#2']);
    const ons = fx.project.systems.slice(1).map((s) => only(s, 'output.deathBurst').structural?.on);
    expect(ons).toEqual(['death', 'birth']);
  });

  it('onHalfway is an age event at 0.5 s, onBounce a bounce event', () => {
    const spawn = { type: 0 as const, id: 2, scale: 1, adoptRotation: false, containerId: '' };
    const b: RfxBundle = sanitizeBundle({
      emitters: [
        { id: 1, name: 'parent', useGravity: true, useFloor: true, floorY: 500, gravity: 0.2, particleSettings: { useSpawns: true, spawn: { onComplete: [], onStart: [], onBounce: [spawn], onHalfway: [spawn] } } } as unknown as RfxEmitter,
        { id: 2, name: 'puff', infinite: false, duration: 0 } as RfxEmitter,
      ],
      sequences: [],
    });
    const fx = convertEffect(b, 'parent', { now: NOW, sheet });
    const bursts = fx.project.systems.slice(1).map((s) => only(s, 'output.deathBurst'));
    expect(bursts.map((n) => n.structural?.on)).toEqual(['age', 'bounce']);
    expect(bursts[0]!.values?.at?.v).toBe(0.5);
    expect(fx.issues.filter((i) => i.level === 'unsupported')).toEqual([]);
  });

  it('a sequence element starts at its delay through emitter.delay', () => {
    const b = sanitizeBundle({
      emitters: [{ id: 1, name: 'e', infinite: false, duration: 0 } as RfxEmitter],
      sequences: [{ id: 1, name: 'seq', effects: [{ componentId: 1, componentType: 2, delay: 0.75 }] } as never],
    });
    const fx = convertEffect(b, 'seq', { now: NOW, sheet, kind: 'sequence' });
    expect(fx.project.systems[0]!.emitter).toMatchObject({ mode: 'once', delay: 0.75 });
  });

  it('stops at maxDepth on a self-spawning emitter and reports it', () => {
    const b: RfxBundle = sanitizeBundle({
      emitters: [{ id: 1, name: 'loop', infinite: false, duration: 0, particleSettings: { useSpawns: true, spawn: { onComplete: [{ type: 0, id: 1, scale: 1, adoptRotation: false, containerId: '' }], onStart: [], onBounce: [], onHalfway: [] } } } as unknown as RfxEmitter],
      sequences: [],
    });
    const fx = convertEffect(b, 'loop', { now: NOW, sheet, maxDepth: 2 });
    expect(fx.project.systems).toHaveLength(3);
    expect(fx.issues.some((i) => i.feature === 'spawn.depth')).toBe(true);
  });
});

describe('sequences', () => {
  it('top-big-explosion: timed emitters, a sprite and two triggers', () => {
    // also an emitter name: sequences live in their own namespace
    expect(all['top-big-explosion']!.kind).toBe('emitter');
    const fx = seqs['top-big-explosion']!;
    expect(fx.kind).toBe('sequence');
    expect(fx.timeline.triggers).toEqual([
      { at: 0, value: 'shake' },
      { at: 1, value: 'shake' },
    ]);
    const ats = fx.timeline.emits.filter((t) => t.parent === undefined).map((t) => t.at);
    expect(ats).toContain(0.2);
    const sprite = fx.project.systems.find((s) => s.name === 'top-big-explosion.fx-light01')!;
    expect(sprite.blendMode).toBe('add');
    expect(only(sprite, 'output.initLife').values?.life?.v).toBe(0.2);
    expect(only(sprite, 'output.writeColor').values?.color?.v).toBe('#ffb700ff');
  });

  it('an element waits for the one before it (EffectSequence.setNextEffect)', () => {
    const b = sanitizeBundle({
      emitters: [{ id: 1, name: 'e' } as RfxEmitter],
      sequences: [{ id: 1, name: 'seq', delay: 0.5, effects: [{ componentId: 1, componentType: 2, delay: 1 }, { componentId: 1, componentType: 2, delay: 0.25 }] } as never],
    });
    const fx = convertEffect(b, 'seq', { now: NOW, sheet });
    expect(fx.timeline.emits.map((t) => t.at)).toEqual([1.5, 1.5]);
  });
});
