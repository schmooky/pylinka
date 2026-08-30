---
'@pylinka/core': minor
---

`@pylinka/core/webgl` says which nodes it cannot run.

The interpreted backend recognises node patterns instead of evaluating the graph — that is what keeps it small and lets it live-edit without recompiling — so a kind it does not recognise contributes nothing at all. Silently: the effect just comes out wrong, with no error, until you work out that the compiled backends run the whole catalog and this one runs 35 kinds of it. Whole namespaces are affected, `math.*` and `input.*` among them, along with `output.setVelocity`, `writePosition`, `killIf`, `killIfOutOfRect` and `reflectInRect`.

New exports `INTERPRETED_KINDS`, `isInterpreted(kind)` and `unsupportedNodes(system)` make that list something a tool can read. `output.addForce`, `output.drag`, `output.writeColor` and the `tex.*` pair count as supported: this backend reads the field or ramp node behind them rather than the output itself, so the effect still lands. A test holds the list against the source of `params.ts`, so support added there without a line in the list fails the build.

The editor uses it to mark those nodes `inert` while the interpreted backend is the one running.
