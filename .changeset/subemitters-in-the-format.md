---
'@pylinka/graph': minor
'@pylinka/core': minor
---

Sub-emitter links are part of the project format, and loading one wires them up.

A system whose particles are born from another's was stored as `subEmitters` on the project — an undeclared extra key, written by the editor and read by nothing on the loading side. `PylinkaProject` had no such field, `createParticles` never looked for it, and `createCompiledParticles` did not either: a project that worked in the editor came back from a file as a set of unrelated systems, with the child spawning at its own emitter instead of on its parent's deaths. It read as the link not having been saved. It was saved; nothing read it.

`subEmitters` is now a documented field on `PylinkaProject` (`child system id` → `parent system id`), part of the document rather than editor decoration.

New in `@pylinka/core`: `systemsInBuildOrder(project)` returns the enabled systems parents-first along with the links that survived (a link to a muted or missing system is dropped rather than taking the child down with it; a cycle keeps its systems), and `buildProject(project, create)` walks that order, hands each child its parent's handle, and returns something that steps every system in the same order — a child reads the parent's state from the frame it is in, so the parent has to move first.

The pixi runtime already resolved the links and is unchanged; the editor now shares the same ordering rather than keeping a second copy of it.
