import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import pdfiumWasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { PdfCanvasEditor } from "../src/editor";

const container = document.querySelector<HTMLElement>("#editor");
if (!container) throw new Error("Missing #editor");

const editor = new PdfCanvasEditor(container, {
  workerSrc: workerUrl,
  pdfiumWasmUrl,
  fontAssetsUrl: "/assets/fonts/",
  initialZoom: "fit-width",
  locale: "it",
  brandHref: "https://pdf.eneawork.it",
  autosave: { key: "demo", debounce: 300 },
  onError: (error) => console.error("[editor demo]", error),
});

declare global {
  interface Window {
    pdfcanvasEditorDemo?: PdfCanvasEditor;
  }
}
window.pdfcanvasEditorDemo = editor;

try {
  await editor.ready();
  if (editor.core.getPages().length === 0) {
    const response = await fetch("/demo/sample.pdf");
    if (response.ok) {
      await editor.open(await response.arrayBuffer(), "sample.pdf");
    }
  }
} catch (error) {
  console.warn("No demo sample loaded", error);
}
