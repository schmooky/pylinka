---
'@pylinka/core': minor
---

A structural edit to a running effect starts from now, on the interpreted backend too.

Uniforms are read every frame, so a changed VALUE has always reached the next spawn immediately. Particles already alive re-read nothing, though — delete the node that shaped the spawn area and everything currently on screen keeps the old shape until it dies. With a two-second lifetime that is indistinguishable from the deletion not having taken effect, and the next unrelated edit that happens to force a rebuild then snaps it, so the rebuild looks like the fix.

`apply()` now compares a graph hash and clears the pool when the STRUCTURE changed — a node or a wire added or removed — which is what the compiled backends have always done, since a changed graph means a changed kernel there. Value edits still leave the pool alone: you are tuning a running effect, and wiping it on every keystroke would make tuning impossible.
