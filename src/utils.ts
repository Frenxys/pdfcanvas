import type { FontFamily } from "./types";

type PdfJsModule = typeof import("pdfjs-dist");
type PdfLibModule = typeof import("pdf-lib");

let pdfjsPromise: Promise<PdfJsModule> | null = null;
let pdfLibPromise: Promise<PdfLibModule> | null = null;

export function getPdfjs(): Promise<PdfJsModule> {
  pdfjsPromise ??= import("pdfjs-dist");
  return pdfjsPromise;
}

export function getPdfLib(): Promise<PdfLibModule> {
  pdfLibPromise ??= import("pdf-lib");
  return pdfLibPromise;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normaliseRotation(value: number): number {
  return ((Math.round(value / 90) * 90) % 360 + 360) % 360;
}

/** Returns [width, height] after rotation, in PDF points. */
export function rotatedDimensions(
  width: number,
  height: number,
  rotation: number,
): [number, number] {
  return rotation % 180 === 0 ? [width, height] : [height, width];
}

/**
 * Converts a point from display space (top-left origin, y down) to PDF space
 * (bottom-left origin, y up) for a page of size W x H displayed with `rotation`.
 */
export function displayToPdf(
  x: number,
  y: number,
  rotation: number,
  width: number,
  height: number,
): { x: number; y: number } {
  switch (normaliseRotation(rotation)) {
    case 90:
      return { x: y, y: x };
    case 180:
      return { x: width - x, y };
    case 270:
      return { x: height - y, y: width - x };
    default:
      return { x, y: height - y };
  }
}

export interface DisplayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned PDF bounding box for a display-space rectangle. */
export function displayRectToPdf(
  rect: DisplayRect,
  rotation: number,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const corners = [
    displayToPdf(rect.x, rect.y, rotation, width, height),
    displayToPdf(rect.x + rect.w, rect.y, rotation, width, height),
    displayToPdf(rect.x, rect.y + rect.h, rotation, width, height),
    displayToPdf(rect.x + rect.w, rect.y + rect.h, rotation, width, height),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    w: Math.max(...xs) - minX,
    h: Math.max(...ys) - minY,
  };
}

export function toRgb(color: string): { r: number; g: number; b: number } {
  const value = color.trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const expanded =
      hex.length === 3
        ? hex
            .split("")
            .map((char) => char + char)
            .join("")
        : hex;
    if (/^[0-9a-f]{6}$/i.test(expanded)) {
      return {
        r: parseInt(expanded.slice(0, 2), 16) / 255,
        g: parseInt(expanded.slice(2, 4), 16) / 255,
        b: parseInt(expanded.slice(4, 6), 16) / 255,
      };
    }
  }
  const rgb = value.match(/rgba?\(([^)]+)\)/i);
  if (rgb?.[1]) {
    const parts = rgb[1].split(",").map((part) => Number.parseFloat(part));
    return {
      r: clamp((parts[0] ?? 0) / 255, 0, 1),
      g: clamp((parts[1] ?? 0) / 255, 0, 1),
      b: clamp((parts[2] ?? 0) / 255, 0, 1),
    };
  }
  return { r: 0, g: 0, b: 0 };
}

export const FONT_CSS: Record<FontFamily, string> = {
  helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, Georgia, serif',
  courier: '"Courier New", Courier, monospace',
};

let measureContext: CanvasRenderingContext2D | null = null;

export function measureText(
  text: string,
  fontSize: number,
  fontFamily: FontFamily,
  bold: boolean,
  italic: boolean,
  lineHeight = 1.25,
): { width: number; height: number } {
  if (typeof document === "undefined") {
    return { width: text.length * fontSize * 0.55, height: fontSize * lineHeight };
  }
  measureContext ??= document.createElement("canvas").getContext("2d");
  const lines = text.split("\n");
  let width = 0;
  if (measureContext) {
    measureContext.font = `${italic ? "italic " : ""}${bold ? "700" : "400"} ${fontSize}px ${FONT_CSS[fontFamily]}`;
    for (const line of lines) {
      width = Math.max(width, measureContext.measureText(line || " ").width);
    }
  }
  return {
    width: Math.max(8, Math.ceil(width)),
    height: Math.max(1, lines.length) * fontSize * lineHeight,
  };
}

/** Splits text into lines that fit `maxWidth`, preserving explicit newlines. */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: FontFamily,
  bold: boolean,
  italic: boolean,
): string[] {
  const paragraphs = text.split("\n");
  if (typeof document === "undefined") {
    const approximate = Math.max(1, Math.floor(maxWidth / (fontSize * 0.55)));
    return paragraphs.flatMap((line) => {
      if (line.length <= approximate) return [line];
      const chunks: string[] = [];
      for (let index = 0; index < line.length; index += approximate) {
        chunks.push(line.slice(index, index + approximate));
      }
      return chunks;
    });
  }
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return paragraphs;
  measureContext.font = `${italic ? "italic " : ""}${bold ? "700" : "400"} ${fontSize}px ${FONT_CSS[fontFamily]}`;
  const fits = (value: string) =>
    measureContext!.measureText(value).width <= Math.max(1, maxWidth);
  const output: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      output.push("");
      continue;
    }
    let line = "";
    for (const token of paragraph.split(/(\s+)/)) {
      if (!token) continue;
      if (fits(line + token)) {
        line += token;
        continue;
      }
      if (line) {
        output.push(line.replace(/\s+$/, ""));
        line = "";
      }
      if (token.trim() && !fits(token)) {
        let chunk = "";
        for (const char of token) {
          if (chunk && !fits(chunk + char)) {
            output.push(chunk);
            chunk = char;
          } else {
            chunk += char;
          }
        }
        line = chunk;
      } else {
        line = token.replace(/^\s+/, "");
      }
    }
    output.push(line.replace(/\s+$/, ""));
  }
  return output.length > 0 ? output : [""];
}

export async function toBytes(source: ArrayBuffer | Uint8Array | Blob | File | string): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    return new Uint8Array(source);
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source.slice(0));
  }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  }
  if (typeof source === "string") {
    if (source.startsWith("data:")) {
      const response = await fetch(source);
      return new Uint8Array(await response.arrayBuffer());
    }
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Could not download the PDF (HTTP ${response.status}).`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error("Unsupported PDF source.");
}

export function fileNameFromSource(source: PdfFileNameSource, fallback = "document.pdf"): string {
  if (typeof source === "string") {
    if (source.startsWith("data:")) return fallback;
    try {
      const path = new URL(source, "https://localhost").pathname;
      const name = decodeURIComponent(path.split("/").pop() ?? "");
      return name || fallback;
    } catch {
      return fallback;
    }
  }
  if (typeof File !== "undefined" && source instanceof File && source.name) {
    return source.name;
  }
  return fallback;
}

type PdfFileNameSource = ArrayBuffer | Uint8Array | Blob | File | string;

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export function isImageFile(file: File): boolean {
  return /^image\//.test(file.type);
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image."));
    image.src = src;
  });
}

/** Converts any browser-readable image to a PNG data URL. */
export async function normaliseImage(src: string): Promise<string> {
  if (/^data:image\/(png|jpe?g);/i.test(src)) return src;
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth);
  canvas.height = Math.max(1, image.naturalHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");
  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function outputFileName(name: string): string {
  const base = name.replace(/\.pdf$/i, "");
  if (/-pdfcanvas(-edit)?$/i.test(base)) {
    return `${base.replace(/-edit$/i, "")}-edit.pdf`;
  }
  return `${base}-pdfcanvas.pdf`;
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function pdfjsVersion(): string {
  return "6.5.438";
}
