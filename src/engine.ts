import { STYLES } from "./styles";
import { withOs2Table } from "./font-patch";
import { buildPdf } from "./export";
import {
  PdfiumTextEngine,
  type PdfiumTextEdit,
  type PdfiumTextMove,
  type PdfiumTextRun,
} from "./pdfium";
import {
  displaySize,
  objectBounds,
  totalRotation,
  type PageState,
} from "./model";
import {
  clamp,
  deepClone,
  downloadBytes,
  fileNameFromSource,
  getPdfjs,
  isImageFile,
  isPdfFile,
  loadImage,
  measureText,
  wrapTextLines,
  normaliseImage,
  normaliseRotation,
  outputFileName,
  readFileAsDataUrl,
  toBytes,
  uid,
  FONT_CSS,
} from "./utils";
import type {
  AddImageOptions,
  AddShapeOptions,
  AddTextOptions,
  ChangeReason,
  ExportOptions,
  ImageObject,
  LineObject,
  PageInfo,
  PdfCanvasEventMap,
  PdfCanvasOptions,
  PdfCanvasState,
  PdfSource,
  PenObject,
  SceneObject,
  ShapeObject,
  TextObject,
  Thumbnail,
  Tool,
} from "./types";
import type { PDFDocumentProxy } from "pdfjs-dist";

interface DragState {
  kind: "move" | "resize" | "draw" | "line" | "pen" | "original" | "copy" | "marquee";
  page: PageState;
  object: SceneObject | null;
  start: { x: number; y: number };
  original: SceneObject | null;
  handle?: string;
  points?: Array<[number, number]>;
  moved: boolean;
  objects?: SceneObject[];
  originals?: SceneObject[];
  run?: PdfiumTextRun;
  copyMove?: PdfiumTextMove;
  dx?: number;
  dy?: number;
  originDx?: number;
  originDy?: number;
  cover?: HTMLElement;
  ghost?: HTMLElement;
  background?: string;
  marquee?: HTMLDivElement;
  additive?: boolean;
  last?: Point;
}

interface EditState {
  page: PageState;
  object: TextObject;
  el: HTMLElement;
}

interface Point {
  x: number;
  y: number;
}

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  t: "text",
  e: "text-edit",
  i: "image",
  r: "rect",
  o: "ellipse",
  l: "line",
  p: "pen",
  h: "highlight",
  w: "whiteout",
};

export class PdfCanvas {
  readonly root: HTMLDivElement;
  private readonly viewport: HTMLDivElement;
  private readonly pagesEl: HTMLDivElement;
  private readonly options: Required<
    Pick<PdfCanvasOptions, "minZoom" | "maxZoom" | "historyLimit" | "maxFileSize">
  > &
    PdfCanvasOptions;

  private pdf: PDFDocumentProxy | null = null;
  private sourceBytes: Uint8Array | null = null;
  private fileName = "document.pdf";
  private pages: PageState[] = [];
  private zoom = 1;
  private tool: Tool = "select";
  private currentPageIndex = 0;
  private selectedPageId: string | null = null;
  private selectedObjectId: string | null = null;
  private selectedObjectIds = new Set<string>();
  private selectionEls: HTMLDivElement[] = [];
  private reading = false;
  private editingState: EditState | null = null;
  private history: string[] = [];
  private future: string[] = [];
  private beforeSnapshot: string | null = null;
  private drag: DragState | null = null;
  private pageEls = new Map<string, HTMLDivElement>();
  private visible = new Set<string>();
  private renderTasks = new Map<
    string,
    { cancel: () => void; promise?: Promise<unknown> }
  >();
  private observer: IntersectionObserver | null = null;
  private thumbnailCache = new Map<string, string>();
  private listeners = new Map<
    keyof PdfCanvasEventMap,
    Set<(payload: never) => void>
  >();
  private imageInput: HTMLInputElement;
  private pendingInsert: Point | null = null;
  private scrollFrame = 0;
  private zoomTimer: ReturnType<typeof setTimeout> | null = null;
  private spaceDown = false;
  private panStart: {
    x: number;
    y: number;
    left: number;
    top: number;
  } | null = null;
  private destroyed = false;
  private pdfium: PdfiumTextEngine | null = null;
  private pdfiumLoading: Promise<PdfiumTextEngine> | null = null;
  private pdfiumGeneration = 0;
  private textRuns = new Map<string, PdfiumTextRun[]>();
  private textRunsLoading = new Set<string>();
  private textEdits = new Map<string, PdfiumTextEdit>();
  private originalMoves = new Map<string, PdfiumTextMove>();
  private selectedOriginalKey: string | null = null;
  private selectedOriginalPageId: string | null = null;
  private runFontFaces = new Map<number, string>();
  private originalGhostCache = new Map<string, string | null>();
  private fontFaceGeneration = 0;
  private lockedRunsReported = new Set<string>();
  private originalEdit: {
    page: PageState;
    run: PdfiumTextRun;
    el: HTMLDivElement;
    previous: string;
    background: string;
  } | null = null;
  private activeOriginalKey: string | null = null;
  private activeOriginalPageId: string | null = null;
  private rotationWarningShown = false;

