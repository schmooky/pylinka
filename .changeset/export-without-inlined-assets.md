---
'@pylinka/format': minor
'@pylinka/core': minor
---

Projects can now be exported without their images inlined, and as a `.pylinka.zip` bundle.

An editor export carries every texture, sequence frame, emission mask and reference image as a base64 data URI, so the JSON is mostly pixels. `externalizeAssets` lifts each data URI out of the document and leaves a relative path (`assets/flame.png`) in its place; identical images are stored once. `bundleProject` writes that JSON as `project.json` next to the images under `assets/` and a `meta.json` (project id, name, format and catalog versions, systems, and per-asset mime, size, SHA-256 and the JSON pointers that use it). `unbundleProject` turns a bundle back into a self-contained document, and reads zips that were re-packed with deflate as well.

`createPylinka` takes a new `assetBase` option, so a project whose textures are relative paths loads them from next to its JSON rather than relative to the page.

In the editor, the Project menu gains "Export minimal JSON (no assets)" and "Export bundle (.zip)", and Import (and drag-and-drop) accepts `.pylinka.zip`.
