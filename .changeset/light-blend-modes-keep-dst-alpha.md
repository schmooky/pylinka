---
'@pylinka/core': patch
---

Fix `add` and `screen`: they composited exactly like `normal` over anything behind the canvas.

Both blended the destination ALPHA as well as colour, so an opaque sprite — a glow drawn on black, which is precisely the asset additive exists for — drove the canvas alpha to 1 across its whole quad. The canvas then composited as opaque, and the sprite's black background covered the scene instead of dropping out. Measured before the fix, an opaque sprite gave byte-identical pixels in `add` and `normal`: `[0,0,0,255]` for the sprite's black area in both.

The light modes now keep the destination alpha, so the browser composites `backdrop + light` — what additive means. On a black preview nothing changes; over a scene it is finally right. Fixed in all three backends.
