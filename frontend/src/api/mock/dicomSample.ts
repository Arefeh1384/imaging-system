// Draws sample anatomy for the sample cases. It builds a real DICOM file for the ZIP download,
// and the 4 or 5 grayscale pictures that the backend will make as PNGs from the real study.
import type { CaseRecord } from '../types';

interface DicomSeriesInfo {
  id: string;
  description: string;
  modality: string;
  instanceCount: number;
}

const AIR = 0;
const LUNG = 1;
const FAT = 2;
const MUSCLE = 3;
const ORGAN = 4;
const LIVER = 5;
const BLOOD = 6;
const BONE = 7;
const MARROW = 8;
const CSF = 9;
const GRAY = 10;
const WHITE = 11;
const DISC = 12;
const CORD = 13;
const TABLE = 14;

const CT_VALUES = [-1000, -840, -100, 55, 35, 62, 44, 950, 220, 8, 38, 28, 85, 35, 180];
const T1_VALUES = [0, 40, 950, 420, 520, 620, 180, 90, 800, 180, 500, 650, 350, 560, 0];
const T2_VALUES = [0, 40, 800, 280, 500, 300, 220, 60, 500, 1500, 760, 550, 450, 650, 0];

type Region = 'chest' | 'abdomen' | 'brain' | 'sinus' | 'spine' | 'knee' | 'shoulder';
type Phantom = (x: number, y: number, t: number) => number;

const ell = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;

function hash(x: number, y: number, z: number) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Smooth noise: gives lungs their vessels and the bowel its gas. */
function smoothNoise(x: number, y: number, z: number) {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const u = x - fx;
  const v = y - fy;
  const w = z - fz;
  const mix = (a: number, b: number, k: number) => a + (b - a) * k * k * (3 - 2 * k);
  const layer = (zz: number) => mix(mix(hash(fx, fy, zz), hash(fx + 1, fy, zz), u), mix(hash(fx, fy + 1, zz), hash(fx + 1, fy + 1, zz), u), v);
  return mix(layer(fz), layer(fz + 1), w);
}

const spineBlock = (x: number, y: number) => {
  if (ell(x, y, 0, 0.47, 0.055, 0.055) < 1) return CSF;
  const body = ell(x, y, 0, 0.32, 0.12, 0.1);
  if (body < 0.55) return MARROW;
  if (body < 1) return BONE;
  if (Math.abs(x) < 0.025 && y > 0.5 && y < 0.62) return BONE;
  return -1;
};

const chest: Phantom = (x, y, t) => {
  const s = 0.86 + 0.14 * Math.sin(Math.PI * t);
  const skin = ell(x, y, 0, 0.03, 0.86 * s, 0.62 * s);
  if (skin > 1) return y > 0.72 && y < 0.77 && Math.abs(x) < 0.92 ? TABLE : AIR;
  if (ell(x, y, 0, 0.03, 0.8 * s, 0.56 * s) > 1) return FAT;
  const spine = spineBlock(x, y);
  if (spine >= 0) return spine;
  if (ell(x, y, 0, 0.03, 0.72 * s, 0.48 * s) > 1) {
    const angle = Math.atan2(y - 0.03, x);
    return Math.sin(angle * 9 + t * 7) > 0.45 ? BONE : MUSCLE;
  }
  if (ell(x, y, 0, -0.41 * s, 0.09, 0.03) < 1) return BONE;
  if (ell(x, y, 0.09, 0.2, 0.055, 0.055) < 1) return BLOOD;
  const heartSize = Math.max(0.05, Math.sin(Math.PI * Math.min(1, Math.max(0, t * 1.35 - 0.12))));
  if (ell(x, y, 0.1, -0.1, 0.3 * heartSize, 0.25 * heartSize) < 1) return ell(x, y, 0.1, -0.1, 0.16 * heartSize, 0.12 * heartSize) < 1 ? BLOOD : ORGAN;
  const lung = 0.35 + 0.65 * Math.sin(Math.PI * t);
  for (const side of [-1, 1]) {
    if (ell(x, y, side * 0.4 * s, 0, 0.27 * s * (0.6 + 0.4 * lung), 0.38 * s * lung) < 1) {
      return smoothNoise(x * 16, y * 16, t * 24) > 0.74 ? BLOOD : LUNG;
    }
  }
  return FAT;
};

