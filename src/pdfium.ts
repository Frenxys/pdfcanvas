import type { WrappedPdfiumModule } from "@embedpdf/pdfium";

import type { FontFamily } from "./types";

/** A text object that exists in the original PDF and can be edited in place. */
export interface PdfiumTextRun {
  key: string;
  pageIndex: number;
  objPtr: number;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  color: string;
}

/** A pending edit for an original text object. */
export interface PdfiumTextEdit extends PdfiumTextRun {
  newText: string;
  originalText: string;
  background: string;
}

export interface PdfiumApplyResult {
  bytes: Uint8Array;
  failed: PdfiumTextEdit[];
}

interface PageBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
  width: number;
  height: number;
}

const FPDF_PAGEOBJ_TEXT = 1;
const FPDF_PAGEOBJ_FORM = 5;
const MIN_INK_EM_PER_CHAR = 0.15;

/**
 * Small PDFium WASM wrapper for editing text objects in place.
 *
 * PDFium is only loaded when the user asks for the "text-edit" tool. The
 * renderer remains pdf.js; this engine handles the original text objects and
 * writes the final bytes with PDFium.
 */
export class PdfiumTextEngine {
  private readonly m: WrappedPdfiumModule;
  private readonly docPtr: number;
  private readonly dataPtr: number;
  private readonly openedBytes: Uint8Array;
  private readonly pages = new Map<number, number>();
  private readonly textPages = new Map<number, number>();
  private readonly boxes = new Map<number, PageBox>();
  private readonly runCache = new Map<number, PdfiumTextRun[]>();
  private destroyed = false;

  private constructor(
    m: WrappedPdfiumModule,
    docPtr: number,
    dataPtr: number,
    openedBytes: Uint8Array,
  ) {
    this.m = m;
    this.docPtr = docPtr;
    this.dataPtr = dataPtr;
    this.openedBytes = openedBytes;
  }

  static async create(
    wasmUrl: string,
    bytes: Uint8Array,
  ): Promise<PdfiumTextEngine> {
    const { init } = await import("@embedpdf/pdfium");
    const m = await init({ locateFile: () => wasmUrl });
    try {
      m.PDFiumExt_Init();
    } catch {
      // Already initialised in a previous instance.
    }

    const dataPtr = m.pdfium.wasmExports.malloc(bytes.length);
    if (!dataPtr) throw new Error("PDFium: memoria WASM esaurita.");
    const heap = heapOf(m);
    heap.set(bytes, dataPtr);
    const docPtr = m.FPDF_LoadMemDocument(dataPtr, bytes.length, "");
    if (!docPtr) {
      m.pdfium.wasmExports.free(dataPtr);
      const code = m.FPDF_GetLastError();
      const reason =
        code === 4
          ? "Il PDF è protetto da password."
          : "PDFium non riesce ad aprire questo PDF.";
      throw new Error(`${reason} (codice ${code}).`);
    }
    return new PdfiumTextEngine(m, docPtr, dataPtr, new Uint8Array(bytes));
  }

  /** Text objects of a page, in display coordinates (rotation 0 only). */
  readPage(pageIndex: number, displayRotation: number): PdfiumTextRun[] {
    if (this.destroyed || displayRotation !== 0) return [];
    const cached = this.runCache.get(pageIndex);
    if (cached) return cached;
    const pagePtr = this.page(pageIndex);
    if (!pagePtr) return [];
    const box = this.box(pageIndex);
    const textPage = this.textPage(pageIndex);
    if (!textPage) return [];

    const runs: PdfiumTextRun[] = [];
    const count = this.m.FPDFPage_CountObjects(pagePtr);
    for (let index = 0; index < count; index += 1) {
      const objPtr = this.m.FPDFPage_GetObject(pagePtr, index);
      if (!objPtr) continue;
      const type = this.m.FPDFPageObj_GetType(objPtr);
      // Form XObjects need their own matrix applied. Skip them in this first
      // version instead of drawing misplaced boxes.
      if (type === FPDF_PAGEOBJ_FORM) continue;
      if (type !== FPDF_PAGEOBJ_TEXT) continue;
      const run = this.readTextObject(objPtr, textPage, pageIndex, box);
      if (run) runs.push(run);
    }
    this.runCache.set(pageIndex, runs);
    return runs;
  }

