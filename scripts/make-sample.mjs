import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const doc = await PDFDocument.create();
const page = doc.addPage([595.28, 841.89]);
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

page.drawRectangle({
  x: 0,
  y: 690,
  width: 595.28,
  height: 152,
  color: rgb(0.42, 0.31, 1),
});
page.drawText("pdfcanvas", {
  x: 54,
  y: 772,
  size: 34,
  font: bold,
  color: rgb(1, 1, 1),
});
page.drawText("A tiny client-side PDF editor engine.", {
  x: 54,
  y: 735,
  size: 14,
  font,
  color: rgb(0.92, 0.9, 1),
});

page.drawText("Try it", { x: 54, y: 630, size: 20, font: bold, color: rgb(0.1, 0.09, 0.13) });
const lines = [
  "1. Click anywhere on the page with the text tool.",
  "2. Add shapes, images, highlights and freehand strokes.",
  "3. Download a vector PDF. No server involved.",
];
lines.forEach((line, index) => {
  page.drawText(line, {
    x: 54,
    y: 596 - index * 26,
    size: 13,
    font,
    color: rgb(0.25, 0.24, 0.3),
  });
});

page.drawRectangle({
  x: 54,
  y: 380,
  width: 487,
  height: 120,
  borderColor: rgb(0.84, 0.82, 0.76),
  borderWidth: 1,
  color: rgb(0.98, 0.97, 0.94),
});
page.drawText("This box and all the text above are original PDF content.", {
  x: 72,
  y: 440,
  size: 12,
  font,
  color: rgb(0.35, 0.34, 0.4),
});

await mkdir("demo", { recursive: true });
await writeFile("demo/sample.pdf", await doc.save());
console.log("demo/sample.pdf written");
