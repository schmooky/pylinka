---
'@pylinka/core': minor
---

A handle stays bound to the system it was created for, even after a rename.

`apply()` re-resolved the system by NAME on every live edit, with a fall-through to "the first enabled system". Renaming an emitter therefore did not fail — the handle silently rebound to a different system and started rendering another effect. In the editor, where renaming a tab does not rebuild the preview, that is exactly what happened. Handles now re-resolve by system id, which survives a rename, and fall back to the name only if the id is gone.

A `systemName` that matches nothing still falls back rather than throwing — a game asking for an effect that was renamed should not go down — but it now warns once, naming the systems the project does have. It used to play a different effect in silence.

`pickSystem` moved to its own module (`@pylinka/core` internals) so the interpreted WebGL path no longer imports the WebGPU one to ask which system to run, and takes an optional third `systemId` argument.
