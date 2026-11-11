// The image math behind the document scanner: find the sheet of paper in a photo, flatten it to a rectangle,
// even out the light so it looks like a scan, and check that the result is sharp and bright enough to read.
// Plain arrays in, plain arrays out, with no browser APIs, so the same code runs in tests.

export interface Point {
  x: number;
  y: number;
}
/** Four corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type ScanIssue = 'notFound' | 'blurry' | 'dark' | 'small';

// ---------- geometry ----------

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Puts four points in reading order (top-left, top-right, bottom-right, bottom-left), whatever order they came in. */
export function orderCorners(points: Point[]): Quad {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const byAngle = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // Clockwise on screen from the corner nearest the top-left.
  let start = 0;
  for (let i = 1; i < 4; i++) if (byAngle[i].x + byAngle[i].y < byAngle[start].x + byAngle[start].y) start = i;
  return [0, 1, 2, 3].map((i) => byAngle[(start + i) % 4]) as Quad;
}

/** True when the four corners make a proper sheet shape: convex, not folded or squashed into a triangle, and
 *  of a reasonable size. */
export function isUsableQuad(q: Quad, width: number, height: number): boolean {
  const minSide = 0.05 * Math.min(width, height);
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4];
    const b = q[i];
    const c = q[(i + 1) % 4];
    if (dist(b, c) < minSide) return false;
    const turn = cross(a, b, c);
    if (sign === 0) sign = Math.sign(turn);
    else if (Math.sign(turn) !== sign) return false;
    // Every corner between 25 and 155 degrees.
    const cos = ((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) / (dist(a, b) * dist(c, b));
    if (Math.abs(cos) > Math.cos((25 * Math.PI) / 180)) return false;
  }
  return polygonArea(q) >= 0.04 * width * height;
}

function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The largest four-cornered shape whose corners are points of the hull: the sheet's corners. */
function largestQuad(hull: Point[]): Point[] {
  let pts = hull;
  if (pts.length > 72) {
    const step = pts.length / 72;
    pts = Array.from({ length: 72 }, (_, i) => hull[Math.floor(i * step)]);
  }
  const n = pts.length;
  if (n < 4) return pts;
  let best = -1;
  let bestQuad: Point[] = pts.slice(0, 4);
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      // Best point on each side of the diagonal i-k.
      let left = -1;
      let leftArea = -1;
      for (let j = i + 1; j < k; j++) {
        const a = Math.abs(cross(pts[i], pts[k], pts[j]));
        if (a > leftArea) [leftArea, left] = [a, j];
      }
      let right = -1;
      let rightArea = -1;
      for (let j = k + 1; j < n + i; j++) {
        const p = pts[j % n];
        const a = Math.abs(cross(pts[i], pts[k], p));
        if (a > rightArea) [rightArea, right] = [a, j % n];
      }
      if (left < 0 || right < 0) continue;
      if (leftArea + rightArea > best) {
        best = leftArea + rightArea;
        bestQuad = [pts[i], pts[left], pts[k], pts[right]];
      }
    }
  }
  return bestQuad;
}

// ---------- finding the paper ----------

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / (2 * r + 1);
      sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1);
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function otsu(values: Float32Array, mask?: Uint8Array): number {
  const hist = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    hist[Math.max(0, Math.min(255, Math.round(values[i])))]++;
    total++;
  }
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > best) [best, threshold] = [between, t];
  }
  return threshold + 0.5;
}