const abdomen: Phantom = (x, y, t) => {
  if (ell(x, y, 0, 0.03, 0.8, 0.6) > 1) return y > 0.72 && y < 0.77 && Math.abs(x) < 0.92 ? TABLE : AIR;
  if (ell(x, y, 0, 0.03, 0.7, 0.5) > 1) return FAT;
  const spine = spineBlock(x, y);
  if (spine >= 0) return spine;
  if (ell(x, y, 0.08, 0.15, 0.05, 0.05) < 1 || ell(x, y, -0.09, 0.14, 0.05, 0.045) < 1) return BLOOD;
  for (const side of [-1, 1]) {
    if (ell(x, y, side * 0.18, 0.33, 0.06, 0.1) < 1) return MUSCLE;
    const kidney = ell(x, y, side * 0.34, 0.26, 0.11, 0.15);
    if (t > 0.3 && t < 0.75 && kidney < 1) return kidney < 0.3 ? FAT : ORGAN;
  }
  if (t < 0.7 && ell(x, y, -0.34, -0.06, 0.32, 0.34) < 1) return ell(x, y, -0.3, 0.02, 0.05, 0.04) < 1 ? BLOOD : LIVER;
  if (t < 0.5 && ell(x, y, 0.45, 0.06, 0.13, 0.2) < 1) return ORGAN;
  if (ell(x, y, 0.15, -0.2, 0.3, 0.2) < 1 || t > 0.6) {
    const bowel = smoothNoise(x * 7, y * 7, t * 12);
    if (bowel > 0.72) return AIR;
    if (bowel > 0.5) return ORGAN;
  }
  return FAT;
};

const brain: Phantom = (x, y, t) => {
  const s = Math.sqrt(Math.max(0.05, 1 - (2 * t - 1) ** 2));
  const r = 0.35 + 0.55 * s;
  if (ell(x, y, 0, 0, 0.72 * r, 0.88 * r) > 1) return AIR;
  if (ell(x, y, 0, 0, 0.68 * r, 0.84 * r) > 1) return FAT;
  if (ell(x, y, 0, 0, 0.63 * r, 0.79 * r) > 1) return BONE;
  if (ell(x, y, 0, 0, 0.6 * r, 0.76 * r) > 1) return CSF;
  if (Math.abs(x) < 0.008 && Math.abs(y) > 0.1) return CSF;
  for (const side of [-1, 1]) {
    if (t > 0.35 && t < 0.72) {
      if (ell(x, y, side * 0.1, -0.12, 0.06, 0.2) < 1 || ell(x, y, side * 0.13, 0.18, 0.05, 0.12) < 1) return CSF;
    }
  }
  const folds = smoothNoise(x * 14, y * 14, t * 10);
  return ell(x, y, 0, 0, 0.48 * r, 0.62 * r) + (folds - 0.5) * 0.4 > 1 ? GRAY : WHITE;
};

const sinus: Phantom = (x, y, t) => {
  if (ell(x, y, 0, 0, 0.66, 0.84) > 1) return AIR;
  if (ell(x, y, 0, 0, 0.62, 0.8) > 1) return FAT;
  if (ell(x, y, 0, 0, 0.57, 0.75) > 1) return BONE;
  for (const side of [-1, 1]) {
    if (t < 0.55 && ell(x, y, side * 0.26, -0.28, 0.17, 0.2) < 1) return AIR;
    if (t > 0.45 && ell(x, y, side * 0.25, -0.34, 0.15, 0.17) < 1) return ell(x, y, side * 0.25, -0.34, 0.06, 0.08) < 1 ? MUSCLE : FAT;
    if (ell(x, y, side * 0.1, -0.5, 0.06, 0.12) < 1) return AIR;
  }
  if (Math.abs(x) < 0.015 && y < -0.2) return BONE;
  if (ell(x, y, 0, 0.42, 0.13, 0.13) < 1) return BONE;
  return y < 0 ? MUSCLE : GRAY;
};

