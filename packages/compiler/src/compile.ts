/**
 * compile(bundle, catalog, target): SystemBundle → CompiledSystem
 * (REQUIREMENTS.md §6, §11.4, §14). Pure, deterministic, no I/O.
 */
import type {
  Backend,
  Diagnostic,
  Edge,
  Graph,
  Node,
  NodeCatalog,
  NodeSchema,
  ParamDef,
  SystemBundle,
} from '@pylinka/graph';
import { getSchema, hashGraph, resolveKind, validateGraph } from '@pylinka/graph';
import { buildSlots, NODE_CODEGEN, NodeCtx, valueSlotExpr, type SlotResolution } from './codegen.js';
import { easeFnGlsl, GLSL_DISCARD_FS, glslStepShader, glslSubStepShader } from './glsl.js';
import { naturalCompare, resolveEvalTimes } from './topo.js';
import { wgslBodyToGlsl } from './translate.js';
import { CompileError, V1_BINDINGS, type CompiledSystem } from './types.js';
import { EASE_BODIES, easeFn, easeFnName, emitKernel, preamble, subEmitKernel, updateKernel } from './wgsl.js';

const INIT_OUTPUT_ORDER = [
  'output.spawnPosition',
  'output.initLife',
  'output.initVelocity',
  'output.initTexIndex',
];

export function compile(bundle: SystemBundle, catalog: NodeCatalog, target: Backend): CompiledSystem {
  const graph = bundle.system.graph;

  // 1. validate — errors block compilation
  const diagnostics = validateGraph(bundle, catalog);
  if (diagnostics.some((d) => d.severity === 'error')) {
    throw new CompileError(diagnostics);
  }

  // 2. slots + eval-time resolution
  const slots = buildSlots(graph, bundle.params);
  const evalDiags: Diagnostic[] = [];
  const resolution = resolveEvalTimes(graph, catalog, evalDiags);
  if (evalDiags.some((d) => d.severity === 'error')) {
    throw new CompileError([...diagnostics, ...evalDiags]);
  }

  const ctx = new CompileCtx(graph, catalog, bundle.params, slots);

  // 3. init kernel
  const initFlags = { safeDiv: false, safeNormalize: false };
  const { body: initBody, eases: initEases } = ctx.buildInit(
    resolution.initValue,
    resolution.initOutputs,
    initFlags,
  );

  // 4. update kernel
  const updateFlags = { safeDiv: false, safeNormalize: false };
  const { body, postIntegrate, setVelocity, eases: updateEases } = ctx.buildUpdate(
    resolution.updateValue,
    resolution.updateOutputs,
    updateFlags,
  );

  // ease functions: one WGSL/GLSL fn per distinct ease key, emitted into the
  // kernel(s) that use it (sorted for deterministic output). A system may mix
  // eases freely (e.g. color sine.out + scale linear) — each node calls its own.
  const sorted = (s: Set<string>) => [...s].sort();
  const easeDefsWgsl = (s: Set<string>) => sorted(s).map((e) => '\n' + easeFn(e)).join('');

  let emitSrc: string;
  let updateSrc: string;
  let subSrc: string;
  if (target === 'webgpu') {
    emitSrc =
      preamble(slots.layout.slotCount, initFlags) +
      easeDefsWgsl(initEases) +
      '\n' +
      emitKernel(initBody);
    updateSrc =
      preamble(slots.layout.slotCount, updateFlags) +
      easeDefsWgsl(updateEases) +
      '\n' +
      updateKernel(body, postIntegrate, { setVelocity });
    // sub-emitter emit: init body only, into the child's own pool (§sub-emitters)
    subSrc =
      preamble(slots.layout.slotCount, initFlags) +
      easeDefsWgsl(initEases) +
      '\n' +
      subEmitKernel(initBody);
  } else {
    // webgl2: ONE fused TF step shader (see glsl.ts header for the mapping), so
    // it needs every ease used by either the init or update body.
    const allEases = sorted(new Set([...initEases, ...updateEases]));
    const glslOpts = {
      slots: slots.layout.slotCount,
      helpers: {
        safeDiv: initFlags.safeDiv || updateFlags.safeDiv,
        safeNormalize: initFlags.safeNormalize || updateFlags.safeNormalize,
      },
      ...(allEases.length > 0
        ? { easeSrcs: allEases.map((e) => easeFnGlsl(easeFnName(e), EASE_BODIES[e]!)) }
        : {}),
      initBody: wgslBodyToGlsl(initBody, ctx.tempTypes),
      updateBody: wgslBodyToGlsl(body, ctx.tempTypes),
      postIntegrate: wgslBodyToGlsl(postIntegrate, ctx.tempTypes),
      setVelocity,
    };
    emitSrc = glslStepShader(glslOpts);
    updateSrc = GLSL_DISCARD_FS;
    subSrc = glslSubStepShader(glslOpts);
  }

  // 5. textures (tex.* nodes → asset bindings)
  const textures: { assetId: string; binding: number }[] = [];
  let texBinding = 0;
  for (const n of graph.nodes) {
    if (resolveKind(catalog, n.kind).startsWith('tex.')) {
      const assetId = n.structural?.asset;
      if (assetId !== undefined && assetId !== '') textures.push({ assetId, binding: texBinding++ });
    }
  }

  return {
    graphHash: hashGraph(graph),
    backend: target,
    emitSrc,
    updateSrc,
    subSrc,
    uniforms: slots.layout,
    bindings: V1_BINDINGS,
    textures,
    diagnostics: [...diagnostics, ...evalDiags].filter((d) => d.severity === 'warning'),
  };
}

