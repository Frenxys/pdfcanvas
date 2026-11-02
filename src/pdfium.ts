import type { WrappedPdfiumModule } from "@embedpdf/pdfium";

import type { FontFamily } from "./types";

/** One backing PDFium text object inside a grouped run. */
export interface PdfiumTextMember {
  objPtr: number;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontPtr: number;
  fontName: string;
  fontSize: number;
  textFontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  color: string;
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number };
}

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
  textFontSize: number;
  fontFamily: FontFamily;
  fontName: string;
  bold: boolean;
  italic: boolean;
  color: string;
  /** True when the original font is embedded or safely replaceable. */
  editable: boolean;
  /** True when bold/italic can be reproduced without changing typeface. */
  canStyle: boolean;
  /** CSS family registered from the embedded font, when available. */
  fontCss?: string;
  /** A line may be built from many per-character PDFium objects. */
  members: PdfiumTextMember[];
}

/** A translation applied to an original text run. */
export interface PdfiumTextMove {
  key: string;
  pageIndex: number;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontFamily: FontFamily;
  fontName: string;
  bold: boolean;
  italic: boolean;
  color: string;
  fontCss?: string;
  dx: number;
  dy: number;
  background: string;
}

interface RawChar extends PdfiumTextMember {
  pageIndex: number;
  editable: boolean;
  canStyle: boolean;
}

/** A pending edit for an original text object. */
export interface PdfiumTextEdit extends PdfiumTextRun {
  newText: string;
  originalText: string;
  background: string;
  boldOverride?: boolean;
  italicOverride?: boolean;
  fontSizeOverride?: number;
  colorOverride?: string;
}

export interface PdfiumApplyResult {
  bytes: Uint8Array;
  failed: PdfiumTextEdit[];
  failedMoves: PdfiumTextMove[];
}

interface FontInfo {
  fontPtr: number;
  fontFamily: FontFamily;
  fontName: string;
  bold: boolean;
  italic: boolean;
  embedded: boolean;
  standard: boolean;
  fallback: boolean;
  canStyle: boolean;
}

interface PageBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
  width: number;
  height: number;
}

interface EditStyle {
  bold: boolean;
  italic: boolean;
  fontSize: number;
  color: string;
}

