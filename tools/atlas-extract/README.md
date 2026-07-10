# atlas-extract

Extracts the **coin flip** (10 frames) from the piggy-cash Spine/libgdx atlas,
un-trims + re-centres each frame (clean straight alpha), bakes **tinted colour
variants** (gold · ruby · emerald · sapphire · amethyst · rose · silver), and
packs them into one **pixi spritesheet** — one row per colour.

```bash
pnpm --filter @pylinka/atlas-extract exec node extract.mjs
```

Downloads the source atlas + page on first run (cached in `.cache/`), writes to
`apps/site/public/atlas/coins.{png,json}`.

## Output

`coins.json` is a standard pixi spritesheet, so it works directly with pixi:

```ts
const sheet = await Assets.load('/atlas/coins.json');
const coin = new AnimatedSprite(sheet.animations.coin_gold); // or coin_ruby, …
coin.play();
```

It also carries a `pylinka` block describing the uniform grid
(`cols: 10, rows: 7, frameW: 138, frameH: 138, pad: 2`), which the pylinka WebGL
runtime uses to spin a random coin per particle.

Source: a Spine `game_elements.atlas`; only `cup/coin/coin_1..10` is used.
