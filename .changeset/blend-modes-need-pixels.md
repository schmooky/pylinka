---
'@pylinka/core': patch
---

Document what a light blend mode can actually reach, and stop a fix that broke it.

`add` and `screen` add to the pixels in the SAME framebuffer. They cannot add to the page behind a transparent canvas, so an additive effect over a transparent clear behaves as if the backdrop were black, and an opaque sprite's black background covers whatever is really behind the canvas.

An attempt to fix that by holding the destination alpha at 0 made it worse: the canvas is premultiplied, so RGB carrying light with alpha 0 is not a representable colour and the compositor discards the pixel — an additive emitter rendered nothing at all. The blend functions are unchanged; what was missing was somewhere for the light to land. Give the canvas a backdrop of its own and the modes behave.
