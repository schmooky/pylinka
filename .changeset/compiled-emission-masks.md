---
"@pylinka/core": minor
"@pylinka/compiler": minor
---

Emission masks now work on the compiled WebGPU and WebGL2 backends. A painted mask is rasterised into a point table of emitter-relative spawn offsets; the compiled emit kernel samples one per spawn instead of the graph's analytic shape (matching the interpreted backend). WebGPU binds the table as a read-only storage buffer (binding 7); WebGL2 samples an RG32F texture. `CompiledParticlesOptions` gains `emissionMask`. The compiler's emit/step scaffolds gained the mask sampling (emit WGSL binding + WebGL2 step uniforms); the update kernel is unchanged.
