---
'@pylinka/graph': patch
---

`W107_EMITTER_NEVER_FIRES`: a repeating burst with no count or no interval.

The scheduler counts down an interval to decide when to fire, so `0` is not "as fast as possible" — it is an emitter that silently emits nothing, forever. The editor clamps the field, but an imported or hand-written project can hold it, and an emitter that produces nothing looks like a broken graph rather than a setting.