  constructor(container: HTMLElement, options: PdfCanvasOptions = {}) {
    if (!container) throw new Error("A container element is required.");
    PdfCanvas.ensureStyles();
    this.options = {
      minZoom: 0.15,
      maxZoom: 5,
      historyLimit: 60,
      maxFileSize: 200 * 1024 * 1024,
      ...options,
    };

    this.root = document.createElement("div");
    this.root.className = "pc-root";
    this.root.tabIndex = 0;
    this.root.dataset.tool = this.tool;
    this.root.style.setProperty("--pc-accent", options.accent ?? "#6b4eff");
    this.injectFontFaces();
    this.viewport = document.createElement("div");
    this.viewport.className = "pc-viewport";
    this.viewport.tabIndex = 0;
    this.pagesEl = document.createElement("div");
    this.pagesEl.className = "pc-pages";
    this.viewport.appendChild(this.pagesEl);
    this.root.appendChild(this.viewport);

    this.imageInput = document.createElement("input");
    this.imageInput.type = "file";
    this.imageInput.accept = "image/*";
    this.imageInput.style.display = "none";
    this.imageInput.addEventListener("change", () => {
      const file = this.imageInput.files?.[0];
      const point = this.pendingInsert;
      this.pendingInsert = null;
      this.imageInput.value = "";
      if (file) {
        void this.addImageFile(
          file,
          point
            ? { pageIndex: this.currentPageIndex, x: point.x, y: point.y }
            : {},
        );
      }
    });
    this.root.appendChild(this.imageInput);

    container.appendChild(this.root);

    this.viewport.addEventListener("scroll", this.onScroll, { passive: true });
    this.viewport.addEventListener("pointerdown", this.onViewportPointerDown, true);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onWindowBlur);
    this.root.addEventListener("keydown", this.onKeyDown);
    this.root.addEventListener("dragover", this.onDragOver);
    this.root.addEventListener("dragleave", this.onDragLeave);
    this.root.addEventListener("drop", this.onDrop);
    this.root.addEventListener("paste", this.onPaste);
    this.root.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private static ensureStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById("pdfcanvas-styles")) return;
    const style = document.createElement("style");
    style.id = "pdfcanvas-styles";
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------- events

  on<K extends keyof PdfCanvasEventMap>(
    event: K,
    handler: (payload: PdfCanvasEventMap[K]) => void,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => set.delete(handler as (payload: never) => void);
  }

  private emit<K extends keyof PdfCanvasEventMap>(
    event: K,
    payload: PdfCanvasEventMap[K],
  ) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as (value: PdfCanvasEventMap[K]) => void)(payload);
      } catch (error) {
        console.error(`[pdfcanvas] "${event}" handler failed`, error);
      }
    }
  }

  private fail(error: unknown): Error {
    const normalised = error instanceof Error ? error : new Error(String(error));
    this.emit("error", { error: normalised });
    this.options.onError?.(normalised);
    return normalised;
  }

  // ----------------------------------------------------------------- state

  getState(): PdfCanvasState {
    return {
      fileName: this.fileName,
      pageCount: this.pages.length,
      currentPage: this.currentPageIndex,
      pages: this.getPages(),
      selection: this.getSelection(),
      zoom: this.zoom,
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
      tool: this.tool,
    };
  }

  getPages(): PageInfo[] {
    return this.pages.map((page, index) => ({
      id: page.id,
      index,
      width: displaySize(page)[0],
      height: displaySize(page)[1],
      rotation: totalRotation(page),
      objectCount: page.objects.length,
    }));
  }

  getCurrentPage(): number {
    return this.currentPageIndex;
  }

  getZoom(): number {
    return this.zoom;
  }

  getTool(): Tool {
    return this.tool;
  }

  getFileName(): string {
    return this.fileName;
  }

  getSelection(): SceneObject | null {
    const found = this.findSelected();
    return found ? deepClone(found.object) : null;
  }

  private getSelectedPage(): PageState | null {
    return this.pages.find((page) => page.id === this.selectedPageId) ?? null;
  }

  private findSelected(): { page: PageState; object: SceneObject } | null {
    const page = this.getSelectedPage();
    if (!page) return null;
    const object = page.objects.find((item) => item.id === this.selectedObjectId);
    return object ? { page, object } : null;
  }

  // ------------------------------------------------------------------ load

  async load(source: PdfSource, options: { fileName?: string } = {}): Promise<void> {
    if (this.destroyed) throw new Error("This editor has been destroyed.");
    if (!this.options.workerSrc) {
      throw new Error(
        "pdfcanvas: options.workerSrc is required. Self-host pdf.worker.min.mjs and pass its URL.",
      );
    }
    this.reading = true;
    this.reset();
    try {
      const bytes = await toBytes(source);
      if (bytes.byteLength === 0) throw new Error("The PDF file is empty.");
      if (bytes.byteLength > this.options.maxFileSize) {
        throw new Error(
          `This PDF is larger than ${Math.round(this.options.maxFileSize / (1024 * 1024))} MB.`,
        );
      }
      this.sourceBytes = bytes;
      this.fileName =
        options.fileName ?? fileNameFromSource(source, "document.pdf");

      const pdfjs = await getPdfjs();
      pdfjs.GlobalWorkerOptions.workerSrc = this.options.workerSrc;
      const pdf = await pdfjs.getDocument({
        data: bytes.slice(),
        cMapUrl: this.options.cMapUrl,
        cMapPacked: true,
        standardFontDataUrl: this.options.standardFontDataUrl,
        wasmUrl: this.options.wasmUrl,
        useSystemFonts: true,
      }).promise;
      this.pdf = pdf;

      const nextPages: PageState[] = [];
      for (let index = 1; index <= pdf.numPages; index += 1) {
        const page = await pdf.getPage(index);
        const viewport = page.getViewport({ scale: 1, rotation: 0 });
        nextPages.push({
          id: uid(),
          sourceIndex: index - 1,
          width: viewport.width,
          height: viewport.height,
          sourceRotation: normaliseRotation(page.rotate ?? 0),
          rotation: 0,
          objects: [],
        });
      }
      this.pages = nextPages;
      this.currentPageIndex = 0;
      this.buildPages();
      this.applyInitialZoom();
      this.emit("load", {
        fileName: this.fileName,
        pageCount: this.pages.length,
      });
      this.emit("change", { reason: "load" });
    } catch (error) {
      this.pdf = null;
      throw this.fail(error);
    } finally {
      this.reading = false;
    }
  }

  private reset() {
    this.observer?.disconnect();
    this.observer = null;
    this.detachDragListeners();
    this.drag = null;
    this.pendingInsert = null;
    this.originalEdit = null;
    this.pdfiumGeneration += 1;
    this.pdfium?.destroy();
    this.pdfium = null;
    this.pdfiumLoading = null;
    this.textRuns.clear();
    this.textRunsLoading.clear();
    this.textEdits.clear();
    this.originalMoves.clear();
    this.selectedOriginalKey = null;
    this.selectedOriginalPageId = null;
    this.finishPan();
    this.setSpacePan(false);
    this.runFontFaces.clear();
    this.originalGhostCache.clear();
    this.fontFaceGeneration += 1;
    this.lockedRunsReported.clear();
    this.activeOriginalKey = null;
    this.activeOriginalPageId = null;
    this.rotationWarningShown = false;
    for (const task of this.renderTasks.values()) {
      try {
        task.cancel();
      } catch {
        // Ignore cancelled tasks.
      }
    }
    this.renderTasks.clear();
    this.pageEls.clear();
    this.visible.clear();
    this.pagesEl.textContent = "";
    this.pages = [];
    this.history = [];
    this.future = [];
    this.beforeSnapshot = null;
    this.selectedPageId = null;
    this.selectedObjectId = null;
    this.selectedObjectIds.clear();
    this.clearSelectionElements();
    this.editingState = null;
    this.thumbnailCache.clear();
    this.currentPageIndex = 0;
    this.sourceBytes = null;
  }

  // ---------------------------------------------------------------- layout

  private applyInitialZoom() {
    const request =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback: () => void) => setTimeout(callback, 0);
    request(() => {
      if (this.destroyed || this.pages.length === 0) return;
      const initial = this.options.initialZoom ?? 1;
      if (initial === "fit-width") this.fitWidth();
      else if (initial === "fit-page") this.fitPage();
      else this.setZoom(initial);
    });
  }

  private buildPages() {
    this.observer?.disconnect();
    for (const task of this.renderTasks.values()) {
      try {
        task.cancel();
      } catch {
        // Ignore.
      }
    }
    this.renderTasks.clear();
    this.pageEls.clear();
    this.visible.clear();
    this.pagesEl.textContent = "";
    this.selectionEls = [];
    this.thumbnailCache.clear();

    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.pageId;
            if (!id) continue;
            if (entry.isIntersecting) {
              this.visible.add(id);
              const page = this.pages.find((item) => item.id === id);
              if (page) void this.renderPage(page);
            } else {
              this.visible.delete(id);
            }
          }
        },
        { root: this.viewport, rootMargin: "500px 0px" },
      );
    }

    this.pages.forEach((page, index) => {
      const el = document.createElement("div");
      el.className = "pc-page";
      el.dataset.pageId = page.id;
      el.dataset.pageIndex = String(index);
      const canvas = document.createElement("canvas");
      canvas.className = "pc-canvas";
      const overlay = document.createElement("div");
      overlay.className = "pc-overlay";
      el.append(canvas, overlay);
      this.pagesEl.appendChild(el);
      this.pageEls.set(page.id, el);
      this.applyPageLayout(page, el, canvas);
      el.addEventListener("pointerdown", (event) =>
        this.onPagePointerDown(event, page),
      );
      el.addEventListener("dblclick", (event) =>
        this.onPageDoubleClick(event, page),
      );
      this.observer?.observe(el);
      this.renderObjects(page);
    });

    this.renderSelection();
    if (!this.observer) this.renderVisible();
    this.emit("change", { reason: "page" });
  }

  private applyPageLayout(
    page: PageState,
    el = this.pageEls.get(page.id),
    canvas = el?.querySelector("canvas") ?? null,
  ) {
    if (!el) return;
    const [width, height] = displaySize(page);
    el.style.width = `${width * this.zoom}px`;
    el.style.height = `${height * this.zoom}px`;
    if (canvas) {
      canvas.style.width = `${width * this.zoom}px`;
      canvas.style.height = `${height * this.zoom}px`;
    }
  }

  private renderVisible() {
    for (const page of this.pages) {
      if (page.id === this.pages[this.currentPageIndex]?.id || this.visible.has(page.id)) {
        void this.renderPage(page);
      }
    }
  }

  private async renderPage(page: PageState) {
    const el = this.pageEls.get(page.id);
    if (!el) return;
    const canvas = el.querySelector("canvas");
    if (!canvas) return;
    const previous = this.renderTasks.get(page.id);
    if (previous) {
      try {
        previous.cancel();
      } catch {
        // Ignore.
      }
    }
    if (page.sourceIndex === null || !this.pdf) {
      this.paintBlank(canvas);
      return;
    }
    try {
      const pdfPage = await this.pdf.getPage(page.sourceIndex + 1);
      if (this.destroyed || !this.pageEls.has(page.id)) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rotation = totalRotation(page);
      const [cssWidth, cssHeight] = displaySize(page);
      const viewport = pdfPage.getViewport({
        scale: this.zoom * dpr,
        rotation,
      });
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      canvas.style.width = `${cssWidth * this.zoom}px`;
      canvas.style.height = `${cssHeight * this.zoom}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.save();
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();
      const task = pdfPage.render({
        canvasContext: context,
        viewport,
        canvas,
      });
      this.renderTasks.set(page.id, task);
      await task.promise;
      this.renderTasks.delete(page.id);
      this.originalGhostCache.clear();
      if (this.tool === "text-edit") {
        void this.ensureTextRuns(page);
        this.renderOriginalText(page);
      } else if (this.tool === "select" && totalRotation(page) === 0) {
        void this.ensureTextRuns(page, false);
        this.renderOriginalText(page);
      } else {
        this.renderOriginalText(page);
      }
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      if (name !== "RenderingCancelledException") {
        this.fail(error);
      }
    }
  }

  private paintBlank(canvas: HTMLCanvasElement) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const page = this.pages.find((item) => item.id === canvas.parentElement?.dataset.pageId);
    if (!page) return;
    const [width, height] = displaySize(page);
    canvas.width = Math.max(1, Math.round(width * this.zoom * dpr));
    canvas.height = Math.max(1, Math.round(height * this.zoom * dpr));
    canvas.style.width = `${width * this.zoom}px`;
    canvas.style.height = `${height * this.zoom}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  // --------------------------------------------------------------- objects

  private renderObjects(page: PageState) {
    if (this.editingState?.page.id === page.id) return;
    const el = this.pageEls.get(page.id);
    const overlay = el?.querySelector<HTMLElement>(".pc-overlay");
    if (!overlay) return;
    overlay.querySelectorAll(".pc-obj, .pc-selection").forEach((node) => node.remove());
    for (const object of page.objects) {
      overlay.appendChild(this.createObjectElement(page, object));
    }
    this.renderSelection();
    this.renderOriginalText(page);
  }

  private createObjectElement(page: PageState, object: SceneObject): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = `pc-obj pc-obj-${object.type}`;
    wrapper.dataset.objectId = object.id;
    wrapper.dataset.objectType = object.type;
    wrapper.style.opacity = String(object.opacity ?? 1);
    wrapper.addEventListener("pointerdown", (event) => {
      this.onObjectPointerDown(event, page, object);
    });

    if (object.type === "text") {
      wrapper.style.left = `${object.x * this.zoom}px`;
      wrapper.style.top = `${object.y * this.zoom}px`;
      wrapper.style.width = `${object.w * this.zoom}px`;
      wrapper.style.height = `${object.h * this.zoom}px`;
      wrapper.style.fontSize = `${object.fontSize * this.zoom}px`;
      wrapper.style.fontFamily = FONT_CSS[object.fontFamily];
      wrapper.style.fontWeight = object.bold ? "700" : "400";
      wrapper.style.fontStyle = object.italic ? "italic" : "normal";
      wrapper.style.color = object.color;
      wrapper.style.textAlign = object.align;
      if (object.wrap) {
        wrapper.style.whiteSpace = "pre-wrap";
        wrapper.style.overflowWrap = "break-word";
      }
      wrapper.textContent = object.text;
      wrapper.dataset.placeholder = "Scrivi qui";
      wrapper.addEventListener("dblclick", () => this.beginEdit(page, object));
      return wrapper;
    }

    if (object.type === "image") {
      wrapper.style.left = `${object.x * this.zoom}px`;
      wrapper.style.top = `${object.y * this.zoom}px`;
      wrapper.style.width = `${object.w * this.zoom}px`;
      wrapper.style.height = `${object.h * this.zoom}px`;
      const image = document.createElement("img");
      image.src = object.src;
      image.alt = object.name ?? "";
      image.draggable = false;
      wrapper.appendChild(image);
      return wrapper;
    }

    if (object.type === "shape") {
      wrapper.style.left = `${object.x * this.zoom}px`;
      wrapper.style.top = `${object.y * this.zoom}px`;
      wrapper.style.width = `${object.w * this.zoom}px`;
      wrapper.style.height = `${object.h * this.zoom}px`;
      wrapper.dataset.shape = object.shape;
      if (object.fill) wrapper.style.backgroundColor = object.fill;
      if (object.stroke && object.strokeWidth > 0) {
        wrapper.style.border = `${object.strokeWidth * this.zoom}px solid ${object.stroke}`;
      }
      if (object.blend === "multiply") wrapper.style.mixBlendMode = "multiply";
      return wrapper;
    }

    if (object.type === "line") {
      const bounds = objectBounds(object);
      wrapper.style.left = `${bounds.x * this.zoom}px`;
      wrapper.style.top = `${bounds.y * this.zoom}px`;
      wrapper.style.width = `${bounds.w * this.zoom}px`;
      wrapper.style.height = `${bounds.h * this.zoom}px`;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", `0 0 ${bounds.w} ${bounds.h}`);
      svg.setAttribute("preserveAspectRatio", "none");
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "line");
      hit.setAttribute("x1", String(object.x1 - bounds.x));
      hit.setAttribute("y1", String(object.y1 - bounds.y));
      hit.setAttribute("x2", String(object.x2 - bounds.x));
      hit.setAttribute("y2", String(object.y2 - bounds.y));
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", "14");
      hit.setAttribute("pointer-events", "stroke");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(object.x1 - bounds.x));
      line.setAttribute("y1", String(object.y1 - bounds.y));
      line.setAttribute("x2", String(object.x2 - bounds.x));
      line.setAttribute("y2", String(object.y2 - bounds.y));
      line.setAttribute("stroke", object.stroke);
      line.setAttribute("stroke-width", String(object.strokeWidth));
      line.setAttribute("stroke-linecap", "round");
      svg.append(hit, line);
      wrapper.appendChild(svg);
      return wrapper;
    }

    const bounds = objectBounds(object);
    wrapper.style.left = `${bounds.x * this.zoom}px`;
    wrapper.style.top = `${bounds.y * this.zoom}px`;
    wrapper.style.width = `${bounds.w * this.zoom}px`;
    wrapper.style.height = `${bounds.h * this.zoom}px`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${bounds.w} ${bounds.h}`);
    svg.setAttribute("preserveAspectRatio", "none");
    const path = pointsToPath(object.points, bounds.w, bounds.h);
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", path);
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "16");
    hit.setAttribute("pointer-events", "stroke");
    const ink = document.createElementNS("http://www.w3.org/2000/svg", "path");
    ink.setAttribute("d", path);
    ink.setAttribute("fill", "none");
    ink.setAttribute("stroke", object.stroke);
    ink.setAttribute("stroke-width", String(object.strokeWidth));
    ink.setAttribute("stroke-linecap", "round");
    ink.setAttribute("stroke-linejoin", "round");
    svg.append(hit, ink);
    wrapper.appendChild(svg);
    return wrapper;
  }

  private renderSelection() {
    this.clearSelectionElements();
    if (this.editingState) return;
    const page = this.getSelectedPage();
    if (!page) return;
    const objects = this.selectedObjectsOnPage(page);
    if (objects.length === 0) return;
    const overlay = this.pageEls
      .get(page.id)
      ?.querySelector<HTMLElement>(".pc-overlay");
    if (!overlay) return;
    for (const object of objects) {
      const bounds = objectBounds(object);
      const selection = document.createElement("div");
      selection.className = "pc-selection";
      selection.style.left = `${bounds.x * this.zoom}px`;
      selection.style.top = `${bounds.y * this.zoom}px`;
      selection.style.width = `${bounds.w * this.zoom}px`;
      selection.style.height = `${bounds.h * this.zoom}px`;
      if (objects.length === 1) {
        const handles =
          object.type === "text"
            ? (["w", "e"] as const)
            : (["nw", "ne", "sw", "se"] as const);
        for (const corner of handles) {
          const handle = document.createElement("div");
          handle.className = "pc-handle";
          handle.dataset.corner = corner;
          handle.style.left = corner.includes("w") ? "0" : "100%";
          handle.style.top =
            object.type === "text"
              ? "50%"
              : corner.includes("n")
                ? "0"
                : "100%";
          handle.style.transform = "translate(-50%, -50%)";
          handle.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.startResize(event, page, object, corner);
          });
          selection.appendChild(handle);
        }
      }
      overlay.appendChild(selection);
      this.selectionEls.push(selection);
    }
  }

  private objectElement(page: PageState, id: string): HTMLElement | null {
    return (
      this.pageEls
        .get(page.id)
        ?.querySelector<HTMLElement>(`[data-object-id="${id}"]`) ?? null
    );
  }

  // -------------------------------------------------------- original text

  private injectFontFaces() {
    if (!this.options.fontAssetsUrl || typeof document === "undefined") return;
    if (document.getElementById("pdfcanvas-font-faces")) return;
    const base = this.options.fontAssetsUrl.endsWith("/")
      ? this.options.fontAssetsUrl
      : `${this.options.fontAssetsUrl}/`;
    const style = document.createElement("style");
    style.id = "pdfcanvas-font-faces";
    style.textContent = [
      ["WorkSans-Regular.ttf", "400", "normal"],
      ["WorkSans-Bold.ttf", "700", "normal"],
      ["WorkSans-Italic.ttf", "400", "italic"],
      ["WorkSans-BoldItalic.ttf", "700", "italic"],
    ]
      .map(
        ([file, weight, fontStyle]) =>
          `@font-face{font-family:"pc-WorkSans";src:url("${base}${file}");font-weight:${weight};font-style:${fontStyle};font-display:swap}`,
      )
      .concat(
        [
          ["LiberationSans-Regular.ttf", "400", "normal"],
          ["LiberationSans-Bold.ttf", "700", "normal"],
          ["LiberationSans-Italic.ttf", "400", "italic"],
          ["LiberationSans-BoldItalic.ttf", "700", "italic"],
        ].map(
          ([file, weight, fontStyle]) =>
            `@font-face{font-family:"pc-LiberationSans";src:url("${base}${file}");font-weight:${weight};font-style:${fontStyle};font-display:swap}`,
        ),
      )
      .join("\n");
    document.head.appendChild(style);
  }

  private fontCssForRun(
    run: Pick<PdfiumTextRun, "fontCss" | "fontName" | "fontFamily">,
  ): string {
    if (run.fontCss) return `${run.fontCss}, ${FONT_CSS[run.fontFamily]}`;
    if (this.options.fontAssetsUrl) {
      const name = run.fontName.toLowerCase();
      if (/work\s*sans|worksans/.test(name)) {
        return `"pc-WorkSans", ${FONT_CSS[run.fontFamily]}`;
      }
      if (/liberation|arial|helvetica/.test(name)) {
        return `"pc-LiberationSans", ${FONT_CSS[run.fontFamily]}`;
      }
    }
    return FONT_CSS[run.fontFamily];
  }

  private async ensurePdfium(): Promise<PdfiumTextEngine> {
    if (this.pdfium) return this.pdfium;
    if (!this.options.pdfiumWasmUrl) {
      throw new Error(
        "pdfcanvas: options.pdfiumWasmUrl is required to edit original PDF text.",
      );
    }
    if (!this.sourceBytes) throw new Error("Nessun PDF caricato.");
    if (!this.pdfiumLoading) {
      const generation = this.pdfiumGeneration;
      const bytes = new Uint8Array(this.sourceBytes);
      this.pdfiumLoading = PdfiumTextEngine.create(
        this.options.pdfiumWasmUrl,
        bytes,
        this.options.fontAssetsUrl,
      )
        .then((engine) => {
          if (generation !== this.pdfiumGeneration) {
            engine.destroy();
            throw new Error("Il documento è cambiato durante il caricamento.");
          }
          this.pdfium = engine;
          return engine;
        })
        .catch((error: unknown) => {
          if (generation === this.pdfiumGeneration) this.pdfiumLoading = null;
          throw error;
        });
    }
    return this.pdfiumLoading;
  }

  private async ensureTextRuns(page: PageState, warn = true): Promise<void> {
    if (this.textRuns.has(page.id) || this.textRunsLoading.has(page.id)) return;
    if (!this.options.pdfiumWasmUrl) {
      this.textRuns.set(page.id, []);
      return;
    }
    if (page.sourceIndex === null) {
      this.textRuns.set(page.id, []);
      return;
    }
    if (totalRotation(page) !== 0) {
      this.textRuns.set(page.id, []);
      if (warn && !this.rotationWarningShown) {
        this.rotationWarningShown = true;
        this.fail(
          new Error(
            "Il testo originale si può modificare solo su pagine non ruotate. Usa lo strumento Testo per aggiungere contenuto.",
          ),
        );
      }
      return;
    }
    this.textRunsLoading.add(page.id);
    try {
      const engine = await this.ensurePdfium();
      if (!this.pageEls.has(page.id)) return;
      const runs = engine.readPage(page.sourceIndex, totalRotation(page));
      await this.registerRunFonts(engine, runs);
      this.textRuns.set(page.id, runs);
      this.renderOriginalText(page);
    } catch (error) {
      this.textRuns.set(page.id, []);
      this.fail(error);
    } finally {
      this.textRunsLoading.delete(page.id);
    }
  }

  private async registerRunFonts(
    engine: PdfiumTextEngine,
    runs: PdfiumTextRun[],
  ): Promise<void> {
    if (typeof document === "undefined" || typeof FontFace === "undefined") {
      return;
    }
    for (const run of runs) {
      const fontPtr = run.members[0]?.fontPtr ?? 0;
      if (!fontPtr) continue;
      let family = this.runFontFaces.get(fontPtr);
      if (family === undefined) {
        family = "";
        const raw = engine.fontBytes(run);
        const bytes = raw
          ? withOs2Table(raw, {
              bold: run.bold,
              italic: run.italic,
              widthClass: /condensed|narrow/i.test(run.fontName) ? 3 : 5,
            })
          : null;
        if (bytes && canLoadFontFace(bytes)) {
          const name = `pc-run-${this.fontFaceGeneration}-${fontPtr}`;
          try {
            const face = new FontFace(
              name,
              bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
              ) as ArrayBuffer,
            );
            await face.load();
            document.fonts.add(face);
            family = name;
          } catch {
            // CFF and malformed fonts often fail in the browser; PDFium can
            // still export them, the editor preview falls back to the family.
          }
        }
        this.runFontFaces.set(fontPtr, family);
      }
      if (family) run.fontCss = `"${family}"`;
      if (!hasSafePreviewFont(run)) {
        run.editable = false;
        run.canStyle = false;
      }
    }
  }

  private renderOriginalText(page: PageState) {
    const overlay = this.pageEls
      .get(page.id)
      ?.querySelector<HTMLElement>(".pc-overlay");
    if (!overlay) return;
    if (this.originalEdit?.page.id === page.id) return;
    overlay
      .querySelectorAll(
        ".pc-orig-hit, .pc-orig-preview, .pc-orig-editor, .pc-orig-selection, .pc-orig-cover, .pc-orig-ghost",
      )
      .forEach((node) => node.remove());

    const moves = [...this.originalMoves.values()].filter(
      (move) => move.pageIndex === page.sourceIndex,
    );
    const moveByKey = new Map(moves.map((move) => [move.key, move]));
    const edits = [...this.textEdits.values()].filter(
      (edit) => edit.pageIndex === page.sourceIndex,
    );

    if (
      (edits.length > 0 || moves.length > 0) &&
      !this.textRuns.has(page.id) &&
      totalRotation(page) === 0 &&
      (this.visible.has(page.id) ||
        page.id === this.pages[this.currentPageIndex]?.id)
    ) {
      void this.ensureTextRuns(page, false);
    }

    for (const move of moves) {
      if (!move.copy) overlay.appendChild(this.createOriginalCover(move));
    }
    for (const edit of edits) {
      if (edit.deleted) {
        overlay.appendChild(this.createOriginalCover(edit));
        continue;
      }
      overlay.appendChild(
        this.createOriginalPreview(edit, moveByKey.get(edit.key)),
      );
    }
    for (const move of moves) {
      if (this.textEdits.has(move.key)) continue;
      overlay.appendChild(
        this.createOriginalGhost(
          page,
          move,
          this.textEdits.get(move.key),
          move.x + move.dx,
          move.y + move.dy,
          "pc-orig-ghost",
        ),
      );
    }

    this.renderOriginalSelection(page, overlay);

    if (this.tool !== "select" && this.tool !== "text-edit") return;
    const runs = this.textRuns.get(page.id);
    if (!runs) {
      if (
        totalRotation(page) === 0 &&
        (this.visible.has(page.id) ||
          page.id === this.pages[this.currentPageIndex]?.id)
      ) {
        void this.ensureTextRuns(page, this.tool === "text-edit");
      }
      return;
    }

    for (const run of runs) {
      if (this.textEdits.get(run.key)?.deleted) continue;
      const move = moveByKey.get(run.key);
      const hit = document.createElement("div");
      hit.className = "pc-orig-hit";
      hit.style.left = `${(run.x + (move?.dx ?? 0)) * this.zoom}px`;
      hit.style.top = `${(run.y + (move?.dy ?? 0)) * this.zoom}px`;
      hit.style.width = `${Math.max(12, run.w * this.zoom)}px`;
      hit.style.height = `${Math.max(10, run.h * this.zoom)}px`;
      hit.dataset.originalText = run.text;
      hit.dataset.originalKey = run.key;

      if (this.tool === "select") {
        hit.classList.add("pc-orig-move");
        hit.title = run.editable
          ? "Trascina per spostare, doppio clic per modificare"
          : "Trascina per spostare (font non modificabile)";
        hit.setAttribute("aria-label", `Testo: ${run.text}`);
        hit.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          this.beginOriginalMove(event, page, run);
        });
        hit.addEventListener("dblclick", (event) => {
          if (!run.editable) {
            this.reportNonEditable(run);
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          this.beginOriginalTextEdit(page, run, event);
        });
      } else if (run.editable) {
        hit.title = "Modifica questo testo";
        hit.setAttribute("aria-label", `Modifica testo: ${run.text}`);
        hit.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.beginOriginalTextEdit(page, run, event);
        });
      } else {
        hit.classList.add("pc-orig-locked");
        hit.title =
          "Font non disponibile: usa Seleziona per spostare il testo";
        hit.setAttribute("aria-label", `Testo non modificabile: ${run.text}`);
        hit.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.reportNonEditable(run);
        });
      }
      overlay.appendChild(hit);
    }

    if (this.tool !== "select") return;
    for (const move of moves) {
      if (!move.copy) continue;
      const hit = document.createElement("div");
      hit.className = "pc-orig-hit pc-orig-move";
      hit.style.left = `${(move.x + move.dx) * this.zoom}px`;
      hit.style.top = `${(move.y + move.dy) * this.zoom}px`;
      hit.style.width = `${Math.max(12, move.w * this.zoom)}px`;
      hit.style.height = `${Math.max(10, move.h * this.zoom)}px`;
      hit.dataset.originalText = move.text;
      hit.dataset.originalKey = move.key;
      hit.title = "Trascina per spostare la copia";
      hit.setAttribute("aria-label", `Copia testo: ${move.text}`);
      hit.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.beginCopyMove(event, page, move);
      });
      overlay.appendChild(hit);
    }
  }

  private renderOriginalSelection(page: PageState, overlay: HTMLElement) {
    if (
      !this.selectedOriginalKey ||
      this.selectedOriginalPageId !== page.id
    ) {
      return;
    }
    const move = this.originalMoves.get(this.selectedOriginalKey);
    const edit = this.textEdits.get(this.selectedOriginalKey);
    const run = this.textRuns
      .get(page.id)
      ?.find((item) => item.key === this.selectedOriginalKey);
    const source = edit ?? run ?? move;
    if (!source) return;
    const selection = document.createElement("div");
    selection.className = "pc-orig-selection";
    selection.style.left = `${(source.x + (move?.dx ?? 0)) * this.zoom}px`;
    selection.style.top = `${(source.y + (move?.dy ?? 0)) * this.zoom}px`;
    selection.style.width = `${Math.max(12, source.w * this.zoom)}px`;
    selection.style.height = `${Math.max(10, source.h * this.zoom)}px`;
    overlay.appendChild(selection);
  }

  private createOriginalCover(
    move: Pick<PdfiumTextMove, "x" | "y" | "w" | "h" | "background">,
  ): HTMLDivElement {
    const cover = document.createElement("div");
    cover.className = "pc-orig-cover";
    cover.style.left = `${move.x * this.zoom}px`;
    cover.style.top = `${move.y * this.zoom}px`;
    cover.style.width = `${Math.max(1, move.w * this.zoom)}px`;
    cover.style.height = `${Math.max(1, move.h * this.zoom)}px`;
    cover.style.background = move.background;
    return cover;
  }

  private createOriginalPreview(
    edit: PdfiumTextEdit,
    move?: PdfiumTextMove,
  ): HTMLDivElement {
    return this.createOriginalTextElement(
      edit,
      edit,
      edit.x + (move?.dx ?? 0),
      edit.y + (move?.dy ?? 0),
      move ? "transparent" : edit.background,
      "pc-orig-preview",
    );
  }

  private createOriginalGhost(
    page: PageState,
    source: PdfiumTextRun | PdfiumTextMove,
    edit: PdfiumTextEdit | undefined,
    x: number,
    y: number,
    className: string,
  ): HTMLElement {
    if (edit && !edit.deleted) {
      return this.createOriginalTextElement(
        source,
        edit,
        x,
        y,
        "transparent",
        className,
      );
    }
    if (source.fontCss && !source.mixed) {
      return this.createOriginalTextElement(
        source,
        undefined,
        x,
        y,
        "transparent",
        className,
      );
    }
    const image = this.captureOriginalGhost(page, source);
    if (!image) {
      return this.createOriginalTextElement(
        source,
        undefined,
        x,
        y,
        "transparent",
        className,
      );
    }
    const ghost = document.createElement("div");
    ghost.className = className;
    ghost.style.left = `${x * this.zoom}px`;
    ghost.style.top = `${y * this.zoom}px`;
    ghost.style.width = `${Math.max(1, source.w * this.zoom)}px`;
    ghost.style.height = `${Math.max(1, source.h * this.zoom)}px`;
    ghost.style.backgroundImage = `url("${image}")`;
    ghost.style.backgroundSize = "100% 100%";
    ghost.style.backgroundRepeat = "no-repeat";
    return ghost;
  }

  private captureOriginalGhost(
    page: PageState,
    source: Pick<PdfiumTextRun, "x" | "y" | "w" | "h">,
  ): string | null {
    const key = `${page.id}:${source.x.toFixed(2)}:${source.y.toFixed(2)}:${source.w.toFixed(2)}:${source.h.toFixed(2)}:${this.zoom}`;
    const cached = this.originalGhostCache.get(key);
    if (cached !== undefined) return cached;
    const canvas = this.pageEls.get(page.id)?.querySelector("canvas");
    if (!canvas || canvas.width <= 1 || canvas.height <= 1) {
      this.originalGhostCache.set(key, null);
      return null;
    }
    const [pageWidth, pageHeight] = displaySize(page);
    const scaleX = canvas.width / Math.max(1, pageWidth);
    const scaleY = canvas.height / Math.max(1, pageHeight);
    const left = clamp(Math.round(source.x * scaleX), 0, canvas.width - 1);
    const top = clamp(Math.round(source.y * scaleY), 0, canvas.height - 1);
    const width = Math.max(
      1,
      Math.min(canvas.width - left, Math.round(source.w * scaleX)),
    );
    const height = Math.max(
      1,
      Math.min(canvas.height - top, Math.round(source.h * scaleY)),
    );
    const image = document.createElement("canvas");
    image.width = width;
    image.height = height;
    const context = image.getContext("2d");
    if (!context) {
      this.originalGhostCache.set(key, null);
      return null;
    }
    context.drawImage(canvas, left, top, width, height, 0, 0, width, height);
    const background = colourToRgb(this.sampleBackground(page, source));
    try {
      const data = context.getImageData(0, 0, width, height);
      const pixels = data.data;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          Math.abs((pixels[index] ?? 0) - background.r) <= 14 &&
          Math.abs((pixels[index + 1] ?? 0) - background.g) <= 14 &&
          Math.abs((pixels[index + 2] ?? 0) - background.b) <= 14
        ) {
          pixels[index + 3] = 0;
        }
      }
      context.putImageData(data, 0, 0);
    } catch {
      // Tainted canvas: keep the opaque capture.
    }
    const url = image.toDataURL("image/png");
    this.originalGhostCache.set(key, url);
    return url;
  }

  private createOriginalTextElement(
    source: PdfiumTextRun | PdfiumTextMove,
    edit: PdfiumTextEdit | undefined,
    x: number,
    y: number,
    background: string,
    className: string,
  ): HTMLDivElement {
    const preview = document.createElement("div");
    preview.className = className;
    const fontSize = edit?.fontSizeOverride ?? edit?.fontSize ?? source.fontSize;
    const color = edit?.colorOverride ?? edit?.color ?? source.color;
    const bold = edit?.boldOverride ?? edit?.bold ?? source.bold;
    const italic = edit?.italicOverride ?? edit?.italic ?? source.italic;
    preview.style.left = `${x * this.zoom}px`;
    preview.style.top = `${y * this.zoom}px`;
    preview.style.minWidth = `${source.w * this.zoom}px`;
    preview.style.minHeight = `${source.h * this.zoom}px`;
    preview.style.fontSize = `${fontSize * this.zoom}px`;
    preview.style.fontFamily = this.fontCssForRun(edit ?? source);
    preview.style.fontWeight = bold ? "700" : "400";
    preview.style.fontStyle = italic ? "italic" : "normal";
    preview.style.color = color;
    preview.style.background = background;
    preview.textContent = edit?.newText ?? source.text;
    return preview;
  }

  private reportNonEditable(run: PdfiumTextRun) {
    if (this.lockedRunsReported.has(run.key)) return;
    this.lockedRunsReported.add(run.key);
    this.fail(
      new Error(
        "Questo testo usa un font che l'editor non riesce a riutilizzare. Puoi spostarlo con lo strumento Seleziona, ma non modificarlo senza cambiare font.",
      ),
    );
  }

  private beginOriginalTextEdit(
    page: PageState,
    run: PdfiumTextRun,
    event?: PointerEvent | MouseEvent,
  ) {
    if (!run.editable) {
      this.reportNonEditable(run);
      return;
    }
    if (this.originalEdit) this.finishOriginalEdit();
    this.beginMutation();
    const existing = this.textEdits.get(run.key);
    const move = this.originalMoves.get(run.key);
    const offsetX = move?.dx ?? 0;
    const offsetY = move?.dy ?? 0;
    const background =
      existing?.background ??
      this.sampleBackground(page, run, offsetX, offsetY);
    const fontSize = existing?.fontSizeOverride ?? run.fontSize;
    const color = existing?.colorOverride ?? run.color;
    const bold = existing?.boldOverride ?? run.bold;
    const italic = existing?.italicOverride ?? run.italic;
    const editor = document.createElement("div");
    editor.className = "pc-orig-editor";
    editor.contentEditable = "true";
    editor.spellcheck = true;
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-label", "Modifica testo originale");
    editor.style.left = `${(run.x + offsetX) * this.zoom}px`;
    editor.style.top = `${(run.y + offsetY) * this.zoom}px`;
    editor.style.minWidth = `${Math.max(12, run.w * this.zoom)}px`;
    editor.style.minHeight = `${Math.max(10, run.h * this.zoom)}px`;
    editor.style.fontSize = `${fontSize * this.zoom}px`;
    editor.style.fontFamily = this.fontCssForRun(run);
    editor.style.fontWeight = bold ? "700" : "400";
    editor.style.fontStyle = italic ? "italic" : "normal";
    editor.style.color = color;
    editor.style.background = background;
    editor.textContent = existing?.newText ?? run.text;
    editor.addEventListener("paste", (event) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text) document.execCommand("insertText", false, text);
    });
    editor.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        editor.blur();
      }
    });
    editor.addEventListener("blur", () => this.finishOriginalEdit());
    const overlay = this.pageEls
      .get(page.id)
      ?.querySelector<HTMLElement>(".pc-overlay");
    overlay?.appendChild(editor);
    this.originalEdit = {
      page,
      run,
      el: editor,
      previous: existing?.newText ?? run.text,
      background,
    };
    this.activeOriginalKey = run.key;
    this.activeOriginalPageId = page.id;
    this.emit("originaledit", {
      edit:
        existing ??
        {
          ...run,
          newText: run.text,
          originalText: run.text,
          background,
        },
    });
    editor.focus({ preventScroll: true });
    if (event) {
      const placeCaret = () => {
        if (!editor.isConnected) return;
        const doc = document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
          caretPositionFromPoint?: (
            x: number,
            y: number,
          ) => { offsetNode: Node; offset: number } | null;
        };
        const position = doc.caretPositionFromPoint?.(
          event.clientX,
          event.clientY,
        );
        const range = position
          ? null
          : doc.caretRangeFromPoint?.(event.clientX, event.clientY);
        const selection = window.getSelection();
        if (position && editor.contains(position.offsetNode)) {
          const point = document.createRange();
          point.setStart(position.offsetNode, position.offset);
          point.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(point);
        } else if (range && editor.contains(range.startContainer)) {
          selection?.removeAllRanges();
          selection?.addRange(range);
        } else {
          const end = document.createRange();
          end.selectNodeContents(editor);
          end.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(end);
        }
      };
      requestAnimationFrame(placeCaret);
    }
  }

  private finishOriginalEdit() {
    const state = this.originalEdit;
    if (!state) return;
    this.originalEdit = null;
    const text = state.el.innerText
      .replace(/\u00a0/g, " ")
      .replace(/\n$/, "");
    state.el.remove();
    const existing = this.textEdits.get(state.run.key);
    const hasFormat =
      existing &&
      (existing.boldOverride !== undefined ||
        existing.italicOverride !== undefined ||
        existing.fontSizeOverride !== undefined ||
        existing.colorOverride !== undefined);
    if (!text.trim() || (text === state.run.text && !hasFormat)) {
      this.textEdits.delete(state.run.key);
      this.emit("originaledit", {
        edit: {
          ...state.run,
          newText: state.run.text,
          originalText: state.run.text,
          background: state.background,
        },
      });
    } else {
      const edit: PdfiumTextEdit = {
        ...state.run,
        ...existing,
        newText: text,
        originalText: state.run.text,
        background: state.background,
      };
      this.textEdits.set(state.run.key, edit);
      this.emit("originaledit", { edit });
    }
    this.commitMutation("text");
    this.renderObjects(state.page);
    this.emit("change", { reason: "text" });
  }

  /** Apply formatting overrides to the line that is being edited. */
  updateOriginalText(
    patch: Partial<
      Pick<
        PdfiumTextEdit,
        | "boldOverride"
        | "italicOverride"
        | "fontSizeOverride"
        | "colorOverride"
      >
    >,
  ): void {
    if (!this.activeOriginalKey || !this.activeOriginalPageId) return;
    const page = this.pages.find((item) => item.id === this.activeOriginalPageId);
    if (!page) return;
    const run = this.textRuns
      .get(page.id)
      ?.find((item) => item.key === this.activeOriginalKey);
    if (!run) return;
    if (!run.editable) {
      this.fail(
        new Error(
          "Questo font non è disponibile nell'editor: il testo può essere spostato, eliminato o duplicato, ma non riformattato.",
        ),
      );
      return;
    }
    if (
      (patch.boldOverride !== undefined || patch.italicOverride !== undefined) &&
      !run.canStyle
    ) {
      this.fail(
        new Error(
          "Questo font incorporato non ha una variante grassetto o corsivo: il testo può essere modificato solo mantenendo il font originale.",
        ),
      );
      return;
    }
    const move = this.originalMoves.get(run.key);
    const existing = this.textEdits.get(run.key);
    const edit: PdfiumTextEdit = {
      ...(existing ?? {
        ...run,
        newText: run.text,
        originalText: run.text,
        background: this.sampleBackground(
          page,
          run,
          move?.dx ?? 0,
          move?.dy ?? 0,
        ),
      }),
      ...patch,
    };
    this.beginMutation();
    this.textEdits.set(run.key, edit);
    this.commitMutation("text");
    this.renderObjects(page);
    this.emit("originaledit", { edit });
    this.emit("change", { reason: "text" });
  }

  clearOriginalTextFocus(): void {
    this.activeOriginalKey = null;
    this.activeOriginalPageId = null;
    this.emit("originaledit", { edit: null });
  }

  getOriginalEdits(): PdfiumTextEdit[] {
    return [...this.textEdits.values()].map((edit) => deepClone(edit));
  }

  getSourceBytes(): Uint8Array | null {
    return this.sourceBytes ? new Uint8Array(this.sourceBytes) : null;
  }

  serializeScene(): string {
    return this.snapshot();
  }

  restoreScene(scene: string): void {
    this.applySnapshot(scene);
    this.history = [];
    this.future = [];
    this.emit("change", { reason: "load" });
  }

  private sampleBackground(
    page: PageState,
    run: Pick<PdfiumTextRun, "x" | "y" | "w" | "h">,
    offsetX = 0,
    offsetY = 0,
  ): string {
    const canvas = this.pageEls.get(page.id)?.querySelector("canvas");
    if (!canvas) return "#ffffff";
    const context = canvas.getContext("2d");
    if (!context) return "#ffffff";
    const [displayWidth, displayHeight] = displaySize(page);
    const scaleX = canvas.width / Math.max(1, displayWidth);
    const scaleY = canvas.height / Math.max(1, displayHeight);
    const samples: Array<[number, number, number]> = [];
    const x = run.x + offsetX;
    const y = run.y + offsetY;
    const points: Array<[number, number]> = [
      [x - 3, y - 3],
      [x + run.w + 3, y - 3],
      [x - 3, y + run.h + 3],
      [x + run.w + 3, y + run.h + 3],
      [x + run.w / 2, y - 3],
      [x + run.w / 2, y + run.h + 3],
    ];
    for (const [x, y] of points) {
      const px = clamp(Math.round(x * scaleX), 0, canvas.width - 1);
      const py = clamp(Math.round(y * scaleY), 0, canvas.height - 1);
      try {
        const data = context.getImageData(px, py, 1, 1).data;
        samples.push([data[0] ?? 255, data[1] ?? 255, data[2] ?? 255]);
      } catch {
        // Tainted canvas or read failure: fall back to white.
      }
    }
    if (samples.length === 0) return "#ffffff";
    const median = (index: 0 | 1 | 2) => {
      const values = samples.map((sample) => sample[index]).sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)] ?? 255;
    };
    return `#${[median(0), median(1), median(2)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
  }

  private pagesWithFallback(
    edits: PdfiumTextEdit[],
    moves: PdfiumTextMove[] = [],
  ): PageState[] {
    const pages = deepClone(this.pages);
    const moveByKey = new Map(moves.map((move) => [move.key, move]));
    for (const edit of edits) {
      const page = pages.find((item) => item.sourceIndex === edit.pageIndex);
      if (!page) continue;
      const move = moveByKey.get(edit.key);
      const x = edit.x + (move?.dx ?? 0);
      const y = edit.y + (move?.dy ?? 0);
      const fontSize = edit.fontSizeOverride ?? edit.fontSize;
      const color = edit.colorOverride ?? edit.color;
      const bold = edit.boldOverride ?? edit.bold;
      const italic = edit.italicOverride ?? edit.italic;
      const measured = measureText(
        edit.newText,
        fontSize,
        edit.fontFamily,
        bold,
        italic,
      );
      page.objects.push({
        id: uid(),
        type: "shape",
        shape: "rect",
        x,
        y,
        w: edit.w,
        h: edit.h,
        opacity: 1,
        fill: edit.background,
        stroke: null,
        strokeWidth: 0,
      });
      if (edit.deleted) continue;
      page.objects.push({
        id: uid(),
        type: "text",
        x,
        y,
        w: measured.width,
        h: measured.height,
        opacity: 1,
        text: edit.newText,
        fontFamily: edit.fontFamily,
        fontSize,
        bold,
        italic,
        color,
        align: "left",
      });
    }
    return pages;
  }

  private async prepareOriginalEdits(): Promise<{
    bytes: Uint8Array | null;
    pages: PageState[];
  }> {
    if (
      (this.textEdits.size === 0 && this.originalMoves.size === 0) ||
      !this.sourceBytes
    ) {
      return { bytes: this.sourceBytes, pages: this.pages };
    }
    const edits = [...this.textEdits.values()];
    const moves = [...this.originalMoves.values()];
    try {
      if (!this.options.pdfiumWasmUrl) {
        return {
          bytes: this.sourceBytes,
          pages: this.pagesWithFallback(edits, moves),
        };
      }
      // Apply on a fresh document every time. The live PDFium instance must not
      // accumulate mutations: otherwise undo would keep a text change that is no
      // longer in the edit map.
      const engine = await PdfiumTextEngine.create(
        this.options.pdfiumWasmUrl,
        new Uint8Array(this.sourceBytes),
        this.options.fontAssetsUrl,
      );
      try {
        const result = engine.applyEdits(edits, moves);
        if (result.failedMoves.length > 0) {
          this.fail(
            new Error(
              "Una parte del testo originale non può essere spostata in questo PDF.",
            ),
          );
        }
        return {
          bytes: result.bytes,
          pages:
            result.failed.length > 0
              ? this.pagesWithFallback(result.failed, moves)
              : this.pages,
        };
      } finally {
        engine.destroy();
      }
    } catch (error) {
      this.fail(error);
      return {
        bytes: this.sourceBytes,
        pages: this.pagesWithFallback(edits, moves),
      };
    }
  }

  // ------------------------------------------------------------- selection

  select(pageId: string | null, objectId: string | null) {
    if (this.editingState) this.finishEdit();
    if (this.originalEdit) this.finishOriginalEdit();
    if (this.activeOriginalKey) this.clearOriginalTextFocus();
    this.clearOriginalSelection();
    this.selectedPageId = pageId;
    this.selectedObjectId = objectId;
    this.selectedObjectIds = objectId ? new Set([objectId]) : new Set();
    this.renderSelection();
    this.emitSelection();
  }

  private selectMany(
    pageId: string,
    objectIds: string[],
    primaryId: string | null = null,
  ) {
    if (this.editingState) this.finishEdit();
    if (this.originalEdit) this.finishOriginalEdit();
    if (this.activeOriginalKey) this.clearOriginalTextFocus();
    this.clearOriginalSelection();
    this.selectedPageId = pageId;
    this.selectedObjectIds = new Set(objectIds);
    this.selectedObjectId =
      primaryId && this.selectedObjectIds.has(primaryId)
        ? primaryId
        : (objectIds[objectIds.length - 1] ?? null);
    this.renderSelection();
    this.emitSelection();
  }

  private toggleObjectSelection(page: PageState, object: SceneObject) {
    if (this.selectedPageId !== page.id) {
      this.clearOriginalSelection();
      this.selectedPageId = page.id;
      this.selectedObjectIds.clear();
      this.selectedObjectId = null;
    }
    if (this.selectedObjectIds.has(object.id)) {
      this.selectedObjectIds.delete(object.id);
      if (this.selectedObjectId === object.id) {
        this.selectedObjectId = [...this.selectedObjectIds][0] ?? null;
      }
    } else {
      this.selectedObjectIds.add(object.id);
      this.selectedObjectId = object.id;
    }
    this.renderSelection();
    this.emitSelection();
  }

  private selectedObjectsOnPage(
    page: PageState,
  ): SceneObject[] {
    return page.objects.filter((object) =>
      this.selectedObjectIds.has(object.id),
    );
  }

  getSelectedObjects(): SceneObject[] {
    const page = this.getSelectedPage();
    if (!page) return [];
    return this.selectedObjectsOnPage(page).map((object) => deepClone(object));
  }

  private emitSelection() {
    const objects = this.getSelectedObjects();
    this.emit("selectionchange", {
      object: this.getSelection(),
      objects,
    });
  }

  private clearSelectionElements() {
    for (const element of this.selectionEls) element.remove();
    this.selectionEls = [];
  }

  private clearOriginalSelection() {
    if (!this.selectedOriginalKey && !this.selectedOriginalPageId) return;
    this.selectedOriginalKey = null;
    this.selectedOriginalPageId = null;
    for (const page of this.pages) {
      this.pageEls
        .get(page.id)
        ?.querySelectorAll(".pc-orig-selection")
        .forEach((node) => node.remove());
    }
  }

  private selectOriginal(page: PageState, run: PdfiumTextRun) {
    this.selectOriginalKey(page, run.key);
  }

  private selectOriginalKey(page: PageState, key: string) {
    this.clearOriginalSelection();
    this.selectedObjectIds.clear();
    this.selectedObjectId = null;
    this.selectedPageId = page.id;
    this.selectedOriginalKey = key;
    this.selectedOriginalPageId = page.id;
    const run = this.textRuns
      .get(page.id)
      ?.find((item) => item.key === key);
    if (run) {
      const existing = this.textEdits.get(run.key);
      this.activeOriginalKey = run.key;
      this.activeOriginalPageId = page.id;
      this.emit("originaledit", {
        edit:
          existing ?? {
            ...run,
            newText: run.text,
            originalText: run.text,
            background: this.sampleBackground(page, run),
          },
      });
    } else {
      this.activeOriginalKey = null;
      this.activeOriginalPageId = null;
      this.emit("originaledit", { edit: null });
    }
    this.renderSelection();
    this.renderOriginalText(page);
    this.emitSelection();
  }

  clearSelection() {
    this.select(null, null);
  }

  // ---------------------------------------------------------------- pages

  setCurrentPage(index: number) {
    if (this.pages.length === 0) return;
    const next = clamp(index, 0, this.pages.length - 1);
    if (next === this.currentPageIndex) return;
    this.currentPageIndex = next;
    this.emit("pagechange", { index: next });
    if (this.tool === "text-edit") {
      const page = this.pages[next];
      if (page) void this.ensureTextRuns(page);
    }
  }

  goToPage(index: number, smooth = true) {
    const page = this.pages[index];
    if (!page) return;
    const el = this.pageEls.get(page.id);
    this.setCurrentPage(index);
    el?.scrollIntoView({
      block: "start",
      behavior: smooth ? "smooth" : "auto",
    });
  }

  async addBlankPage(afterIndex = this.currentPageIndex): Promise<void> {
    if (this.originalEdit) this.finishOriginalEdit();
    const current = this.pages[afterIndex] ?? this.pages[this.pages.length - 1];
    if (!current) return;
    const [width, height] = displaySize(current);
    this.beginMutation();
    const page: PageState = {
      id: uid(),
      sourceIndex: null,
      width,
      height,
      sourceRotation: 0,
      rotation: 0,
      objects: [],
    };
    this.pages.splice(afterIndex + 1, 0, page);
    this.currentPageIndex = afterIndex + 1;
    this.commitMutation("page");
    this.buildPages();
    this.goToPage(afterIndex + 1, false);
    this.emit("change", { reason: "page" });
  }

  duplicatePage(index = this.currentPageIndex): boolean {
    const source = this.pages[index];
    if (!source) return false;
    if (this.originalEdit) this.finishOriginalEdit();
    this.beginMutation();
    const clone: PageState = {
      ...deepClone(source),
      id: uid(),
      objects: deepClone(source.objects).map((object) => ({
        ...object,
        id: uid(),
      })),
    };
    this.pages.splice(index + 1, 0, clone);
    this.currentPageIndex = index + 1;
    this.commitMutation("page");
    this.buildPages();
    this.goToPage(index + 1, false);
    this.emit("change", { reason: "page" });
    return true;
  }

  deletePage(index: number): boolean {
    if (this.originalEdit) this.finishOriginalEdit();
    if (this.pages.length <= 1) {
      this.fail(new Error("A document needs at least one page."));
      return false;
    }
    if (!this.pages[index]) return false;
    this.beginMutation();
    this.pages.splice(index, 1);
    if (this.currentPageIndex >= this.pages.length) {
      this.currentPageIndex = this.pages.length - 1;
    }
    this.select(null, null);
    this.commitMutation("page");
    this.buildPages();
    this.goToPage(this.currentPageIndex, false);
    this.emit("change", { reason: "page" });
    return true;
  }

  rotatePage(index: number, delta = 90): void {
    if (this.originalEdit) this.finishOriginalEdit();
    const page = this.pages[index];
    if (!page) return;
    this.beginMutation();
    page.rotation = normaliseRotation(page.rotation + delta);
    this.thumbnailCache.delete(page.id);
    this.commitMutation("page");
    this.buildPages();
    this.goToPage(index, false);
    this.emit("change", { reason: "page" });
  }

  movePage(from: number, to: number): void {
    if (this.originalEdit) this.finishOriginalEdit();
    if (from === to || !this.pages[from] || to < 0 || to >= this.pages.length) {
      return;
    }
    this.beginMutation();
    const [page] = this.pages.splice(from, 1);
    if (!page) return;
    this.pages.splice(to, 0, page);
    this.currentPageIndex = this.pages.indexOf(page);
    this.commitMutation("page");
    this.buildPages();
    this.goToPage(this.currentPageIndex, false);
    this.emit("change", { reason: "page" });
  }

  // ------------------------------------------------------------------ zoom

  setZoom(value: number) {
    const next = clamp(
      Math.round(value * 1000) / 1000,
      this.options.minZoom,
      this.options.maxZoom,
    );
    if (next === this.zoom) return;
    this.zoom = next;
    for (const page of this.pages) {
      this.applyPageLayout(page);
      this.renderObjects(page);
    }
    if (this.zoomTimer) clearTimeout(this.zoomTimer);
    this.zoomTimer = setTimeout(() => this.renderVisible(), 70);
    this.emit("zoom", { zoom: next });
    this.emit("change", { reason: "zoom" });
  }

  zoomIn() {
    this.setZoom(this.zoom * 1.2);
  }

  zoomOut() {
    this.setZoom(this.zoom / 1.2);
  }

  fitWidth() {
    if (this.pages.length === 0) return;
    this.setZoom(this.fitZoom("width"));
  }

  fitPage() {
    if (this.pages.length === 0) return;
    this.setZoom(this.fitZoom("page"));
  }

  private fitZoom(mode: "width" | "page"): number {
    const availableWidth = Math.max(120, this.viewport.clientWidth - 64);
    const availableHeight = Math.max(120, this.viewport.clientHeight - 96);
    let zoom = this.options.maxZoom;
    for (const page of this.pages) {
      const [width, height] = displaySize(page);
      const byWidth = availableWidth / width;
      const byHeight =
        mode === "width" ? Number.POSITIVE_INFINITY : availableHeight / height;
      zoom = Math.min(zoom, byWidth, byHeight);
    }
    return zoom;
  }

  // ------------------------------------------------------------- add items

  addText(x?: number, y?: number, options: AddTextOptions = {}): SceneObject | null {
    const page = this.pages[options.pageIndex ?? this.currentPageIndex];
    if (!page) return null;
    const [pageWidth, pageHeight] = displaySize(page);
    const point = {
      x: x ?? options.x ?? pageWidth / 2 - 60,
      y: y ?? options.y ?? pageHeight / 2 - 12,
    };
    this.beginMutation();
    const object = this.createTextObject(page, point.x, point.y, options);
    page.objects.push(object);
    this.commitMutation("object");
    this.select(page.id, object.id);
    this.renderObjects(page);
    this.emit("change", { reason: "object" });
    return deepClone(object);
  }

  private createTextObject(
    page: PageState,
    x: number,
    y: number,
    options: AddTextOptions = {},
  ): TextObject {
    const fontSize = options.fontSize ?? 18;
    const fontFamily = options.fontFamily ?? "helvetica";
    const text = options.text ?? "";
    const bold = options.bold ?? false;
    const italic = options.italic ?? false;
    const measured = measureText(text, fontSize, fontFamily, bold, italic);
    const [pageWidth, pageHeight] = displaySize(page);
    return {
      id: uid(),
      type: "text",
      x: clamp(x, 0, Math.max(0, pageWidth - measured.width)),
      y: clamp(y, 0, Math.max(0, pageHeight - measured.height)),
      w: measured.width,
      h: measured.height,
      opacity: options.opacity ?? 1,
      text,
      fontFamily,
      fontSize,
      bold,
      italic,
      color: options.color ?? "#191722",
      align: options.align ?? "left",
    };
  }

  async addImage(src: string, options: AddImageOptions = {}): Promise<SceneObject | null> {
    const page = this.pages[options.pageIndex ?? this.currentPageIndex];
    if (!page) return null;
    const dataUrl = await normaliseImage(src);
    const image = await loadImage(dataUrl);
    const [pageWidth, pageHeight] = displaySize(page);
    const aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
    const defaultWidth = Math.min(pageWidth * 0.5, 480);
    const width = Math.min(options.width ?? defaultWidth, pageWidth);
    const height = Math.min(
      options.height ?? width / Math.max(0.01, aspect),
      pageHeight,
    );
    const object: ImageObject = {
      id: uid(),
      type: "image",
      x: clamp(options.x ?? (pageWidth - width) / 2, 0, Math.max(0, pageWidth - width)),
      y: clamp(options.y ?? (pageHeight - height) / 2, 0, Math.max(0, pageHeight - height)),
      w: width,
      h: height,
      opacity: options.opacity ?? 1,
      src: dataUrl,
      name: options.name,
      lockAspect: options.lockAspect ?? true,
    };
    this.beginMutation();
    page.objects.push(object);
    this.commitMutation("object");
    this.select(page.id, object.id);
    this.renderObjects(page);
    this.emit("change", { reason: "object" });
    return deepClone(object);
  }

  async addImageFile(file: File, options: AddImageOptions = {}): Promise<SceneObject | null> {
    if (!isImageFile(file)) throw this.fail(new Error("This file is not an image."));
    const dataUrl = await readFileAsDataUrl(file);
    return this.addImage(dataUrl, { ...options, name: file.name });
  }

  async addSignature(src: string): Promise<SceneObject | null> {
    const page = this.pages[this.currentPageIndex];
    if (!page) return null;
    const [pageWidth] = displaySize(page);
    return this.addImage(src, {
      width: Math.min(260, pageWidth * 0.34),
      lockAspect: true,
    });
  }

  addShape(
    shape: "rect" | "ellipse",
    options: AddShapeOptions = {},
  ): SceneObject | null {
    const page = this.pages[options.pageIndex ?? this.currentPageIndex];
    if (!page) return null;
    const [pageWidth, pageHeight] = displaySize(page);
    const width = options.width ?? 160;
    const height = options.height ?? 100;
    const object: ShapeObject = {
      id: uid(),
      type: "shape",
      shape,
      x: options.x ?? (pageWidth - width) / 2,
      y: options.y ?? (pageHeight - height) / 2,
      w: width,
      h: height,
      opacity: options.opacity ?? 1,
      fill: options.fill === undefined ? "#6b4eff" : options.fill,
      stroke: options.stroke === undefined ? null : options.stroke,
      strokeWidth: options.strokeWidth ?? 0,
    };
    this.beginMutation();
    page.objects.push(object);
    this.commitMutation("object");
    this.select(page.id, object.id);
    this.renderObjects(page);
    this.emit("change", { reason: "object" });
    return deepClone(object);
  }

  // ------------------------------------------------------------- selection

  updateSelected(patch: Partial<SceneObject>): void {
    const selected = this.findSelected();
    if (!selected) return;
    this.beginMutation();
    const target = selected.object as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (key === "id" || key === "type") continue;
      target[key] = value;
    }
    if (selected.object.type === "text") {
      if (selected.object.wrap) {
        const lines = wrapTextLines(
          selected.object.text,
          selected.object.w,
          selected.object.fontSize,
          selected.object.fontFamily,
          selected.object.bold,
          selected.object.italic,
        );
        selected.object.h = Math.max(1, lines.length) * selected.object.fontSize * 1.25;
      } else {
        const measured = measureText(
          selected.object.text || " ",
          selected.object.fontSize,
          selected.object.fontFamily,
          selected.object.bold,
          selected.object.italic,
        );
        selected.object.w = measured.width;
        selected.object.h = measured.height;
      }
    }
    this.commitMutation("object");
    this.renderObjects(selected.page);
    this.emit("change", { reason: "object" });
  }

  duplicateSelection(): void {
    const page = this.pages.find(
      (item) => item.id === this.selectedOriginalPageId,
    );
    const key = this.selectedOriginalKey;
    if (page && key) {
      const source = this.originalMoves.get(key);
      const run = this.textRuns
        .get(page.id)
        ?.find((item) => item.key === key);
      const edit = run ? this.textEdits.get(run.key) : undefined;
      const base = run
        ? { ...run, text: edit?.newText ?? run.text }
        : source;
      if (run?.mixed) {
        this.fail(
          new Error(
            "Questa riga contiene più stili: può essere spostata o eliminata, ma non duplicata come testo modificabile.",
          ),
        );
        return;
      }
      if (base) {
        const dx = (source?.dx ?? 0) + 12;
        const dy = (source?.dy ?? 0) + 12;
        const copyKey = `copy:${uid()}`;
        this.beginMutation();
        this.originalMoves.set(copyKey, {
          key: copyKey,
          pageIndex: base.pageIndex,
          text: base.text,
          x: base.x,
          y: base.y,
          w: base.w,
          h: base.h,
          fontSize: base.fontSize,
          fontFamily: base.fontFamily,
          fontName: base.fontName,
          bold: base.bold,
          italic: base.italic,
          color: base.color,
          fontCss: base.fontCss,
          mixed: base.mixed,
          dx,
          dy,
          background:
            source?.background ?? this.sampleBackground(page, base),
          copy: true,
          sourceKey: source?.sourceKey ?? run?.key ?? key,
        });
        this.commitMutation("text");
        this.selectOriginalKey(page, copyKey);
        this.emit("change", { reason: "text" });
        return;
      }
    }
    this.duplicateSelected();
  }

  deleteSelection(): void {
    const page = this.pages.find(
      (item) => item.id === this.selectedOriginalPageId,
    );
    const key = this.selectedOriginalKey;
    if (page && key) {
      const move = this.originalMoves.get(key);
      if (move?.copy) {
        this.beginMutation();
        this.originalMoves.delete(key);
        this.clearOriginalSelection();
        this.activeOriginalKey = null;
        this.activeOriginalPageId = null;
        this.commitMutation("text");
        this.renderObjects(page);
        this.emitSelection();
        this.emit("change", { reason: "text" });
        return;
      }
      const run = this.textRuns
        .get(page.id)
        ?.find((item) => item.key === key);
      if (run) {
        const existing = this.textEdits.get(run.key);
        this.beginMutation();
        this.textEdits.set(run.key, {
          ...run,
          ...existing,
          newText: "",
          originalText: run.text,
          deleted: true,
          background:
            existing?.background ??
            this.sampleBackground(page, run, move?.dx ?? 0, move?.dy ?? 0),
        });
        this.originalMoves.delete(run.key);
        this.clearOriginalSelection();
        this.activeOriginalKey = null;
        this.activeOriginalPageId = null;
        this.commitMutation("text");
        this.renderObjects(page);
        this.emit("originaledit", { edit: null });
        this.emitSelection();
        this.emit("change", { reason: "text" });
        return;
      }
    }
    this.deleteSelected();
  }

  deleteSelected(): void {
    const page = this.getSelectedPage();
    if (!page) return;
    const selected = this.selectedObjectsOnPage(page);
    if (selected.length === 0) return;
    this.beginMutation();
    const ids = new Set(selected.map((object) => object.id));
    page.objects = page.objects.filter((object) => !ids.has(object.id));
    this.selectedObjectId = null;
    this.selectedObjectIds.clear();
    this.clearSelectionElements();
    this.commitMutation("object");
    this.renderObjects(page);
    this.emitSelection();
    this.emit("change", { reason: "object" });
  }

  duplicateSelected(): void {
    const page = this.getSelectedPage();
    if (!page) return;
    const selected = this.selectedObjectsOnPage(page);
    if (selected.length === 0) return;
    this.beginMutation();
    const clones = selected.map((object) => {
      const clone = deepClone(object);
      clone.id = uid();
      if (clone.type === "line") {
        clone.x1 += 12;
        clone.y1 += 12;
        clone.x2 += 12;
        clone.y2 += 12;
      } else {
        clone.x += 12;
        clone.y += 12;
      }
      page.objects.push(clone);
      return clone;
    });
    this.selectedObjectIds = new Set(clones.map((clone) => clone.id));
    this.selectedObjectId = clones[0]?.id ?? null;
    this.commitMutation("object");
    this.renderObjects(page);
    this.emitSelection();
    this.emit("change", { reason: "object" });
  }

  bringForward(): void {
    this.reorderSelected(1);
  }

  sendBackward(): void {
    this.reorderSelected(-1);
  }

  private reorderSelected(direction: 1 | -1) {
    const selected = this.findSelected();
    if (!selected) return;
    const index = selected.page.objects.indexOf(selected.object);
    const next = index + direction;
    if (next < 0 || next >= selected.page.objects.length) return;
    this.beginMutation();
    selected.page.objects.splice(index, 1);
    selected.page.objects.splice(next, 0, selected.object);
    this.commitMutation("object");
    this.renderObjects(selected.page);
    this.emit("change", { reason: "object" });
  }

  // ---------------------------------------------------------------- history

  private snapshot(): string {
    return JSON.stringify({
      pages: this.pages,
      currentPage: this.currentPageIndex,
      textEdits: [...this.textEdits.values()],
      originalMoves: [...this.originalMoves.values()],
    });
  }

  private beginMutation() {
    this.beforeSnapshot ??= this.snapshot();
  }

  private commitMutation(reason: ChangeReason) {
    const before = this.beforeSnapshot;
    this.beforeSnapshot = null;
    if (!before) return;
    if (before !== this.snapshot()) {
      this.history.push(before);
      if (this.history.length > this.options.historyLimit) this.history.shift();
      this.future = [];
    }
    this.emit("change", { reason });
  }

  private abortMutation() {
    this.beforeSnapshot = null;
  }

  undo(): void {
    if (this.originalEdit) this.finishOriginalEdit();
    if (this.history.length === 0) return;
    const current = this.snapshot();
    const previous = this.history.pop();
    if (!previous) return;
    this.future.push(current);
    this.applySnapshot(previous);
    this.emit("change", { reason: "history" });
  }

  redo(): void {
    if (this.originalEdit) this.finishOriginalEdit();
    if (this.future.length === 0) return;
    const current = this.snapshot();
    const next = this.future.pop();
    if (!next) return;
    this.history.push(current);
    this.applySnapshot(next);
    this.emit("change", { reason: "history" });
  }

  private applySnapshot(snapshot: string) {
    try {
      const parsed = JSON.parse(snapshot) as {
        pages: PageState[];
        currentPage: number;
        textEdits?: PdfiumTextEdit[];
        originalMoves?: PdfiumTextMove[];
      };
      this.pages = parsed.pages;
      this.textEdits = new Map(
        (parsed.textEdits ?? []).map((edit) => [edit.key, edit]),
      );
      this.originalMoves = new Map(
        (parsed.originalMoves ?? []).map((move) => [move.key, move]),
      );
      this.originalEdit = null;
      this.activeOriginalKey = null;
      this.activeOriginalPageId = null;
      this.selectedOriginalKey = null;
      this.selectedOriginalPageId = null;
      this.emit("originaledit", { edit: null });
      this.currentPageIndex = clamp(
        parsed.currentPage ?? 0,
        0,
        Math.max(0, this.pages.length - 1),
      );
      this.selectedPageId = null;
      this.selectedObjectId = null;
      this.selectedObjectIds.clear();
      this.selectionEls = [];
      this.editingState = null;
      this.buildPages();
      this.emitSelection();
      this.goToPage(this.currentPageIndex, false);
    } catch (error) {
      this.fail(error);
    }
  }

  // ------------------------------------------------------------------ edit

  private beginEdit(page: PageState, object: TextObject) {
    if (this.editingState) this.finishEdit();
    this.select(page.id, object.id);
    const el = this.objectElement(page, object.id);
    if (!el) return;
    this.beginMutation();
    this.editingState = { page, object, el };
    this.renderSelection();
    el.contentEditable = "true";
    el.spellcheck = false;
    el.focus({ preventScroll: true });
    if (!object.text) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    const onInput = () => {
      const text = el.innerText.replace(/\u00a0/g, " ").replace(/\n$/, "");
      object.text = text;
      if (object.wrap) {
        const lines = wrapTextLines(
          text,
          object.w,
          object.fontSize,
          object.fontFamily,
          object.bold,
          object.italic,
        );
        object.h = Math.max(1, lines.length) * object.fontSize * 1.25;
      } else {
        const measured = measureText(
          text || " ",
          object.fontSize,
          object.fontFamily,
          object.bold,
          object.italic,
        );
        object.w = measured.width;
        object.h = measured.height;
      }
      el.style.width = `${object.w * this.zoom}px`;
      el.style.height = `${object.h * this.zoom}px`;
      this.emit("change", { reason: "text" });
    };
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text) document.execCommand("insertText", false, text);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        el.blur();
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        el.blur();
      }
      event.stopPropagation();
    };
    const onBlur = () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("paste", onPaste);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur);
      this.finishEdit();
    };
    el.addEventListener("input", onInput);
    el.addEventListener("paste", onPaste);
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
  }

  private finishEdit() {
    const state = this.editingState;
    if (!state) return;
    this.editingState = null;
    const { page, object, el } = state;
    el.contentEditable = "false";
    const text = object.text.trim();
    if (!text) {
      page.objects = page.objects.filter((item) => item.id !== object.id);
      if (this.selectedObjectId === object.id) {
        this.selectedObjectId = null;
        this.emit("selectionchange", { object: null });
      }
    } else {
      object.text = object.text.replace(/\s+$/, "");
    }
    this.commitMutation("text");
    this.renderObjects(page);
    this.emit("change", { reason: "text" });
  }

  // --------------------------------------------------------------- pointer

  private pointFromEvent(event: PointerEvent | MouseEvent, page: PageState): Point {
    const el = this.pageEls.get(page.id);
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / this.zoom,
      y: (event.clientY - rect.top) / this.zoom,
    };
  }

  private async onPageDoubleClick(event: MouseEvent, page: PageState) {
    if (this.tool !== "select" || page.sourceIndex === null) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(".pc-obj") ||
      target?.closest(".pc-orig-editor") ||
      target?.closest(".pc-orig-hit")
    ) {
      return;
    }
    const point = this.pointFromEvent(event, page);
    try {
      if (!this.textRuns.has(page.id)) await this.ensureTextRuns(page);
      const run = this.textRuns
        .get(page.id)
        ?.find(
          (item) =>
            point.x >= item.x &&
            point.x <= item.x + item.w &&
            point.y >= item.y &&
            point.y <= item.y + item.h,
        );
      if (run) {
        event.preventDefault();
        this.beginOriginalTextEdit(page, run, event);
      }
    } catch {
      // ensureTextRuns already reports the error.
    }
  }

  private setSpacePan(active: boolean) {
    this.spaceDown = active;
    if (active) this.root.dataset.pan = "true";
    else delete this.root.dataset.pan;
  }

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.code === "Space") this.setSpacePan(false);
  };

  private onWindowBlur = () => {
    this.setSpacePan(false);
    this.finishPan();
  };

  private onViewportPointerDown = (event: PointerEvent) => {
    if (event.button === 1 || (event.button === 0 && this.spaceDown)) {
      event.preventDefault();
      event.stopPropagation();
      if (this.originalEdit) this.finishOriginalEdit();
      if (this.editingState) this.finishEdit();
      this.panStart = {
        x: event.clientX,
        y: event.clientY,
        left: this.viewport.scrollLeft,
        top: this.viewport.scrollTop,
      };
      this.root.dataset.panning = "true";
      window.addEventListener("pointermove", this.onPanMove, { passive: false });
      window.addEventListener("pointerup", this.onPanEnd);
      window.addEventListener("pointercancel", this.onPanEnd);
    }
  };

  private onPanMove = (event: PointerEvent) => {
    const pan = this.panStart;
    if (!pan) return;
    event.preventDefault();
    this.viewport.scrollLeft = pan.left - (event.clientX - pan.x);
    this.viewport.scrollTop = pan.top - (event.clientY - pan.y);
  };

  private onPanEnd = () => {
    this.finishPan();
  };

  private finishPan() {
    if (!this.panStart) return;
    this.panStart = null;
    delete this.root.dataset.panning;
    window.removeEventListener("pointermove", this.onPanMove);
    window.removeEventListener("pointerup", this.onPanEnd);
    window.removeEventListener("pointercancel", this.onPanEnd);
  }

  private onPagePointerDown(event: PointerEvent, page: PageState) {    if (event.button !== 0) return;
    if (this.tool === "select") {
      this.setCurrentPage(this.pages.indexOf(page));
      this.root.focus({ preventScroll: true });
      this.startMarquee(event, page);
      return;
    }
    if (this.reading) return;
    event.preventDefault();
    this.setCurrentPage(this.pages.indexOf(page));
    this.root.focus({ preventScroll: true });
    const point = this.pointFromEvent(event, page);
    this.createWithTool(page, point);
  }

  private onObjectPointerDown(
    event: PointerEvent,
    page: PageState,
    object: SceneObject,
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.setCurrentPage(this.pages.indexOf(page));
    this.root.focus({ preventScroll: true });
    if (this.tool === "text" && object.type === "text") {
      this.beginEdit(page, object);
      return;
    }
    if (this.tool !== "select") {
      event.preventDefault();
      const point = this.pointFromEvent(event, page);
      this.createWithTool(page, point);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      this.toggleObjectSelection(page, object);
      return;
    }
    if (!this.selectedObjectIds.has(object.id)) {
      this.select(page.id, object.id);
    }
    this.startMoveSelection(event, page, object);
  }

  private createWithTool(page: PageState, point: Point) {
    switch (this.tool) {
      case "text": {
        this.beginMutation();
        const object = this.createTextObject(page, point.x, point.y);
        page.objects.push(object);
        this.select(page.id, object.id);
        this.renderObjects(page);
        this.beginEdit(page, object);
        break;
      }
      case "image": {
        this.pendingInsert = point;
        this.imageInput.value = "";
        this.imageInput.click();
        break;
      }
      case "rect":
      case "ellipse":
      case "highlight":
      case "whiteout": {
        this.startShapeDraw(page, point);
        break;
      }
      case "line": {
        this.startLineDraw(page, point);
        break;
      }
      case "pen": {
        this.startPenDraw(page, point);
        break;
      }
      default:
        break;
    }
  }

  private startShapeDraw(page: PageState, start: Point) {
    const shapeType = this.tool;
    const isHighlight = shapeType === "highlight";
    const isWhiteout = shapeType === "whiteout";
    const object: ShapeObject = {
      id: uid(),
      type: "shape",
      shape: shapeType === "ellipse" ? "ellipse" : "rect",
      x: start.x,
      y: start.y,
      w: 1,
      h: 1,
      opacity: isHighlight ? 0.5 : 1,
      fill: isHighlight ? "#ffe14d" : isWhiteout ? "#ffffff" : "#6b4eff",
      stroke: null,
      strokeWidth: 0,
      blend: isHighlight ? "multiply" : "normal",
    };
    this.beginMutation();
    page.objects.push(object);
    this.drag = {
      kind: "draw",
      page,
      object,
      start,
      original: deepClone(object),
      moved: false,
    };
    this.attachDragListeners();
    this.renderObjects(page);
  }

  private startLineDraw(page: PageState, start: Point) {
    const object: LineObject = {
      id: uid(),
      type: "line",
      x1: start.x,
      y1: start.y,
      x2: start.x,
      y2: start.y,
      stroke: "#191722",
      strokeWidth: 2,
      opacity: 1,
    };
    this.beginMutation();
    page.objects.push(object);
    this.drag = {
      kind: "line",
      page,
      object,
      start,
      original: deepClone(object),
      moved: false,
    };
    this.attachDragListeners();
    this.renderObjects(page);
  }

  private startPenDraw(page: PageState, start: Point) {
    const object: PenObject = {
      id: uid(),
      type: "pen",
      x: start.x,
      y: start.y,
      w: 1,
      h: 1,
      opacity: 1,
      points: [[0.5, 0.5]],
      stroke: "#6b4eff",
      strokeWidth: 2.5,
    };
    this.beginMutation();
    page.objects.push(object);
    this.drag = {
      kind: "pen",
      page,
      object,
      start,
      original: deepClone(object),
      points: [[start.x, start.y]],
      moved: false,
    };
    this.attachDragListeners();
    this.renderObjects(page);
  }

  private startMoveSelection(
    event: PointerEvent,
    page: PageState,
    primary: SceneObject,
  ) {
    const objects = this.selectedObjectsOnPage(page);
    const moving = objects.length > 0 ? objects : [primary];
    this.beginMutation();
    this.drag = {
      kind: "move",
      page,
      object: primary,
      objects: moving,
      originals: moving.map((object) => deepClone(object)),
      start: this.pointFromEvent(event, page),
      original: deepClone(primary),
      moved: false,
    };
    this.attachDragListeners();
  }

  private startMarquee(event: PointerEvent, page: PageState) {
    if (this.originalEdit) this.finishOriginalEdit();
    if (this.editingState) this.finishEdit();
    event.preventDefault();
    const start = this.pointFromEvent(event, page);
    const overlay = this.pageEls
      .get(page.id)
      ?.querySelector<HTMLElement>(".pc-overlay");
    if (!overlay) return;
    const marquee = document.createElement("div");
    marquee.className = "pc-marquee";
    marquee.style.left = `${start.x * this.zoom}px`;
    marquee.style.top = `${start.y * this.zoom}px`;
    marquee.style.width = "0px";
    marquee.style.height = "0px";
    overlay.appendChild(marquee);
    this.drag = {
      kind: "marquee",
      page,
      object: null,
      original: null,
      start,
      moved: false,
      marquee,
      additive: event.shiftKey,
    };
    this.attachDragListeners();
  }

  private beginOriginalMove(
    event: PointerEvent,
    page: PageState,
    run: PdfiumTextRun,
  ) {
    if (this.originalEdit) this.finishOriginalEdit();
    if (this.editingState) this.finishEdit();
    this.selectOriginal(page, run);
    this.beginMutation();
    const existing = this.originalMoves.get(run.key);
    const dx = existing?.dx ?? 0;
    const dy = existing?.dy ?? 0;
    const background = existing?.background ?? this.sampleBackground(page, run);
    const overlay = this.pageEls
      .get(page.id)
      ?.querySelector<HTMLElement>(".pc-overlay");
    if (!overlay) return;
    const cover = this.createOriginalCover({ ...run, background });
    const ghost = this.createOriginalGhost(
      page,
      run,
      this.textEdits.get(run.key),
      run.x + dx,
      run.y + dy,
      "pc-orig-ghost",
    );
    overlay.append(cover, ghost);
    this.drag = {
      kind: "original",
      page,
      object: null,
      run,
      start: this.pointFromEvent(event, page),
      original: null,
      moved: false,
      dx,
      dy,
      originDx: dx,
      originDy: dy,
      cover,
      ghost,
      background,
    };
    this.attachDragListeners();
  }

  private beginCopyMove(
    event: PointerEvent,
    page: PageState,
    move: PdfiumTextMove,
  ) {
    if (this.originalEdit) this.finishOriginalEdit();
    if (this.editingState) this.finishEdit();
    this.selectOriginalKey(page, move.key);
    this.beginMutation();
    const overlay = this.pageEls
      .get(page.id)
      ?.querySelector<HTMLElement>(".pc-overlay");
    if (!overlay) return;
    const ghost = this.createOriginalGhost(
      page,
      move,
      undefined,
      move.x + move.dx,
      move.y + move.dy,
      "pc-orig-ghost",
    );
    overlay.appendChild(ghost);
    this.drag = {
      kind: "copy",
      page,
      object: null,
      copyMove: move,
      start: this.pointFromEvent(event, page),
      original: null,
      moved: false,
      dx: move.dx,
      dy: move.dy,
      originDx: move.dx,
      originDy: move.dy,
      ghost,
      background: move.background,
    };
    this.attachDragListeners();
  }

  private startResize(
    event: PointerEvent,
    page: PageState,
    object: SceneObject,
    handle: string,
  ) {
    this.beginMutation();
    this.drag = {
      kind: "resize",
      page,
      object,
      start: this.pointFromEvent(event, page),
      original: deepClone(object),
      handle,
      moved: false,
    };
    this.attachDragListeners();
  }

  private attachDragListeners() {
    window.addEventListener("pointermove", this.onDragMove, { passive: false });
    window.addEventListener("pointerup", this.onDragEnd);
    window.addEventListener("pointercancel", this.onDragEnd);
  }

  private detachDragListeners() {
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.onDragEnd);
    window.removeEventListener("pointercancel", this.onDragEnd);
  }

  private onDragMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag) return;
    event.preventDefault();
    const point = this.pointFromEvent(event, drag.page);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 2 / this.zoom) return;
    drag.moved = true;
    drag.last = point;

    if (drag.kind === "move" && drag.object && drag.original) {
      this.moveObjects(
        drag.page,
        drag.objects ?? [drag.object],
        drag.originals ?? [drag.original],
        dx,
        dy,
      );
      this.renderObjects(drag.page);
    } else if (drag.kind === "marquee" && drag.marquee) {
      const left = Math.min(drag.start.x, point.x);
      const top = Math.min(drag.start.y, point.y);
      drag.marquee.style.left = `${left * this.zoom}px`;
      drag.marquee.style.top = `${top * this.zoom}px`;
      drag.marquee.style.width = `${Math.abs(point.x - drag.start.x) * this.zoom}px`;
      drag.marquee.style.height = `${Math.abs(point.y - drag.start.y) * this.zoom}px`;
    } else if (drag.kind === "original" && drag.run) {
      const run = drag.run;
      const [pageWidth, pageHeight] = displaySize(drag.page);
      drag.dx = clamp(
        (drag.originDx ?? 0) + dx,
        -run.x,
        Math.max(-run.x, pageWidth - run.x - run.w),
      );
      drag.dy = clamp(
        (drag.originDy ?? 0) + dy,
        -run.y,
        Math.max(-run.y, pageHeight - run.y - run.h),
      );
      if (drag.ghost) {
        drag.ghost.style.left = `${(run.x + drag.dx) * this.zoom}px`;
        drag.ghost.style.top = `${(run.y + drag.dy) * this.zoom}px`;
      }
      const overlay = this.pageEls
        .get(drag.page.id)
        ?.querySelector<HTMLElement>(".pc-overlay");
      const selection = overlay?.querySelector<HTMLElement>(
        ".pc-orig-selection",
      );
      if (selection) {
        selection.style.left = `${(run.x + drag.dx) * this.zoom}px`;
        selection.style.top = `${(run.y + drag.dy) * this.zoom}px`;
      }
    } else if (drag.kind === "copy" && drag.copyMove) {
      const move = drag.copyMove;
      const [pageWidth, pageHeight] = displaySize(drag.page);
      drag.dx = clamp(
        (drag.originDx ?? 0) + dx,
        -move.x,
        Math.max(-move.x, pageWidth - move.x - move.w),
      );
      drag.dy = clamp(
        (drag.originDy ?? 0) + dy,
        -move.y,
        Math.max(-move.y, pageHeight - move.y - move.h),
      );
      if (drag.ghost) {
        drag.ghost.style.left = `${(move.x + drag.dx) * this.zoom}px`;
        drag.ghost.style.top = `${(move.y + drag.dy) * this.zoom}px`;
      }
      const overlay = this.pageEls
        .get(drag.page.id)
        ?.querySelector<HTMLElement>(".pc-overlay");
      const selection = overlay?.querySelector<HTMLElement>(
        ".pc-orig-selection",
      );
      if (selection) {
        selection.style.left = `${(move.x + drag.dx) * this.zoom}px`;
        selection.style.top = `${(move.y + drag.dy) * this.zoom}px`;
      }
    } else if (drag.kind === "resize" && drag.object && drag.original && drag.handle) {
      this.resizeObject(drag.object, drag.original, drag.handle, dx, dy);
      this.renderObjects(drag.page);
    } else if (drag.kind === "draw" && drag.object) {
      const shape = drag.object as ShapeObject;
      shape.x = Math.min(drag.start.x, point.x);
      shape.y = Math.min(drag.start.y, point.y);
      shape.w = Math.max(1, Math.abs(point.x - drag.start.x));
      shape.h = Math.max(1, Math.abs(point.y - drag.start.y));
      this.renderObjects(drag.page);
    } else if (drag.kind === "line" && drag.object) {
      const line = drag.object as LineObject;
      line.x2 = point.x;
      line.y2 = point.y;
      this.renderObjects(drag.page);
    } else if (drag.kind === "pen" && drag.object && drag.points) {
      const last = drag.points[drag.points.length - 1];
      if (!last || Math.hypot(point.x - last[0], point.y - last[1]) > 1.5 / this.zoom) {
        drag.points.push([point.x, point.y]);
        this.updatePenBounds(drag.object as PenObject, drag.points);
        this.renderObjects(drag.page);
      }
    }
  };

  private onDragEnd = () => {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.detachDragListeners();
    this.clearGuides();
    drag.cover?.remove();
    drag.ghost?.remove();
    drag.marquee?.remove();
    if (!drag.moved) {
      if (drag.kind === "draw" || drag.kind === "line" || drag.kind === "pen") {
        this.removeObject(drag.page, drag.object);
        this.abortMutation();
        this.renderObjects(drag.page);
      } else {
        this.abortMutation();
      }
      if (drag.kind === "marquee" && !drag.additive) {
        this.clearSelection();
      }
      if (drag.kind === "original" && drag.run) {
        this.selectOriginal(drag.page, drag.run);
      }
      if (drag.kind === "copy" && drag.copyMove) {
        this.selectOriginalKey(drag.page, drag.copyMove.key);
      }
      return;
    }
    if (drag.kind === "copy" && drag.copyMove) {
      const move = drag.copyMove;
      const updated: PdfiumTextMove = {
        ...move,
        dx: drag.dx ?? 0,
        dy: drag.dy ?? 0,
      };
      if (!updated.dx && !updated.dy) {
        this.originalMoves.delete(move.key);
        this.clearOriginalSelection();
      } else {
        this.originalMoves.set(move.key, updated);
        this.selectOriginalKey(drag.page, move.key);
      }
      this.commitMutation("text");
      this.renderObjects(drag.page);
      this.emit("change", { reason: "text" });
      return;
    }
    if (drag.kind === "marquee") {
      const end = drag.last ?? drag.start;
      const left = Math.min(drag.start.x, end.x);
      const top = Math.min(drag.start.y, end.y);
      const right = Math.max(drag.start.x, end.x);
      const bottom = Math.max(drag.start.y, end.y);
      const hits = drag.page.objects.filter((object) => {
        const bounds = objectBounds(object);
        return (
          bounds.x < right &&
          bounds.x + bounds.w > left &&
          bounds.y < bottom &&
          bounds.y + bounds.h > top
        );
      });
      const ids = hits.map((object) => object.id);
      if (drag.additive) {
        const merged = new Set(this.selectedObjectIds);
        for (const id of ids) merged.add(id);
        if (merged.size > 0) {
          this.selectMany(drag.page.id, [...merged], ids[ids.length - 1] ?? null);
        }
      } else if (ids.length > 0) {
        this.selectMany(drag.page.id, ids, ids[ids.length - 1] ?? null);
      } else {
        this.clearSelection();
      }
      return;
    }
    if (drag.kind === "original" && drag.run) {
      const run = drag.run;
      const dx = drag.dx ?? 0;
      const dy = drag.dy ?? 0;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        this.originalMoves.delete(run.key);
      } else {
        this.originalMoves.set(run.key, {
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
          background:
            drag.background ?? this.sampleBackground(drag.page, run),
        });
      }
      this.commitMutation("text");
      this.selectOriginal(drag.page, run);
      this.emit("change", { reason: "text" });
      return;
    }
    if (drag.kind === "draw" && drag.object) {
      const shape = drag.object as ShapeObject;
      if (shape.w < 8 || shape.h < 8) {
        const isHighlight = shape.blend === "multiply";
        shape.w = isHighlight ? 180 : 140;
        shape.h = isHighlight ? 26 : 90;
      }
      this.select(drag.page.id, shape.id);
    }
    if (drag.kind === "line" && drag.object) {
      const line = drag.object as LineObject;
      if (Math.hypot(line.x2 - line.x1, line.y2 - line.y1) < 6) {
        line.x2 = line.x1 + 140;
        line.y2 = line.y1;
      }
      this.select(drag.page.id, line.id);
    }
    if (drag.kind === "pen" && drag.object && drag.points) {
      if (drag.points.length < 2) {
        this.removeObject(drag.page, drag.object);
        this.abortMutation();
        this.renderObjects(drag.page);
        return;
      }
      this.select(drag.page.id, drag.object.id);
    }
    this.commitMutation("object");
    this.renderObjects(drag.page);
    this.emit("change", { reason: "object" });
  };

  private moveObjects(
    page: PageState,
    objects: SceneObject[],
    originals: SceneObject[],
    dx: number,
    dy: number,
  ) {
    if (objects.length === 0) return;
    const [pageWidth, pageHeight] = displaySize(page);
    const union = this.unionBounds(originals);
    if (!union) return;
    const rawX = union.x + dx;
    const rawY = union.y + dy;
    const snap = 7 / this.zoom;
    const exclude = new Set(objects.map((object) => object.id));
    const xTargets = [0, pageWidth / 2, pageWidth];
    const yTargets = [0, pageHeight / 2, pageHeight];
    for (const other of page.objects) {
      if (exclude.has(other.id)) continue;
      const bounds = objectBounds(other);
      xTargets.push(bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w);
      yTargets.push(bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h);
    }
    const bestX = this.bestSnap(
      [rawX, rawX + union.w / 2, rawX + union.w],
      xTargets,
      snap,
    );
    const bestY = this.bestSnap(
      [rawY, rawY + union.h / 2, rawY + union.h],
      yTargets,
      snap,
    );
    const moveX = clamp(
      dx + (bestX?.delta ?? 0),
      -union.w + 20 - union.x,
      pageWidth - 20 - union.x,
    );
    const moveY = clamp(
      dy + (bestY?.delta ?? 0),
      -union.h + 20 - union.y,
      pageHeight - 20 - union.y,
    );

    objects.forEach((object, index) => {
      const original = originals[index];
      if (!original) return;
      if (object.type === "line" && original.type === "line") {
        object.x1 = original.x1 + moveX;
        object.y1 = original.y1 + moveY;
        object.x2 = original.x2 + moveX;
        object.y2 = original.y2 + moveY;
      } else if (object.type !== "line" && original.type !== "line") {
        object.x = original.x + moveX;
        object.y = original.y + moveY;
      }
    });
    this.showGuides(page, bestX?.guide ?? null, bestY?.guide ?? null);
  }

  private bestSnap(
    own: number[],
    targets: number[],
    threshold: number,
  ): { delta: number; guide: number } | null {
    let best: { delta: number; guide: number } | null = null;
    for (const value of own) {
      for (const target of targets) {
        const delta = target - value;
        if (
          Math.abs(delta) <= threshold &&
          (!best || Math.abs(delta) < Math.abs(best.delta))
        ) {
          best = { delta, guide: target };
        }
      }
    }
    return best;
  }

  private unionBounds(objects: SceneObject[]) {
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const object of objects) {
      const bounds = objectBounds(object);
      left = Math.min(left, bounds.x);
      top = Math.min(top, bounds.y);
      right = Math.max(right, bounds.x + bounds.w);
      bottom = Math.max(bottom, bounds.y + bounds.h);
    }
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  private resizeObject(
    object: SceneObject,
    original: SceneObject,
    handle: string,
    dx: number,
    dy: number,
  ) {
    const bounds = objectBounds(original);
    let left = bounds.x;
    let top = bounds.y;
    let right = bounds.x + bounds.w;
    let bottom = bounds.y + bounds.h;
    if (handle.includes("w")) left += dx;
    if (handle.includes("e")) right += dx;
    if (handle.includes("n")) top += dy;
    if (handle.includes("s")) bottom += dy;
    if (right - left < 12) {
      if (handle.includes("w")) left = right - 12;
      else right = left + 12;
    }
    if (bottom - top < 12) {
      if (handle.includes("n")) top = bottom - 12;
      else bottom = top + 12;
    }

    if (object.type === "line") {
      if (original.type !== "line") return;
      const mapX = (value: number) =>
        left + ((value - bounds.x) / bounds.w) * (right - left);
      const mapY = (value: number) =>
        top + ((value - bounds.y) / bounds.h) * (bottom - top);
      object.x1 = mapX(original.x1);
      object.y1 = mapY(original.y1);
      object.x2 = mapX(original.x2);
      object.y2 = mapY(original.y2);
      return;
    }

    let width = right - left;
    let height = bottom - top;
    if (object.type === "text") {
      width = Math.max(40, width);
      object.w = width;
      object.x = handle.includes("w") ? right - width : left;
      object.y = top;
      object.wrap = true;
      const lines = wrapTextLines(
        object.text,
        object.w,
        object.fontSize,
        object.fontFamily,
        object.bold,
        object.italic,
      );
      object.h = Math.max(1, lines.length) * object.fontSize * 1.25;
      return;
    }
    if (object.type === "image" && object.lockAspect) {
      const aspect = bounds.w / Math.max(1, bounds.h);
      height = width / aspect;
      if (handle.includes("n")) top = bottom - height;
      else bottom = top + height;
    }
    object.w = width;
    object.h = height;
    object.x = left;
    object.y = top;
  }

  private updatePenBounds(object: PenObject, points: Array<[number, number]>) {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const minX = Math.min(...xs) - 2;
    const minY = Math.min(...ys) - 2;
    const width = Math.max(1, Math.max(...xs) - minX + 2);
    const height = Math.max(1, Math.max(...ys) - minY + 2);
    object.x = minX;
    object.y = minY;
    object.w = width;
    object.h = height;
    object.points = points.map(([x, y]) => [
      (x - minX) / width,
      (y - minY) / height,
    ]);
  }

  private removeObject(page: PageState, object: SceneObject | null) {
    if (!object) return;
    page.objects = page.objects.filter((item) => item.id !== object.id);
    if (this.selectedObjectId === object.id) {
      this.selectedObjectId = null;
    }
  }

  private showGuides(page: PageState, x: number | null, y: number | null) {
    this.clearGuides();
    const overlay = this.pageEls
      .get(page.id)
      ?.querySelector<HTMLElement>(".pc-overlay");
    if (!overlay) return;
    if (x !== null) {
      const guide = document.createElement("div");
      guide.className = "pc-guide pc-guide-v";
      guide.style.left = `${x * this.zoom}px`;
      overlay.appendChild(guide);
    }
    if (y !== null) {
      const guide = document.createElement("div");
      guide.className = "pc-guide pc-guide-h";
      guide.style.top = `${y * this.zoom}px`;
      overlay.appendChild(guide);
    }
  }

  private clearGuides() {
    for (const el of this.pageEls.values()) {
      el.querySelectorAll(".pc-guide").forEach((node) => node.remove());
    }
  }

  // --------------------------------------------------------------- zoom UX

  private onScroll = () => {
    if (this.scrollFrame) return;
    this.scrollFrame = window.requestAnimationFrame(() => {
      this.scrollFrame = 0;
      this.updateCurrentPageFromScroll();
    });
  };

  private updateCurrentPageFromScroll() {
    if (this.pages.length === 0) return;
    const viewportRect = this.viewport.getBoundingClientRect();
    let bestIndex = this.currentPageIndex;
    let bestArea = 0;
    this.pages.forEach((page, index) => {
      const el = this.pageEls.get(page.id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.max(
        0,
        Math.min(rect.right, viewportRect.right) - Math.max(rect.left, viewportRect.left),
      );
      const height = Math.max(
        0,
        Math.min(rect.bottom, viewportRect.bottom) - Math.max(rect.top, viewportRect.top),
      );
      const area = width * height;
      if (area > bestArea) {
        bestArea = area;
        bestIndex = index;
      }
    });
    this.setCurrentPage(bestIndex);
  }

  private onWheel = (event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.setZoom(this.zoom * factor);
  };

  // -------------------------------------------------------------- keyboard

  private onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    if (event.code === "Space" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (!this.spaceDown) this.setSpacePan(true);
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && key === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    if (mod && key === "d") {
      event.preventDefault();
      this.duplicateSelection();
      return;
    }
    if (mod && key === "s") {
      event.preventDefault();
      this.emit("save", {});
      return;
    }
    if (mod && (key === "=" || key === "+")) {
      event.preventDefault();
      this.zoomIn();
      return;
    }
    if (mod && key === "-") {
      event.preventDefault();
      this.zoomOut();
      return;
    }
    if (mod && key === "0") {
      event.preventDefault();
      this.fitWidth();
      return;
    }
    if (mod && key === "a") {
      const page = this.pages[this.currentPageIndex];
      if (page && page.objects.length > 0) {
        event.preventDefault();
        this.selectMany(
          page.id,
          page.objects.map((object) => object.id),
          page.objects[page.objects.length - 1]?.id ?? null,
        );
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (this.selectedObjectId || this.selectedOriginalKey) {
        event.preventDefault();
        this.deleteSelection();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.tool !== "select") this.setTool("select");
      else this.clearSelection();
      return;
    }
    if (!mod && TOOL_KEYS[key] && !event.altKey) {
      event.preventDefault();
      this.setTool(TOOL_KEYS[key]!);
      return;
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = arrows[event.key];
    if (direction && (this.selectedObjectId || this.selectedOriginalKey)) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      if (this.selectedObjectId) {
        this.nudge(direction[0] * step, direction[1] * step);
      } else {
        this.nudgeOriginal(direction[0] * step, direction[1] * step);
      }
      return;
    }
    if (event.key === "PageDown") {
      event.preventDefault();
      this.goToPage(this.currentPageIndex + 1);
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      this.goToPage(this.currentPageIndex - 1);
    }
  };

  private nudge(dx: number, dy: number) {
    const page = this.getSelectedPage();
    if (!page) return;
    const selected = this.selectedObjectsOnPage(page);
    if (selected.length === 0) return;
    this.beginMutation();
    for (const object of selected) {
      if (object.type === "line") {
        object.x1 += dx;
        object.y1 += dy;
        object.x2 += dx;
        object.y2 += dy;
      } else {
        object.x += dx;
        object.y += dy;
      }
    }
    this.commitMutation("object");
    this.renderObjects(page);
    this.emit("change", { reason: "object" });
  }

  private nudgeOriginal(dx: number, dy: number) {
    const page = this.pages.find(
      (item) => item.id === this.selectedOriginalPageId,
    );
    const key = this.selectedOriginalKey;
    if (!page || !key) return;
    if (this.textEdits.get(key)?.deleted) return;
    const run = this.textRuns
      .get(page.id)
      ?.find((item) => item.key === key);
    const move = this.originalMoves.get(key);
    if (!run && !move) return;
    const base =
      move ??
      (run
        ? {
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
            dx: 0,
            dy: 0,
            background: this.sampleBackground(page, run),
          }
        : null);
    if (!base) return;
    this.beginMutation();
    this.originalMoves.set(key, {
      ...base,
      dx: base.dx + dx,
      dy: base.dy + dy,
    });
    this.commitMutation("text");
    this.renderObjects(page);
    this.selectOriginalKey(page, key);
    this.emit("change", { reason: "text" });
  }

  // ----------------------------------------------------------------- tools

  setTool(tool: Tool) {
    if (this.editingState) this.finishEdit();
    if (this.originalEdit) this.finishOriginalEdit();
    if (this.activeOriginalKey) this.clearOriginalTextFocus();
    this.tool = tool;
    this.root.dataset.tool = tool;
    if (tool !== "select") this.clearSelection();
    if (tool === "text-edit") {
      if (!this.options.pdfiumWasmUrl || !this.sourceBytes) {
        this.tool = "select";
        this.root.dataset.tool = "select";
        this.fail(
          new Error(
            "La modifica del testo originale non è configurata (pdfiumWasmUrl mancante).",
          ),
        );
      } else {
        void this.ensurePdfium()
          .then(() => {
            if (this.tool !== "text-edit") return;
            for (const page of this.pages) this.renderObjects(page);
          })
          .catch((error: unknown) => {
            if (this.tool !== "text-edit") return;
            this.tool = "select";
            this.root.dataset.tool = "select";
            this.fail(error);
            for (const page of this.pages) this.renderObjects(page);
          });
      }
    } else if (tool === "select" && this.options.pdfiumWasmUrl) {
      for (const page of this.pages) {
        if (
          totalRotation(page) === 0 &&
          (this.visible.has(page.id) ||
            page.id === this.pages[this.currentPageIndex]?.id)
        ) {
          void this.ensureTextRuns(page, false);
        }
      }
    }
    for (const page of this.pages) this.renderObjects(page);
    this.emit("change", { reason: "tool" });
  }

  // ----------------------------------------------------------------- files

  private onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    this.root.classList.add("pc-dragover");
  };

  private onDragLeave = (event: DragEvent) => {
    if (event.target === this.root) this.root.classList.remove("pc-dragover");
  };

  private onDrop = async (event: DragEvent) => {
    event.preventDefault();
    this.root.classList.remove("pc-dragover");
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      if (isPdfFile(file)) {
        await this.load(file);
      } else if (isImageFile(file)) {
        await this.addImageFile(file);
      }
    } catch (error) {
      this.fail(error);
    }
  };

  private onPaste = async (event: ClipboardEvent) => {
    if (this.editingState) return;
    const items = Array.from(event.clipboardData?.items ?? []);
    const image = items.find((item) => item.type.startsWith("image/"));
    if (image) {
      const file = image.getAsFile();
      if (file) {
        event.preventDefault();
        try {
          await this.addImageFile(file);
        } catch (error) {
          this.fail(error);
        }
        return;
      }
    }
    const text = event.clipboardData?.getData("text/plain");
    if (text && this.tool === "select") {
      event.preventDefault();
      const page = this.pages[this.currentPageIndex];
      if (!page) return;
      const [width, height] = displaySize(page);
      this.addText(width / 2, height / 2, { text });
    }
  };

  setPendingInsert(pageId: string, point: Point) {
    this.pendingInsert = point;
    this.selectedPageId = pageId;
  }

  // ------------------------------------------------------------ thumbnails

  async getThumbnail(pageId: string, width = 140): Promise<string> {
    const page = this.pages.find((item) => item.id === pageId);
    if (!page) throw new Error("Page not found.");
    const rotation = totalRotation(page);
    const key = `${page.id}:${width}:${rotation}`;
    const cached = this.thumbnailCache.get(key);
    if (cached) return cached;
    const [pageWidth, pageHeight] = displaySize(page);
    const scale = width / Math.max(1, pageWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(pageWidth * scale));
    canvas.height = Math.max(1, Math.round(pageHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (page.sourceIndex !== null && this.pdf) {
      const pdfPage = await this.pdf.getPage(page.sourceIndex + 1);
      const viewport = pdfPage.getViewport({ scale, rotation });
      const task = pdfPage.render({ canvasContext: context, viewport, canvas });
      await task.promise;
    }
    const url = canvas.toDataURL("image/jpeg", 0.82);
    this.thumbnailCache.set(key, url);
    return url;
  }

  async getThumbnails(width = 140): Promise<Thumbnail[]> {
    const thumbnails: Thumbnail[] = [];
    for (const [index, page] of this.pages.entries()) {
      thumbnails.push({
        id: page.id,
        index,
        url: await this.getThumbnail(page.id, width),
      });
    }
    return thumbnails;
  }

  // ----------------------------------------------------------------- export

  async exportPdf(options: ExportOptions = {}): Promise<Uint8Array> {
    try {
      if (this.originalEdit) this.finishOriginalEdit();
      if (this.editingState) this.finishEdit();
      const prepared =
        this.textEdits.size > 0 || this.originalMoves.size > 0
          ? await this.prepareOriginalEdits()
          : { bytes: this.sourceBytes, pages: this.pages };
      const bytes = await buildPdf(
        prepared.pages,
        prepared.bytes,
        this.fileName,
        options,
      );
      this.emit("export", {
        bytes,
        fileName: options.fileName ?? outputFileName(this.fileName),
      });
      return bytes;
    } catch (error) {
      throw this.fail(error);
    }
  }

  async download(options: ExportOptions = {}): Promise<void> {
    const bytes = await this.exportPdf(options);
    downloadBytes(bytes, options.fileName ?? outputFileName(this.fileName));
  }

  // ---------------------------------------------------------------- destroy

  destroy() {
    this.destroyed = true;
    this.pdfiumGeneration += 1;
    this.pdfium?.destroy();
    this.pdfium = null;
    this.pdfiumLoading = null;
    this.textEdits.clear();
    this.textRuns.clear();
    this.originalMoves.clear();
    this.runFontFaces.clear();
    this.originalGhostCache.clear();
    this.detachDragListeners();
    this.finishPan();
    this.setSpacePan(false);
    this.observer?.disconnect();
    this.root.removeEventListener("keydown", this.onKeyDown);
    this.viewport.removeEventListener("pointerdown", this.onViewportPointerDown, true);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onWindowBlur);
    this.root.removeEventListener("dragover", this.onDragOver);
    this.root.removeEventListener("dragleave", this.onDragLeave);
    this.root.removeEventListener("drop", this.onDrop);
    this.root.removeEventListener("paste", this.onPaste);
    this.root.removeEventListener("wheel", this.onWheel);
    this.viewport.removeEventListener("scroll", this.onScroll);
    if (this.zoomTimer) clearTimeout(this.zoomTimer);
    for (const task of this.renderTasks.values()) {
      try {
        task.cancel();
      } catch {
        // Ignore.
      }
    }
    this.renderTasks.clear();
    void (this.pdf as unknown as { destroy?: () => Promise<void> } | null)?.destroy?.();
    this.pdf = null;
    this.root.remove();
    this.listeners.clear();
  }
}

