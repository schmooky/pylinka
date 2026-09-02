---
'@pylinka/core': minor
---

`ParticlesHandle.clearColor` — what `autoClear` clears the canvas to, as straight `[r,g,b,a]` in 0..1. Defaults to fully transparent, so nothing changes unless you set it. Available on the interpreted and both compiled backends.

This exists because of what a light blend mode can actually reach. `add` and `screen` add to the pixels in the SAME framebuffer; they cannot add to the page behind a transparent canvas. So an additive effect on a transparent canvas behaves as if the backdrop were black, and an opaque sprite drawn on black covers whatever is really behind the canvas rather than keying itself out. Clearing to the colour the effect will actually play on gives the light somewhere to land.

Worth recording what does NOT work, since it looks obviously right: holding the destination alpha at 0 so the page shows through. The canvas is premultiplied, so RGB carrying light at alpha 0 is not a representable colour and the compositor discards the pixel — measured, an additive emitter rendered nothing at all. The blend functions are unchanged.
