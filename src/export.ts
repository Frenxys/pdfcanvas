import {
  displayRectToPdf,
  displayToPdf,
  getPdfLib,
  normaliseImage,
  toRgb,
  clamp,
  wrapTextLines,
} from "./utils";
import { totalRotation, type PageState } from "./model";
import type {
  ExportOptions,
  FontFamily,
  PenObject,
  TextObject,
} from "./types";

type PdfLib = typeof import("pdf-lib");
type PdfDocument = import("pdf-lib").PDFDocument;
type PdfPage = import("pdf-lib").PDFPage;
type PdfFont = import("pdf-lib").PDFFont;
type PdfImage = import("pdf-lib").PDFImage;
type StandardFontName = import("pdf-lib").StandardFonts;

const FONT_CHOICES: Record<
  FontFamily,
  [StandardFontName, StandardFontName, StandardFontName, StandardFontName]
> = {
  helvetica: [
    "Helvetica" as StandardFontName,
    "Helvetica-Bold" as StandardFontName,
    "Helvetica-Oblique" as StandardFontName,
    "Helvetica-BoldOblique" as StandardFontName,
  ],
  times: [
    "Times-Roman" as StandardFontName,
    "Times-Bold" as StandardFontName,
    "Times-Italic" as StandardFontName,
    "Times-BoldItalic" as StandardFontName,
  ],
  courier: [
    "Courier" as StandardFontName,
    "Courier-Bold" as StandardFontName,
    "Courier-Oblique" as StandardFontName,
    "Courier-BoldOblique" as StandardFontName,
  ],
};

/**
 * Builds the output PDF: original pages are copied as vectors and every scene
 * object is drawn on top with pdf-lib, so text stays selectable and shapes
 * stay sharp.
 */
