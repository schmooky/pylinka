import type { APIRoute } from 'astro';

// llms.txt — a concise, link-rich summary for AI/answer engines (llmstxt.org).
export const GET: APIRoute = ({ site }) => {
  const b = (site ?? new URL('https://pylinka.schmooky.dev')).origin;
  const body = `# Pylinka

> Pylinka is an open-source (MIT), GPU-driven, node-based particle system for PixiJS. You wire a typed dataflow graph of nodes (Position, Velocity, Age, Noise, AddForce, ColorOverLife, …) and it compiles to GPU programs; particles live and update entirely on the GPU. Every value is live-tweakable (inline literals become uniforms), so editing never recompiles. WebGPU first, WebGL2 transform-feedback fallback — built for slot games on real phones.

Key facts:
- Package: \`@pylinka/core\` (runtime), \`@pylinka/graph\`, \`@pylinka/compiler\`, \`@pylinka/format\`.
- Quickest usage: \`import { createParticles } from '@pylinka/core/webgl'\` — a WebGL2 transform-feedback engine that runs in any WebGL2 browser, no WebGPU required.
- 2D only (state is vec2; no vec3). Not a general GPGPU framework, no physics solver — analytic force fields and simple bounds only.
- Backend follows the host PixiJS renderer: a WebGL app gets the WebGL2 sim in the same GL context; a WebGPU app shares the device.
- License: MIT. Repository: https://github.com/schmooky/pylinka
- Supports textured sprite sequences (e.g. a random spinning coin) via a uniform atlas grid.

## Docs
- [Introduction](${b}/): what Pylinka is and why (GPU owns the particles, everything live, typed dataflow graph, backend follows the host).
- [Getting started](${b}/getting-started): install and render your first effect on a canvas; move the emitter, set knobs, spawn bursts.
- [Core concepts](${b}/concepts): Project/System/Graph, values vs. structure, knobs, world-space emitters, emission modes, pools, determinism.
- [Node reference](${b}/nodes): the full v1 node catalog (input, param, gen, math, field, shape, output, tex).
- [API](${b}/api): createPylinka, ParticleSystemView, KnobBus, device-loss handling, createParticles.

## Examples
- [Recipes](${b}/recipes): 44 ready-made particle effects (trails, fire, magic, ambient, UI, abstract), each a real Pylinka project.
- [Editor](${b}/editor): a node-graph editor with a live WebGL preview that updates on every edit with zero recompile.
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