const spine: Phantom = (x, y, t) => {
  // Sagittal: x runs front to back, y runs head to foot.
  const off = (t - 0.5) * 0.5;
  if (x < -0.72 || x > 0.72) return AIR;
  if (x > 0.5) return FAT;
  const cell = ((y + 2) / 0.25) % 1;
  const front = 0.02;
  if (x > front && x < 0.32) return cell < 0.22 ? DISC : cell < 0.3 || cell > 0.95 ? BONE : MARROW;
  if (Math.abs(off) < 0.12) {
    if (x > 0.32 && x < 0.44) return Math.abs(x - 0.38) < 0.03 ? CORD : CSF;
  }
  if (x > 0.44) return cell > 0.3 && cell < 0.7 ? BONE : MUSCLE;
  if (x > 0.32) return MUSCLE;
  return x < -0.45 ? FAT : smoothNoise(x * 6, y * 6, t * 8) > 0.6 ? ORGAN : FAT;
};

const knee: Phantom = (x, y, t) => {
  if (ell(x, y, 0, 0, 0.72, 0.7) > 1) return AIR;
  if (ell(x, y, 0, 0, 0.66, 0.64) > 1) return FAT;
  const femur = t < 0.5;
  const size = femur ? 0.3 + 0.2 * (t / 0.5) : 0.42 - 0.2 * ((t - 0.5) / 0.5);
  if (t > 0.42 && t < 0.54) return ell(x, y, 0, -0.04, size, size * 0.75) < 1 ? DISC : MUSCLE;
  const bone = ell(x, y, 0, -0.04, size, size * 0.72);
  if (bone < 0.8) return MARROW;
  if (bone < 1) return BONE;
  if (t > 0.18 && t < 0.42 && ell(x, y, 0, -0.5, 0.16, 0.07) < 1) return MARROW;
  if (ell(x, y, 0.05, 0.42, 0.04, 0.04) < 1) return BLOOD;
  return smoothNoise(x * 9, y * 9, t * 6) > 0.62 ? FAT : MUSCLE;
};

const shoulder: Phantom = (x, y, t) => {
  if (ell(x, y, 0, 0, 0.78, 0.72) > 1) return AIR;
  if (ell(x, y, 0, 0, 0.72, 0.66) > 1) return FAT;
  const r = 0.22 + 0.12 * Math.sin(Math.PI * t);
  const head = ell(x, y, -0.18, 0, r, r);
  if (head < 0.82) return MARROW;
  if (head < 1) return BONE;
  if (ell(x, y, 0.22, 0.02, 0.08, 0.2) < 1) return BONE;
  if (Math.abs(x - 0.1) < 0.012 && Math.abs(y) < 0.18) return CSF;
  return smoothNoise(x * 9, y * 9, t * 6) > 0.68 ? FAT : MUSCLE;
};

const PHANTOMS: Record<Region, Phantom> = { chest, abdomen, brain, sinus, spine, knee, shoulder };

function regionOf(title: string): Region {
  if (title.includes('سینوس')) return 'sinus';
  if (title.includes('سینه')) return 'chest';
  if (title.includes('مغز')) return 'brain';
  if (title.includes('ستون')) return 'spine';
  if (title.includes('زانو')) return 'knee';
  if (title.includes('شانه')) return 'shoulder';
  return 'abdomen';
}

const encoder = new TextEncoder();

class DicomWriter {
  private parts: Uint8Array[] = [];
  private size = 0;
  private push(part: Uint8Array) {
    this.parts.push(part);
    this.size += part.length;
  }
  private head(group: number, element: number, vr: string, length: number) {
    const long = vr === 'OW' || vr === 'OB';
    const data = new DataView(new ArrayBuffer(long ? 12 : 8));
    data.setUint16(0, group, true);
    data.setUint16(2, element, true);
    data.setUint8(4, vr.charCodeAt(0));
    data.setUint8(5, vr.charCodeAt(1));
    if (long) data.setUint32(8, length, true);
    else data.setUint16(6, length, true);
    this.push(new Uint8Array(data.buffer));
  }
  text(group: number, element: number, vr: string, value: string) {
    let bytes = encoder.encode(value);
    if (bytes.length % 2) {
      const padded = new Uint8Array(bytes.length + 1);
      padded.set(bytes);
      padded[bytes.length] = vr === 'UI' ? 0 : 32;
      bytes = padded;
    }
    this.head(group, element, vr, bytes.length);
    this.push(bytes);
  }
  ushort(group: number, element: number, value: number) {
    const data = new DataView(new ArrayBuffer(2));
    data.setUint16(0, value, true);
    this.head(group, element, 'US', 2);
    this.push(new Uint8Array(data.buffer));
  }
  bytes(group: number, element: number, vr: string, value: Uint8Array) {
    this.head(group, element, vr, value.length);
    this.push(value);
  }
  raw(value: Uint8Array) {
    this.push(value);
  }
  finish(): ArrayBuffer {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out.buffer as ArrayBuffer;
  }
}

