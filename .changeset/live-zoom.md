---
'@pylinka/core': minor
---

`zoom` is settable on a running handle, on all three backends.

It was a construction-time option, so anything wanting to zoom a live effect had to scale the finished canvas instead — magnifying a raster rendered at the un-zoomed size, which blurs, worse the further in you go. `handle.zoom = 0.5` now shows half as much world at full resolution. Zero and negative values are ignored rather than blanking the view.

The editor uses it for both halves of a bug the preview had: it grows the canvas buffer with the zoom so a magnified view is drawn rather than stretched, and it sets `zoom = 1 / devicePixelRatio` so that world units are CSS pixels. Effects used to be measured in DEVICE pixels there, which meant the same project rendered half-size on a 2× display — a particle authored at 8px covering 8 device pixels rather than 8 CSS ones.

The runtime default is unchanged: `zoom: 1` still means one world unit per canvas pixel.
