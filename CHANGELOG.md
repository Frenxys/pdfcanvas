# Changelog

## 0.4.1

- Use the visual font size (font size × text matrix scale) in previews, fallback text and line grouping.
- Load matching Work Sans/Liberation webfonts in the editor preview, so the text you see matches the exported PDF.
- Fixed fallback font loading with CID text objects (spaces and dashes now render correctly).

## 0.4.0

- Bundled **Work Sans** and **Liberation Sans** fallback fonts.
- Match the original PDF font by name where possible; Work Sans documents keep the same family, weight and size.
- Arial-metric Liberation Sans for other sans-serif PDFs.
- `fontAssetsUrl` option and `/assets/fonts/` self-hosting.
- Font-size matching from PDFium ascent/descent metrics when a substitute is required.

## 0.3.0

- Group per-character/per-word PDFium objects into editable line runs.
- Read characters from the PDFium text page, which fixes scrambled object text in fonts with broken encodings.
- Standard-font vector fallback for PDFs whose embedded font cannot encode the new text.
- `resume.pdf`-style documents now expose line-level text boxes instead of 1,500 single-letter boxes.

## 0.2.3

- Load PDFium text runs only for visible/current pages, not every page at once.

## 0.2.2

- Commit/restore original-text edits around selection, undo/redo and page operations.
- Re-layout overlays after zoom changes.

## 0.2.1

- Validate text edits by regenerating the page and reading the object back.
- Apply original-text edits on a fresh PDFium document at export, so undo/redo never leaks stale mutations.
- Failing code points now fall back to the visual overlay instead of exporting filler glyphs.

## 0.2.0

- **Edit existing PDF text in place** with PDFium WASM.
- New `text-edit` tool and `pdfiumWasmUrl` option.
- Text edits are written as native PDF text; unchanged fonts and positions are preserved.
- Automatic overlay fallback when a font cannot encode the replacement text or the run is rotated/inside a form.
- Undo/redo includes original-text edits.

## 0.1.6

- Clearer exported file names (`-pdfcanvas.pdf`, `-pdfcanvas-edit.pdf`).

## 0.1.5

- Cancel an in-flight drag/resize when a new document is loaded.
- Clear pending image placement on load.

## 0.1.4

- Fixed standard PDF font names (Times, Courier, Helvetica bold/italic) so text export uses real vector fonts.
- Added `maxFileSize` option (default 200 MB).
- Better image placement when the image is larger than the page.
- Touch drawing no longer scrolls the page while a drawing tool is active.

## 0.1.3

- Self-hosted worker required; style export removed.
- `maxFileSize` groundwork and image clamping.

## 0.1.0

- First public API: load, render, text/images/shapes/ink, page management, undo/redo, vector export.
