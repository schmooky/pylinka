---
'@pylinka/core': minor
---

The pixi runtime carries emission masks and sub-emitter links.

`createPylinka` built each enabled system on its own, so two things the compiled sims underneath have always supported never reached them through this path: painted **emission masks**, and **sub-emitters** — a system whose particles are born from another system's. Anything built on the pixi integration silently lost both, which reads as broken rather than unsupported.

New options: `emissionMask` / `emissionMasks` (per system name), and `subEmitters` as `child name → parent name`. An editor project's own `subEmitters` map is read when the option is absent, translating its system IDs to names. Parents are built before their children, since the two share GPU buffers; a link to a muted or missing system is dropped rather than throwing, so muting one emitter does not take its children down with it.