interface Pixels {
  rows: number;
  columns: number;
  bits: 8 | 16;
  signed: boolean;
  frames: number;
  data: Uint8Array;
  photometric: 'MONOCHROME1' | 'MONOCHROME2';
  spacing: number;
  center?: number;
  width?: number;
  intercept?: number;
}

function caseSeed(id: string) {
  let h = 7;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 100000;
  return h;
}

function dateTag(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

const SOP_CLASSES: Record<string, string> = {
  CT: '1.2.840.10008.5.1.4.1.1.2',
  MR: '1.2.840.10008.5.1.4.1.1.4',
  DX: '1.2.840.10008.5.1.4.1.1.1.1',
  US: '1.2.840.10008.5.1.4.1.1.6.1',
};

function buildFile(record: CaseRecord, series: { number: number; description: string; orientation?: string }, instance: number, position: number, thickness: number, pixels: Pixels): ArrayBuffer {
  const root = '1.2.826.0.1.3680043.10.999';
  const seed = caseSeed(record.id);
  const sop = `${root}.${seed}.${series.number}.${instance + 1}`;
  const modality = record.study.modality;
  const sopClass = SOP_CLASSES[modality] ?? SOP_CLASSES.CT;

  const meta = new DicomWriter();
  meta.bytes(0x0002, 0x0001, 'OB', new Uint8Array([0, 1]));
  meta.text(0x0002, 0x0002, 'UI', sopClass);
  meta.text(0x0002, 0x0003, 'UI', sop);
  meta.text(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1');
  meta.text(0x0002, 0x0012, 'UI', `${root}.1`);
  const metaBody = new Uint8Array(meta.finish());

  const w = new DicomWriter();
  w.raw(new Uint8Array(128));
  w.raw(encoder.encode('DICM'));
  const metaLength = new Uint8Array(4);
  new DataView(metaLength.buffer).setUint32(0, metaBody.length, true);
  w.bytes(0x0002, 0x0000, 'UL', metaLength);
  w.raw(metaBody);

  w.text(0x0008, 0x0005, 'CS', 'ISO_IR 192');
  w.text(0x0008, 0x0008, 'CS', 'DERIVED\\SECONDARY');
  w.text(0x0008, 0x0016, 'UI', sopClass);
  w.text(0x0008, 0x0018, 'UI', sop);
  w.text(0x0008, 0x0020, 'DA', dateTag(record.receivedAt));
  w.text(0x0008, 0x0060, 'CS', modality);
  w.text(0x0008, 0x0070, 'LO', 'Sample');
  w.text(0x0008, 0x0080, 'LO', record.hospitalName);
  w.text(0x0008, 0x1030, 'LO', record.study.title);
  w.text(0x0008, 0x103e, 'LO', series.description);
  w.text(0x0010, 0x0010, 'PN', record.patient.name);
  w.text(0x0010, 0x0020, 'LO', record.patient.nationalId);
  if (thickness) w.text(0x0018, 0x0050, 'DS', String(thickness));
  w.text(0x0020, 0x000d, 'UI', `${root}.${seed}`);
  w.text(0x0020, 0x000e, 'UI', `${root}.${seed}.${series.number}`);
  w.text(0x0020, 0x0011, 'IS', String(series.number));
  w.text(0x0020, 0x0013, 'IS', String(instance + 1));
  if (series.orientation) w.text(0x0020, 0x0037, 'DS', series.orientation);
  if (thickness) w.text(0x0020, 0x1041, 'DS', position.toFixed(1));
  w.ushort(0x0028, 0x0002, 1);
  w.text(0x0028, 0x0004, 'CS', pixels.photometric);
  if (pixels.frames > 1) w.text(0x0028, 0x0008, 'IS', String(pixels.frames));
  w.ushort(0x0028, 0x0010, pixels.rows);
  w.ushort(0x0028, 0x0011, pixels.columns);
  w.text(0x0028, 0x0030, 'DS', `${pixels.spacing}\\${pixels.spacing}`);
  w.ushort(0x0028, 0x0100, pixels.bits);
  w.ushort(0x0028, 0x0101, pixels.bits === 16 ? 12 : 8);
  w.ushort(0x0028, 0x0102, pixels.bits === 16 ? 11 : 7);
  w.ushort(0x0028, 0x0103, pixels.signed ? 1 : 0);
  if (pixels.center !== undefined && pixels.width !== undefined) {
    w.text(0x0028, 0x1050, 'DS', String(pixels.center));
    w.text(0x0028, 0x1051, 'DS', String(pixels.width));
  }
  if (pixels.intercept !== undefined) {
    w.text(0x0028, 0x1052, 'DS', String(pixels.intercept));
    w.text(0x0028, 0x1053, 'DS', '1');
    w.text(0x0028, 0x1054, 'LO', 'HU');
  }
  w.bytes(0x7fe0, 0x0010, pixels.bits === 16 ? 'OW' : 'OB', pixels.data.length % 2 ? new Uint8Array([...pixels.data, 0]) : pixels.data);
  return w.finish();
}

function blur(values: Float32Array, size: number) {
  const out = new Float32Array(values.length);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < size && xx >= 0 && xx < size) {
            sum += values[yy * size + xx];
            n += 1;
          }
        }
      }
      out[y * size + x] = sum / n;
    }
  }
  return out;
}

