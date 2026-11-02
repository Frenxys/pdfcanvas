# pdfcanvas

**A client-side PDF editor engine for the browser.** Render PDFs with pdf.js, place Canva-style objects on top, move pages around, then export a real vector PDF with pdf-lib. No server, no upload, no license key.

[![npm](https://img.shields.io/npm/v/pdfcanvas.svg)](https://www.npmjs.com/package/pdfcanvas)
[![license](https://img.shields.io/npm/l/pdfcanvas.svg)](./LICENSE)

- Website / playground: https://pdf.eneawork.it
- Source: https://github.com/Frenxys/pdfcanvas

> Status: `0.8.x`. The editing model and public API are usable but may still change.

## Features

- **PDF.js rendering** with lazy pages, zoom, fit-to-width and DPR-aware canvases.
- **Edit existing PDF text in place** with PDFium WASM, the same engine Chrome uses. Per-character PDFs are grouped into editable line runs.
- **Font matching** with bundled Work Sans and Arial-metric Liberation Sans when the original embedded font cannot be reused.
- **Scene objects**: text, images, rectangles, ellipses, lines, freehand pen, highlighter and whiteout.
- **Direct manipulation**: drag, resize, centre snapping, arrow-key nudge, duplicate, z-order, delete.
- **Text editing** in place, with font family, size, weight, style, colour and alignment.
- **Page management**: insert blank pages, duplicate, delete, reorder by drag or buttons, rotate.
- **Text boxes** grow with their content or wrap after a side-handle resize; wrapped text exports as wrapped PDF text.
- **Undo / redo** with snapshots (object and page operations).
- **Vector export**: original pages stay vector; overlays are drawn as PDF text, shapes and images.
- **Everything local**: the PDF never leaves the browser. The worker is self-hosted by the app.
- **Framework agnostic**: plain TypeScript + DOM. React, Vue, Svelte or vanilla.
- **Complete editor UI**: `pdfcanvas/editor` ships the full toolbar, page rail, property inspector, text formatting bar, signature pad, local templates and IndexedDB autosave.

## Install

```bash
npm install pdfcanvas pdfjs-dist pdf-lib @embedpdf/pdfium
```

`pdfjs-dist`, `pdf-lib` and `@embedpdf/pdfium` are dependencies of the package, but installing them explicitly keeps your lockfile and worker paths obvious.

## Quick start

```ts
import { PdfCanvas } from "pdfcanvas";

const editor = new PdfCanvas(document.querySelector("#editor")!, {
  // Required: self-host the pdf.js worker (see below).
  workerSrc: "/pdfjs/pdf.worker.min.mjs",
  cMapUrl: "/pdfjs/cmaps/",
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  pdfiumWasmUrl: "/pdfium/pdfium.wasm",
  fontAssetsUrl: "/fonts/",
  initialZoom: "fit-width",
});

await editor.load(file); // File | Blob | ArrayBuffer | Uint8Array | URL
editor.setTool("text-edit");   // click an existing text line to edit it
editor.addText(80, 120, { text: "Hello", fontSize: 24, color: "#6b4eff" });
editor.addShape("rect", { x: 80, y: 180, width: 200, height: 90 });
await editor.download();            // downloads "file-pdfcanvas.pdf"
```

Existing text can be edited with the `text-edit` tool, or by double-clicking a text line with the Select tool. Use `updateOriginalText()` to change the selected line's bold/italic/size/colour:

```ts
editor.on("originaledit", ({ edit }) => {
  if (edit) editor.updateOriginalText({ boldOverride: true });
});
```

The `#editor` element needs a height (for example `height: 100vh` or a flex child with `min-height: 0`).

## Full editor, one import

`pdfcanvas/editor` is the ready-made Canva-style shell. It builds the top bar, tools, pages panel, inspector, contextual original-text toolbar, signature dialog, templates, autosave and mobile drawers around the same core.

```ts
import { PdfCanvasEditor } from "pdfcanvas/editor";

const editor = new PdfCanvasEditor(document.querySelector("#app")!, {
  workerSrc: "/pdfjs/pdf.worker.min.mjs",
  pdfiumWasmUrl: "/pdfium/pdfium.wasm",
  fontAssetsUrl: "/fonts/",
  locale: "auto",                       // "auto" | "en" | "it"
  brandName: "PdfCanvas",
  brandHref: "https://pdf.eneawork.it",
  brandTarget: "_blank",                // "_self" to stay in the same tab
  sampleUrl: "/sample.pdf",             // optional “Try a sample” button
  autosave: { key: "my-project", debounce: 600 },
  templates: [],                        // omit for the bundled templates
});

await editor.ready();                   // autosaved project restored, if any
await editor.open(file);
```

`autosave` stores the original PDF bytes plus the scene in IndexedDB. Nothing is uploaded. Use a distinct `key` per document. Call `destroy()` to release listeners and DOM.

Language defaults to `auto`: English unless the browser prefers Italian (`en` and `it` are supported). Pass `locale: "en"` or `"it"` to force one. `detectLocale()` is exported if you need the resolved value.

### Editor API

```ts
await editor.open(source, "name.pdf");
await editor.download();
await editor.ready();
await editor.applyTemplate(template);
editor.registerTemplate(template);
editor.destroy();

editor.core        // the underlying PdfCanvas instance (same API as above)
```

```ts
interface EditorTemplate {
  id: string;
  name: string;
  description?: string;
  objects: EditorTemplateObject[];
}
```

Template objects are positioned in PDF points from the top-left of the page. Text objects accept `text`, `fontSize`, `fontFamily`, `bold`, `italic`, `color`; shape objects accept `shape`, `width`, `height`, `fill`, `stroke`, `strokeWidth`.

The editor CSS is injected on first mount, so there is no stylesheet import to forget. When `fontAssetsUrl` points at the packaged `assets/fonts/` folder, the editor also loads the bundled Space Grotesk and Fraunces WOFF2 files for the same typography as the hosted editor; otherwise it falls back to system fonts.

### Self-host the pdf.js worker

Copy these from `node_modules/pdfjs-dist` to a public folder:

```text
build/pdf.worker.min.mjs        -> public/pdfjs/pdf.worker.min.mjs
cmaps/                          -> public/pdfjs/cmaps/
standard_fonts/                 -> public/pdfjs/standard_fonts/
wasm/                           -> public/pdfjs/wasm/
@embedpdf/pdfium/dist/pdfium.wasm -> public/pdfium/pdfium.wasm
assets/fonts/                    -> public/fonts/   (PDF fallback + editor UI fonts)
```

```ts
new PdfCanvas(el, {
  workerSrc: "/pdfjs/pdf.worker.min.mjs",
  cMapUrl: "/pdfjs/cmaps/",
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  pdfiumWasmUrl: "/pdfium/pdfium.wasm",
  fontAssetsUrl: "/fonts/",
});
```

A bundler can also emit the worker URL for you:

```ts
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
new PdfCanvas(el, { workerSrc: workerUrl });
```

The worker is **never** loaded from a CDN by the library, so documents stay on the user's device.

## API

### Constructor

```ts
new PdfCanvas(container: HTMLElement, options?: PdfCanvasOptions)
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `workerSrc` | `string` | — | **Required.** pdf.js worker URL. |
| `cMapUrl` | `string` | — | Directory with pdf.js CMaps. |
| `standardFontDataUrl` | `string` | — | Directory with pdf.js standard fonts. |
| `wasmUrl` | `string` | — | Directory with pdf.js WASM decoders. |
| `pdfiumWasmUrl` | `string` | — | PDFium WASM URL. Enables editing original text. |
| `fontAssetsUrl` | `string` | — | URL of the bundled fallback fonts directory. |
| `initialZoom` | `number \| "fit-width" \| "fit-page"` | `1` | Initial zoom. |
| `minZoom` / `maxZoom` | `number` | `0.15` / `5` | Zoom limits. |
| `historyLimit` | `number` | `60` | Undo steps kept in memory. |
| `maxFileSize` | `number` | `200 MB` | Maximum accepted PDF size, in bytes. |
| `accent` | `string` | `#6b4eff` | Selection UI colour. |
| `onError` | `(error: Error) => void` | — | Non-fatal error hook. |

### Loading and exporting

```ts
await editor.load(source, { fileName?: string });
const bytes = await editor.exportPdf({ fileName?: string });
await editor.download();
editor.getState();          // serialisable snapshot of the editor
editor.getPages();          // [{ id, index, width, height, rotation, objectCount }]
await editor.getThumbnails(140);
editor.destroy();
```

### Objects

```ts
editor.addText(x, y, options);
await editor.addImage(dataUrlOrUrl, options);
await editor.addImageFile(file);
await editor.addSignature(pngDataUrl);
editor.addShape("rect" | "ellipse", options);

editor.updateSelected({ color: "#ff5b4a", fontSize: 28 });
editor.duplicateSelected();
editor.deleteSelected();
editor.bringForward();
editor.sendBackward();
```

### Pages and history

```ts
await editor.addBlankPage(afterIndex);
editor.duplicatePage(index);
editor.deletePage(index);
editor.rotatePage(index, 90);
editor.movePage(from, to);
editor.goToPage(index);

editor.undo();
editor.redo();
```

### Original text formatting

```ts
editor.getOriginalEdits();
editor.updateOriginalText({ boldOverride: true, fontSizeOverride: 24, colorOverride: "#c7442e" });
editor.clearOriginalTextFocus();
```

### Zoom and tools

```ts
editor.setTool("select" | "text" | "text-edit" | "image" | "rect" | "ellipse" | "line" | "pen" | "highlight" | "whiteout");
editor.setZoom(1.25);
editor.zoomIn();
editor.zoomOut();
editor.fitWidth();
editor.fitPage();
```

### Events

```ts
const off = editor.on("change", ({ reason }) => {
  console.log("changed", reason);
});
```

Events: `load`, `change`, `selectionchange`, `originaledit`, `zoom`, `pagechange`, `error`, `export`, `save` (`Ctrl/Cmd+S`).

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `V` / `T` / `E` / `I` / `R` / `O` / `L` / `P` / `H` / `W` | Select / text / edit original text / image / rectangle / ellipse / line / pen / highlight / whiteout |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` | Undo / redo |
| `Ctrl/Cmd+D` | Duplicate |
| `Ctrl/Cmd+S` | Download the edited PDF (also while a field or text edit is focused) |
| `Ctrl/Cmd+=`, `Ctrl/Cmd+-`, `Ctrl/Cmd+0` | Zoom in / out / fit width |
| `Ctrl/Cmd` + wheel | Zoom at pointer |
| Arrows, `Shift` + arrows | Nudge 1 pt / 10 pt |
| `Delete` | Delete selection |
| `Escape` | Back to select / clear selection |
| `PageUp`, `PageDown` | Previous / next page |

## What is preserved in the export

- Original page content stays vector and selectable.
- Text, shapes, images and ink are written as native PDF content.
- Page order, inserted blank pages and rotation are applied.
- Text with glyphs outside WinAnsi (for example CJK or emoji) is rasterised at 3× so it still looks right.

### Known limitations

- Existing PDF text can be edited in place when it is a real text object. Rotated text and text inside Form XObjects are left untouched in this version.
- If the embedded font cannot encode the new characters, the library substitutes Helvetica/Times/Courier while keeping the line vector. If even that fails, it falls back to a background patch plus an overlay.
- Existing PDF text cannot be reflowed. Cover it with the whiteout tool and type on top if you need a different layout.
- Encrypted PDFs can be viewed but not exported until the password is removed (pdf-lib cannot decrypt).
- Interactive form fields (AcroForm) are not copied by pdf-lib on export.
- Crop-box offsets other than `(0, 0)` are normalised to the media box.
- Object-level rotation is not implemented yet; page rotation is.

## Development

```bash
npm install
npm run typecheck
npm run build
npm run sample     # writes demo/sample.pdf
npm run demo       # Vite playground: /demo/ and /demo/editor.html
```

## License

MIT © Enea Zani. pdf.js is Apache-2.0, pdf-lib is MIT, PDFium is BSD. Bundled Work Sans and Liberation fonts are SIL OFL 1.1; their license texts are in `assets/fonts/`.
