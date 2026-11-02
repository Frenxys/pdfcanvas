import type { PdfiumTextEdit } from "./pdfium";

export type PdfSource = ArrayBuffer | Uint8Array | Blob | File | string;

export type Tool =
  | "select"
  | "text"
  | "text-edit"
  | "image"
  | "rect"
  | "ellipse"
  | "line"
  | "pen"
  | "highlight"
  | "whiteout";

export type FontFamily = "helvetica" | "times" | "courier";

export type TextAlign = "left" | "center" | "right";

export type PageRotation = 0 | 90 | 180 | 270;

interface ObjectBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
}

export interface TextObject extends ObjectBase {
  type: "text";
  text: string;
  fontFamily: FontFamily;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: TextAlign;
  /** Wrap text to the object width instead of growing horizontally. */
  wrap?: boolean;
}

export interface ImageObject extends ObjectBase {
  type: "image";
  src: string;
  name?: string;
  /** Keep the original aspect ratio while resizing. */
  lockAspect?: boolean;
}

export interface ShapeObject extends ObjectBase {
  type: "shape";
  shape: "rect" | "ellipse";
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  blend?: "normal" | "multiply";
}

export interface LineObject {
  id: string;
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

export interface PenObject extends ObjectBase {
  type: "pen";
  /** Normalised points (0..1) relative to the object box. */
  points: Array<[number, number]>;
  stroke: string;
  strokeWidth: number;
}

export type SceneObject =
  | TextObject
  | ImageObject
  | ShapeObject
  | LineObject
  | PenObject;

export interface PageInfo {
  id: string;
  index: number;
  width: number;
  height: number;
  rotation: number;
  objectCount: number;
}

export interface PdfCanvasOptions {
  /**
   * URL of the self-hosted pdf.js worker (`pdf.worker.min.mjs`).
   * Required: the worker is never loaded from a third-party CDN to keep
   * documents on the user's device.
   */
  workerSrc?: string;
  /** URL of the pdf.js `cmaps/` directory (trailing slash). */
  cMapUrl?: string;
  /** URL of the pdf.js `standard_fonts/` directory (trailing slash). */
  standardFontDataUrl?: string;
  /** URL of the pdf.js `wasm/` directory (trailing slash). */
  wasmUrl?: string;
  /**
   * URL of `pdfium.wasm`. Enables editing existing PDF text.
   * Without it, only overlay editing is available.
   */
  pdfiumWasmUrl?: string;
  /**
   * URL of the bundled fallback fonts directory (trailing slash), normally
   * `/fonts/` copied from `pdfcanvas/assets/fonts/`. Enables Arial-metric
   * replacement with Liberation Sans.
   */
  fontAssetsUrl?: string;
  /** Initial zoom. `fit-width` works once the container is visible. */
  initialZoom?: number | "fit-width" | "fit-page";
  minZoom?: number;
  maxZoom?: number;
  /** Maximum number of undo steps kept in memory. */
  historyLimit?: number;
  /** Maximum accepted PDF size in bytes (default 200 MB). */
  maxFileSize?: number;
  /** Accent colour used by the selection UI. */
  accent?: string;
  /** Called for non-fatal errors (e.g. a page failed to render). */
  onError?: (error: Error) => void;
}

export type ChangeReason =
  | "load"
  | "object"
  | "text"
  | "page"
  | "selection"
  | "zoom"
  | "history"
  | "tool";

export interface PdfCanvasEventMap {
  load: { fileName: string; pageCount: number };
  change: { reason: ChangeReason };
  selectionchange: { object: SceneObject | null; objects?: SceneObject[] };
  zoom: { zoom: number };
  pagechange: { index: number };
  error: { error: Error };
  export: { bytes: Uint8Array; fileName: string };
  save: Record<string, never>;
  originaledit: { edit: PdfiumTextEdit | null };
}

export interface ExportOptions {
  /** Output file name. Defaults to the loaded name with a suffix. */
  fileName?: string;
  /** PDF metadata. */
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
}

export interface PdfCanvasState {
  fileName: string;
  pageCount: number;
  currentPage: number;
  pages: PageInfo[];
  selection: SceneObject | null;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  tool: Tool;
}

export interface AddTextOptions {
  pageIndex?: number;
  x?: number;
  y?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: FontFamily;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: TextAlign;
  opacity?: number;
}

export interface AddImageOptions {
  pageIndex?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  name?: string;
  lockAspect?: boolean;
}

export interface AddShapeOptions {
  pageIndex?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  opacity?: number;
}

export interface Thumbnail {
  id: string;
  url: string;
  index: number;
}
