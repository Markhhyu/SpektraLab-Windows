// localAdjust.ts — per-photo local adjustments: masked grades applied by the
// native host after the engine has rendered the print. The host owns the pixel
// pass (engine/host/local_adjust.cpp); this module owns the wire shape, the
// validation and the mask maths used by the panel and by the tests.
//
// Mask coordinates are normalised over the rendered frame (after crop,
// rotation and pair layout), so a mask follows the output picture.

import { clamp } from './params.ts';

export type LocalMaskKind = 'linear' | 'radial';

export interface LocalAdjustment {
  id: string;
  kind: LocalMaskKind;
  /** Linear gradient: the mask ramps from 0 at (x0, y0) to 1 at (x1, y1). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Normalised centre; radius is a fraction of frame width. */
  cx: number;
  cy: number;
  radius: number;
  /** Vertical radius in frame heights. Absent in legacy radial masks. */
  radiusY?: number;
  feather: number;
  invert: boolean;
  /** Exposure in EV; the other grades are -100..100 UI units. */
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
}

export interface LocalGrade {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
}

export const LOCAL_GRADE_DEFAULT: LocalGrade = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
};

export const LOCAL_GRADE_RANGE = {
  exposure: [-4, 4] as [number, number],
  contrast: [-100, 100] as [number, number],
  saturation: [-100, 100] as [number, number],
  temperature: [-100, 100] as [number, number],
  tint: [-100, 100] as [number, number],
  highlights: [-100, 100] as [number, number],
  shadows: [-100, 100] as [number, number],
};

const KIND_GEOMETRY: Record<LocalMaskKind, Pick<LocalAdjustment, 'x0' | 'y0' | 'x1' | 'y1' | 'cx' | 'cy' | 'radius'>> = {
  linear: { x0: 0.5, y0: 0.0, x1: 0.5, y1: 1.0, cx: 0.5, cy: 0.5, radius: 0.5 },
  radial: { x0: 0.5, y0: 0.0, x1: 0.5, y1: 1.0, cx: 0.5, cy: 0.5, radius: 0.5 },
};

let nextId = 1;

export function createLocalAdjustment(kind: LocalMaskKind): LocalAdjustment {
  return {
    id: `local-${nextId++}`,
    kind,
    ...KIND_GEOMETRY[kind],
    feather: 0.35,
    invert: false,
    ...LOCAL_GRADE_DEFAULT,
  };
}

export function localAdjustmentLabel(a: LocalAdjustment, index: number): string {
  const kind = a.kind === 'radial' ? 'Radial' : 'Linear';
  return `${kind} ${index + 1}`;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function clampLocalAdjustment(a: LocalAdjustment): LocalAdjustment {
  return {
    ...a,
    x0: clamp(a.x0, -1, 2),
    y0: clamp(a.y0, -1, 2),
    x1: clamp(a.x1, -1, 2),
    y1: clamp(a.y1, -1, 2),
    cx: clamp(a.cx, -1, 2),
    cy: clamp(a.cy, -1, 2),
    radius: clamp(a.radius, 0.02, 2),
    ...(a.radiusY !== undefined && { radiusY: clamp(a.radiusY, 0.02, 2) }),
    feather: clamp(a.feather, 0, 2),
    exposure: clamp(a.exposure, LOCAL_GRADE_RANGE.exposure[0], LOCAL_GRADE_RANGE.exposure[1]),
    contrast: clamp(a.contrast, -100, 100),
    saturation: clamp(a.saturation, -100, 100),
    temperature: clamp(a.temperature, -100, 100),
    tint: clamp(a.tint, -100, 100),
    highlights: clamp(a.highlights, -100, 100),
    shadows: clamp(a.shadows, -100, 100),
  };
}

// Tolerant decode for sidecars; unknown layers are dropped rather than
// poisoning the whole photo's edit state.
export function decodeLocalAdjustments(raw: unknown): LocalAdjustment[] {
  if (!Array.isArray(raw)) return [];
  const out: LocalAdjustment[] = [];
  for (const entry of raw) {
    const o = obj(entry);
    const kind = o.kind === 'radial' ? 'radial' : o.kind === 'linear' ? 'linear' : null;
    if (!kind) continue;
    const id = typeof o.id === 'string' && o.id ? o.id : `local-${nextId++}`;
    const base = createLocalAdjustment(kind);
    out.push(
      clampLocalAdjustment({
        ...base,
        id,
        x0: num(o.x0, base.x0),
        y0: num(o.y0, base.y0),
        x1: num(o.x1, base.x1),
        y1: num(o.y1, base.y1),
        cx: num(o.cx, base.cx),
        cy: num(o.cy, base.cy),
        radius: num(o.radius, base.radius),
        ...(typeof o.radiusY === 'number' && Number.isFinite(o.radiusY) && { radiusY: o.radiusY }),
        feather: num(o.feather, base.feather),
        invert: typeof o.invert === 'boolean' ? o.invert : base.invert,
        exposure: num(o.exposure, 0),
        contrast: num(o.contrast, 0),
        saturation: num(o.saturation, 0),
        temperature: num(o.temperature, 0),
        tint: num(o.tint, 0),
        highlights: num(o.highlights, 0),
        shadows: num(o.shadows, 0),
      }),
    );
    if (out.length >= 16) break;
  }
  // Re-seed ids so freshly created layers never collide with decoded ones.
  for (const layer of out) {
    const match = /^local-(\d+)$/.exec(layer.id);
    if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
  }
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth01(v: number): number {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

// Client-side mask weight, mirroring engine/host/local_adjust.cpp. Used by the
// tests and by the panel's position readout; the host stays authoritative.
export function maskWeight(a: LocalAdjustment, x: number, y: number, aspect = 1): number {
  let weight: number;
  if (a.kind === 'radial') {
    const dx = (x - a.cx) / a.radius;
    const dy = (y - a.cy) / (a.radiusY ?? a.radius / aspect);
    const d = Math.hypot(dx, dy);
    const edge = Math.max(a.feather * 0.5, 1e-3);
    weight = smooth01((1 - d) / edge);
  } else {
    const dx = a.x1 - a.x0;
    const dy = a.y1 - a.y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-9 ? (x >= a.x0 ? 1 : 0) : ((x - a.x0) * dx + (y - a.y0) * dy) / len2;
    // `feather` is the width of the transition band, as a fraction of the
    // gradient; tiny values collapse it to a hard edge at the midpoint.
    const fe = clamp(a.feather, 0.02, 1);
    weight = smooth01((t - (1 - fe) / 2) / fe);
  }
  return a.invert ? 1 - weight : weight;
}
