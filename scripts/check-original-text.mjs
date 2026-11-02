import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PdfiumTextEngine } from "../dist/index.js";

const wasm = "node_modules/@embedpdf/pdfium/dist/pdfium.wasm";
const source = new Uint8Array(readFileSync("demo/sample.pdf"));

function moveFor(run, dx, dy) {
  return {
    key: run.key,
    pageIndex: run.pageIndex,
    text: run.text,
    x: run.x,
    y: run.y,
    w: run.w,
    h: run.h,
    fontSize: run.fontSize,
    fontFamily: run.fontFamily,
    fontName: run.fontName,
    bold: run.bold,
    italic: run.italic,
    color: run.color,
    fontCss: run.fontCss,
    dx,
    dy,
    background: "#ffffff",
  };
}

const engine = await PdfiumTextEngine.create(wasm, source);
const runs = engine.readPage(0, 0);
assert.ok(runs.length > 1, "sample has text runs");
assert.equal(runs[0].editable, true);
assert.equal(runs[0].canStyle, true);

const moved = runs[0];
const edited = runs[1];
const result = engine.applyEdits(
  [
    {
      ...edited,
      newText: "Edited and moved",
      originalText: edited.text,
      background: "#ffffff",
      boldOverride: true,
    },
  ],
  [moveFor(moved, 40, 30), moveFor(edited, -20, 45)],
);
assert.equal(result.failed.length, 0, "edit was applied");
assert.equal(result.failedMoves.length, 0, "moves were applied");
engine.destroy();

const check = await PdfiumTextEngine.create(wasm, result.bytes);
const after = check.readPage(0, 0);
const movedAfter = after.find((run) => run.text === moved.text);
const editedAfter = after.find((run) => run.text === "Edited and moved");
assert.ok(movedAfter, "moved run is present");
assert.ok(editedAfter, "edited run is present");
assert.ok(Math.abs(movedAfter.x - (moved.x + 40)) < 0.6, "x move");
assert.ok(Math.abs(movedAfter.y - (moved.y + 30)) < 0.6, "y move");
assert.ok(Math.abs(editedAfter.x - (edited.x - 20)) < 2, "edited x move");
assert.ok(Math.abs(editedAfter.y - (edited.y + 45)) < 2, "edited y move");
assert.equal(editedAfter.bold, true, "bold override kept");
assert.match(editedAfter.fontName, /Bold/i);
check.destroy();

const deleteEngine = await PdfiumTextEngine.create(wasm, source);
const deleteRun = deleteEngine.readPage(0, 0)[2];
const deleted = deleteEngine.applyEdits([
  {
    ...deleteRun,
    newText: "",
    originalText: deleteRun.text,
    background: "#ffffff",
    deleted: true,
  },
]);
assert.equal(deleted.failed.length, 0, "delete was applied");
deleteEngine.destroy();
const afterDelete = await PdfiumTextEngine.create(wasm, deleted.bytes);
assert.equal(
  afterDelete.readPage(0, 0).some((run) => run.text === deleteRun.text),
  false,
  "deleted run is gone",
);
afterDelete.destroy();

const copyEngine = await PdfiumTextEngine.create(wasm, source);
const copyRun = copyEngine.readPage(0, 0)[1];
const copyMove = {
  ...moveFor(copyRun, 25, 35),
  key: "copy:check",
  sourceKey: copyRun.key,
  copy: true,
};
const copied = copyEngine.applyEdits([], [copyMove]);
assert.equal(copied.failedMoves.length, 0, "copy was applied");
copyEngine.destroy();
const afterCopy = await PdfiumTextEngine.create(wasm, copied.bytes);
const copies = afterCopy
  .readPage(0, 0)
  .filter((run) => run.text === copyRun.text);
assert.equal(copies.length, 2, "copy is present");
const copyAfter = copies.find(
  (run) =>
    Math.abs(run.x - (copyRun.x + 25)) < 0.6 &&
    Math.abs(run.y - (copyRun.y + 35)) < 0.6,
);
assert.ok(copyAfter, "copy offset");
assert.match(copyAfter.fontName, /Helvetica/i);
afterCopy.destroy();

console.log("original text move/edit/delete/copy check: ok");