const SIZE = 320;

function crossSection(region: Region, t: number, table: number[], noise: number, seed: number) {
  const phantom = PHANTOMS[region];
  const values = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const ny = (y / (SIZE - 1)) * 2 - 1;
    for (let x = 0; x < SIZE; x += 1) values[y * SIZE + x] = table[phantom((x / (SIZE - 1)) * 2 - 1, ny, t)];
  }
  const soft = blur(blur(values, SIZE), SIZE);
  let state = (seed * 2654435761 + Math.round(t * 100000)) >>> 0;
  for (let i = 0; i < soft.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    soft[i] += ((state >>> 16) / 65536 - 0.5) * noise;
  }
  return soft;
}

function uint16Pixels(values: Float32Array, add: number, max: number): Uint8Array {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = Math.max(0, Math.min(max, Math.round(values[i] + add)));
  return new Uint8Array(out.buffer);
}

/** A frontal or side plain film, drawn directly: bright where tissue blocks more X-rays. */
function radiograph(region: Region, view: number, seed: number) {
  const out = new Float32Array(SIZE * SIZE);
  let state = (seed + view * 131) >>> 0;
  const lateral = view % 2 === 1;
  for (let py = 0; py < SIZE; py += 1) {
    const y = (py / (SIZE - 1)) * 2 - 1;
    for (let px = 0; px < SIZE; px += 1) {
      const x = (px / (SIZE - 1)) * 2 - 1;
      let v = 300;
      if (region === 'knee') {
        const shift = lateral ? 0.06 : 0;
        if (Math.abs(x) < 0.5) v = 1300;
        if (y < -0.04 && Math.abs(x + shift) < 0.2 + (y > -0.3 ? (y + 0.3) * 0.5 : 0)) v = 2900;
        if (y > 0.04 && Math.abs(x - shift) < 0.2 + (y < 0.3 ? (0.3 - y) * 0.45 : 0)) v = 2800;
        if (lateral && ell(x, y, -0.34, -0.1, 0.09, 0.16) < 1) v = 3100;
        if (!lateral && ell(x, y, 0, -0.12, 0.12, 0.13) < 1) v = 3200;
      } else {
        const width = lateral ? 0.55 : 0.78;
        if (Math.abs(x) < width + 0.08 * Math.sin(y * 2) && y > -0.92) v = 1500;
        if (y > -0.75) {
          if (lateral) {
            if (ell(x, y, 0.02, -0.02, 0.4, 0.62) < 1) v = 600;
            if (ell(x, y, -0.16, 0.22, 0.2, 0.26) < 1) v = 1500;
            if (x > 0.36 && x < 0.47 && y > -0.7) v = Math.sin(y * 44) > 0.2 ? 3000 : 2200;
          } else {
            for (const side of [-1, 1]) {
              if (ell(x, y, side * 0.38, -0.05, 0.27, 0.62) < 1) {
                v = 620;
                if (Math.sin((y + Math.abs(x) * 0.4) * 34) > 0.72) v = 1750;
                if (smoothNoise(x * 18, y * 18, 2) > 0.7) v += 240;
              }
            }
            if (ell(x, y, 0.1, 0.24, 0.26, 0.26) < 1) v = 1950;
            if (Math.abs(x) < 0.07) v = Math.max(v, Math.sin(y * 42) > 0.3 ? 2500 : 2150);
            if (y > 0.5) v = Math.max(v, 1700);
          }
        }
      }
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      out[py * SIZE + px] = v + ((state >>> 16) / 65536 - 0.5) * 70;
    }
  }
  return blur(out, SIZE);
}