/** Stateful helper that walks nodes and emits WGSL body lines. */
class CompileCtx {
  private readonly nodeById = new Map<string, Node>();
  private readonly edgeInto = new Map<string, Edge>(); // "nodeId portId" → edge
  private readonly paramName = new Map<string, string>();
  /** every generated temp/output-temp name → port type (webgl2 let-typing) */
  readonly tempTypes = new Map<string, string>();

  constructor(
    private readonly graph: Graph,
    private readonly catalog: NodeCatalog,
    params: ParamDef[],
    private readonly slots: SlotResolution,
  ) {
    for (const n of graph.nodes) this.nodeById.set(n.id, n);
    for (const e of graph.edges) this.edgeInto.set(e.to.nodeId + ' ' + e.to.portId, e);
    for (const p of params) this.paramName.set(p.id, p.name);
  }

  private schemaOf(node: Node): NodeSchema {
    const s = getSchema(this.catalog, node.kind);
    if (s === undefined) throw new Error(`no schema for ${node.kind}`); // validated earlier
    return s;
  }

  /** Temp name for an output port (single-output nodes → t_<id>). */
  private outputTemp(nodeId: string, portId: string): string {
    const node = this.nodeById.get(nodeId)!;
    const schema = this.schemaOf(node);
    return schema.outputs.length > 1 ? `t_${nodeId}_${portId}` : `t_${nodeId}`;
  }

  /** Expression feeding an input port: upstream temp, or its value slot. */
  private inputExpr(nodeId: string, portId: string): { expr: string; srcId?: string } {
    const edge = this.edgeInto.get(nodeId + ' ' + portId);
    if (edge !== undefined) {
      return { expr: this.outputTemp(edge.from.nodeId, edge.from.portId), srcId: edge.from.nodeId };
    }
    return { expr: valueSlotExpr(this.slots, nodeId, portId) };
  }

  private comment(node: Node, ctx: NodeCtx): string {
    let c = `  // ${node.id} ${node.kind}`;
    if (ctx.stableUsed.length > 0) c += ` [stable ${ctx.stableUsed.map((k) => '#' + k).join(', ')}]`;
    if (ctx.frameUsed.length > 0) c += ` [frame ${ctx.frameUsed.map((k) => '#' + k).join(', ')}]`;
    if (node.structural?.ease !== undefined) c += ` [ease=${node.structural.ease}]`;
    if (resolveKind(this.catalog, node.kind) === 'param.ref') {
      const pid = node.structural?.param ?? '';
      c += ` → ${this.paramName.get(pid) ?? pid}`;
    }
    return c;
  }

