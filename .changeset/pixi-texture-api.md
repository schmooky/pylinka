---
"@pylinka/core": minor
---

Add an official texture/atlas API to the PixiJS runtime

`createPylinka` / `createParticleSystem` now accept a `textures` map (and single
`texture`) so systems render real art instead of the built-in soft disc. A
texture can be a URL, a `TexImageSource`, or a pixi `Texture`, and carries atlas
options for animated sprite sheets: `cols`/`rows`, `frameW`/`frameH`, `pad`,
`fps`, `play` (`loop`|`once`) and `pick` (`per-particle`|`per-spawn`). New
`resolveTexture` / `loadImage` / `toTexImageSource` helpers are exported.