function hasSafePreviewFont(run: PdfiumTextRun): boolean {
  return /^(helvetica($|[-_ ])|arial|liberation|work\s*sans|worksans|times($|[-_ ])|timesnewroman|courier($|[-_ ])|couriernew)/i.test(
    run.fontName,
  );
}

function colourToRgb(value: string): { r: number; g: number; b: number } {
  const match = value.match(/^#?([0-9a-f]{6})$/i);
  if (!match?.[1]) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(match[1].slice(0, 2), 16),
    g: parseInt(match[1].slice(2, 4), 16),
    b: parseInt(match[1].slice(4, 6), 16),
  };
}

function looksLikeBrowserFont(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  return (
    (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) ||
    tag === "true" ||
    tag === "OTTO" ||
    tag === "ttcf" ||
    tag === "wOFF" ||
    tag === "wOF2"
  );
}

function canLoadFontFace(bytes: Uint8Array): boolean {
  if (!looksLikeBrowserFont(bytes)) return false;
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (tag === "ttcf" || tag === "wOFF" || tag === "wOF2") return true;
  if (bytes.length < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4);
  for (let index = 0; index < count; index += 1) {
    const offset = 12 + index * 16;
    if (offset + 4 > bytes.length) break;
    const table = String.fromCharCode(
      bytes[offset]!,
      bytes[offset + 1]!,
      bytes[offset + 2]!,
      bytes[offset + 3]!,
    );
    if (table === "OS/2") return true;
  }
  return false;
}

function pointsToPath(
  points: Array<[number, number]>,
  width: number,
  height: number,
): string {
  if (points.length === 0) return "";
  return points
    .map(([x, y], index) => {
      const px = (x * width).toFixed(2);
      const py = (y * height).toFixed(2);
      return `${index === 0 ? "M" : "L"}${px} ${py}`;
    })
    .join(" ");
}
