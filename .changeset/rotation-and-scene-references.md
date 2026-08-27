---
'@pylinka/graph': minor
'@pylinka/compiler': minor
'@pylinka/core': minor
---

Rotation you can actually author.

`output.writeRotation` existed, but nothing an artist could wire into it made a sprite turn: the interpreted WebGL backend never read an angle at all, and no node could set one at spawn. Three nodes close the gap.

- `output.initRotation` — the angle a particle is born at. Feed it a `gen.randomRange` so each one starts somewhere different, or a literal to pin them all. Previously every particle spawned at zero, so a burst spun in lockstep and read as one rigid object.
- `gen.spin` — an angular velocity in radians per second, integrated over the particle's own age. This is the term that was missing: feeding a constant into `output.writeRotation` sets an angle, it does not turn anything.
- `gen.rotationOverLife` — an eased sweep between two angles, for a tile that turns exactly ninety degrees as it falls and then stops.

Plus `math.radians`, since every angle port in the catalog is radians and artists type degrees.

All three terms sum, so a shard can start at a random angle, tumble at its own rate, and settle. The interpreted backend derives the angle from the seed and age each particle already carries rather than widening the particle state, and rotates the sprite quad rather than the texture lookup, so an atlas cell turns instead of shearing. The compiled backends already drew with an angle and now honour the spawn-time write.