export async function buildPdf(
  pages: PageState[],
  sourceBytes: Uint8Array | null,
  fileName: string,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("The document has no pages.");

  const lib: PdfLib = await getPdfLib();
  const { PDFDocument, degrees, rgb, BlendMode, LineCapStyle } = lib;

  const out = await PDFDocument.create();
  out.setProducer("pdfcanvas");
  out.setCreator(options.creator ?? "pdfcanvas");
  out.setModificationDate(new Date());

  let source: PdfDocument | null = null;
  if (sourceBytes && pages.some((page) => page.sourceIndex !== null)) {
    source = await PDFDocument.load(sourceBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
    if (source.isEncrypted) {
      throw new Error(
        "This PDF is encrypted. Remove the password before exporting.",
      );
    }
    try {
      const title = source.getTitle();
      const author = source.getAuthor();
      const subject = source.getSubject();
      const keywords = source.getKeywords();
      if (title) out.setTitle(title);
      if (author) out.setAuthor(author);
      if (subject) out.setSubject(subject);
      if (keywords) out.setKeywords(keywords.split(/[,;]\s*/));
    } catch {
      // Malformed metadata is not worth failing an export over.
    }
  }
  if (options.title) out.setTitle(options.title);
  if (options.author) out.setAuthor(options.author);
  if (options.subject) out.setSubject(options.subject);

  const toColor = (value: string) => {
    const { r, g, b } = toRgb(value);
    return rgb(r, g, b);
  };

  const fontCache = new Map<string, PdfFont>();
  const getFont = async (
    family: FontFamily,
    bold: boolean,
    italic: boolean,
  ): Promise<PdfFont> => {
    const key = `${family}:${bold ? 1 : 0}:${italic ? 1 : 0}`;
    const cached = fontCache.get(key);
    if (cached) return cached;
    const choices = FONT_CHOICES[family];
    const font = await out.embedFont(choices[(bold ? 1 : 0) + (italic ? 2 : 0)]!);
    fontCache.set(key, font);
    return font;
  };

  const imageCache = new Map<string, PdfImage>();
  const embedImage = async (src: string): Promise<PdfImage> => {
    const cached = imageCache.get(src);
    if (cached) return cached;
    let dataUrl = src;
    if (!/^data:image\/(png|jpe?g);base64,/i.test(dataUrl)) {
      dataUrl = await normaliseImage(dataUrl);
    }
    const match = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
    if (!match?.[1] || !match[2]) throw new Error("Unsupported image format.");
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const image = /png/i.test(match[1])
      ? await out.embedPng(bytes)
      : await out.embedJpg(bytes);
    imageCache.set(src, image);
    return image;
  };

  for (const pageState of pages) {
    const rotation = totalRotation(pageState);
    let page: PdfPage;
    if (pageState.sourceIndex !== null && source) {
      const [copied] = await out.copyPages(source, [pageState.sourceIndex]);
      if (!copied) throw new Error("Could not copy a page.");
      page = out.addPage(copied);
    } else {
      page = out.addPage([pageState.width, pageState.height]);
    }
    page.setRotation(degrees(rotation));

    const W = pageState.width;
    const H = pageState.height;

    for (const object of pageState.objects) {
      const opacity = clamp(object.opacity ?? 1, 0, 1);
      if (object.type === "text") {
        await drawText(
          page,
          object,
          rotation,
          W,
          H,
          out,
          getFont,
          toColor,
          degrees,
          opacity,
        );
        continue;
      }
      if (object.type === "image") {
        const image = await embedImage(object.src);
        const bottomLeft = displayToPdf(
          object.x,
          object.y + object.h,
          rotation,
          W,
          H,
        );
        page.drawImage(image, {
          x: bottomLeft.x,
          y: bottomLeft.y,
          width: object.w,
          height: object.h,
          rotate: degrees(rotation),
          opacity,
        });
        continue;
      }
      if (object.type === "shape") {
        const box = displayRectToPdf(
          { x: object.x, y: object.y, w: object.w, h: object.h },
          rotation,
          W,
          H,
        );
        const fill = object.fill ? toColor(object.fill) : undefined;
        const stroke = object.stroke ? toColor(object.stroke) : undefined;
        const strokeWidth = Math.max(0, object.strokeWidth ?? 0);
        const blendMode =
          object.blend === "multiply" ? BlendMode.Multiply : undefined;
        if (object.shape === "ellipse") {
          page.drawEllipse({
            x: box.x + box.w / 2,
            y: box.y + box.h / 2,
            xScale: box.w / 2,
            yScale: box.h / 2,
            ...(fill ? { color: fill } : {}),
            ...(stroke ? { borderColor: stroke, borderWidth: strokeWidth } : {}),
            opacity,
            ...(blendMode ? { blendMode } : {}),
          });
        } else {
          page.drawRectangle({
            x: box.x,
            y: box.y,
            width: box.w,
            height: box.h,
            ...(fill ? { color: fill } : {}),
            ...(stroke ? { borderColor: stroke, borderWidth: strokeWidth } : {}),
            opacity,
            ...(blendMode ? { blendMode } : {}),
          });
        }
        continue;
      }
      if (object.type === "line") {
        const start = displayToPdf(object.x1, object.y1, rotation, W, H);
        const end = displayToPdf(object.x2, object.y2, rotation, W, H);
        page.drawLine({
          start,
          end,
          thickness: Math.max(0.25, object.strokeWidth),
          color: toColor(object.stroke),
          opacity,
          lineCap: LineCapStyle.Round,
        });
        continue;
      }
      if (object.type === "pen") {
        drawPen(
          page,
          object,
          rotation,
          W,
          H,
          toColor,
          LineCapStyle.Round,
          opacity,
        );
      }
    }
  }

  if (options.fileName) {
    const clean = options.fileName.replace(/\.pdf$/i, "");
    if (!out.getTitle()) out.setTitle(clean);
  } else if (!out.getTitle()) {
    out.setTitle(fileName.replace(/\.pdf$/i, ""));
  }

  return out.save();
}

function drawPen(
  page: PdfPage,
  object: PenObject,
  rotation: number,
  W: number,
  H: number,
  toColor: (value: string) => import("pdf-lib").RGB,
  lineCap: import("pdf-lib").LineCapStyle,
  opacity: number,
) {
  const points = object.points.map(([nx, ny]) =>
    displayToPdf(
      object.x + nx * object.w,
      object.y + ny * object.h,
      rotation,
      W,
      H,
    ),
  );
  const color = toColor(object.stroke);
  const thickness = Math.max(0.5, object.strokeWidth);
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end) continue;
    page.drawLine({ start, end, thickness, color, opacity, lineCap });
  }
  if (points.length === 1) {
    const only = points[0];
    if (only) {
      page.drawCircle({
        x: only.x,
        y: only.y,
        size: thickness / 2,
        color,
        opacity,
      });
    }
  }
}