  /**
   * Apply edits to the live PDFium document and return new PDF bytes.
   * Failed runs are reverted and reported; the caller overlays them.
   */
  applyEdits(edits: PdfiumTextEdit[]): PdfiumApplyResult {
    if (this.destroyed) throw new Error("PDFium è già stato chiuso.");
    const failed: PdfiumTextEdit[] = [];
    let applied = 0;

    for (const edit of edits) {
      if (!edit.newText || edit.newText === edit.originalText) continue;
      const pagePtr = this.page(edit.pageIndex);
      if (!pagePtr) {
        failed.push(edit);
        continue;
      }
      const run = this.matchRun(edit);
      if (!run) {
        failed.push(edit);
        continue;
      }
      const ok = this.setObjectText(run.objPtr, edit.newText);
      if (!ok) {
        this.setObjectText(run.objPtr, edit.originalText);
        failed.push(edit);
        continue;
      }
      // PDFium applies the text to the object only when the content stream is
      // regenerated. Regenerate, then read through a fresh text page. This
      // catches fonts that silently map unsupported code points to filler.
      if (!this.m.FPDFPage_GenerateContent(pagePtr)) {
        throw new Error("PDFium: impossibile rigenerare la pagina.");
      }
      this.reloadTextPage(edit.pageIndex);
      const textPage = this.textPage(edit.pageIndex);
      const roundTrip = textPage ? this.objectText(run.objPtr, textPage) : "";
      if (normaliseText(roundTrip) !== normaliseText(edit.newText)) {
        this.setObjectText(run.objPtr, edit.originalText);
        this.m.FPDFPage_GenerateContent(pagePtr);
        this.reloadTextPage(edit.pageIndex);
        failed.push(edit);
        continue;
      }
      const bbox = this.objectBounds(run.objPtr);
      const visible = edit.newText.replace(/\s+/gu, "").length;
      const collapsed =
        bbox !== null &&
        visible > 0 &&
        edit.fontSize > 0 &&
        bbox.right - bbox.left < visible * edit.fontSize * MIN_INK_EM_PER_CHAR;
      if (collapsed || !bbox) {
        // The font could not encode some characters and PDFium replaced them
        // with zero-width glyphs. Restore and let the overlay fallback handle it.
        this.setObjectText(run.objPtr, edit.originalText);
        this.m.FPDFPage_GenerateContent(pagePtr);
        this.reloadTextPage(edit.pageIndex);
        failed.push(edit);
        continue;
      }
      applied += 1;
    }

    if (applied === 0) {
      return { bytes: this.openedBytes, failed };
    }
    return { bytes: this.save(), failed };
  }

  private reloadTextPage(pageIndex: number): void {
    const textPage = this.textPages.get(pageIndex);
    if (textPage) {
      try {
        this.m.FPDFText_ClosePage(textPage);
      } catch {
        // Ignore.
      }
      this.textPages.delete(pageIndex);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      for (const textPage of this.textPages.values()) {
        this.m.FPDFText_ClosePage(textPage);
      }
      for (const page of this.pages.values()) {
        this.m.FPDF_ClosePage(page);
      }
    } catch {
      // Best effort teardown.
    }
    try {
      this.m.FPDF_CloseDocument(this.docPtr);
    } catch {
      // Ignore.
    }
    try {
      this.m.pdfium.wasmExports.free(this.dataPtr);
    } catch {
      // Ignore.
    }
    this.pages.clear();
    this.textPages.clear();
    this.boxes.clear();
  }

  private page(pageIndex: number): number | null {
    const cached = this.pages.get(pageIndex);
    if (cached) return cached;
    const ptr = this.m.FPDF_LoadPage(this.docPtr, pageIndex);
    if (!ptr) return null;
    this.pages.set(pageIndex, ptr);
    return ptr;
  }