function ultrasound(frames: number, seed: number) {
  const rows = 256;
  const columns = 320;
  const data = new Uint8Array(rows * columns * frames);
  let state = seed >>> 0;
  for (let f = 0; f < frames; f += 1) {
    const t = frames > 1 ? f / (frames - 1) : 0.5;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const dx = (x - columns / 2) / rows;
        const dy = (y + 20) / rows;
        const depth = Math.hypot(dx, dy);
        const angle = Math.atan2(dx, dy);
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        if (Math.abs(angle) > 0.62 || depth < 0.1 || depth > 1.05) continue;
        let v = 62 + 42 * smoothNoise(x * 0.09, y * 0.16, t * 3 + 4);
        const speckle = (state >>> 24) / 255;
        if (ell(dx, dy, 0.1 * Math.sin(t * 3), 0.55, 0.15, 0.1) < 1) v = 6;
        else if (ell(dx, dy, -0.14, 0.72 + t * 0.05, 0.2, 0.09) < 1) v = 118;
        if (Math.abs(depth - 0.2) < 0.012) v += 70;
        const gain = 1.1 - depth * 0.45;
        data[f * rows * columns + y * columns + x] = Math.max(0, Math.min(255, v * gain * (0.45 + speckle * 1.1)));
      }
    }
  }
  return { rows, columns, data };
}

const SPACING: Record<Region, number> = { chest: 1.1, abdomen: 1.1, brain: 0.72, sinus: 0.62, spine: 1.05, knee: 0.5, shoulder: 0.56 };
const DX_VIEWS = ['AP', 'Lateral', 'Oblique', 'PA'];

export function sampleSeries(record: CaseRecord): DicomSeriesInfo[] {
  const { modality, imageCount } = record.study;
  const count = Math.max(imageCount, 1);
  if (modality === 'DX') {
    return Array.from({ length: Math.min(count, DX_VIEWS.length) }, (_, i) => ({ id: `view-${i}`, description: DX_VIEWS[i], modality, instanceCount: 1 }));
  }
  if (modality === 'US') return [{ id: 'cine', description: 'B-mode', modality, instanceCount: 1 }];
  if (modality === 'MR') {
    const t2 = Math.ceil(count / 2);
    return [
      { id: 't2', description: 'T2', modality, instanceCount: t2 },
      { id: 't1', description: 'T1', modality, instanceCount: Math.max(count - t2, 1) },
    ];
  }
  return [
    { id: 'axial', description: 'Axial', modality, instanceCount: Math.max(count - 1, 1) },
    { id: 'scout', description: 'Localizer', modality, instanceCount: 1 },
  ];
}