function editStyle(run: PdfiumTextRun, edit: PdfiumTextEdit): EditStyle {
  return {
    bold: edit.boldOverride ?? run.bold,
    italic: edit.italicOverride ?? run.italic,
    fontSize: edit.fontSizeOverride ?? run.fontSize,
    color: edit.colorOverride ?? run.color,
  };
}

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
  private readonly loadedFonts: Array<{ fontPtr: number; dataPtr: number }> = [];
  private readonly fallbackFontData = new Map<string, Uint8Array>();
  private readonly fallbackFontPtrs = new Map<string, number>();
  private readonly fontInfoCache = new Map<number, FontInfo>();
  private readonly fontDataCache = new Map<number, Uint8Array | null>();
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
    fontAssetsUrl?: string,
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
    const engine = new PdfiumTextEngine(m, docPtr, dataPtr, new Uint8Array(bytes));
    if (fontAssetsUrl) await engine.loadFallbackFonts(fontAssetsUrl);
    return engine;
  }

  private async loadFallbackFonts(baseUrl: string): Promise<void> {
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const files = [
      "LiberationSans-Regular.ttf",
      "LiberationSans-Bold.ttf",
      "LiberationSans-Italic.ttf",
      "LiberationSans-BoldItalic.ttf",
      "WorkSans-Regular.ttf",
      "WorkSans-Bold.ttf",
      "WorkSans-Italic.ttf",
      "WorkSans-BoldItalic.ttf",
    ];
    await Promise.all(
      files.map(async (file) => {
        try {
          const response = await fetch(`${base}${file}`);
          if (!response.ok) return;
          this.fallbackFontData.set(
            file.replace(/\.ttf$/i, "").toLowerCase(),
            new Uint8Array(await response.arrayBuffer()),
          );
        } catch {
          // Fonts are optional; standard PDF fonts remain the final fallback.
        }
      }),
    );
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

    const raw: RawChar[] = [];
    const charCount = this.m.FPDFText_CountChars(textPage);
    let lastStyle: Pick<
      RawChar,
      | "fontSize"
      | "textFontSize"
      | "fontFamily"
      | "fontName"
      | "bold"
      | "italic"
      | "color"
      | "fontPtr"
      | "editable"
      | "canStyle"
    > | null = null;
    for (let index = 0; index < charCount; index += 1) {
      const codePoint = this.m.FPDFText_GetUnicode(textPage, index);
      if (!codePoint || codePoint === 0x0a || codePoint === 0x0d) continue;
      const text = String.fromCodePoint(codePoint);
      const objPtr = this.m.FPDFText_GetTextObject(textPage, index);
      const rectPtr = this.m.pdfium.wasmExports.malloc(16);
      if (!rectPtr) continue;
      let left = 0;
      let top = 0;
      let right = 0;
      let bottom = 0;
      let boxed = false;
      try {
        boxed = this.m.FPDFText_GetLooseCharBox(textPage, index, rectPtr);
        if (boxed) {
          left = this.f32(rectPtr);
          top = this.f32(rectPtr + 4);
          right = this.f32(rectPtr + 8);
          bottom = this.f32(rectPtr + 12);
        }
      } finally {
        this.m.pdfium.wasmExports.free(rectPtr);
      }
      if (!boxed) continue;
      let style: Pick<
        RawChar,
        | "fontSize"
        | "textFontSize"
        | "fontFamily"
        | "fontName"
        | "bold"
        | "italic"
        | "color"
        | "fontPtr"
        | "editable"
        | "canStyle"
      > | null = lastStyle;
      if (objPtr) {
        const textFontSize = Math.max(
          1,
          this.objectFontSize(objPtr, bottom, top),
        );
        const font = this.objectFontInfo(objPtr);
        style = {
          fontSize: textFontSize,
          textFontSize,
          fontFamily: font.fontFamily,
          fontName: font.fontName,
          bold: font.bold,
          italic: font.italic,
          color: this.objectColor(objPtr),
          fontPtr: font.fontPtr,
          editable: font.embedded || font.standard || font.fallback,
          canStyle: font.canStyle,
        };
        lastStyle = style;
      }
      if (!style) continue;
      const matrix = objPtr ? this.objectMatrix(objPtr) : null;
      if (!matrix || Math.abs(matrix.b) > 0.001 || Math.abs(matrix.c) > 0.001) {
        continue;
      }
      const scale = Math.hypot(matrix.a, matrix.b) || 1;
      const visualFontSize = Math.max(1, style.textFontSize * scale);
      raw.push({
        pageIndex,
        objPtr,
        text,
        x: left - box.left,
        y: box.top - top,
        w: Math.max(0.1, right - left),
        h: Math.max(0.1, top - bottom),
        fontSize: visualFontSize,
        textFontSize: style.textFontSize,
        fontFamily: style.fontFamily,
        fontName: style.fontName,
        bold: style.bold,
        italic: style.italic,
        color: style.color,
        fontPtr: style.fontPtr,
        editable: style.editable,
        canStyle: style.canStyle,
        matrix,
      });
    }
    const runs = groupChars(raw);
    this.runCache.set(pageIndex, runs);
    return runs;
  }

  /**
   * Apply edits and translations to the live PDFium document and return new
   * PDF bytes. Failed runs are reverted and reported; the caller overlays them.
   */
  applyEdits(
    edits: PdfiumTextEdit[],
    moves: PdfiumTextMove[] = [],
  ): PdfiumApplyResult {
    if (this.destroyed) throw new Error("PDFium è già stato chiuso.");
    const failed: PdfiumTextEdit[] = [];
    const failedMoves: PdfiumTextMove[] = [];
    let applied = 0;

    // Snapshot the runs before mutating: after a move, run keys and
    // coordinates change, but the object pointers stay valid.
    const pageIndexes = new Set<number>();
    for (const edit of edits) pageIndexes.add(edit.pageIndex);
    for (const move of moves) pageIndexes.add(move.pageIndex);
    const runsByKey = new Map<string, PdfiumTextRun>();
    for (const pageIndex of pageIndexes) {
      for (const run of this.readPage(pageIndex, 0)) {
        runsByKey.set(run.key, run);
      }
    }

    const movedPages = new Set<number>();
    for (const move of moves) {
      if (!move.dx && !move.dy) continue;
      const run = runsByKey.get(move.key);
      if (!run || !this.translateRun(run, move.dx, move.dy)) {
        failedMoves.push(move);
        continue;
      }
      movedPages.add(move.pageIndex);
      applied += 1;
    }
    for (const pageIndex of movedPages) {
      const pagePtr = this.page(pageIndex);
      if (!pagePtr || !this.m.FPDFPage_GenerateContent(pagePtr)) {
        throw new Error("PDFium: impossibile rigenerare la pagina.");
      }
    }

    const moveByKey = new Map(moves.map((move) => [move.key, move]));
    for (const edit of edits) {
      const hasFormat =
        edit.boldOverride !== undefined ||
        edit.italicOverride !== undefined ||
        edit.fontSizeOverride !== undefined ||
        edit.colorOverride !== undefined;
      if (!edit.newText || (edit.newText === edit.originalText && !hasFormat)) {
        continue;
      }
      const pagePtr = this.page(edit.pageIndex);
      if (!pagePtr) {
        failed.push(edit);
        continue;
      }
      const run = runsByKey.get(edit.key) ?? this.matchRun(edit);
      if (!run) {
        failed.push(edit);
        continue;
      }
      if (
        this.applyRun(
          pagePtr,
          edit.pageIndex,
          run,
          edit,
          moveByKey.get(edit.key),
        )
      ) {
        applied += 1;
      } else {
        failed.push(edit);
      }
    }

    if (applied === 0) {
      return { bytes: this.openedBytes, failed, failedMoves };
    }
    return { bytes: this.save(), failed, failedMoves };
  }

  private translateRun(
    run: PdfiumTextRun,
    dx: number,
    dy: number,
  ): boolean {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    if (!run.members.length) return false;
    for (const member of run.members) {
      if (!member.objPtr) return false;
      // Display coordinates grow downwards; PDF user space grows upwards.
      this.m.FPDFPageObj_Transform(member.objPtr, 1, 0, 0, 1, dx, -dy);
    }
    return true;
  }

  /** Embedded font bytes for the given run, or null when it is not embedded. */
  fontBytes(run: PdfiumTextRun): Uint8Array | null {
    const fontPtr = run.members[0]?.fontPtr ?? 0;
    return this.readFontBytes(fontPtr);
  }

  private applyRun(
    pagePtr: number,
    pageIndex: number,
    run: PdfiumTextRun,
    edit: PdfiumTextEdit,
    move?: PdfiumTextMove,
  ): boolean {
    const style = editStyle(run, edit);
    const hasLayoutFormat =
      edit.boldOverride !== undefined ||
      edit.italicOverride !== undefined ||
      edit.fontSizeOverride !== undefined;
    const wantsBoldItalic =
      edit.boldOverride !== undefined || edit.italicOverride !== undefined;
    if (wantsBoldItalic && !run.canStyle) return false;
    if (
      !hasLayoutFormat &&
      this.applyExistingRun(pagePtr, pageIndex, run, edit)
    ) {
      return true;
    }
    const target =
      run.members.find((member) => member.text.trim().length > 0) ??
      run.members[0];
    if (target) {
      if (!hasLayoutFormat || (!wantsBoldItalic && this.canReuseFont(run))) {
        const embeddedFont = this.loadEmbeddedFont(target.fontPtr);
        if (
          embeddedFont &&
          this.applyReplacementRun(
            pagePtr,
            pageIndex,
            run,
            edit,
            embeddedFont,
            style,
            move,
          )
        ) {
          return true;
        }
      }
      if (isStandardFamily(run)) {
        const standardFont = this.m.FPDFText_LoadStandardFont(
          this.docPtr,
          standardFontName(run, style),
        );
        if (
          standardFont &&
          this.applyReplacementRun(
            pagePtr,
            pageIndex,
            run,
            edit,
            standardFont,
            style,
            move,
          )
        ) {
          return true;
        }
      }
      if (isFallbackFamily(run)) {
        const fallbackFont = this.loadFallbackFont(run, style);
        if (
          fallbackFont &&
          this.applyReplacementRun(
            pagePtr,
            pageIndex,
            run,
            edit,
            fallbackFont,
            style,
            move,
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private canReuseFont(run: PdfiumTextRun): boolean {
    return run.members.some((member) => member.fontPtr !== 0);
  }

  private loadFallbackFont(
    run: PdfiumTextRun,
    style: { bold: boolean; italic: boolean },
  ): number | null {
    let family: string;
    if (/work\s*sans|worksans/i.test(run.fontName)) {
      family = "worksans";
    } else if (run.fontFamily === "helvetica") {
      family = "liberationsans";
    } else {
      return null;
    }
    const styleName = style.bold
      ? style.italic
        ? "bolditalic"
        : "bold"
      : style.italic
        ? "italic"
        : "regular";
    const key = `${family}-${styleName}`;
    const cached = this.fallbackFontPtrs.get(key);
    if (cached) return cached;
    const data = this.fallbackFontData.get(key);
    if (!data) return null;
    const dataPtr = this.m.pdfium.wasmExports.malloc(data.length);
    if (!dataPtr) return null;
    try {
      heapOf(this.m).set(data, dataPtr);
      const fontPtr = this.m.FPDFText_LoadFont(
        this.docPtr,
        dataPtr,
        data.length,
        2,
        true,
      );
      if (!fontPtr) {
        this.m.pdfium.wasmExports.free(dataPtr);
        return null;
      }
      this.loadedFonts.push({ fontPtr, dataPtr });
      this.fallbackFontPtrs.set(key, fontPtr);
      return fontPtr;
    } catch {
      this.m.pdfium.wasmExports.free(dataPtr);
      return null;
    }
  }

  private applyExistingRun(
    pagePtr: number,
    pageIndex: number,
    run: PdfiumTextRun,
    edit: PdfiumTextEdit,
  ): boolean {
    if (run.members.length <= 1) {
      const member = run.members[0];
      if (!member) return false;
      if (!this.setObjectText(member.objPtr, edit.newText)) {
        this.setObjectText(member.objPtr, edit.originalText);
        return false;
      }
      if (!this.m.FPDFPage_GenerateContent(pagePtr)) {
        throw new Error("PDFium: impossibile rigenerare la pagina.");
      }
      this.reloadTextPage(pageIndex);
      const textPage = this.textPage(pageIndex);
      const roundTrip = textPage ? this.objectText(member.objPtr, textPage) : "";
      if (normaliseText(roundTrip) !== normaliseText(edit.newText)) {
        this.setObjectText(member.objPtr, edit.originalText);
        this.m.FPDFPage_GenerateContent(pagePtr);
        this.reloadTextPage(pageIndex);
        return false;
      }
      const bbox = this.objectBounds(member.objPtr);
      if (!bbox || isCollapsed(bbox, edit.newText, edit.fontSize)) {
        this.setObjectText(member.objPtr, edit.originalText);
        this.m.FPDFPage_GenerateContent(pagePtr);
        this.reloadTextPage(pageIndex);
        return false;
      }
      if (edit.colorOverride) {
        this.setObjectColor(member.objPtr, edit.colorOverride);
        this.m.FPDFPage_GenerateContent(pagePtr);
        this.reloadTextPage(pageIndex);
      }
      return true;
    }

    // A line assembled from many per-character objects: write the full text
    // into the first non-space object and blank the others. This keeps the
    // original font, matrix and color instead of creating a new font object.
    const target =
      run.members.find((member) => member.text.trim().length > 0) ??
      run.members[0];
    if (!target) return false;
    const originals = run.members.map((member) => ({
      member,
      text: member.text,
    }));
    if (!this.setObjectText(target.objPtr, edit.newText)) return false;
    for (const member of run.members) {
      if (member.objPtr === target.objPtr) continue;
      if (!this.setObjectText(member.objPtr, " ")) {
        for (const original of originals) {
          this.setObjectText(original.member.objPtr, original.text);
        }
        this.m.FPDFPage_GenerateContent(pagePtr);
        this.reloadTextPage(pageIndex);
        return false;
      }
    }
    if (!this.m.FPDFPage_GenerateContent(pagePtr)) {
      throw new Error("PDFium: impossibile rigenerare la pagina.");
    }
    this.reloadTextPage(pageIndex);
    const textPage = this.textPage(pageIndex);
    const roundTrip = textPage ? this.objectText(target.objPtr, textPage) : "";
    const bbox = this.objectBounds(target.objPtr);
    if (
      normaliseText(roundTrip) !== normaliseText(edit.newText) ||
      !bbox ||
      isCollapsed(bbox, edit.newText, edit.fontSize)
    ) {
      for (const original of originals) {
        this.setObjectText(original.member.objPtr, original.text);
      }
      this.m.FPDFPage_GenerateContent(pagePtr);
      this.reloadTextPage(pageIndex);
      return false;
    }
    if (edit.colorOverride) {
      this.setObjectColor(target.objPtr, edit.colorOverride);
      this.m.FPDFPage_GenerateContent(pagePtr);
      this.reloadTextPage(pageIndex);
    }
    return true;
  }

  /**
   * Best-effort exact match: reload the embedded font from the PDF and use it
   * for a new text object. Subset fonts that lack a usable cmap will fail the
   * round-trip check and fall through to the standard-font path.
   */
  private loadEmbeddedFont(fontPtr: number): number | null {
    const bytes = this.readFontBytes(fontPtr);
    if (!bytes || bytes.length === 0) return null;
    const dataPtr = this.m.pdfium.wasmExports.malloc(bytes.length);
    if (!dataPtr) return null;
    try {
      heapOf(this.m).set(bytes, dataPtr);
      let loaded = this.m.FPDFText_LoadFont(
        this.docPtr,
        dataPtr,
        bytes.length,
        2,
        false,
      );
      if (!loaded) {
        loaded = this.m.FPDFText_LoadFont(
          this.docPtr,
          dataPtr,
          bytes.length,
          1,
          false,
        );
      }
      if (!loaded) {
        this.m.pdfium.wasmExports.free(dataPtr);
        return null;
      }
      this.loadedFonts.push({ fontPtr: loaded, dataPtr });
      return loaded;
    } catch {
      this.m.pdfium.wasmExports.free(dataPtr);
      return null;
    }
  }

  private readFontBytes(fontPtr: number): Uint8Array | null {
    if (!fontPtr) return null;
    const cached = this.fontDataCache.get(fontPtr);
    if (cached !== undefined) return cached;
    const sizePtr = this.m.pdfium.wasmExports.malloc(4);
    if (!sizePtr) return null;
    let size = 0;
    try {
      if (!this.m.FPDFFont_GetFontData(fontPtr, 0, 0, sizePtr)) {
        this.fontDataCache.set(fontPtr, null);
        return null;
      }
      size = this.m.pdfium.getValue(sizePtr, "i32");
    } catch {
      this.fontDataCache.set(fontPtr, null);
      return null;
    } finally {
      this.m.pdfium.wasmExports.free(sizePtr);
    }
    if (!size || size < 0) {
      this.fontDataCache.set(fontPtr, null);
      return null;
    }
    const dataPtr = this.m.pdfium.wasmExports.malloc(size);
    if (!dataPtr) return null;
    try {
      const outPtr = this.m.pdfium.wasmExports.malloc(4);
      if (!outPtr) return null;
      let ok = false;
      try {
        ok = this.m.FPDFFont_GetFontData(fontPtr, dataPtr, size, outPtr);
      } finally {
        this.m.pdfium.wasmExports.free(outPtr);
      }
      if (!ok) {
        this.fontDataCache.set(fontPtr, null);
        return null;
      }
      const bytes = heapOf(this.m).slice(dataPtr, dataPtr + size);
      this.fontDataCache.set(fontPtr, bytes);
      return bytes;
    } catch {
      this.fontDataCache.set(fontPtr, null);
      return null;
    } finally {
      this.m.pdfium.wasmExports.free(dataPtr);
    }
  }

  private applyReplacementRun(
    pagePtr: number,
    pageIndex: number,
    run: PdfiumTextRun,
    edit: PdfiumTextEdit,
    fontPtr: number,
    style: EditStyle,
    move?: PdfiumTextMove,
  ): boolean {
    const target =
      run.members.find((member) => member.text.trim().length > 0) ??
      run.members[0];
    if (!target) return false;
    const matrixScale = Math.hypot(target.matrix.a, target.matrix.b) || 1;
    const sourceSize =
      target.textFontSize || run.textFontSize || run.fontSize || style.fontSize;
    const rawSize =
      edit.fontSizeOverride !== undefined
        ? style.fontSize / matrixScale
        : sourceSize;
    const replacementSize =
      edit.fontSizeOverride !== undefined
        ? Math.max(0.5, rawSize)
        : this.matchFontSize(target.fontPtr, fontPtr, rawSize);
    const objectPtr = this.m.FPDFPageObj_CreateTextObj(
      this.docPtr,
      fontPtr,
      replacementSize,
    );
    if (!objectPtr) return false;
    const textPtr = this.writeUtf16(edit.newText);
    if (!textPtr) {
      this.m.FPDFPageObj_Destroy(objectPtr);
      return false;
    }
    let inserted = false;
    try {
      if (!this.m.FPDFText_SetText(objectPtr, textPtr)) {
        this.m.FPDFPageObj_Destroy(objectPtr);
        return false;
      }
      const { r, g, b } = hexToRgb(style.color);
      this.m.FPDFPageObj_SetFillColor(objectPtr, r, g, b, 255);
      this.setObjectMatrix(
        objectPtr,
        move
          ? {
              ...target.matrix,
              e: target.matrix.e + move.dx,
              f: target.matrix.f - move.dy,
            }
          : target.matrix,
      );
      this.m.FPDFPage_InsertObject(pagePtr, objectPtr);
      inserted = true;
      if (!this.m.FPDFPage_GenerateContent(pagePtr)) {
        throw new Error("PDFium: impossibile rigenerare la pagina.");
      }
      this.reloadTextPage(pageIndex);
      const textPage = this.textPage(pageIndex);
      const roundTrip = textPage ? this.objectText(objectPtr, textPage) : "";
      const bbox = this.objectBounds(objectPtr);
      if (
        normaliseText(roundTrip) !== normaliseText(edit.newText) ||
        !bbox ||
        isCollapsed(bbox, edit.newText, style.fontSize)
      ) {
        this.m.FPDFPage_RemoveObject(pagePtr, objectPtr);
        this.m.FPDFPageObj_Destroy(objectPtr);
        inserted = false;
        this.m.FPDFPage_GenerateContent(pagePtr);
        this.reloadTextPage(pageIndex);
        return false;
      }
      this.reloadTextPage(pageIndex);
      for (const member of run.members) {
        if (!this.m.FPDFPage_RemoveObject(pagePtr, member.objPtr)) {
          throw new Error("PDFium: impossibile rimuovere il testo originale.");
        }
        this.m.FPDFPageObj_Destroy(member.objPtr);
      }
      if (!this.m.FPDFPage_GenerateContent(pagePtr)) {
        throw new Error("PDFium: impossibile rigenerare la pagina.");
      }
      this.reloadTextPage(pageIndex);
      return true;
    } catch (error) {
      if (inserted) {
        try {
          this.m.FPDFPage_RemoveObject(pagePtr, objectPtr);
          this.m.FPDFPageObj_Destroy(objectPtr);
        } catch {
          // The page is already dirty; the whole export will use the overlay.
        }
      }
      throw error;
    } finally {
      this.m.pdfium.wasmExports.free(textPtr);
    }
  }

  private matchFontSize(
    originalFontPtr: number,
    replacementFontPtr: number,
    size: number,
  ): number {
    const original = this.fontHeight(originalFontPtr, size);
    const replacement = this.fontHeight(replacementFontPtr, size);
    if (!original || !replacement || original <= 0 || replacement <= 0) {
      return size;
    }
    const matched = size * (original / replacement);
    return Math.min(size * 1.3, Math.max(size * 0.8, matched));
  }

  private fontHeight(fontPtr: number, size: number): number | null {
    if (!fontPtr) return null;
    const ptr = this.m.pdfium.wasmExports.malloc(8);
    if (!ptr) return null;
    try {
      const ascentOk = this.m.FPDFFont_GetAscent(fontPtr, size, ptr);
      const descentOk = this.m.FPDFFont_GetDescent(fontPtr, size, ptr + 4);
      if (!ascentOk || !descentOk) return null;
      const ascent = this.f32(ptr);
      const descent = this.f32(ptr + 4);
      const height = ascent - descent;
      return height > 0 && Number.isFinite(height) ? height : null;
    } catch {
      return null;
    } finally {
      this.m.pdfium.wasmExports.free(ptr);
    }
  }

  private setObjectMatrix(
    objPtr: number,
    matrix: { a: number; b: number; c: number; d: number; e: number; f: number },
  ): void {
    const ptr = this.m.pdfium.wasmExports.malloc(24);
    if (!ptr) return;
    try {
      const view = new DataView(
        (this.m.pdfium.wasmExports as unknown as { memory: WebAssembly.Memory })
          .memory.buffer,
      );
      view.setFloat32(ptr, matrix.a, true);
      view.setFloat32(ptr + 4, matrix.b, true);
      view.setFloat32(ptr + 8, matrix.c, true);
      view.setFloat32(ptr + 12, matrix.d, true);
      view.setFloat32(ptr + 16, matrix.e, true);
      view.setFloat32(ptr + 20, matrix.f, true);
      this.m.FPDFPageObj_SetMatrix(objPtr, ptr);
    } finally {
      this.m.pdfium.wasmExports.free(ptr);
    }
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
      for (const loaded of this.loadedFonts) {
        try {
          this.m.FPDFFont_Close(loaded.fontPtr);
        } catch {
          // Ignore.
        }
        this.m.pdfium.wasmExports.free(loaded.dataPtr);
      }
      this.loadedFonts.length = 0;
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
    this.fontInfoCache.clear();
    this.fontDataCache.clear();
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

  private objectFontInfo(objPtr: number): FontInfo {
    const fontPtr = this.m.FPDFTextObj_GetFont(objPtr);
    const cached = this.fontInfoCache.get(fontPtr);
    if (cached) return cached;
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
    const embedded = this.readFontBytes(fontPtr) !== null;
    const standard = isStandardName(name);
    const fallback = isFallbackName(name);
    const info: FontInfo = {
      fontPtr,
      fontFamily,
      fontName: base || family,
      bold: weight >= 600 || /bold|black|heavy/.test(name),
      italic: /italic|oblique/.test(name),
      embedded,
      standard,
      fallback,
      canStyle: standard || fallback,
    };
    if (fontPtr) this.fontInfoCache.set(fontPtr, info);
    return info;
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
    e: number;
    f: number;
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
        e: this.f32(ptr + 16),
        f: this.f32(ptr + 20),
      };
    } finally {
      this.m.pdfium.wasmExports.free(ptr);
    }
  }

  private setObjectColor(objPtr: number, color: string): void {
    const { r, g, b } = hexToRgb(color);
    this.m.FPDFPageObj_SetFillColor(objPtr, r, g, b, 255);
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

/** Merge per-character/per-word PDFium objects into editable line runs. */
function groupChars(chars: RawChar[]): PdfiumTextRun[] {
  const groups: PdfiumTextRun[] = [];
  for (const char of chars) {
    let current = groups[groups.length - 1];
    const startsNew =
      !current ||
      Math.abs(current.fontSize - char.fontSize) > 0.6 ||
      current.fontFamily !== char.fontFamily ||
      current.fontName !== char.fontName ||
      current.bold !== char.bold ||
      current.italic !== char.italic ||
      current.color !== char.color ||
      current.editable !== char.editable ||
      current.canStyle !== char.canStyle ||
      current.members[0]?.fontPtr !== char.fontPtr ||
      Math.abs(current.y + current.h - (char.y + char.h)) >
        Math.max(2, char.fontSize * 0.35) ||
      char.x - (current.x + current.w) < -char.fontSize * 0.8 ||
      char.x - (current.x + current.w) > char.fontSize * 0.9;

    if (startsNew || !current) {
      const group: PdfiumTextRun = {
        key: `${char.pageIndex}:${char.objPtr}:${Math.round(char.x * 10)}`,
        pageIndex: char.pageIndex,
        objPtr: char.objPtr,
        text: char.text,
        x: char.x,
        y: char.y,
        w: char.w,
        h: char.h,
        fontSize: char.fontSize,
        textFontSize: char.textFontSize,
        fontFamily: char.fontFamily,
        fontName: char.fontName,
        bold: char.bold,
        italic: char.italic,
        color: char.color,
        editable: char.editable,
        canStyle: char.canStyle,
        members: [],
      };
      groups.push(group);
      current = group;
    } else {
      if (
        char.x - (current.x + current.w) > char.fontSize * 0.16 &&
        !/\s$/.test(current.text) &&
        !/^\s/.test(char.text)
      ) {
        current.text += " ";
      }
      current.text += char.text;
    }
    if (!current) continue;
    current.w = Math.max(current.w, char.x + char.w - current.x);
    current.h = Math.max(current.h, char.y + char.h - current.y);
    current.y = Math.min(current.y, char.y);
    if (char.objPtr && !current.members.some((member) => member.objPtr === char.objPtr)) {
      current.members.push(char);
    }
  }
  return groups.filter((group) => group.members.length > 0);
}

function isCollapsed(
  bbox: { left: number; right: number },
  text: string,
  fontSize: number,
): boolean {
  const visible = text.replace(/\s+/gu, "").length;
  if (visible === 0 || fontSize <= 0) return false;
  return bbox.right - bbox.left < visible * fontSize * MIN_INK_EM_PER_CHAR;
}

function isStandardName(name: string): boolean {
  return /^(helvetica|times(?:[\s-]?(?:new[\s-]?)?roman)?|courier(?:[\s-]?new)?)(?:$|[\s,-])/i.test(
    name,
  );
}

function isFallbackName(name: string): boolean {
  return /work\s*sans|worksans|liberation|arial|helvetica/i.test(name);
}

function isStandardFamily(run: PdfiumTextRun): boolean {
  return isStandardName(run.fontName);
}

function isFallbackFamily(run: PdfiumTextRun): boolean {
  return isFallbackName(run.fontName);
}

function standardFontName(run: PdfiumTextRun, style: EditStyle): string {
  if (run.fontFamily === "times") {
    if (style.bold && style.italic) return "Times-BoldItalic";
    if (style.bold) return "Times-Bold";
    if (style.italic) return "Times-Italic";
    return "Times-Roman";
  }
  if (run.fontFamily === "courier") {
    if (style.bold && style.italic) return "Courier-BoldOblique";
    if (style.bold) return "Courier-Bold";
    if (style.italic) return "Courier-Oblique";
    return "Courier";
  }
  if (style.bold && style.italic) return "Helvetica-BoldOblique";
  if (style.bold) return "Helvetica-Bold";
  if (style.italic) return "Helvetica-Oblique";
  return "Helvetica";
}

function hexToRgb(value: string): { r: number; g: number; b: number } {
  const match = value.match(/^#?([0-9a-f]{6})$/i);
  if (!match?.[1]) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(match[1].slice(0, 2), 16),
    g: parseInt(match[1].slice(2, 4), 16),
    b: parseInt(match[1].slice(4, 6), 16),
  };
}
