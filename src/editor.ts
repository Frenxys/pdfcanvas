import { PdfCanvas } from "./engine";
import { EDITOR_STYLES } from "./editor-styles";
import type {
  ImageObject,
  PdfCanvasOptions,
  PdfSource,
  PenObject,
  SceneObject,
  ShapeObject,
  TextObject,
  Tool,
} from "./types";
import type { PdfiumTextEdit } from "./pdfium";

export interface EditorTemplateObject {
  type: "text" | "shape";
  text?: string;
  shape?: "rect" | "ellipse";
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize?: number;
  fontFamily?: "helvetica" | "times" | "courier";
  bold?: boolean;
  italic?: boolean;
  color?: string;
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
}

export interface EditorTemplate {
  id: string;
  name: string;
  description?: string;
  objects: EditorTemplateObject[];
}

export interface PdfCanvasEditorOptions extends PdfCanvasOptions {
  brandName?: string;
  brandHref?: string;
  brandTarget?: "_blank" | "_self";
  locale?: "en" | "it" | "auto";
  autosave?: boolean | {
    key?: string;
    debounce?: number;
    restore?: boolean;
  };
  templates?: EditorTemplate[];
  /** Optional sample PDF URL shown as a second button on the empty screen. */
  sampleUrl?: string;
}

export const DEFAULT_TEMPLATES: EditorTemplate[] = [
  {
    id: "plain-letter",
    name: "Lettera / Letter",
    description: "Intestazione, corpo e firma.",
    objects: [
      { type: "text", text: "Nome Cognome", x: 56, y: 72, fontSize: 26, bold: true, color: "#191722" },
      { type: "text", text: "Via e città · email@example.com", x: 56, y: 108, fontSize: 11, color: "#6f6a63" },
      { type: "shape", shape: "rect", x: 56, y: 136, width: 483, height: 2, fill: "#6b4eff" },
      { type: "text", text: "Oggetto: una lettera chiara e ordinata", x: 56, y: 176, fontSize: 17, bold: true, color: "#191722" },
      { type: "text", text: "Scrivi qui il testo della lettera.\nPuoi modificarlo direttamente.", x: 56, y: 216, fontSize: 12, color: "#3f3b36" },
      { type: "text", text: "Cordiali saluti,\nNome Cognome", x: 56, y: 360, fontSize: 12, color: "#3f3b36" },
    ],
  },
  {
    id: "minimal-cover",
    name: "Copertina minimal",
    description: "Titolo, sottotitolo e blocco colore.",
    objects: [
      { type: "shape", shape: "rect", x: 0, y: 0, width: 595, height: 190, fill: "#6b4eff" },
      { type: "text", text: "Documento", x: 54, y: 68, fontSize: 38, bold: true, color: "#ffffff" },
      { type: "text", text: "Sottotitolo o descrizione breve", x: 54, y: 122, fontSize: 15, color: "#e8e3ff" },
      { type: "text", text: "Contenuto", x: 54, y: 250, fontSize: 24, bold: true, color: "#191722" },
      { type: "text", text: "Aggiungi qui il contenuto del documento.", x: 54, y: 292, fontSize: 13, color: "#3f3b36" },
    ],
  },
  {
    id: "invoice",
    name: "Fattura",
    description: "Intestazione, dati e totale.",
    objects: [
      { type: "text", text: "FATTURA", x: 54, y: 60, fontSize: 30, bold: true, color: "#191722" },
      { type: "text", text: "Numero: 001\nData: 01/01/2026", x: 54, y: 104, fontSize: 11, color: "#6f6a63" },
      { type: "text", text: "Cliente", x: 330, y: 60, fontSize: 12, bold: true, color: "#191722" },
      { type: "text", text: "Nome cliente\nVia e città\nP.IVA", x: 330, y: 82, fontSize: 11, color: "#3f3b36" },
      { type: "shape", shape: "rect", x: 54, y: 220, width: 487, height: 1, fill: "#d8cfbf" },
      { type: "text", text: "Descrizione", x: 54, y: 240, fontSize: 11, bold: true, color: "#6f6a63" },
      { type: "text", text: "Importo", x: 470, y: 240, fontSize: 11, bold: true, color: "#6f6a63" },
      { type: "text", text: "Servizio professionale", x: 54, y: 270, fontSize: 12, color: "#191722" },
      { type: "text", text: "€ 1.000,00", x: 470, y: 270, fontSize: 12, color: "#191722" },
      { type: "text", text: "Totale: € 1.000,00", x: 400, y: 330, fontSize: 14, bold: true, color: "#6b4eff" },
    ],
  },
];

type Locale = "en" | "it";

export function detectLocale(
  requested: PdfCanvasEditorOptions["locale"] = "auto",
): Locale {
  if (requested === "en" || requested === "it") return requested;
  if (typeof navigator !== "undefined") {
    const languages = [
      navigator.language,
      ...(navigator.languages ?? []),
    ].map((value) => value.toLowerCase());
    if (languages.some((value) => value.startsWith("it"))) return "it";
  }
  return "en";
}

