import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PdfCanvas } from "../src/index";

const container = document.querySelector<HTMLElement>("#editor");
if (!container) throw new Error("Missing #editor");

const editor = new PdfCanvas(container, {
  workerSrc: workerUrl,
  initialZoom: "fit-width",
  onError: (error) => console.error("[demo]", error),
});

declare global {
  interface Window {
    pdfcanvasDemo?: PdfCanvas;
  }
}
window.pdfcanvasDemo = editor;

editor.on("error", ({ error }) => {
  window.alert(error.message);
});

const pdfInput = document.querySelector<HTMLInputElement>("#pdf-input");
pdfInput?.addEventListener("change", async () => {
  const file = pdfInput.files?.[0];
  pdfInput.value = "";
  if (file) await editor.load(file);
});

document.querySelector("#text")?.addEventListener("click", () => {
  editor.addText(undefined, undefined, { text: "Hello from pdfcanvas" });
});

const imageInput = document.querySelector<HTMLInputElement>("#image-input");
imageInput?.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  imageInput.value = "";
  if (file) await editor.addImageFile(file);
});

document.querySelector("#undo")?.addEventListener("click", () => editor.undo());
document.querySelector("#redo")?.addEventListener("click", () => editor.redo());
document.querySelector("#save")?.addEventListener("click", () => {
  void editor.download();
});

try {
  const response = await fetch("/demo/sample.pdf");
  if (response.ok) {
    await editor.load(await response.arrayBuffer(), { fileName: "sample.pdf" });
  }
} catch (error) {
  console.warn("No demo sample loaded", error);
}
