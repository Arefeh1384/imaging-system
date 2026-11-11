// The document scanner, in the browser: reads the photo, finds the sheet of paper, flattens it, evens out the
// light and checks it can be read. The image math is in scanMath.ts; this file moves pixels in and out of canvases.
// What the patient approves on screen is exactly the file that gets sent.
import { detectPaper, flatSize, flatten, issuesOf, sharpness, whiten, wholeImage, type Point, type Quad, type Rgba, type ScanIssue } from './scanMath';

export type { Point, Quad, ScanIssue };

const MAX_SOURCE = 2600; // longest side kept from the photo
const DETECT_SIDE = 500; // the paper is looked for in a copy this size
const PREVIEW_SIDE = 1400; // the copy shown while placing the corners
const MAX_OUTPUT = 2000; // longest side of the scanned page

export interface Photo {
  source: Rgba;
  previewUrl: string;
  name: string;
  /** Where the paper was found, in the photo's pixels. */
  quad: Quad;
  found: boolean;
}

export interface ScannedFile {
  file: File;
  previewUrl: string | null;
  isImage: boolean;
  issues: ScanIssue[];
}

/** Lets the page draw (the scan animation, the found outline) between the heavy steps. */
export const breathe = () => new Promise<void>((resolve) => window.setTimeout(resolve, 16));

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas');
  return { canvas, ctx };
}

function pixelsOf(from: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number): Rgba {
  const { ctx } = canvasOf(dw, dh);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(from, sx, sy, sw, sh, 0, 0, dw, dh);
  const image = ctx.getImageData(0, 0, dw, dh);
  return { data: image.data, width: dw, height: dh };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Finds the paper in part of the photo (the whole photo, or the area around a first guess). */
function findIn(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const k = Math.min(1, DETECT_SIDE / Math.max(w, h));
  const small = pixelsOf(canvas, x, y, w, h, Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k)));
  const found = detectPaper(small);
  const sx = w / small.width;
  const sy = h / small.height;
  return { ...found, quad: found.quad.map((p) => ({ x: x + p.x * sx, y: y + p.y * sy })) as Quad };
}

const isWhole = (q: Quad, w: number, h: number) => q.every((p, i) => Math.abs(p.x - wholeImage(w, h)[i].x) < 1 && Math.abs(p.y - wholeImage(w, h)[i].y) < 1);

/** Reads the photo and finds the paper in it. Null when the browser can't read the image (the file then goes as is). */
export async function loadPhoto(file: File): Promise<Photo | null> {
  let bitmap: ImageBitmap;
  try {
    // Phone photos are often stored sideways with a note saying which way is up; follow the note.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, MAX_SOURCE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const { canvas, ctx } = canvasOf(width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const source: Rgba = { data: image.data, width, height };

    const p = Math.min(1, PREVIEW_SIDE / Math.max(width, height));
    const preview = canvasOf(Math.round(width * p), Math.round(height * p));
    preview.ctx.drawImage(canvas, 0, 0, preview.canvas.width, preview.canvas.height);
    const previewBlob = await toBlob(preview.canvas, 0.85);
    await breathe();

    let { quad, found } = findIn(canvas, 0, 0, width, height);
    if (found && !isWhole(quad, width, height)) {
      // A second, closer look around the first guess places the corners more exactly, above all for a small sheet.
      const xs = quad.map((c) => c.x);
      const ys = quad.map((c) => c.y);
      const margin = 0.08 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const x0 = Math.max(0, Math.floor(Math.min(...xs) - margin));
      const y0 = Math.max(0, Math.floor(Math.min(...ys) - margin));
      const x1 = Math.min(width, Math.ceil(Math.max(...xs) + margin));
      const y1 = Math.min(height, Math.ceil(Math.max(...ys) + margin));
      await breathe();
      const closer = findIn(canvas, x0, y0, x1 - x0, y1 - y0);
      const near = Math.hypot(x1 - x0, y1 - y0) * 0.04;
      if (closer.found && !isWhole(closer.quad.map((c) => ({ x: c.x - x0, y: c.y - y0 })) as Quad, x1 - x0, y1 - y0) && closer.quad.every((c, i) => Math.hypot(c.x - quad[i].x, c.y - quad[i].y) < near)) {
        quad = closer.quad;
      }
    }
    return { source, previewUrl: previewBlob ? URL.createObjectURL(previewBlob) : URL.createObjectURL(file), name: file.name, quad, found };
  } finally {
    bitmap.close();
  }
}

/** Corners for the patient to drag when the paper wasn't found: a little inside the photo's edges. */
export function startingCorners(photo: Photo): Quad {
  const { width: w, height: h } = photo.source;
  const mx = w * 0.08;
  const my = h * 0.08;
  return [
    { x: mx, y: my },
    { x: w - mx, y: my },
    { x: w - mx, y: h - my },
    { x: mx, y: h - my },
  ];
}

const sideLengths = (q: Quad) => [Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y), Math.hypot(q[3].x - q[2].x, q[3].y - q[2].y), Math.hypot(q[0].x - q[3].x, q[0].y - q[3].y), Math.hypot(q[1].x - q[2].x, q[1].y - q[2].y)];

/** Cuts the sheet out along the corners, flattens it, makes it look like a scan and checks it. */
export async function scanPhoto(photo: Photo, quad: Quad, found: boolean): Promise<ScannedFile> {
  const { width, height } = flatSize(quad, MAX_OUTPUT);
  const flat = flatten(photo.source, quad, width, height);
  await breathe();
  const paper = whiten(flat);
  const sharp = sharpness(flat);
  const [top, bottom, left, right] = sideLengths(quad);
  const issues = issuesOf({ found, sharp, paper, shortSide: Math.min(Math.max(top, bottom), Math.max(left, right)) });

  const { canvas, ctx } = canvasOf(width, height);
  const page = ctx.createImageData(width, height);
  page.data.set(flat.data);
  ctx.putImageData(page, 0, 0);
  const blob = await toBlob(canvas, 0.88);
  if (!blob) throw new Error('scan');
  const file = new File([blob], photo.name.replace(/\.[^.]+$/, '') + '-scan.jpg', { type: 'image/jpeg' });
  return { file, previewUrl: URL.createObjectURL(file), isImage: true, issues };
}

/** A file sent as it is: a PDF, or a photo the browser can't read. */
export function asIs(file: File): ScannedFile {
  const isImage = file.type.startsWith('image/');
  return { file, previewUrl: isImage ? URL.createObjectURL(file) : null, isImage, issues: [] };
}
