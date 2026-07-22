import type { APIRoute } from 'astro';
import { RECIPES } from '../recipes/data';

// llms.txt — a concise, link-rich summary for AI/answer engines (llmstxt.org).
export const GET: APIRoute = ({ site }) => {
  const b = (site ?? new URL('https://pylinka.schmooky.dev')).origin;
  const body = `# Pylinka

> Pylinka is an open-source (MIT) GPU-driven, node-based particle system for PixiJS. You wire a typed dataflow graph of nodes (Position, Velocity, Age, Noise, AddForce, ColorOverLife and so on) and it compiles to GPU programs, so particles live and update entirely on the GPU. Every value is live-tweakable, because inline literals become uniforms, which means editing a number never recompiles. WebGPU first, WebGL2 transform feedback everywhere else, built for slot games running on phones.

Key facts:
- Packages: \`@pylinka/core\` (runtime), \`@pylinka/graph\`, \`@pylinka/compiler\`, \`@pylinka/format\`. All at 1.0.
- Quickest usage: \`import { createParticles } from '@pylinka/core/webgl'\`, a WebGL2 transform-feedback engine that runs in any WebGL2 browser with no WebGPU required.
- 2D only: state is vec2, there is no vec3. It compiles particle graphs rather than acting as a general GPGPU framework, so you get analytic force fields and simple solid bounds instead of a physics solver.
- Particles can react to the world: \`field.obstacle\` is a moving body with a push, a swirl and a carry term that gives it a bow wave and a wake, and \`output.collidePlane\`/\`collideRect\`/\`collideCircle\` give floors, walls, boxes and discs with restitution and friction. Their geometry reads in world or emitter space. Bind a vec2 knob to drive any of it from a cursor.
- Backend follows the host PixiJS renderer: a WebGL app gets the WebGL2 sim in the same GL context, a WebGPU app shares the device.
- Context loss is handled: a lost WebGL context stops the effect, and the effect rebuilds itself when the browser restores it. WebGPU device loss is reported to the host, which owns the device.
- Supports textured sprite sequences (a random spinning coin, for instance) through a uniform atlas grid.
- License: MIT. Repository: https://github.com/schmooky/pylinka

## Docs
- [Introduction](${b}/): what Pylinka is, how the GPU owns the particles, why every number stays live.
- [Getting started](${b}/getting-started): install and render your first effect on a canvas, move the emitter, set knobs, spawn bursts.
- [Core concepts](${b}/concepts): projects, systems and graphs, what costs a recompile, knobs, world-space emitters, emission modes, forces and obstacles and solids, pools, determinism.
- [Node reference](${b}/nodes): the full v1 node catalog (input, param, gen, math, field, shape, output, tex).
- [API](${b}/api): createPylinka, ParticleSystemView, KnobBus, vec2 knobs, context and device loss, createCompiledParticles.

## Examples
- [Recipes](${b}/recipes): ${RECIPES.length} ready-made particle effects (trails, fire, magic, ambient, UI, abstract, swirl, drawn, physics, combo), each a real Pylinka project you can open in the editor.
- [Interaction lab](${b}/interactive): a live sandbox where a flying obstacle and the cursor push a particle field around and heavier sparks collide with walls, a crate and the obstacle.
- [Editor](${b}/editor): a node-graph editor with a live WebGL preview that updates on every edit with no recompile.
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
