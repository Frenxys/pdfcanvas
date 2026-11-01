# Changelog

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