const LABELS: Record<Locale, Record<string, string>> = {
  en: {
    file: "Document",
    saved: "Saved",
    saving: "Saving…",
    local: "Local",
    localChanges: "Local changes",
    undo: "Undo",
    redo: "Redo",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    fit: "Fit width",
    open: "Open",
    export: "Download PDF",
    pages: "Pages",
    properties: "Properties",
    select: "Select",
    text: "Text",
    textEdit: "Edit text",
    image: "Image",
    rect: "Rectangle",
    ellipse: "Ellipse",
    line: "Line",
    pen: "Pen",
    highlight: "Highlight",
    whiteout: "Whiteout",
    signature: "Signature",
    addPage: "Add page",
    duplicatePage: "Duplicate page",
    deletePage: "Delete page",
    rotatePage: "Rotate page",
    moveUp: "Move up",
    moveDown: "Move down",
    page: "Page",
    of: "of",
    noDocument: "No document",
    noPages: "No pages",
    currentPage: "Current page",
    rotateShort: "Rotate",
    deleteShort: "Delete",
    openFirst: "Open a PDF to start.",
    emptyTitle: "Open a PDF to start",
    emptyHint: "Drag it here or choose a file. Everything stays on your device: no uploads, no account.",
    choosePdf: "Choose a PDF",
    trySample: "Try a sample",
    emptyNote: "Password-protected PDFs are not supported",
    lockAspect: "Keep ratio",
    noSelection: "Select an element on the page to edit its properties.",
    font: "Font",
    size: "Size",
    color: "Color",
    fill: "Fill",
    stroke: "Stroke",
    strokeWidth: "Stroke width",
    opacity: "Opacity",
    bold: "Bold",
    italic: "Italic",
    align: "Align",
    left: "Left",
    center: "Center",
    right: "Right",
    duplicate: "Duplicate",
    forward: "Forward",
    backward: "Backward",
    delete: "Delete",
    close: "Close",
    insertSignature: "Insert signature",
    clear: "Clear",
    cancel: "Cancel",
    templates: "Templates",
    apply: "Apply",
    restored: "Project restored",
    exported: "PDF downloaded",
    templateDone: "Template applied",
    noTemplatePage: "Open a PDF first.",
    drawingSignature: "Draw your signature",
    signatureHint: "Use mouse, trackpad or finger. Transparent background.",
    tips: "Shortcuts",
    tipText: "T text · E original text · V select",
    tipUndo: "Ctrl/Cmd+Z undo · Ctrl/Cmd+S export",
    tipZoom: "Ctrl/Cmd + wheel to zoom · double-click text to edit",
    pageSize: "Page size",
    originalText: "Original text",
    autosave: "Autosave",
    untitled: "document.pdf",
  },
  it: {
    file: "Documento",
    saved: "Salvato",
    saving: "Salvataggio…",
    local: "Locale",
    localChanges: "Modifiche locali",
    undo: "Annulla",
    redo: "Ripeti",
    zoomOut: "Zoom indietro",
    zoomIn: "Zoom avanti",
    fit: "Adatta",
    open: "Apri",
    export: "Scarica PDF",
    pages: "Pagine",
    properties: "Proprietà",
    select: "Seleziona",
    text: "Testo",
    textEdit: "Testo originale",
    image: "Immagine",
    rect: "Rettangolo",
    ellipse: "Ellisse",
    line: "Linea",
    pen: "Penna",
    highlight: "Evidenzia",
    whiteout: "Bianchetto",
    signature: "Firma",
    addPage: "Aggiungi pagina",
    duplicatePage: "Duplica pagina",
    deletePage: "Elimina pagina",
    rotatePage: "Ruota pagina",
    moveUp: "Sposta su",
    moveDown: "Sposta giù",
    page: "Pagina",
    of: "di",
    noDocument: "Nessun documento",
    noPages: "Nessuna pagina",
    currentPage: "Pagina corrente",
    rotateShort: "Ruota",
    deleteShort: "Elimina",
    openFirst: "Apri un PDF per iniziare.",
    emptyTitle: "Apri un PDF per iniziare",
    emptyHint: "Trascinalo qui oppure scegli un file. Resta sul tuo dispositivo: nessun upload, nessun account.",
    choosePdf: "Scegli un PDF",
    trySample: "Prova un esempio",
    emptyNote: "I PDF protetti da password non sono supportati",
    lockAspect: "Mantieni proporzioni",
    noSelection: "Seleziona un elemento sulla pagina per modificarne le proprietà.",
    font: "Font",
    size: "Dimensione",
    color: "Colore",
    fill: "Riempimento",
    stroke: "Bordo",
    strokeWidth: "Spessore bordo",
    opacity: "Opacità",
    bold: "Grassetto",
    italic: "Corsivo",
    align: "Allineamento",
    left: "Sinistra",
    center: "Centro",
    right: "Destra",
    duplicate: "Duplica",
    forward: "Avanti",
    backward: "Dietro",
    delete: "Elimina",
    close: "Chiudi",
    insertSignature: "Inserisci firma",
    clear: "Cancella",
    cancel: "Annulla",
    templates: "Template",
    apply: "Applica",
    restored: "Progetto ripristinato",
    exported: "PDF scaricato",
    templateDone: "Template applicato",
    noTemplatePage: "Apri prima un PDF.",
    drawingSignature: "Disegna la firma",
    signatureHint: "Usa mouse, trackpad o dito. Sfondo trasparente.",
    tips: "Scorciatoie",
    tipText: "T testo · E testo originale · V seleziona",
    tipUndo: "Ctrl/Cmd+Z annulla · Ctrl/Cmd+S esporta",
    tipZoom: "Ctrl/Cmd + rotella per zoom · doppio clic sul testo",
    pageSize: "Dimensione pagina",
    originalText: "Testo originale",
    autosave: "Autosave",
    untitled: "documento.pdf",
  },
};

const TOOL_DEFS: Array<{ tool: Tool; label: string; icon: string; shortcut: string }> = [
  { tool: "select", label: "select", icon: "pointer", shortcut: "V" },
  { tool: "text", label: "text", icon: "type", shortcut: "T" },
  { tool: "text-edit", label: "textEdit", icon: "textEdit", shortcut: "E" },
  { tool: "image", label: "image", icon: "image", shortcut: "I" },
  { tool: "rect", label: "rect", icon: "square", shortcut: "R" },
  { tool: "ellipse", label: "ellipse", icon: "circle", shortcut: "O" },
  { tool: "line", label: "line", icon: "line", shortcut: "L" },
  { tool: "pen", label: "pen", icon: "pen", shortcut: "P" },
  { tool: "highlight", label: "highlight", icon: "highlight", shortcut: "H" },
  { tool: "whiteout", label: "whiteout", icon: "eraser", shortcut: "W" },
];

const ICONS: Record<string, string> = {
  pointer: '<path d="m4 3 7 17 2-7 7-2Z"/>',
  type: '<path d="M5 5h14M12 5v14"/>',
  textEdit: '<path d="M4 18 16 6l3 3L7 21H4Z"/><path d="m14 8 2 2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="1.5"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  line: '<path d="M4 20 20 4"/>',
  pen: '<path d="M12 19l7-7 3 3-7 7-3-3Z"/><path d="M18 13 5 0"/><path d="M2 22l4-1-3-3-1 4Z"/>',
  highlight: '<path d="m9 11-6 6v3h3l6-6"/><path d="m14 6 4 4"/><path d="M9 11 5 7l7-4 4 4-7 4Z"/>',
  eraser: '<path d="m7 21-4-4L17 3l4 4L7 21Z"/><path d="M13 7 17 11"/>',
  signature: '<path d="M3 20c4 0 5-12 9-12 3 0 2 7 5 7 2 0 3-2 4-4"/><path d="M3 20h18"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h2"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M21 21l-4.5-4.5"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M21 21l-4.5-4.5"/>',
  fit: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  open: '<path d="M4 20h16V8H4Z"/><path d="M8 8V4h8l4 4"/>',
  fileup: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4"/><path d="M12 11v6"/><path d="m9 14 3-3 3 3"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  pages: '<rect x="4" y="3" width="12" height="16" rx="2"/><path d="M8 7h4M8 11h4M8 15h2"/><path d="M18 7h2v14H8v-2"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 4v7h-7"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  bold: '<path d="M7 4h6a4 4 0 0 1 0 8H7Z"/><path d="M7 12h7a4 4 0 0 1 0 8H7Z"/>',
  italic: '<path d="M10 4h8M6 20h8M14 4l-4 16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  template: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V4h12"/>',
  forward: '<path d="m12 19 6-6-6-6"/><path d="M18 13H4"/>',
  backward: '<path d="m12 5-6 6 6 6"/><path d="M6 11h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};

function icon(name: string, size = 17): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}

