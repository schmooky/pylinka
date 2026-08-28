---
'@pylinka/site': patch
---

Fix the preview's tool palette: it was painted over by the canvas, so clicks fell straight through to the pan handler and none of the tools could be selected.