export function sampleInstance(record: CaseRecord, seriesId: string, index: number): ArrayBuffer {
  const { modality, imageCount } = record.study;
  const region = regionOf(record.study.title);
  const seed = caseSeed(record.id);
  const list = sampleSeries(record);
  const number = list.findIndex((s) => s.id === seriesId) + 1;
  const info = list[number - 1];
  const spacing = SPACING[region];
  const t = info.instanceCount > 1 ? index / (info.instanceCount - 1) : 0.5;

  if (modality === 'US') {
    const { rows, columns, data } = ultrasound(Math.max(imageCount, 1), seed);
    return buildFile(record, { number, description: info.description }, 0, 0, 0, { rows, columns, bits: 8, signed: false, frames: Math.max(imageCount, 1), data, photometric: 'MONOCHROME2', spacing: 0.3, center: 128, width: 256 });
  }
  if (modality === 'DX') {
    const film = radiograph(region, index + number - 1, seed);
    const flipped = new Float32Array(film.length);
    for (let i = 0; i < film.length; i += 1) flipped[i] = 4095 - film[i];
    return buildFile(record, { number, description: info.description }, 0, 0, 0, { rows: SIZE, columns: SIZE, bits: 16, signed: false, frames: 1, data: uint16Pixels(flipped, 0, 4095), photometric: 'MONOCHROME1', spacing: 0.9, center: 2048, width: 4096 });
  }
  if (seriesId === 'scout') {
    const film = radiograph(region, 0, seed);
    return buildFile(record, { number, description: info.description }, 0, 0, 0, { rows: SIZE, columns: SIZE, bits: 16, signed: false, frames: 1, data: uint16Pixels(film, 0, 4095), photometric: 'MONOCHROME2', spacing: 1.1, center: 2048, width: 4096 });
  }

  const sagittal = region === 'spine';
  const orientation = sagittal ? '0\\1\\0\\0\\0\\-1' : '1\\0\\0\\0\\1\\0';
  const thickness = modality === 'MR' ? 3 : 2.5;
  const position = index * thickness;
  if (modality === 'MR') {
    const table = seriesId === 't1' ? T1_VALUES : T2_VALUES;
    const values = crossSection(region, t, table, 34, seed);
    return buildFile(record, { number, description: `${info.description} ${sagittal ? 'Sagittal' : 'Axial'}`, orientation }, index, position, thickness, { rows: SIZE, columns: SIZE, bits: 16, signed: false, frames: 1, data: uint16Pixels(values, 0, 4095), photometric: 'MONOCHROME2', spacing, center: 600, width: 1300 });
  }
  const values = crossSection(region, t, CT_VALUES, 22, seed);
  const soft = region === 'brain' ? { center: 40, width: 80 } : region === 'sinus' ? { center: 400, width: 2000 } : { center: 40, width: 400 };
  return buildFile(record, { number, description: info.description, orientation }, index, position, thickness, { rows: SIZE, columns: SIZE, bits: 16, signed: false, frames: 1, data: uint16Pixels(values, 1024, 4095), photometric: 'MONOCHROME2', spacing, ...soft, intercept: -1024 });
}

/** One grayscale picture, 8 bits per pixel, ready to be drawn as a PNG. */
export interface SamplePreview {
  label: string;
  width: number;
  height: number;
  gray: Uint8ClampedArray;
}

function windowed(values: Float32Array, center: number, width: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(values.length);
  const low = center - width / 2;
  for (let i = 0; i < values.length; i += 1) out[i] = ((values[i] - low) / width) * 255;
  return out;
}

/** The pictures the insurer sees: a few slices or views spread across the study. */
export function samplePreviews(record: CaseRecord): SamplePreview[] {
  const { modality } = record.study;
  const region = regionOf(record.study.title);
  const seed = caseSeed(record.id);
  if (modality === 'US') {
    const { rows, columns, data } = ultrasound(4, seed);
    return [0, 1, 2, 3].map((f) => ({ label: `تصویر ${f + 1}`, width: columns, height: rows, gray: new Uint8ClampedArray(data.subarray(f * rows * columns, (f + 1) * rows * columns)) }));
  }
  if (modality === 'DX') {
    return DX_VIEWS.map((view, i) => ({ label: view, width: SIZE, height: SIZE, gray: windowed(radiograph(region, i, seed), 1900, 3400) }));
  }
  const spots = [0.2, 0.35, 0.5, 0.65, 0.8];
  if (modality === 'MR') {
    return spots.map((t, i) => ({ label: `T2، برش ${i + 1}`, width: SIZE, height: SIZE, gray: windowed(crossSection(region, t, T2_VALUES, 34, seed), 600, 1300) }));
  }
  const soft = region === 'brain' ? { center: 40, width: 80 } : region === 'sinus' ? { center: 400, width: 2000 } : { center: 40, width: 400 };
  return spots.map((t, i) => ({ label: `برش ${i + 1}`, width: SIZE, height: SIZE, gray: windowed(crossSection(region, t, CT_VALUES, 22, seed), soft.center, soft.width) }));
}