function morph(mask: Uint8Array, w: number, h: number, r: number, grow: boolean): Uint8Array {
  // Square erode or dilate, as two one-dimensional passes with running counts.
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(w * h);
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let line = 0; line < lines; line++) {
      const at = (i: number) => (horizontal ? line * w + i : i * w + line);
      let count = 0;
      for (let i = 0; i <= Math.min(r, len - 1); i++) count += src[at(i)];
      for (let i = 0; i < len; i++) {
        const lo = Math.max(0, i - r);
        const hi = Math.min(len - 1, i + r);
        out[at(i)] = grow ? (count > 0 ? 1 : 0) : count === hi - lo + 1 ? 1 : 0;
        if (i + r + 1 < len) count += src[at(i + r + 1)];
        if (i - r >= 0) count -= src[at(i - r)];
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

interface Region {
  area: number;
  rows: Array<[number, number, number]>; // y, leftmost x, rightmost x
  touches: number; // how many image sides it touches
}

function regions(mask: Uint8Array, w: number, h: number): Region[] {
  const label = new Int32Array(w * h).fill(-1);
  const found: Region[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = found.length;
    const left = new Map<number, number>();
    const right = new Map<number, number>();
    let area = 0;
    let top = false;
    let bottom = false;
    let lside = false;
    let rside = false;
    let sp = 0;
    stack[sp++] = start;
    label[start] = id;
    while (sp) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i - x) / w;
      area++;
      if (y === 0) top = true;
      if (y === h - 1) bottom = true;
      if (x === 0) lside = true;
      if (x === w - 1) rside = true;
      if (!left.has(y) || x < left.get(y)!) left.set(y, x);
      if (!right.has(y) || x > right.get(y)!) right.set(y, x);
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of next) {
        if (j >= 0 && mask[j] && label[j] < 0) {
          label[j] = id;
          stack[sp++] = j;
        }
      }
    }
    const rows: Region['rows'] = [];
    for (const [y, lx] of left) rows.push([y, lx, right.get(y)!]);
    found.push({ area, rows, touches: [top, bottom, lside, rside].filter(Boolean).length });
  }
  return found;
}

export interface Detection {
  /** Corners in the photo's pixels. The whole photo when the paper wasn't found or fills the frame. */
  quad: Quad;
  /** False when no sheet could be told apart from the background: the patient should place the corners. */
  found: boolean;
}

export const wholeImage = (w: number, h: number): Quad => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

/** Pixels that look like paper: bright and with little colour. */
function paperScore(img: Rgba): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const light = 0.299 * r + 0.587 * g + 0.114 * b;
    const colour = Math.max(r, g, b) - Math.min(r, g, b);
    out[i] = Math.max(0, light - 0.8 * colour);
  }
  return out;
}

function candidate(mask: Uint8Array, w: number, h: number): { quad: Quad; score: number; full: boolean } | null {
  const opened = morph(morph(mask, w, h, 2, false), w, h, 2, true);
  const all = regions(opened, w, h).sort((a, b) => b.area - a.area);
  const total = w * h;
  for (const region of all.slice(0, 3)) {
    const share = region.area / total;
    if (share < 0.03) break;
    if (share > 0.9 && region.touches >= 3) return { quad: wholeImage(w, h), score: 1, full: true };
    if (region.touches === 4) continue; // bright background around a dark object, not paper
    const edge: Point[] = [];
    for (const [y, l, r] of region.rows) edge.push({ x: l, y }, { x: r + 1, y }, { x: l, y: y + 1 }, { x: r + 1, y: y + 1 });
    const hull = convexHull(edge);
    const hullArea = polygonArea(hull);
    const corners = largestQuad(hull);
    if (corners.length < 4) continue;
    const quad = orderCorners(corners);
    if (!isUsableQuad(quad, w, h)) continue;
    // A sheet fills its four corners (rectangular), and is solid inside the hull, apart from its writing.
    const rectangular = polygonArea(quad) / hullArea;
    const solid = region.area / hullArea;
    if (rectangular < 0.92 || solid < 0.6) continue;
    // Straight sides matter most: a sheet's outline hugs its four corners.
    return { quad, score: rectangular ** 12 * Math.min(1, solid + 0.2) * Math.sqrt(share), full: false };
  }
  return null;
}

/** Everything not reachable from the photo's border without crossing an edge: whatever the paper's outline
 *  encloses. Works when the desk is as bright as the paper somewhere, as long as the paper's edge shows. */
function enclosed(score: Float32Array, w: number, h: number): Uint8Array {
  const grad = new Float32Array(w * h);
  const steps: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const g = Math.hypot(score[i + 1] - score[i - 1], score[i + w] - score[i - w]);
      grad[i] = g;
      if ((x + y) % 3 === 0) steps.push(g);
    }
  }
  steps.sort((a, b) => a - b);
  const limit = Math.max(6, steps[Math.floor(steps.length * 0.8)] * 1.5);
  const wall = morph(Uint8Array.from(grad, (g) => (g > limit ? 1 : 0)), w, h, 1, true);
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!wall[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < (h - 1) * w) push(i + w);
  }
  return Uint8Array.from(outside, (v) => 1 - v);
}

