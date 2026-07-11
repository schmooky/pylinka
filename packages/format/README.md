# @pylinka/format

Project file format of [Pylinka](https://pylinka.schmooky.dev) — a GPU-driven, node-based
particle system for PixiJS.

Everything you export from the [Pylinka editor](https://pylinka.schmooky.dev/editor) is a
`pylinka` project document. This package is the one true way to read and write it:

- **Parse** — validate + load a project JSON (clear errors, never throws on foreign keys).
- **Serialize** — write projects with assets either **inline** (base64, single portable file) or
  as **blob references**.
- **Migrate** — versioned schema migrations so old project files keep loading in new runtimes.

```bash
npm i @pylinka/format
```

Typical flow: export a project from the editor, ship the JSON with your game, and hand it to
`createParticles()` from
[`@pylinka/core`](https://www.npmjs.com/package/@pylinka/core).

Docs, node editor, and a 60+ effect recipe gallery: **https://pylinka.schmooky.dev**

MIT © pylinka contributors
