/**
 * WebGPU render pipeline WGSL (REQUIREMENTS.md §13.8). One instanced draw per
 * system: 6 verts from a const corner array, instance data pulled straight
 * from the sim's hot/rnd/meta buffers (they are created STORAGE | VERTEX).
 * R.atlas = (cols, rows, sizeScale, unused) — .z carries the preview
 * size-scale option in the slot the spec leaves unused.
 */
export const RENDER_WGSL = /* wgsl */ `
struct RenderUniforms {
  scaleOffset: vec4f, // sx, sy, ox, oy
  grid: vec4f,        // cols, rows, sizeScale, pad(px)
  anim: vec4f,        // fps, play(0 once / 1 loop), pick(0 per-particle / 1 fixed), fixedRow
  frame: vec4f,       // frameW, frameH, atlasW, atlasH (px)
}
@group(0) @binding(0) var<uniform> R: RenderUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

const CORNERS = array<vec2f, 6>(
  vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5),
  vec2f(-0.5, 0.5),  vec2f(0.5, -0.5), vec2f(0.5, 0.5));

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) tint: vec4f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32,
      @location(0) pos: vec2f, @location(1) color: vec4f,
      @location(2) size: f32,  @location(3) rot: f32, @location(4) flags: u32,
      @location(5) age: f32,   @location(6) life: f32, @location(7) seed: u32) -> VSOut {
  let corner = CORNERS[vi];
  let s = size * f32(flags & 1u) * R.grid.z;
  let c = cos(rot); let sn = sin(rot);
  let local = vec2f(corner.x * c - corner.y * sn, corner.x * sn + corner.y * c) * s;
  let world = pos + local;

  // atlas cell: column advances with life, row is per-particle (or fixed).
  let cols = max(R.grid.x, 1.0);
  let rows = max(R.grid.y, 1.0);
  let tN = clamp(age / max(life, 1e-4), 0.0, 1.0);
  let seedN = f32(seed & 0xffffu) / 65536.0;
  let row = clamp(select(floor(seedN * rows), R.anim.w, R.anim.z > 0.5), 0.0, rows - 1.0);
  let col = select(clamp(floor(tN * cols), 0.0, cols - 1.0),
                   floor(age * R.anim.x) % cols, R.anim.y > 0.5);
  let cellPx = vec2f(col, row) * (R.frame.xy + R.grid.w);

  var o: VSOut;
  o.clip = vec4f(world * R.scaleOffset.xy + R.scaleOffset.zw, 0.0, 1.0);
  o.uv = (cellPx + (corner + 0.5) * R.frame.xy) / R.frame.zw;
  o.tint = color;
  return o;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let t = textureSample(tex, samp, in.uv);
  return vec4f(t.rgb * in.tint.rgb * in.tint.a, t.a * in.tint.a);
}
`;

/** §13.1 blend states, premultiplied output assumed. */
export function blendState(mode: 'normal' | 'add' | 'screen'): GPUBlendState {
  switch (mode) {
    case 'add':
      return {
        color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      };
    case 'screen':
      return {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      };
    default:
      return {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      };
  }
}
