// presets.ts — a preset is a small JSON document holding the film parameters and
// the adjustment layers of one photograph. Applying it is non-destructive: it
// only writes the sidecar of the open photograph, exactly like an edit.
//
// Presets live in one store entry (`Presets/presets.json`), next to the catalog.

import type { Adjustments } from './adjustments';
import type { FilmParams } from './params';

export const PRESETS_STORE_AREA = 'Presets';
export const PRESETS_STORE_NAME = 'presets.json';
export const PRESETS_SCHEMA_VERSION = 1;

export interface Preset {
  id: string;
  name: string;
  createdAt: number;
  params: FilmParams;
  adjustments: Adjustments;
}

export interface PresetsFile {
  schemaVersion: number;
  presets: Preset[];
}

export const EMPTY_PRESETS: PresetsFile = { schemaVersion: PRESETS_SCHEMA_VERSION, presets: [] };

/** A stable, readable id for a new preset. */
export function presetId(now = Date.now(), seed = Math.random()): string {
  const salt = Math.floor(seed * 0xffffff).toString(36).padStart(4, '0');
  return `preset-${now.toString(36)}-${salt}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createPreset(name: string, params: FilmParams, adjustments: Adjustments, now = Date.now()): Preset {
  return {
    id: presetId(now),
    name: name.trim() || 'Preset',
    createdAt: now,
    params: clone(params),
    adjustments: clone(adjustments),
  };
}

/** Tolerant decoder: drops malformed entries instead of losing the whole file. */
export function decodePresets(raw: unknown): PresetsFile {
  const source = raw as Partial<PresetsFile> | null | undefined;
  const list = Array.isArray(source?.presets) ? source!.presets : [];
  const seen = new Set<string>();
  const presets: Preset[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Partial<Preset>;
    if (typeof p.id !== 'string' || p.id === '' || seen.has(p.id)) continue;
    if (typeof p.name !== 'string') continue;
    if (!p.params || typeof p.params !== 'object' || !p.adjustments || typeof p.adjustments !== 'object') continue;
    seen.add(p.id);
    presets.push({
      id: p.id,
      name: p.name,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
      params: clone(p.params as FilmParams),
      adjustments: clone(p.adjustments as Adjustments),
    });
  }
  return { schemaVersion: PRESETS_SCHEMA_VERSION, presets };
}

export function encodePresets(file: PresetsFile): PresetsFile {
  return { schemaVersion: PRESETS_SCHEMA_VERSION, presets: file.presets.map((p) => ({ ...p, params: clone(p.params), adjustments: clone(p.adjustments) })) };
}

/** The patch an apply writes into the sidecar. */
export interface PresetPatch {
  params: FilmParams;
  adjustments: Adjustments;
}

export function patchFromPreset(preset: Preset): PresetPatch {
  return { params: clone(preset.params), adjustments: clone(preset.adjustments) };
}
