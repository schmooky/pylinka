---
"@pylinka/core": patch
---

Render particles into pixi's current render target (filters, cache-as-texture)

The particle draw computed its clip-space transform from the screen size, so a
system inside a filtered or cached-as-texture container drew off the off-screen
FBO and vanished. It now composes pixi's current render-target projection with
the view's world transform (identical to the old maths for the screen, so
unfiltered rendering is unchanged). A particle view still reports empty bounds —
its particles live on the GPU — so to filter/mask-to-texture a container, set its
`boundsArea` to the region to capture.
