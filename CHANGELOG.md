# Changelog

## 0.9.0

- Original text lines are draggable with the Select tool. Moves are written as PDF object transforms, so the original font, colour and vector quality are preserved.
- Text runs report `editable` and `canStyle`. When the font cannot be reused without changing the typeface, the editor offers move only instead of silently substituting a different font.
- Embedded fonts are reused for the in-page editor preview through the browser `FontFace` API, with a local fallback when the embedded program is not browser-compatible.
- Bold and italic controls are disabled for embedded fonts that have no matching variant.
- `PdfiumTextEngine.applyEdits(edits, moves)` accepts translations; `PdfiumTextMove` is exported.
- The zoom percentage is now an editable field: click it, type an exact value such as `137`, press Enter. Escape cancels.
- Pan the viewport with Space + drag or the middle mouse button.
- Snap dragged objects to page edges, page centre and other objects, with alignment guides.
- Multi-select with Shift + click, Ctrl/Cmd + A or a marquee; drag the whole selection together.
- Delete and duplicate original text. Duplicates are inserted as real PDF text with the original font, and both actions support undo.
- When a browser cannot load an embedded font, its drag preview is a bitmap captured from the page instead of re-rendered text. The export still moves the original PDF object with its real font, and formatting controls stay disabled for that run.
- Subset fonts that only lack a browser-compatible OS/2 or cmap table are rebuilt in memory for the preview, so fonts such as Zapfino, Cameron Sans, Bodoni and Avenir Next Condensed keep their real glyphs while dragging.
- Custom embedded fonts stay move/delete/duplicate-only. Editing is limited to standard or metric-compatible families, so an edit cannot silently swap the typeface.
- Text lines are grouped by baseline and spacing instead of font or weight, so a sentence with bold, italic and regular spans is selected and dragged as one line. Mixed-style lines are move/delete only and use a bitmap preview.
- Dragging original text now always uses a pixel capture of the rendered line, so the preview keeps its exact position, size and font instead of being rebuilt with CSS line-height.
- Selection boxes, covers and drag previews use the tight bounds of the PDF text objects, not the loose font box. A tall decorative title no longer covers or drags the paragraph underneath.
- Snapping is tighter (5 px at 100%) and can be disabled by holding Alt while dragging. The page background keeps vertical touch scrolling while text and objects still capture the drag.
- Mobile layout: the tools rail scrolls with snap points, drawers are capped to the viewport and only one opens at a time, opening a drawer closes the original-text toolbar, and the empty state becomes a full-width column on narrow phones. The page background keeps vertical touch scrolling.
- Arrow keys nudge selected original text; Shift moves it by 10 points.

## 0.8.0

- Editor visual refresh aligned with the pdf.eneawork.it editor: icon-first toolbar, wider page rail and inspector, larger thumbnails, serif headings and page summary cards.
- `sampleUrl` option adds a “Try a sample” button on the empty screen.
- `brandTarget` option controls whether the brand link opens in the same tab.
- Object-count badges on page thumbnails.
- Empty page rail and empty screen now use the same copy and styling as the site.
- Active tool is highlighted immediately on mount.
- Language defaults to `auto`: English unless the browser prefers Italian; `en`/`it` can still be forced. `detectLocale()` is exported.

## 0.7.0

- Resize text boxes from the side handles; text now wraps to the box width in the preview and in the exported PDF.
- Empty-document screen with a direct file picker.
- Global Ctrl/Cmd+S export, including while an inspector input or a text edit is focused.
- Drag pages in the page rail to reorder them.
- Duplicate the current page, with independent object ids and original text edits.
- Keep image proportions toggle in the inspector.
- Templates scale to the current page size, including landscape pages and non-A4 documents.
- Close signature/template dialogs with Escape or a backdrop click; signature insert stays disabled until you draw.
- Rotating a page now refits it in the viewport.
- The brand is no longer a dead link when `brandHref` is omitted.

## 0.6.0

- New `pdfcanvas/editor` entry point with the complete `PdfCanvasEditor` UI.
- Toolbar, page rail with thumbnails and page actions, property inspector, contextual original-text toolbar.
- Signature pad, bundled local templates, toast feedback and English/Italian labels.
- Optional IndexedDB autosave of the original PDF and the editable scene, restored on mount.
- `ready()` resolves after restore; `open()` waits for restore so a user file always wins.
- Responsive drawers and a mobile zoom dock.
- `PdfCanvasEditor` is also exported from the package root.

## 0.5.2

- Commit an open text edit before exporting (Ctrl/Cmd+S during editing exports the current text).

## 0.5.1

- Formatting-only edits are now exported even when the text itself is unchanged.
- Documented caret, double-click editing and the `originaledit` API.

## 0.5.0

- Caret placement at the clicked character instead of selecting the whole line.
- Double-click an existing text line with the Select tool to edit it.
- Contextual format overrides for original text: bold, italic, size and colour.
- Original-text edits are exposed through the `originaledit` event.
- Formatting uses the bundled Work Sans/Liberation fonts and keeps visual font size.

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