/** Finds the sheet of paper in a small copy of the photo (about 500 pixels on its long side). */
export function detectPaper(img: Rgba): Detection {
  const { width: w, height: h } = img;
  const score = boxBlur(paperScore(img), w, h, 2);
  const tries: Array<NonNullable<ReturnType<typeof candidate>>> = [];
  const first = otsu(score);
  // Three ways to tell paper from desk: brighter than the desk; brighter still, for a light desk; and inside
  // a closed outline, for a desk that is as bright as the paper in places.
  const masks: Uint8Array[] = [first, otsu(score, Uint8Array.from(score, (v) => (v > first ? 1 : 0)))].map((t) => Uint8Array.from(score, (v) => (v > t ? 1 : 0)));
  masks.push(enclosed(score, w, h));
  for (const mask of masks) {
    const c = candidate(mask, w, h);
    if (c) tries.push(c);
  }
  if (!tries.length) return { quad: wholeImage(w, h), found: false };
  const best = tries.sort((a, b) => b.score - a.score)[0];
  if (best.full) return { quad: best.quad, found: true };
  return { quad: refineInward(best.quad, 0.002), found: true };
}

/** Pulls the corners a hair towards the middle, so no strip of desk shows along the edge. */
function refineInward(q: Quad, amount: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => ({ x: p.x + (cx - p.x) * amount * 2, y: p.y + (cy - p.y) * amount * 2 })) as Quad;
}

// ---------- flattening ----------

/** Width and height of the flattened sheet, from the lengths of its sides. */
export function flatSize(q: Quad, maxSide: number): { width: number; height: number } {
  let width = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let height = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const scale = Math.min(1, maxSide / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  return { width, height };
}

/** The 3x3 projective map taking the output rectangle onto the four corners in the photo. */
function homography(w: number, h: number, q: Quad): number[] {
  const from = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const { x: u, y: v } = q[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 9; c++) a[r][c] -= f * a[col][c];
    }
  }
  const s = a.map((row, i) => row[8] / row[i]);
  return [...s, 1];
}

/** Flattens the sheet inside the corners into a straight rectangle. */
export function flatten(src: Rgba, q: Quad, width: number, height: number): Rgba {
  const m = homography(width, height, q);
  const out = new Uint8ClampedArray(width * height * 4);
  const { data, width: sw, height: sh } = src;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = m[6] * px + m[7] * py + 1;
      let u = (m[0] * px + m[1] * py + m[2]) / d - 0.5;
      let v = (m[3] * px + m[4] * py + m[5]) / d - 0.5;
      u = Math.max(0, Math.min(sw - 1.001, u));
      v = Math.max(0, Math.min(sh - 1.001, v));
      const x0 = u | 0;
      const y0 = v | 0;
      const fx = u - x0;
      const fy = v - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx;
        const bottom = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx;
        out[o + c] = top + (bottom - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

// ---------- making it look like a scan ----------

/** How bright the paper is around each spot, per colour channel, on a coarse grid. */
function paperLight(img: Rgba, block: number) {
  const { data, width, height } = img;
  const gw = Math.ceil(width / block);
  const gh = Math.ceil(height / block);
  const grids = [new Float32Array(gw * gh), new Float32Array(gw * gh), new Float32Array(gw * gh)];
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.forEach((hst) => hst.fill(0));
      let n = 0;
      const y1 = Math.min(height, (gy + 1) * block);
      const x1 = Math.min(width, (gx + 1) * block);
      for (let y = gy * block; y < y1; y += 2) {
        for (let x = gx * block; x < x1; x += 2) {
          const p = (y * width + x) * 4;
          hist[0][data[p]]++;
          hist[1][data[p + 1]]++;
          hist[2][data[p + 2]]++;
          n++;
        }
      }
      // The paper is the bright part of each block; writing is the dark part.
      const want = n * 0.9;
      for (let c = 0; c < 3; c++) {
        let seen = 0;
        let v = 0;
        for (; v < 256; v++) {
          seen += hist[c][v];
          if (seen >= want) break;
        }
        grids[c][gy * gw + gx] = v;
      }
    }
  }
  // Blocks covered by a heading or a stamp read too dark: take the brightest neighbour, then smooth.
  const smooth = (g: Float32Array, pick: (vals: number[]) => number) => {
    const out = new Float32Array(g.length);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const vals: number[] = [];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) vals.push(g[yy * gw + xx]);
          }
        out[y * gw + x] = pick(vals);
      }
    }
    return out;
  };
  const max = (v: number[]) => Math.max(...v);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const final = grids.map((g) => smooth(smooth(smooth(g, max), mean), mean));
  return { grids: final, gw, gh };
}

