import { normaliseRotation, rotatedDimensions } from "./utils";
import type { SceneObject } from "./types";

export interface PageState {
  id: string;
  sourceIndex: number | null;
  width: number;
  height: number;
  sourceRotation: number;
  rotation: number;
  objects: SceneObject[];
}

export function totalRotation(page: PageState): number {
  return normaliseRotation(page.sourceRotation + page.rotation);
}

export function displaySize(page: PageState): [number, number] {
  return rotatedDimensions(page.width, page.height, totalRotation(page));
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function objectBounds(object: SceneObject): Bounds {
  if (object.type === "line") {
    const x = Math.min(object.x1, object.x2);
    const y = Math.min(object.y1, object.y2);
    return {
      x,
      y,
      w: Math.max(1, Math.abs(object.x2 - object.x1)),
      h: Math.max(1, Math.abs(object.y2 - object.y1)),
    };
  }
  return { x: object.x, y: object.y, w: object.w, h: object.h };
}
