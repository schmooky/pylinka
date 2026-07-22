# atlas-extract

Pulls the coin flip, 10 frames, out of the piggy-cash Spine/libgdx atlas. It un-trims and
re-centres every frame so the alpha comes out straight, bakes seven tinted colour variants (gold,
ruby, emerald, sapphire, amethyst, rose, silver) and packs the lot into one pixi spritesheet with a
row per colour.

```bash
pnpm --filter @pylinka/atlas-extract exec node extract.mjs
```

The source atlas and its page are downloaded on the first run and cached in `.cache/`. Output goes
to `apps/site/public/atlas/coins.{png,json}`.

## Output

`coins.json` is a standard pixi spritesheet, so pixi can use it as-is:

```ts
const sheet = await Assets.load('/atlas/coins.json');
const coin = new AnimatedSprite(sheet.animations.coin_gold); // or coin_ruby, and so on
coin.play();
```

It also carries a `pylinka` block describing the uniform grid (`cols: 10, rows: 7, frameW: 138,
frameH: 138, pad: 2`). That is what the interpreted WebGL runtime reads to give every particle its
own spinning coin.

Source: a Spine `game_elements.atlas`, of which only `cup/coin/coin_1..10` is used.
