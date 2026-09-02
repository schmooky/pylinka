---
'@pylinka/core': minor
---

`handle.viewOffset` — pan the view without moving the effect.

`[x, y]` in world units, subtracted before the world is mapped to the screen, so the same particles are drawn through a window that slid. It pairs with the live `zoom` added alongside it: together they are a full view transform inside the renderer, which is where a view belongs. Transforming the canvas ELEMENT instead moves finished pixels — it slides the drawn area out of its own viewport and leaves an empty margin, and it does not compose with a rendered zoom.

`setEmitter` maps its canvas pixels through the offset as well as the zoom, so a panned view no longer drags the emitter along with the window. With the default view (`[0, 0]`, zoom 1) nothing changes.

The editor now sets both instead of CSS-transforming its canvas, which never scales or translates again.

Measured on a real context — 200×200 canvas, emitter centred, particles read back with `readPixels`: the centroid sat at (100, 101), and with `viewOffset = [40, 25]` it sat at (60, 76). The exact shift, in the opposite direction.