async function drawText(
  page: PdfPage,
  object: TextObject,
  rotation: number,
  W: number,
  H: number,
  out: PdfDocument,
  getFont: (
    family: FontFamily,
    bold: boolean,
    italic: boolean,
  ) => Promise<PdfFont>,
  toColor: (value: string) => import("pdf-lib").RGB,
  degrees: (value: number) => import("pdf-lib").Rotation,
  opacity: number,
) {
  const text = object.text ?? "";
  if (!text.trim()) return;
  const font = await getFont(object.fontFamily, object.bold, object.italic);
  const lines = object.wrap
    ? wrapTextLines(
        text,
        object.w,
        object.fontSize,
        object.fontFamily,
        object.bold,
        object.italic,
      )
    : text.split("\n");
  const lineHeight = object.fontSize * 1.25;
  const ascent = object.fontSize * 0.925;

  const charset = (
    font as unknown as { getCharacterSet?: () => number[] }
  ).getCharacterSet?.();
  if (charset) {
    const allowed = new Set(charset);
    const encodable = [...text].every((char) => {
      if (char === "\n" || char === "\r" || char === "\t" || char === " ") {
        return true;
      }
      const codePoint = char.codePointAt(0);
      return codePoint !== undefined && allowed.has(codePoint);
    });
    if (!encodable) {
      await drawTextAsImage(page, object, rotation, W, H, out, degrees, opacity);
      return;
    }
  }

  try {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!line) continue;
      const width = font.widthOfTextAtSize(line, object.fontSize);
      const offset =
        object.align === "center"
          ? (object.w - width) / 2
          : object.align === "right"
            ? object.w - width
            : 0;
      const point = displayToPdf(
        object.x + offset,
        object.y + ascent + index * lineHeight,
        rotation,
        W,
        H,
      );
      page.drawText(line, {
        x: point.x,
        y: point.y,
        size: object.fontSize,
        font,
        color: toColor(object.color),
        rotate: degrees(rotation),
        opacity,
      });
    }
  } catch {
    await drawTextAsImage(page, object, rotation, W, H, out, degrees, opacity);
  }
}

async function drawTextAsImage(
  page: PdfPage,
  object: TextObject,
  rotation: number,
  W: number,
  H: number,
  out: PdfDocument,
  degrees: (value: number) => import("pdf-lib").Rotation,
  opacity: number,
) {
  if (typeof document === "undefined") return;
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(object.w * scale));
  canvas.height = Math.max(1, Math.ceil(object.h * scale));
  const context = canvas.getContext("2d");
  if (!context) return;
  const { FONT_CSS } = await import("./utils");
  context.scale(scale, scale);
  context.font = `${object.italic ? "italic " : ""}${object.bold ? "700" : "400"} ${object.fontSize}px ${FONT_CSS[object.fontFamily]}`;
  context.fillStyle = object.color;
  context.textBaseline = "alphabetic";
  (object.wrap
    ? wrapTextLines(
        object.text,
        object.w,
        object.fontSize,
        object.fontFamily,
        object.bold,
        object.italic,
      )
    : object.text.split("\n")
  ).forEach((line, index) => {
    const width = context.measureText(line).width;
    const offset =
      object.align === "center"
        ? (object.w - width) / 2
        : object.align === "right"
          ? object.w - width
          : 0;
    context.fillText(
      line,
      offset,
      object.fontSize * 0.925 + index * object.fontSize * 1.25,
    );
  });
  const dataUrl = canvas.toDataURL("image/png");
  const binary = atob(dataUrl.split(",")[1] ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const image = await out.embedPng(bytes);
  const bottomLeft = displayToPdf(
    object.x,
    object.y + object.h,
    rotation,
    W,
    H,
  );
  page.drawImage(image, {
    x: bottomLeft.x,
    y: bottomLeft.y,
    width: object.w,
    height: object.h,
    rotate: degrees(rotation),
    opacity,
  });
}
