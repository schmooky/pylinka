// AssetPack config — the ASSET PIPELINE for this example.
//
// It reads `raw-assets/`, copies/optimises files into `public/`, and (the point
// of the demo) emits a `public/manifest.json` that pixi's Assets can boot from.
// Run it with `pnpm assets` — `predev`/`prebuild` also run it automatically, so
// `pnpm dev` always has a fresh manifest.
//
// This config uses only the manifest pipe (no native image codecs), so it runs
// anywhere. Add `@assetpack/core/image` / `/texture-packer` pipes for real
// compression + atlases in production.
import { pixiManifest } from '@assetpack/core/manifest';

export default {
  entry: './raw-assets',
  output: './public',
  pipes: [
    // one manifest bundle per top-level folder under raw-assets (here: "vfx"),
    // with an alias per file so pixi can load them by name.
    pixiManifest({ createShortcuts: true, includeMetaData: false }),
  ],
};
