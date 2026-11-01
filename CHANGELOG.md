# Changelog

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