  /** Emit a value node's temp declarations (+ any helper lines). */
  private emitValueNode(
    id: string,
    rng: { stable: () => number; frame: () => number },
    flags: { safeDiv: boolean; safeNormalize: boolean },
    out: string[],
    eases: Set<string>,
  ): void {
    const node = this.nodeById.get(id)!;
    const schema = this.schemaOf(node);
    const kind = resolveKind(this.catalog, node.kind);
    const gen = NODE_CODEGEN[kind];
    if (gen === undefined) throw new Error(`no codegen for value node kind ${kind}`);

    const ctx = new NodeCtx(id, this.slots, rng, flags);
    const inputs: Record<string, string> = {};
    for (const port of schema.inputs) inputs[port.id] = this.inputExpr(id, port.id).expr;
    const emit = gen(ctx, inputs, node.structural ?? {});
    for (const e of ctx.usedEases) eases.add(e);

    out.push(this.comment(node, ctx));
    for (const line of ctx.lines) out.push(line);
    for (const [name, type] of ctx.tempTypes) this.tempTypes.set(name, type);
    for (const portId of Object.keys(emit.outputs)) {
      const temp = this.outputTemp(id, portId);
      const port = schema.outputs.find((o) => o.id === portId);
      if (port !== undefined) this.tempTypes.set(temp, port.type);
      out.push(`  let ${temp} = ${emit.outputs[portId]};`);
    }
  }