  private matchRun(edit: PdfiumTextEdit): PdfiumTextRun | null {
    const runs = this.readPage(edit.pageIndex, 0);
    let best: PdfiumTextRun | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const run of runs) {
      if (run.text !== edit.originalText) continue;
      const distance =
        Math.abs(run.x - edit.x) +
        Math.abs(run.y - edit.y) +
        Math.abs(run.fontSize - edit.fontSize) * 2;
      if (distance < bestDistance && distance < 4) {
        best = run;
        bestDistance = distance;
      }
    }
    return best;
  }

  private textPage(pageIndex: number): number | null {
    const cached = this.textPages.get(pageIndex);
    if (cached) return cached;
    const pagePtr = this.page(pageIndex);
    if (!pagePtr) return null;
    const ptr = this.m.FPDFText_LoadPage(pagePtr);
    if (!ptr) return null;
    this.textPages.set(pageIndex, ptr);
    return ptr;
  }

  private box(pageIndex: number): PageBox {
    const cached = this.boxes.get(pageIndex);
    if (cached) return cached;
    const pagePtr = this.page(pageIndex);
    let box: PageBox = { left: 0, bottom: 0, right: 612, top: 792, width: 612, height: 792 };
    if (pagePtr) {
      const ptr = this.m.pdfium.wasmExports.malloc(16);
      try {
        const read = (): PageBox | null => {
          const left = this.f32(ptr);
          const bottom = this.f32(ptr + 4);
          const right = this.f32(ptr + 8);
          const top = this.f32(ptr + 12);
          const width = right - left;
          const height = top - bottom;
          if (width <= 0 || height <= 0) return null;
          return { left, bottom, right, top, width, height };
        };
        let found: PageBox | null = null;
        if (this.m.FPDFPage_GetCropBox(pagePtr, ptr, ptr + 4, ptr + 8, ptr + 12)) {
          found = read();
        }
        if (!found && this.m.FPDFPage_GetMediaBox(pagePtr, ptr, ptr + 4, ptr + 8, ptr + 12)) {
          found = read();
        }
        if (found) box = found;
      } catch {
        // Keep the A4 fallback.
      } finally {
        this.m.pdfium.wasmExports.free(ptr);
      }
    }
    this.boxes.set(pageIndex, box);
    return box;
  }

  private readTextObject(
    objPtr: number,
    textPage: number,
    pageIndex: number,
    box: PageBox,
  ): PdfiumTextRun | null {
    const matrix = this.objectMatrix(objPtr);
    if (!matrix) return null;
    // Rotated text objects need an oriented edit box; the first version only
    // handles upright text and leaves rotated runs untouched.
    if (Math.abs(matrix.b) > 0.001 || Math.abs(matrix.c) > 0.001) return null;

    const text = this.objectText(objPtr, textPage);
    if (!text.trim()) return null;
    const bounds = this.objectBounds(objPtr);
    if (!bounds) return null;

    const fontSize = Math.max(1, this.objectFontSize(objPtr, bounds.bottom, bounds.top));
    const font = this.objectFontInfo(objPtr);
    const color = this.objectColor(objPtr);

    return {
      key: `${pageIndex}:${objPtr}`,
      pageIndex,
      objPtr,
      text,
      x: bounds.left - box.left,
      y: box.top - bounds.top,
      w: Math.max(1, bounds.right - bounds.left),
      h: Math.max(1, bounds.top - bounds.bottom),
      fontSize,
      ...font,
      color,
    };
  }

  private objectText(objPtr: number, textPage: number): string {
    const needed = this.m.FPDFTextObj_GetText(objPtr, textPage, 0, 0);
    if (!needed) return "";
    const ptr = this.m.pdfium.wasmExports.malloc(needed + 2);
    if (!ptr) return "";
    try {
      this.m.FPDFTextObj_GetText(objPtr, textPage, ptr, needed + 2);
      return this.m.pdfium.UTF16ToString(ptr);
    } finally {
      this.m.pdfium.wasmExports.free(ptr);
    }
  }

  private objectFontSize(objPtr: number, bottom: number, top: number): number {
    const ptr = this.m.pdfium.wasmExports.malloc(4);
    if (!ptr) return Math.max(1, top - bottom);
    try {
      if (this.m.FPDFTextObj_GetFontSize(objPtr, ptr)) {
        return Math.max(1, this.f32(ptr));
      }
    } finally {
      this.m.pdfium.wasmExports.free(ptr);
    }
    return Math.max(1, top - bottom);
  }

  private objectFontInfo(objPtr: number): {
    fontFamily: FontFamily;
    bold: boolean;
    italic: boolean;
  } {
    const fontPtr = this.m.FPDFTextObj_GetFont(objPtr);
    let family = "";
    let base = "";
    let weight = 400;
    if (fontPtr) {
      family = this.fontName((buffer, length) =>
        this.m.FPDFFont_GetFamilyName(fontPtr, buffer, length),
      );
      base = this.fontName((buffer, length) =>
        this.m.FPDFFont_GetBaseFontName(fontPtr, buffer, length),
      );
      try {
        weight = this.m.FPDFFont_GetWeight(fontPtr);
      } catch {
        weight = 400;
      }
    }
    const name = `${family} ${base}`.toLowerCase();
    const fontFamily: FontFamily = /courier|mono/.test(name)
      ? "courier"
      : /times|serif/.test(name)
        ? "times"
        : "helvetica";
    return {
      fontFamily,
      bold: weight >= 600 || /bold|black|heavy/.test(name),
      italic: /italic|oblique/.test(name),
    };
  }

  private fontName(read: (buffer: number, length: number) => number): string {
    const needed = read(0, 0);
    if (!needed) return "";
    const ptr = this.m.pdfium.wasmExports.malloc(needed + 2);
    if (!ptr) return "";
    try {
      read(ptr, needed + 2);
      return this.m.pdfium.UTF8ToString(ptr);
    } finally {
      this.m.pdfium.wasmExports.free(ptr);
    }
  }

  private objectColor(objPtr: number): string {
    const ptr = this.m.pdfium.wasmExports.malloc(16);
    if (!ptr) return "#191722";
    try {
      if (!this.m.FPDFPageObj_GetFillColor(objPtr, ptr, ptr + 4, ptr + 8, ptr + 12)) {
        return "#191722";
      }
      const r = this.m.pdfium.getValue(ptr, "i32") & 255;
      const g = this.m.pdfium.getValue(ptr + 4, "i32") & 255;
      const b = this.m.pdfium.getValue(ptr + 8, "i32") & 255;
      return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    } finally {
      this.m.pdfium.wasmExports.free(ptr);
    }
  }

  private objectBounds(
    objPtr: number,
  ): { left: number; bottom: number; right: number; top: number } | null {
    const ptr = this.m.pdfium.wasmExports.malloc(16);
    if (!ptr) return null;
    try {
      if (!this.m.FPDFPageObj_GetBounds(objPtr, ptr, ptr + 4, ptr + 8, ptr + 12)) {
        return null;
      }
      return {
        left: this.f32(ptr),
        bottom: this.f32(ptr + 4),
        right: this.f32(ptr + 8),
        top: this.f32(ptr + 12),
      };
    } finally {
      this.m.pdfium.wasmExports.free(ptr);
    }
  }

  private objectMatrix(objPtr: number): {
    a: number;
    b: number;
    c: number;
    d: number;
  } | null {
    const ptr = this.m.pdfium.wasmExports.malloc(24);
    if (!ptr) return null;
    try {
      if (!this.m.FPDFPageObj_GetMatrix(objPtr, ptr)) return null;
      return {
        a: this.f32(ptr),
        b: this.f32(ptr + 4),
        c: this.f32(ptr + 8),
        d: this.f32(ptr + 12),
      };
    } finally {
      this.m.pdfium.wasmExports.free(ptr);
    }
  }

  private setObjectText(objPtr: number, text: string): boolean {
    const ptr = this.writeUtf16(text);
    if (!ptr) return false;
    try {
      return this.m.FPDFText_SetText(objPtr, ptr);
    } catch {
      return false;
    } finally {
      this.m.pdfium.wasmExports.free(ptr);
    }
  }

  private writeUtf16(text: string): number {
    const ptr = this.m.pdfium.wasmExports.malloc((text.length + 1) * 2);
    if (!ptr) return 0;
    const heap = heapOf(this.m);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      heap[ptr + index * 2] = code & 0xff;
      heap[ptr + index * 2 + 1] = (code >> 8) & 0xff;
    }
    heap[ptr + text.length * 2] = 0;
    heap[ptr + text.length * 2 + 1] = 0;
    return ptr;
  }

  private save(): Uint8Array {
    const writer = this.m.PDFiumExt_OpenFileWriter();
    if (!writer) throw new Error("PDFium: impossibile creare il writer.");
    try {
      if (!this.m.PDFiumExt_SaveAsCopy(this.docPtr, writer)) {
        throw new Error("PDFium: salvataggio fallito.");
      }
      const size = this.m.PDFiumExt_GetFileWriterSize(writer);
      if (!size) throw new Error("PDFium: file di output vuoto.");
      const ptr = this.m.pdfium.wasmExports.malloc(size);
      if (!ptr) throw new Error("PDFium: memoria insufficiente per il salvataggio.");
      try {
        this.m.PDFiumExt_GetFileWriterData(writer, ptr, size);
        const bytes = new Uint8Array(size);
        bytes.set(heapOf(this.m).subarray(ptr, ptr + size));
        if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
          throw new Error("PDFium ha prodotto un file non valido.");
        }
        return bytes;
      } finally {
        this.m.pdfium.wasmExports.free(ptr);
      }
    } finally {
      this.m.PDFiumExt_CloseFileWriter(writer);
    }
  }

  private f32(ptr: number): number {
    return this.m.pdfium.getValue(ptr, "float");
  }
}

function heapOf(m: WrappedPdfiumModule): Uint8Array {
  return new Uint8Array(
    (m.pdfium.wasmExports as unknown as { memory: WebAssembly.Memory }).memory
      .buffer,
  );
}

function normaliseText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\u0000/g, "");
}
