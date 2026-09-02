---
'@pylinka/graph': major
'@pylinka/core': major
'@pylinka/compiler': major
---

**Behaviour change:** angles in the catalog are DEGREES unless the node says otherwise.

Typing 45 into a radian port turns a sprite seven times round and lands somewhere arbitrary, which is indistinguishable from rotation not working — and that is how it was reported. `output.initRotation`, `output.writeRotation` and `gen.spin` now carry a structural `unit` (`degrees` by default, `radians` if you say so). The unit lives on the DESTINATION, so it is set once per angle rather than on every node feeding it, and a `math.radians` node in front of a port still wins: graphs that convert for themselves — including every recipe — are untouched, and neither backend converts twice.

`gen.spin`'s default rate moved from `π` to `180`, which is the same half-turn a second in the new unit, and `gen.rotationOverLife`'s `to` moved from `2π` to `360` for the same reason. Both backends read the unit the same way, so a preview and a shipped game agree about what 45 means.

Also: `output.deathBurst`'s `max` offered powers of two, which reads like a hardware limit and is not one — it is a ceiling on children per parent event, sizing the child pool and the per-frame passes. The options are useful numbers now (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64), and a new `W104_BURST_CLAMPED` warning fires when `countMax` asks for more than that ceiling, which used to just silently drop the extra children.
