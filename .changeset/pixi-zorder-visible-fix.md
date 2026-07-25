---
"@pylinka/core": patch
---

Fix PixiJS z-order and `visible` corruption in the render pipe

Particle views now render at their true position in the scene graph, so they
layer correctly against sibling containers, `Graphics`, and `Text` instead of
always drawing on top. Toggling a view's `visible` no longer leaks GL state onto
other containers. This is what makes pylinka usable inside a real pixi app.