  buildInit(
    valueIds: string[],
    outputIds: string[],
    flags: { safeDiv: boolean; safeNormalize: boolean },
  ): { body: string; eases: Set<string> } {
    let stable = 0;
    let frame = 0;
    const rng = { stable: () => stable++, frame: () => frame++ };
    const out: string[] = [];
    const eases = new Set<string>();
    for (const id of valueIds) this.emitValueNode(id, rng, flags, out, eases);

    const byKind = new Map<string, Node>();
    for (const id of outputIds) {
      const n = this.nodeById.get(id)!;
      byKind.set(resolveKind(this.catalog, n.kind), n);
    }

    const spawn = byKind.get('output.spawnPosition');
    const life = byKind.get('output.initLife');
    const vel = byKind.get('output.initVelocity');
    const tex = byKind.get('output.initTexIndex');

    const sp = this.inputExpr(spawn!.id, 'pos');
    out.push(`  let o_spawnLocal: vec2f = ${sp.expr};${sp.srcId ? ` // output.spawnPosition ← ${sp.srcId}` : ''}`);
    out.push(`  let o_initLife: f32 = ${this.inputExpr(life!.id, 'life').expr};`);
    out.push(
      vel !== undefined
        ? `  let o_initVel: vec2f = ${this.inputExpr(vel.id, 'vel').expr};`
        : `  let o_initVel: vec2f = vec2f(0.0);`,
    );
    out.push(
      tex !== undefined
        ? `  let o_texIndex: u32 = u32(${this.inputExpr(tex.id, 'index').expr});`
        : `  let o_texIndex: u32 = 0u;`,
    );
    void INIT_OUTPUT_ORDER;
    return { body: out.join('\n'), eases };
  }

  buildUpdate(
    valueIds: string[],
    outputIds: string[],
    flags: { safeDiv: boolean; safeNormalize: boolean },
  ): { body: string; postIntegrate: string; setVelocity: boolean; eases: Set<string> } {
    let stable = 0;
    let frame = 0;
    const rng = { stable: () => stable++, frame: () => frame++ };
    const out: string[] = [];
    const eases = new Set<string>();
    for (const id of valueIds) this.emitValueNode(id, rng, flags, out, eases);

    // writes: non-alpha first, alpha last, writePosition into postIntegrate
    const post: string[] = [];
    const alpha: Node[] = [];
    const normal: Node[] = [];
    let setVelocity = false;
    for (const id of outputIds) {
      const n = this.nodeById.get(id)!;
      const kind = resolveKind(this.catalog, n.kind);
      if (kind === 'output.setVelocity') setVelocity = true;
      if (kind === 'output.writeAlpha') alpha.push(n);
      else normal.push(n);
    }
    normal.sort((a, b) => naturalCompare(a.id, b.id));
    alpha.sort((a, b) => naturalCompare(a.id, b.id));

    for (const n of normal) this.emitUpdateWrite(n, out, post);
    for (const n of alpha) this.emitUpdateWrite(n, out, post);

    return { body: out.join('\n'), postIntegrate: post.join('\n'), setVelocity, eases };
  }

  /** Position-port wrapper for a node's `space` structural (world | emitter). */
  private spaceOf(node: Node): (expr: string) => string {
    return node.structural?.space === 'emitter'
      ? (expr: string) => `(U.emitterPos + ${expr})`
      : (expr: string) => expr;
  }

  private emitUpdateWrite(node: Node, out: string[], post: string[]): void {
    const kind = resolveKind(this.catalog, node.kind);
    const tag = ` // ${node.kind} (${node.id})`;
    const inp = (port: string) => this.inputExpr(node.id, port).expr;
    switch (kind) {
      case 'output.addForce':
        out.push(`  force += ${inp('force')};${tag}`);
        break;
      case 'output.drag':
        out.push(`  dragK += ${inp('drag')};${tag}`);
        break;
      case 'output.setVelocity':
        out.push(`  p.vel = ${inp('vel')};${tag}`);
        break;
      case 'output.writeColor':
        out.push(`  outColor = ${inp('color')};${tag}`);
        break;
      case 'output.writeAlpha':
        out.push(`  outColor.a = ${inp('alpha')};${tag}`);
        break;
      case 'output.writeScale':
        out.push(`  outSize = ${inp('scale')};${tag}`);
        break;
      case 'output.writeRotation':
        out.push(`  outRot = ${inp('rot')};${tag}`);
        break;
      case 'output.writePosition':
        post.push(`  p.pos = ${inp('pos')};${tag}`);
        break;
      case 'output.killIf':
        out.push(`  kill = kill || ${inp('cond')};${tag}`);
        break;
      case 'output.killIfOutOfRect':
        out.push(
          `  if (any(p.pos < ${inp('min')}) || any(p.pos > ${inp('max')})) { kill = true; }${tag}`,
        );
        break;
      case 'output.reflectInRect': {
        const mn = inp('min');
        const mx = inp('max');
        out.push(`  if (p.pos.x < ${mn}.x || p.pos.x > ${mx}.x) { p.vel.x = -p.vel.x; }${tag}`);
        out.push(`  if (p.pos.y < ${mn}.y || p.pos.y > ${mx}.y) { p.vel.y = -p.vel.y; }`);
        break;
      }
      // ---- solid geometry: resolve penetration, then bounce -----------------
      // These land in `post`, i.e. AFTER `p.pos += p.vel * dt`, so they see the
      // step that actually crossed the surface. Each one first pushes the
      // particle back onto the surface and only then reflects the normal
      // component of velocity — reflecting alone (reflectInRect) lets a fast
      // particle sit outside and flip sign every frame.
      case 'output.collidePlane': {
        const k = `k_${node.id}`;
        const at = this.spaceOf(node);
        post.push(`  {${tag}`);
        post.push(`    let ${k}_n: vec2f = ${inp('normal')} / max(length(${inp('normal')}), 1e-6);`);
        post.push(`    let ${k}_sd: f32 = dot(p.pos - ${at(inp('point'))}, ${k}_n);`);
        post.push(`    if (${k}_sd < 0.0) {`);
        post.push(`      p.pos = p.pos - ${k}_n * ${k}_sd;`);
        post.push(`      let ${k}_vn: f32 = dot(p.vel, ${k}_n);`);
        post.push(`      if (${k}_vn < 0.0) {`);
        post.push(`        let ${k}_vt: vec2f = p.vel - ${k}_n * ${k}_vn;`);
        post.push(
          `        p.vel = ${k}_vt * (1.0 - ${inp('friction')}) - ${k}_n * (${k}_vn * ${inp('restitution')});`,
        );
        post.push(`      }`);
        post.push(`    }`);
        post.push(`  }`);
        break;
      }
      case 'output.collideRect': {
        const k = `k_${node.id}`;
        const rest = inp('restitution');
        const fric = inp('friction');
        const at = this.spaceOf(node);
        post.push(`  {${tag}`);
        post.push(`    let ${k}_mn: vec2f = ${at(inp('min'))};`);
        post.push(`    let ${k}_mx: vec2f = ${at(inp('max'))};`);
        if ((node.structural?.mode ?? 'inside') === 'inside') {
          // a box the particles are kept inside
          for (const [axis, other] of [
            ['x', 'y'],
            ['y', 'x'],
          ] as const) {
            post.push(
              `    if (p.pos.${axis} < ${k}_mn.${axis}) { p.pos.${axis} = ${k}_mn.${axis};` +
                ` if (p.vel.${axis} < 0.0) { p.vel.${axis} = -p.vel.${axis} * ${rest};` +
                ` p.vel.${other} = p.vel.${other} * (1.0 - ${fric}); } }`,
            );
            post.push(
              `    if (p.pos.${axis} > ${k}_mx.${axis}) { p.pos.${axis} = ${k}_mx.${axis};` +
                ` if (p.vel.${axis} > 0.0) { p.vel.${axis} = -p.vel.${axis} * ${rest};` +
                ` p.vel.${other} = p.vel.${other} * (1.0 - ${fric}); } }`,
            );
          }
        } else {
          // a solid crate: eject along the axis of least penetration
          post.push(
            `    if (p.pos.x > ${k}_mn.x && p.pos.x < ${k}_mx.x && p.pos.y > ${k}_mn.y && p.pos.y < ${k}_mx.y) {`,
          );
          post.push(`      let ${k}_dl: f32 = p.pos.x - ${k}_mn.x;`);
          post.push(`      let ${k}_dr: f32 = ${k}_mx.x - p.pos.x;`);
          post.push(`      let ${k}_du: f32 = p.pos.y - ${k}_mn.y;`);
          post.push(`      let ${k}_dd: f32 = ${k}_mx.y - p.pos.y;`);
          post.push(
            `      let ${k}_m: f32 = min(min(${k}_dl, ${k}_dr), min(${k}_du, ${k}_dd));`,
          );
          post.push(
            `      if (${k}_m == ${k}_dl) { p.pos.x = ${k}_mn.x; p.vel.x = -abs(p.vel.x) * ${rest}; p.vel.y = p.vel.y * (1.0 - ${fric}); }`,
          );
          post.push(
            `      else if (${k}_m == ${k}_dr) { p.pos.x = ${k}_mx.x; p.vel.x = abs(p.vel.x) * ${rest}; p.vel.y = p.vel.y * (1.0 - ${fric}); }`,
          );
          post.push(
            `      else if (${k}_m == ${k}_du) { p.pos.y = ${k}_mn.y; p.vel.y = -abs(p.vel.y) * ${rest}; p.vel.x = p.vel.x * (1.0 - ${fric}); }`,
          );
          post.push(
            `      else { p.pos.y = ${k}_mx.y; p.vel.y = abs(p.vel.y) * ${rest}; p.vel.x = p.vel.x * (1.0 - ${fric}); }`,
          );
          post.push(`    }`);
        }
        post.push(`  }`);
        break;
      }
      case 'output.collideCircle': {
        const k = `k_${node.id}`;
        const inside = (node.structural?.mode ?? 'outside') === 'inside';
        const centre = this.spaceOf(node)(inp('center'));
        // relative velocity, so a MOVING disc kicks what it hits instead of
        // letting particles tunnel through the advancing face
        post.push(`  {${tag}`);
        post.push(`    let ${k}_d: vec2f = p.pos - ${centre};`);
        post.push(`    let ${k}_len: f32 = max(length(${k}_d), 1e-4);`);
        post.push(
          `    if (${k}_len ${inside ? '>' : '<'} ${inp('radius')}) {`,
        );
        post.push(`      let ${k}_n: vec2f = ${k}_d / ${k}_len;`);
        post.push(`      p.pos = ${centre} + ${k}_n * ${inp('radius')};`);
        post.push(`      let ${k}_rel: vec2f = p.vel - ${inp('velocity')};`);
        post.push(`      let ${k}_vn: f32 = dot(${k}_rel, ${k}_n);`);
        post.push(`      if (${k}_vn ${inside ? '>' : '<'} 0.0) {`);
        post.push(`        let ${k}_vt: vec2f = ${k}_rel - ${k}_n * ${k}_vn;`);
        post.push(
          `        p.vel = ${inp('velocity')} + ${k}_vt * (1.0 - ${inp('friction')}) - ${k}_n * (${k}_vn * ${inp('restitution')});`,
        );
        post.push(`      }`);
        post.push(`    }`);
        post.push(`  }`);
        break;
      }
      default:
        throw new Error(`unhandled output kind ${kind}`);
    }
  }
}