/** Evens out the light and whitens the paper, keeping the ink's colour (a blue stamp stays blue). Returns how
 *  bright the paper was before, 0 to 255, for the quality check. */
export function whiten(img: Rgba): number {
  const { data, width, height } = img;
  const block = Math.max(16, Math.round(Math.min(width, height) / 36));
  const { grids, gw, gh } = paperLight(img, block);
  const paperBefore = [...grids[0]].map((v, i) => 0.299 * v + 0.587 * grids[1][i] + 0.114 * grids[2][i]).sort((a, b) => a - b)[Math.floor((gw * gh) / 2)];

  const lum = new Uint32Array(256);
  for (let y = 0; y < height; y++) {
    const gyf = Math.max(0, Math.min(gh - 1, y / block - 0.5));
    const gy0 = Math.floor(gyf);
    const gy1 = Math.min(gh - 1, gy0 + 1);
    const fy = gyf - gy0;
    for (let x = 0; x < width; x++) {
      const gxf = Math.max(0, Math.min(gw - 1, x / block - 0.5));
      const gx0 = Math.floor(gxf);
      const gx1 = Math.min(gw - 1, gx0 + 1);
      const fx = gxf - gx0;
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const g = grids[c];
        const bg =
          (g[gy0 * gw + gx0] * (1 - fx) + g[gy0 * gw + gx1] * fx) * (1 - fy) + (g[gy1 * gw + gx0] * (1 - fx) + g[gy1 * gw + gx1] * fx) * fy;
        data[p + c] = Math.min(255, (data[p + c] * 250) / Math.max(bg, 70));
      }
      lum[Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2])]++;
    }
  }
  // Darken the ink: the darkest bit becomes black, the paper stays white.
  const total = width * height;
  let seen = 0;
  let low = 0;
  for (; low < 200; low++) {
    seen += lum[low];
    if (seen >= total * 0.01) break;
  }
  const top = 245;
  const curve = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) curve[v] = 255 * Math.min(1, Math.max(0, (v - low) / (top - low))) ** 1.35;
  for (let p = 0; p < data.length; p += 4) {
    data[p] = curve[data[p]];
    data[p + 1] = curve[data[p + 1]];
    data[p + 2] = curve[data[p + 2]];
  }
  return paperBefore;
}

// ---------- quality ----------

/** How sharp the writing is: the steepest light-to-dark steps, measured at a fixed size so photos compare. */
export function sharpness(img: Rgba): number {
  const { data, width, height } = img;
  const scale = Math.min(1, 900 / width);
  const w = Math.max(3, Math.round(width * scale));
  const h = Math.max(3, Math.round(height * scale));
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (Math.min(height - 1, Math.floor(y / scale)) * width + Math.min(width - 1, Math.floor(x / scale))) * 4;
      gray[y * w + x] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
  }
  const steps: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const g = Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + w] - gray[i - w]);
      if (g > 20) steps.push(g);
    }
  }
  if (steps.length < 50) return 0;
  steps.sort((a, b) => b - a);
  return steps[Math.floor(steps.length * 0.05)];
}

export const LIMITS = { sharp: 150, paper: 80, shortSide: 500 };

export function issuesOf({ found, sharp, paper, shortSide }: { found: boolean; sharp: number; paper: number; shortSide: number }): ScanIssue[] {
  const out: ScanIssue[] = [];
  if (!found) out.push('notFound');
  if (paper < LIMITS.paper) out.push('dark');
  else if (sharp < LIMITS.sharp) out.push('blurry');
  if (shortSide < LIMITS.shortSide) out.push('small');
  return out;
}
