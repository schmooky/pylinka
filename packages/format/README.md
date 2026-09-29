# @pylinka/format

The project file format of [Pylinka](https://pylinka.schmooky.dev), a GPU-driven node-based
particle system for PixiJS.

Anything you export from the [editor](https://pylinka.schmooky.dev/editor) is a `pylinka` project
document, and this package is the supported way to read and write one.

`parse` validates and loads a project JSON. It gives clear errors and never throws on keys it does
not recognise, so a document written by a newer editor still opens in an older runtime.

`serialize` writes a project back out with assets either inlined as base64, giving you one portable
file, or kept as blob references.

`migrate` runs versioned schema migrations, which is what keeps old project files loading after the
format moves on.

`bundleProject` / `unbundleProject` write and read a `.pylinka.zip`: `project.json` with every image
replaced by an `assets/…` path, the images themselves, and a `meta.json` describing the project and
each asset. `externalizeAssets` does the first half alone, for a minimal JSON when your game ships
its textures some other way.

```bash
npm i @pylinka/format
```

The usual flow: export from the editor, ship the JSON with your game, hand it to
`createParticles()` from [`@pylinka/core`](https://www.npmjs.com/package/@pylinka/core).

Docs, the node editor and 69 recorded effects: **https://pylinka.schmooky.dev**

MIT © pylinka contributors