function button(html: string, label: string, className = "pce-iconbtn"): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.title = label;
  el.setAttribute("aria-label", label);
  el.innerHTML = html;
  return el;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pdfcanvas-editor", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("projects")) {
        request.result.createObjectStore("projects");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
  });
}

interface StoredProject {
  name: string;
  bytes: ArrayBuffer;
  scene: string;
  updatedAt: number;
}

async function readProject(key: string): Promise<StoredProject | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDatabase();
  try {
    return await new Promise<StoredProject | null>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").get(key);
      request.onsuccess = () => resolve((request.result as StoredProject | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeProject(key: string, project: StoredProject): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("projects", "readwrite");
      transaction.objectStore("projects").put(project, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Complete Canva-style editor shell. Framework-free, all UI included.
 *
 *   import { PdfCanvasEditor } from "pdfcanvas/editor";
 *   const editor = new PdfCanvasEditor(container, options);
 *   await editor.open(file);
 */
export class PdfCanvasEditor {
  readonly core: PdfCanvas;
  private readonly root: HTMLDivElement;
  private readonly options: PdfCanvasEditorOptions;
  private readonly t: (key: string) => string;
  private readonly pagesList: HTMLDivElement;
  private readonly pageCount: HTMLSpanElement;
  private readonly inspector: HTMLElement;
  private readonly textbarHost: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;
  private readonly toastHost: HTMLDivElement;
  private readonly saveStatus: HTMLSpanElement;
  private readonly pageLabel: HTMLSpanElement;
  private readonly zoomLabel: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly pagesPanel: HTMLElement;
  private readonly inspectorPanel: HTMLElement;
  private readonly toolsBar: HTMLDivElement;
  private readonly backdrop: HTMLButtonElement;
  private readonly mount: HTMLDivElement;
  private thumbs = new Map<string, string>();
  private thumbToken = 0;
  private saveTimer: number | null = null;
  private toastTimer: number | null = null;
  private textbar: HTMLDivElement | null = null;
  private templates: EditorTemplate[];
  private destroyed = false;
  private saving = false;
  private userOpened = false;
  private readonly restorePromise: Promise<void>;
  private readonly onSaveShortcut = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.download();
  };

  constructor(container: HTMLElement, options: PdfCanvasEditorOptions = {}) {
    if (!container) throw new Error("A container element is required.");
    this.options = options;
    this.templates = options.templates ?? DEFAULT_TEMPLATES;
    const locale = detectLocale(options.locale);
    this.t = (key) => LABELS[locale][key] ?? LABELS.en[key] ?? key;
    PdfCanvasEditor.injectStyles();
    this.injectUiFonts();

    this.root = el("div", "pce");
    this.root.style.setProperty("--pce-accent", options.accent ?? "#6b4eff");
    this.root.innerHTML = `
      <header class="pce-topbar">
        ${options.brandHref
          ? `<a class="pce-brand" href="${escapeHtml(options.brandHref)}" target="${options.brandTarget ?? "_blank"}" rel="noreferrer">`
          : `<span class="pce-brand">`}
          <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#6b4eff"/><path d="M20 12h16.5L47 22.5V52H20z" fill="#fff"/><path d="M36.5 12v10.5H47z" fill="#c9c0ff"/><path d="M26 33h15M26 42h9" stroke="#6b4eff" stroke-width="3.5" stroke-linecap="round"/></svg>
          <span>${escapeHtml(options.brandName ?? "PdfCanvas")}</span>
        ${options.brandHref ? `</a>` : `</span>`}
        <div class="pce-file"><strong data-file>${this.t("noDocument")}</strong><small data-save>${this.t("local")}</small></div>
        <div class="pce-center">
          <span data-undo-slot></span>
          <span data-redo-slot></span>
          <span class="pce-zoomgroup">
            <span class="pce-sep"></span>
            <button type="button" class="pce-iconbtn" data-zoom-out title="${this.t("zoomOut")}">${icon("zoomOut")}</button>
            <button type="button" class="pce-zoom" data-zoom title="${this.t("fit")}">100%</button>
            <button type="button" class="pce-iconbtn" data-zoom-in title="${this.t("zoomIn")}">${icon("zoomIn")}</button>
            <button type="button" class="pce-iconbtn" data-fit title="${this.t("fit")}">${icon("fit")}</button>
          </span>
          <span class="pce-pill" data-page-label>—</span>
        </div>
        <div class="pce-right">
          <span class="pce-pill" data-save-status>${this.t("local")}</span>
          <button type="button" class="pce-outline pce-mobile-actions" data-pages-toggle title="${this.t("pages")}">${icon("pages")}</button>
          <button type="button" class="pce-outline pce-mobile-actions" data-inspector-toggle title="${this.t("properties")}">${icon("sliders")}</button>
          <button type="button" class="pce-outline" data-open>${icon("open")}<span>${this.t("open")}</span></button>
          <button type="button" class="pce-outline pce-template-btn" data-templates>${icon("template")}<span>${this.t("templates")}</span></button>
          <button type="button" class="pce-primary" data-export>${icon("download")}<span>${this.t("export")}</span></button>
        </div>
      </header>
      <div class="pce-tools" data-tools></div>
      <div class="pce-body">
        <aside class="pce-pages" data-pages-panel>
          <div class="pce-panel-head">
            <div><p class="pce-kicker">${this.t("file")}</p><p class="pce-panel-title">${this.t("pages")}</p></div>
            <span class="pce-count" data-page-count>0</span>
            <button type="button" class="pce-iconbtn" data-pages-close title="${this.t("close")}">${icon("close")}</button>
          </div>
          <div class="pce-page-list" data-pages-list></div>
          <div class="pce-page-actions">
            <button type="button" data-add-page title="${this.t("addPage")}">${icon("plus")}</button>
            <button type="button" data-duplicate-page title="${this.t("duplicatePage")}">${icon("duplicate")}</button>
            <button type="button" data-rotate-page title="${this.t("rotatePage")}">${icon("rotate")}</button>
            <button type="button" data-move-up title="${this.t("moveUp")}">${icon("up")}</button>
            <button type="button" data-move-down title="${this.t("moveDown")}">${icon("down")}</button>
            <button type="button" data-delete-page title="${this.t("deletePage")}">${icon("trash")}</button>
          </div>
        </aside>
        <main class="pce-stage-wrap">
          <div class="pce-stage" data-mount></div>
          <div class="pce-empty" data-empty>
            <div class="pce-empty-card">
              <span class="pce-empty-icon">${icon("fileup", 30)}</span>
              <h2>${this.t("emptyTitle")}</h2>
              <p>${this.t("emptyHint")}</p>
              <div class="pce-empty-actions">
                <button type="button" class="pce-primary" data-empty-open>${icon("fileup")}<span>${this.t("choosePdf")}</span></button>
                <button type="button" class="pce-outline" data-empty-sample${options.sampleUrl ? "" : " hidden"}>${icon("template")}<span>${this.t("trySample")}</span></button>
              </div>
              <p class="pce-empty-note">${escapeHtml(this.t("emptyNote"))}</p>
            </div>
          </div>
          <div class="pce-mobile-zoom" data-mobile-zoom>
            <button type="button" class="pce-iconbtn" data-mobile-zoom-out title="${this.t("zoomOut")}">${icon("zoomOut")}</button>
            <span data-mobile-zoom-label>100%</span>
            <button type="button" class="pce-iconbtn" data-mobile-zoom-in title="${this.t("zoomIn")}">${icon("zoomIn")}</button>
          </div>
          <div data-textbar></div>
        </main>
        <aside class="pce-inspector" data-inspector-panel>
          <div class="pce-panel-head">
            <div><p class="pce-kicker" data-inspector-kicker>${this.t("file")}</p><p class="pce-panel-title">${this.t("properties")}</p></div>
            <button type="button" class="pce-iconbtn" data-inspector-close title="${this.t("close")}">${icon("close")}</button>
          </div>
          <div data-inspector></div>
        </aside>
      </div>
      <input type="file" accept="application/pdf,.pdf" data-file-input style="display:none" />
      <div data-toast></div>
      <button type="button" class="pce-backdrop" data-backdrop style="display:none" aria-label="${this.t("close")}"></button>
    `;
    container.appendChild(this.root);

    this.mount = this.query("[data-mount]");
    this.pagesList = this.query("[data-pages-list]");
    this.pageCount = this.query("[data-page-count]");
    this.inspector = this.query("[data-inspector]");
    this.textbarHost = this.query("[data-textbar]");
    this.toastHost = this.query("[data-toast]");
    this.fileInput = this.query("[data-file-input]");
    this.saveStatus = this.query("[data-save-status]");
    this.pageLabel = this.query("[data-page-label]");
    this.zoomLabel = this.query("[data-zoom]");
    this.pagesPanel = this.query("[data-pages-panel]");
    this.inspectorPanel = this.query("[data-inspector-panel]");
    this.toolsBar = this.query("[data-tools]");
    this.backdrop = this.query("[data-backdrop]");

    const undo = button(icon("undo"), this.t("undo"));
    undo.dataset.undo = "";
    this.query("[data-undo-slot]").appendChild(undo);
    this.undoBtn = undo;
    const redo = button(icon("redo"), this.t("redo"));
    redo.dataset.redo = "";
    this.query("[data-redo-slot]").appendChild(redo);
    this.redoBtn = redo;

    this.core = new PdfCanvas(this.mount, {
      ...options,
      accent: options.accent ?? "#6b4eff",
    });

    document.addEventListener("keydown", this.onSaveShortcut, true);
    this.buildTools();
    this.syncTools();
    this.bindEvents();
    this.renderPages();
    this.renderInspector();
    this.syncTopbar();
    this.restorePromise = this.restoreAutosave();
  }

  private static injectStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById("pdfcanvas-editor-styles")) return;
    const style = document.createElement("style");
    style.id = "pdfcanvas-editor-styles";
    style.textContent = EDITOR_STYLES;
    document.head.appendChild(style);
  }

  private injectUiFonts() {
    if (typeof document === "undefined" || !this.options.fontAssetsUrl) return;
    if (document.getElementById("pdfcanvas-ui-fonts")) return;
    const base = this.options.fontAssetsUrl.endsWith("/")
      ? this.options.fontAssetsUrl
      : `${this.options.fontAssetsUrl}/`;
    const style = document.createElement("style");
    style.id = "pdfcanvas-ui-fonts";
    style.textContent = `
@font-face { font-family: "Space Grotesk"; font-style: normal; font-weight: 300 700; font-display: swap; src: url("${base}SpaceGrotesk-latin.woff2") format("woff2"); }
@font-face { font-family: "Fraunces"; font-style: normal; font-weight: 100 900; font-display: swap; src: url("${base}Fraunces-latin.woff2") format("woff2"); }`;
    document.head.appendChild(style);
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const found = this.root.querySelector<T>(selector);
    if (!found) throw new Error(`Missing editor element: ${selector}`);
    return found;
  }

  private buildTools() {
    for (const def of TOOL_DEFS) {
      const b = button(icon(def.icon), `${this.t(def.label)} (${def.shortcut})`, "pce-tool");
      b.dataset.tool = def.tool;
      b.append(el("span", "pce-tool-label", this.t(def.label)));
      b.addEventListener("click", () => this.core.setTool(def.tool));
      this.toolsBar.appendChild(b);
    }
    const sep = el("span", "pce-sep");
    this.toolsBar.appendChild(sep);
    const sig = button(icon("signature"), this.t("signature"), "pce-tool");
    sig.append(el("span", "pce-tool-label", this.t("signature")));
    sig.addEventListener("click", () => this.openSignature());
    this.toolsBar.appendChild(sig);
  }

  private bindEvents() {
    this.query("[data-undo]").addEventListener("click", () => this.core.undo());
    this.query("[data-redo]").addEventListener("click", () => this.core.redo());
    this.query("[data-zoom-out]").addEventListener("click", () => this.core.zoomOut());
    this.query("[data-zoom-in]").addEventListener("click", () => this.core.zoomIn());
    this.query("[data-fit]").addEventListener("click", () => this.core.fitWidth());
    this.zoomLabel.addEventListener("click", () => this.core.fitWidth());
    this.query("[data-mobile-zoom-out]").addEventListener("click", () => this.core.zoomOut());
    this.query("[data-mobile-zoom-in]").addEventListener("click", () => this.core.zoomIn());
    this.query("[data-mobile-zoom-label]").addEventListener("click", () => this.core.fitWidth());
    this.query("[data-open]").addEventListener("click", () => this.fileInput.click());
    this.query("[data-empty-open]").addEventListener("click", () => this.fileInput.click());
    this.query("[data-empty-sample]").addEventListener("click", () => {
      if (this.options.sampleUrl) void this.openSample(this.options.sampleUrl);
    });
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = "";
      if (file) void this.open(file);
    });
    this.query("[data-export]").addEventListener("click", () => void this.download());
    this.query("[data-templates]").addEventListener("click", () => this.openTemplates());
    this.query("[data-pages-toggle]").addEventListener("click", () => this.togglePanel(this.pagesPanel));
    this.query("[data-inspector-toggle]").addEventListener("click", () => this.togglePanel(this.inspectorPanel));
    this.query("[data-pages-close]").addEventListener("click", () => this.closePanels());
    this.query("[data-inspector-close]").addEventListener("click", () => this.closePanels());
    this.backdrop.addEventListener("click", () => this.closePanels());
    this.query("[data-add-page]").addEventListener("click", () => void this.core.addBlankPage());
    this.query("[data-duplicate-page]").addEventListener("click", () => this.core.duplicatePage(this.core.getCurrentPage()));
    this.query("[data-delete-page]").addEventListener("click", () => this.core.deletePage(this.core.getCurrentPage()));
    this.query("[data-rotate-page]").addEventListener("click", () => this.rotateCurrentPage());
    this.query("[data-move-up]").addEventListener("click", () => {
      const current = this.core.getCurrentPage();
      this.core.movePage(current, current - 1);
    });
    this.query("[data-move-down]").addEventListener("click", () => {
      const current = this.core.getCurrentPage();
      this.core.movePage(current, current + 1);
    });

    this.core.on("change", ({ reason }) => {
      if (reason === "page" || reason === "load" || reason === "history") {
        void this.refreshThumbs();
      }
      if (reason === "tool") this.syncTools();
      if (reason === "selection" || reason === "page") this.renderInspector();
      if (
        (reason === "history" || reason === "text") &&
        !this.inspector.contains(document.activeElement)
      ) {
        this.renderInspector();
      }
      this.syncTopbar();
      if (reason !== "zoom" && reason !== "selection" && reason !== "tool") {
        this.scheduleAutosave();
      }
    });
    this.core.on("selectionchange", () => this.renderInspector());
    this.core.on("zoom", () => this.syncTopbar());
    this.core.on("pagechange", () => {
      this.syncTopbar();
      this.renderPages();
      this.renderInspector();
    });
    this.core.on("load", ({ fileName }) => {
      this.query("[data-file]").textContent = fileName;
      if (this.core.getTool() !== "select") this.core.setTool("select");
      this.syncTopbar();
      this.renderPages();
      this.renderInspector();
      void this.refreshThumbs();
      this.scheduleAutosave();
    });
    this.core.on("originaledit", ({ edit }) => this.renderTextbar(edit));
    this.core.on("save", () => void this.download());
    this.core.on("error", ({ error }) => this.toast(error.message, true));
  }

  /** Resolves when any autosaved project has been restored. */
  ready(): Promise<void> {
    return this.restorePromise;
  }

  private async openSample(url: string): Promise<void> {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await this.open(await response.blob(), url.split("/").pop() || "sample.pdf");
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async open(source: PdfSource, name?: string): Promise<void> {
    this.userOpened = true;
    await this.restorePromise;
    await this.core.load(source, name ? { fileName: name } : undefined);
    this.closePanels();
  }

  async download(): Promise<void> {
    if (this.core.getPages().length === 0) return;
    try {
      await this.core.download();
      this.toast(this.t("exported"));
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  registerTemplate(template: EditorTemplate): void {
    this.templates = [...this.templates, template];
  }

  destroy(): void {
    this.destroyed = true;
    document.removeEventListener("keydown", this.onSaveShortcut, true);
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.core.destroy();
    this.root.remove();
  }

  private syncTopbar() {
    const state = this.core.getState();
    this.undoBtn.disabled = !state.canUndo;
    this.redoBtn.disabled = !state.canRedo;
    const zoomText = `${Math.round(state.zoom * 100)}%`;
    this.zoomLabel.textContent = zoomText;
    this.query("[data-mobile-zoom-label]").textContent = zoomText;
    this.pageLabel.textContent = state.pageCount
      ? `${state.currentPage + 1} / ${state.pageCount}`
      : "—";
    this.pageCount.textContent = String(state.pageCount);
    this.query("[data-file]").textContent = state.pageCount
      ? state.fileName
      : this.t("noDocument");
    this.query("[data-save]").textContent = state.pageCount
      ? this.t("localChanges")
      : this.t("local");
    const hasPages = state.pageCount > 0;
    this.query("[data-export]").toggleAttribute("disabled", !hasPages);
    this.query<HTMLElement>("[data-empty]").hidden = hasPages;
    for (const selector of [
      "[data-add-page]",
      "[data-duplicate-page]",
      "[data-rotate-page]",
      "[data-move-up]",
      "[data-move-down]",
      "[data-delete-page]",
    ]) {
      this.query<HTMLButtonElement>(selector).disabled = !hasPages;
    }
    this.refreshPagesActive();
  }

  private syncTools() {
    const active = this.core.getTool();
    for (const b of this.toolsBar.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      b.setAttribute("aria-pressed", String(b.dataset.tool === active));
    }
  }

  private clearDropTargets() {
    for (const node of this.pagesList.querySelectorAll(".drop-target")) {
      node.classList.remove("drop-target");
    }
  }

  private refreshPagesActive() {
    const current = this.core.getCurrentPage();
    for (const b of this.pagesList.querySelectorAll<HTMLButtonElement>("[data-page-index]")) {
      const active = Number(b.dataset.pageIndex) === current;
      if (active) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
  }

  private renderPages() {
    const pages = this.core.getPages();
    this.pageCount.textContent = String(pages.length);
    this.pagesList.replaceChildren();
    if (pages.length === 0) {
      const note = el("div", "pce-pages-empty");
      note.innerHTML = `<strong>${escapeHtml(this.t("noPages"))}</strong><span>${escapeHtml(this.t("openFirst"))}</span>`;
      this.pagesList.appendChild(note);
      return;
    }
    for (const page of pages) {
      const b = el("button", "pce-page");
      b.type = "button";
      b.dataset.pageIndex = String(page.index);
      if (page.index === this.core.getCurrentPage()) b.setAttribute("aria-current", "page");
      const thumb = el("span", "pce-thumb");
      const img = this.thumbs.get(page.id);
      if (img) {
        const image = el("img");
        image.src = img;
        image.alt = `${this.t("page")} ${page.index + 1}`;
        image.draggable = false;
        thumb.appendChild(image);
      } else {
        thumb.appendChild(el("span", "pce-thumb-fallback", String(page.index + 1)));
      }
      if (page.objectCount > 0) {
        thumb.appendChild(el("span", "pce-thumb-badge", String(page.objectCount)));
      }
      const meta = el("span", "pce-page-meta");
      meta.appendChild(el("strong", "", `${this.t("page")} ${page.index + 1}`));
      meta.appendChild(
        el("small", "", `${Math.round(page.width)} × ${Math.round(page.height)} pt`),
      );
      b.append(thumb, meta);
      b.draggable = true;
      b.addEventListener("click", () => {
        this.core.goToPage(page.index);
        this.closePanels();
      });
      b.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", String(page.index));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        b.classList.add("dragging");
      });
      b.addEventListener("dragend", () => {
        b.classList.remove("dragging");
        this.clearDropTargets();
      });
      b.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        this.clearDropTargets();
        b.classList.add("drop-target");
      });
      b.addEventListener("dragleave", () => b.classList.remove("drop-target"));
      b.addEventListener("drop", (event) => {
        event.preventDefault();
        const from = Number(event.dataTransfer?.getData("text/plain"));
        this.clearDropTargets();
        if (Number.isInteger(from)) this.core.movePage(from, page.index);
      });
      this.pagesList.appendChild(b);
    }
  }

  private async refreshThumbs() {
    const token = ++this.thumbToken;
    try {
      const list = await this.core.getThumbnails(120);
      if (token !== this.thumbToken || this.destroyed) return;
      this.thumbs = new Map(list.map((item) => [item.id, item.url]));
      this.renderPages();
    } catch {
      // Thumbnails are cosmetic.
    }
  }

  private renderInspector() {
    const state = this.core.getState();
    this.inspector.replaceChildren();
    const form = el("div", "pce-form");
    if (!state.selection) {
      const current = state.pages[state.currentPage];
      const summary = el("div", "pce-summary");
      summary.innerHTML = `<p class="pce-summary-label">${escapeHtml(this.t("currentPage"))}</p>
        <p class="pce-summary-value">${state.pageCount ? state.currentPage + 1 : 0}<span> / ${state.pageCount}</span></p>
        <p class="pce-summary-meta">${current ? `${Math.round(current.width)} × ${Math.round(current.height)} pt` : escapeHtml(this.t("noDocument"))}</p>`;
      const actions = el("div", "pce-summary-actions");
      const rotate = button(`${icon("rotate")}<span>${this.t("rotateShort")}</span>`, this.t("rotatePage"), "pce-smallbtn");
      rotate.disabled = state.pageCount === 0;
      rotate.addEventListener("click", () => this.rotateCurrentPage());
      const del = button(`${icon("trash")}<span>${this.t("deleteShort")}</span>`, this.t("deletePage"), "pce-smallbtn danger");
      del.disabled = state.pageCount === 0;
      del.addEventListener("click", () => this.core.deletePage(this.core.getCurrentPage()));
      actions.append(rotate, del);
      summary.appendChild(actions);
      form.appendChild(summary);

      const tips = el("div", "pce-shortcuts");
      tips.innerHTML = `<p class="pce-shortcuts-title">${escapeHtml(this.t("tips"))}</p>
        <ul>
          <li><kbd>T</kbd> ${escapeHtml(this.t("text"))} · <kbd>E</kbd> ${escapeHtml(this.t("textEdit"))} · <kbd>V</kbd> ${escapeHtml(this.t("select"))}</li>
          <li><kbd>Ctrl</kbd> + <kbd>Z</kbd> ${escapeHtml(this.t("undo"))}</li>
          <li><kbd>Ctrl</kbd> + <kbd>S</kbd> ${escapeHtml(this.t("export"))}</li>
          <li>${escapeHtml(this.t("tipZoom"))}</li>
        </ul>`;
      form.appendChild(tips);
      form.appendChild(el("p", "pce-hint", this.t("noSelection")));
      this.inspector.appendChild(form);
      this.query("[data-inspector-kicker]").textContent = this.t("file");
      return;
    }
    this.query("[data-inspector-kicker]").textContent = this.t("properties");
    this.buildInspector(form, state.selection);
    this.inspector.appendChild(form);
  }

  private buildInspector(form: HTMLElement, object: SceneObject) {
    if (object.type === "text") {
      const text = object as TextObject;
      form.appendChild(this.selectField(this.t("font"), text.fontFamily, [
        ["helvetica", "Helvetica / Arial"],
        ["times", "Times / Serif"],
        ["courier", "Courier / Mono"],
      ], (value) => this.core.updateSelected({ fontFamily: value as TextObject["fontFamily"] })));
      const row = el("div", "pce-row");
      row.append(
        this.numberField(this.t("size"), text.fontSize, (value) => this.core.updateSelected({ fontSize: value })),
        this.colorField(this.t("color"), text.color, (value) => this.core.updateSelected({ color: value })),
      );
      form.appendChild(row);
      const styleRow = el("div", "pce-row");
      const bold = this.toggleButton(
        this.t("bold"),
        text.bold,
        (next) => this.core.updateSelected({ bold: next }),
        "bold",
      );
      const italic = this.toggleButton(
        this.t("italic"),
        text.italic,
        (next) => this.core.updateSelected({ italic: next }),
        "italic",
      );
      styleRow.append(bold, italic);
      form.appendChild(styleRow);
      form.appendChild(this.selectField(this.t("align"), text.align, [
        ["left", this.t("left")],
        ["center", this.t("center")],
        ["right", this.t("right")],
      ], (value) => this.core.updateSelected({ align: value as TextObject["align"] })));
    } else if (object.type === "shape") {
      const shape = object as ShapeObject;
      form.appendChild(this.colorField(this.t("fill"), shape.fill ?? "#6b4eff", (value) => this.core.updateSelected({ fill: value } as never)));
      form.appendChild(this.colorField(this.t("stroke"), shape.stroke ?? "#191722", (value) => this.core.updateSelected({ stroke: value } as never)));
      form.appendChild(this.rangeField(this.t("strokeWidth"), shape.strokeWidth, 0, 12, 0.5, (value) => this.core.updateSelected({ strokeWidth: value } as never)));
    } else if (object.type === "image") {
      const image = object as ImageObject;
      form.appendChild(el("div", "pce-note", image.name ?? "Image"));
      const lock = this.toggleButton(
        this.t("lockAspect"),
        Boolean(image.lockAspect),
        (next) => this.core.updateSelected({ lockAspect: next } as never),
      );
      form.appendChild(lock);
    } else if (object.type === "line" || object.type === "pen") {
      const ink = object as PenObject;
      form.appendChild(this.colorField(this.t("stroke"), ink.stroke, (value) => this.core.updateSelected({ stroke: value } as never)));
      form.appendChild(this.rangeField(this.t("strokeWidth"), ink.strokeWidth, 0.5, 24, 0.5, (value) => this.core.updateSelected({ strokeWidth: value } as never)));
    }
    form.appendChild(this.rangeField(this.t("opacity"), object.opacity ?? 1, 0.05, 1, 0.05, (value) => this.core.updateSelected({ opacity: value })));
    const actions = el("div", "pce-btnrow");
    const dup = button(`${icon("duplicate")}<span>${this.t("duplicate")}</span>`, this.t("duplicate"), "pce-smallbtn");
    dup.addEventListener("click", () => this.core.duplicateSelected());
    const del = button(`${icon("trash")}<span>${this.t("delete")}</span>`, this.t("delete"), "pce-smallbtn danger");
    del.addEventListener("click", () => this.core.deleteSelected());
    const fwd = button(`${icon("forward")}<span>${this.t("forward")}</span>`, this.t("forward"), "pce-smallbtn");
    fwd.addEventListener("click", () => this.core.bringForward());
    const back = button(`${icon("backward")}<span>${this.t("backward")}</span>`, this.t("backward"), "pce-smallbtn");
    back.addEventListener("click", () => this.core.sendBackward());
    actions.append(dup, del, fwd, back);
    form.appendChild(actions);
  }

  private selectField(
    label: string,
    value: string,
    options: Array<[string, string]>,
    onChange: (value: string) => void,
  ): HTMLElement {
    const wrap = el("label", "pce-field");
    wrap.appendChild(el("span", "pce-label", label));
    const select = el("select", "pce-select");
    for (const [id, name] of options) {
      const option = el("option", "", name);
      option.value = id;
      option.selected = id === value;
      select.appendChild(option);
    }
    select.addEventListener("change", () => onChange(select.value));
    wrap.appendChild(select);
    return wrap;
  }

  private numberField(label: string, value: number, onChange: (value: number) => void): HTMLElement {
    const wrap = el("label", "pce-field");
    wrap.appendChild(el("span", "pce-label", label));
    const input = el("input", "pce-input");
    input.type = "number";
    input.value = String(Math.round(value * 10) / 10);
    input.addEventListener("change", () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) onChange(parsed);
    });
    wrap.appendChild(input);
    return wrap;
  }

  private colorField(label: string, value: string, onChange: (value: string) => void): HTMLElement {
    const wrap = el("label", "pce-field");
    wrap.appendChild(el("span", "pce-label", label));
    const input = el("input", "pce-input");
    input.type = "color";
    input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : "#191722";
    input.addEventListener("input", () => onChange(input.value));
    wrap.appendChild(input);
    return wrap;
  }

  private rangeField(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
  ): HTMLElement {
    const wrap = el("label", "pce-field");
    wrap.appendChild(el("span", "pce-label", label));
    const input = el("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener("input", () => onChange(Number(input.value)));
    wrap.appendChild(input);
    return wrap;
  }

  private toggleButton(
    label: string,
    active: boolean,
    onClick: (next: boolean) => void,
    iconName?: string,
  ): HTMLButtonElement {
    const b = button(
      `${iconName ? icon(iconName) : ""}<span>${escapeHtml(label)}</span>`,
      label,
      "pce-smallbtn",
    );
    const paint = (on: boolean) => {
      b.setAttribute("aria-pressed", String(on));
      b.style.borderColor = on ? "var(--pce-accent)" : "";
      b.style.color = on ? "var(--pce-accent)" : "";
    };
    paint(active);
    b.addEventListener("click", () => {
      const next = b.getAttribute("aria-pressed") !== "true";
      paint(next);
      onClick(next);
    });
    return b;
  }

  private renderTextbar(edit: PdfiumTextEdit | null) {
    if (!edit) {
      this.textbarHost.replaceChildren();
      this.textbar = null;
      return;
    }
    if (!this.textbar) {
      const bar = el("div", "pce-textbar");
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", this.t("originalText"));
      const bold = button(icon("bold"), this.t("bold"));
      bold.addEventListener("click", () => this.core.updateOriginalText({ boldOverride: !this.currentBold }));
      const italic = button(icon("italic"), this.t("italic"));
      italic.addEventListener("click", () => this.core.updateOriginalText({ italicOverride: !this.currentItalic }));
      const size = el("input");
      size.type = "number";
      size.min = "6";
      size.max = "200";
      size.step = "0.5";
      size.setAttribute("aria-label", this.t("size"));
      size.addEventListener("change", () => {
        const value = Number(size.value);
        if (Number.isFinite(value) && value >= 6 && value <= 200) {
          this.core.updateOriginalText({ fontSizeOverride: value });
        }
      });
      const colorLabel = el("label");
      const swatch = el("span", "swatch");
      const color = el("input");
      color.type = "color";
      color.setAttribute("aria-label", this.t("color"));
      color.addEventListener("input", () => {
        swatch.style.background = color.value;
        this.core.updateOriginalText({ colorOverride: color.value });
      });
      colorLabel.append(swatch, color);
      const close = button(icon("close"), this.t("close"));
      close.addEventListener("click", () => this.core.clearOriginalTextFocus());
      bar.append(bold, italic, size, colorLabel, close);
      this.textbarHost.appendChild(bar);
      this.textbar = bar;
      (bar as HTMLDivElement & { _bold?: HTMLButtonElement; _italic?: HTMLButtonElement; _size?: HTMLInputElement; _color?: HTMLInputElement; _swatch?: HTMLSpanElement })._bold = bold;
    }
    const bar = this.textbar as HTMLDivElement & {
      _bold?: HTMLButtonElement;
      _italic?: HTMLButtonElement;
      _size?: HTMLInputElement;
      _color?: HTMLInputElement;
      _swatch?: HTMLSpanElement;
    };
    this.currentBold = edit.boldOverride ?? edit.bold;
    this.currentItalic = edit.italicOverride ?? edit.italic;
    this.currentSize = edit.fontSizeOverride ?? edit.fontSize;
    this.currentColor = edit.colorOverride ?? edit.color;
    bar._bold?.setAttribute("aria-pressed", String(this.currentBold));
    bar._italic?.setAttribute("aria-pressed", String(this.currentItalic));
    const size = bar.querySelector<HTMLInputElement>("input[type=number]");
    if (size && document.activeElement !== size) {
      size.value = String(Math.round(this.currentSize * 10) / 10);
    }
    const color = bar.querySelector<HTMLInputElement>("input[type=color]");
    const swatch = bar.querySelector<HTMLSpanElement>(".swatch");
    if (color && document.activeElement !== color) color.value = this.currentColor;
    if (swatch) swatch.style.background = this.currentColor;
  }

  private currentBold = false;
  private currentItalic = false;
  private currentSize = 12;
  private currentColor = "#191722";

  private togglePanel(panel: HTMLElement) {
    panel.classList.toggle("open");
    this.backdrop.style.display =
      this.pagesPanel.classList.contains("open") || this.inspectorPanel.classList.contains("open")
        ? "block"
        : "none";
  }

  private closePanels() {
    this.pagesPanel.classList.remove("open");
    this.inspectorPanel.classList.remove("open");
    this.backdrop.style.display = "none";
  }

  private rotateCurrentPage() {
    this.core.rotatePage(this.core.getCurrentPage(), 90);
    this.core.fitPage();
  }

  private openSignature() {
    const modal = el("div", "pce-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <div class="pce-modal-card">
        <div class="pce-modal-head">
          <h2 class="pce-modal-title">${escapeHtml(this.t("drawingSignature"))}</h2>
          <button type="button" class="pce-iconbtn" data-close>${icon("close")}</button>
        </div>
        <p class="pce-note">${escapeHtml(this.t("signatureHint"))}</p>
        <canvas class="pce-signature" width="640" height="220"></canvas>
        <div class="pce-modal-actions">
          <button type="button" class="pce-outline" data-clear>${escapeHtml(this.t("clear"))}</button>
          <button type="button" class="pce-outline" data-cancel>${escapeHtml(this.t("cancel"))}</button>
          <button type="button" class="pce-primary" data-insert>${escapeHtml(this.t("insertSignature"))}</button>
        </div>
      </div>`;
    this.root.appendChild(modal);
    const canvas = modal.querySelector<HTMLCanvasElement>("canvas")!;
    const insert = modal.querySelector<HTMLButtonElement>("[data-insert]")!;
    insert.disabled = true;
    const ctx = canvas.getContext("2d")!;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#191722";
    let drawing = false;
    let empty = true;
    let last: { x: number; y: number } | null = null;
    const point = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height,
      };
    };
    canvas.addEventListener("pointerdown", (event) => {
      drawing = true;
      empty = false;
      insert.disabled = false;
      last = point(event);
      canvas.setPointerCapture(event.pointerId);
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = "#191722";
      ctx.fill();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing) return;
      const next = point(event);
      if (!last) last = next;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
      last = next;
    });
    const stop = () => {
      drawing = false;
      last = null;
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    const close = () => {
      document.removeEventListener("keydown", onKey);
      modal.remove();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    modal.addEventListener("pointerdown", (event) => {
      if (event.target === modal) close();
    });
    modal.querySelector("[data-close]")?.addEventListener("click", close);
    modal.querySelector("[data-cancel]")?.addEventListener("click", close);
    modal.querySelector("[data-clear]")?.addEventListener("click", () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      empty = true;
      insert.disabled = true;
    });
    insert.addEventListener("click", () => {
      if (empty) return;
      const dataUrl = canvas.toDataURL("image/png");
      close();
      void this.core.addSignature(dataUrl);
    });
  }

  private openTemplates() {
    const modal = el("div", "pce-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <div class="pce-modal-card">
        <div class="pce-modal-head">
          <h2 class="pce-modal-title">${escapeHtml(this.t("templates"))}</h2>
          <button type="button" class="pce-iconbtn" data-close>${icon("close")}</button>
        </div>
        <div class="pce-template-grid" data-grid></div>
      </div>`;
    this.root.appendChild(modal);
    const grid = modal.querySelector("[data-grid]")!;
    for (const template of this.templates) {
      const card = el("button", "pce-template-card");
      card.type = "button";
      card.innerHTML = `<strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.description ?? "")}</small>`;
      card.addEventListener("click", () => {
        close();
        void this.applyTemplate(template);
      });
      grid.appendChild(card);
    }
    const close = () => {
      document.removeEventListener("keydown", onKey);
      modal.remove();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    modal.addEventListener("pointerdown", (event) => {
      if (event.target === modal) close();
    });
    modal.querySelector("[data-close]")?.addEventListener("click", close);
  }

  async applyTemplate(template: EditorTemplate): Promise<void> {
    const pages = this.core.getPages();
    if (pages.length === 0) {
      this.toast(this.t("noTemplatePage"), true);
      return;
    }
    const page = pages[this.core.getCurrentPage()] ?? pages[0];
    if (!page) return;
    const scale = Math.max(
      0.5,
      Math.min(page.width / 595, page.height / 842),
    );
    for (const object of template.objects) {
      if (object.type === "text") {
        await this.core.addText(object.x * scale, object.y * scale, {
          text: object.text ?? "",
          fontSize: object.fontSize ? object.fontSize * scale : undefined,
          fontFamily: object.fontFamily,
          bold: object.bold,
          italic: object.italic,
          color: object.color,
        });
      } else {
        this.core.addShape(object.shape ?? "rect", {
          x: object.x * scale,
          y: object.y * scale,
          width: object.width ? object.width * scale : undefined,
          height: object.height ? object.height * scale : undefined,
          fill: object.fill,
          stroke: object.stroke,
          strokeWidth: object.strokeWidth
            ? object.strokeWidth * scale
            : undefined,
        });
      }
    }
    this.toast(this.t("templateDone"));
  }

  private scheduleAutosave() {
    if (!this.options.autosave) return;
    const config =
      typeof this.options.autosave === "object" ? this.options.autosave : {};
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void this.persist(config.key ?? "default");
    }, config.debounce ?? 600);
  }

  private async persist(key: string) {
    if (this.saving || this.destroyed) return;
    const bytes = this.core.getSourceBytes();
    if (!bytes) return;
    this.saving = true;
    this.saveStatus.textContent = this.t("saving");
    try {
      const scene = this.core.serializeScene();
      await writeProject(key, {
        name: this.core.getFileName(),
        bytes: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
        scene,
        updatedAt: Date.now(),
      });
      this.saveStatus.textContent = this.t("saved");
    } catch {
      this.saveStatus.textContent = this.t("local");
    } finally {
      this.saving = false;
    }
  }

  private async restoreAutosave() {
    if (!this.options.autosave) return;
    const config =
      typeof this.options.autosave === "object" ? this.options.autosave : {};
    const key = config.key ?? "default";
    try {
      const project = await readProject(key);
      if (!project || this.destroyed || this.userOpened) return;
      await this.core.load(new Uint8Array(project.bytes), {
        fileName: project.name,
      });
      if (this.destroyed || this.userOpened) return;
      this.core.restoreScene(project.scene);
      this.query("[data-file]").textContent = project.name;
      this.syncTopbar();
      this.renderPages();
      this.renderInspector();
      void this.refreshThumbs();
      this.toast(this.t("restored"));
    } catch {
      // No usable project: start empty.
    }
  }

  private toast(message: string, error = false) {
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastHost.replaceChildren();
    const toast = el("div", `pce-toast${error ? " error" : ""}`, message);
    this.toastHost.appendChild(toast);
    this.toastTimer = window.setTimeout(() => {
      toast.remove();
      this.toastTimer = null;
    }, 3400);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
