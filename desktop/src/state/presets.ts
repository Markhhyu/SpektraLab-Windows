// presets.ts (state) — saved looks: one JSON store entry, applied like an edit.
//
// A preset holds the film parameters and the adjustment layers of the photograph
// it was saved from. Saving reads the open photograph; applying writes those two
// groups through the normal setters, so undo, sidecar saving, and the print
// request all run exactly as they do for a manual edit.

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import {
  type Preset,
  type PresetsFile,
  PRESETS_SCHEMA_VERSION,
  PRESETS_STORE_AREA,
  PRESETS_STORE_NAME,
  createPreset,
  decodePresets,
  encodePresets,
  patchFromPreset,
} from '@shared/presets';
import { platform } from '../platform';
import { sessionStore, setAdjustments, setParams } from './session';

interface PresetsState {
  presets: Preset[];
  ready: boolean;
  error: string | null;
}

const INITIAL: PresetsState = { presets: [], ready: false, error: null };

const store = createStore<PresetsState>(() => INITIAL);
const get = store.getState;

export const presetsStore = store;
export const usePresets = <T,>(sel: (s: PresetsState) => T): T => useStore(store, sel);

const set = store.setState;
let saveQueue: Promise<void> = Promise.resolve();

function persist(): Promise<void> {
  const presets = get().presets;
  saveQueue = saveQueue
    .then(() => platform().storeWrite(PRESETS_STORE_AREA, PRESETS_STORE_NAME, encodePresets({ schemaVersion: PRESETS_SCHEMA_VERSION, presets })))
    .catch((e: unknown) => set({ error: `Could not save presets: ${String(e)}` }));
  return saveQueue;
}

/** Load the saved presets once at startup. */
export async function bootPresets(): Promise<void> {
  try {
    const raw = await platform().storeRead(PRESETS_STORE_AREA, PRESETS_STORE_NAME).catch(() => null);
    const file: PresetsFile = decodePresets(raw);
    set({ presets: file.presets, ready: true });
  } catch (e) {
    set({ ready: true, error: `Could not load presets: ${String(e)}` });
  }
}

/** Save the open photograph's settings as a new preset and return its id. */
export async function saveCurrentPreset(name: string): Promise<string | null> {
  const sidecar = sessionStore.getState().sidecar;
  if (!sidecar) {
    set({ error: 'Open a photograph before saving a preset.' });
    return null;
  }
  const preset = createPreset(name, sidecar.params, sidecar.adjustments);
  set({ presets: [preset, ...get().presets], error: null });
  await persist();
  return preset.id;
}

/** Apply a preset to the open photograph (undoable, saved in its sidecar). */
export function applyPreset(id: string): boolean {
  const preset = get().presets.find((p) => p.id === id);
  if (!preset) return false;
  if (!sessionStore.getState().sidecar) {
    set({ error: 'Open a photograph before applying a preset.' });
    return false;
  }
  const patch = patchFromPreset(preset);
  setParams(() => patch.params);
  setAdjustments(() => patch.adjustments);
  return true;
}

export async function deletePreset(id: string): Promise<void> {
  set({ presets: get().presets.filter((p) => p.id !== id), error: null });
  await persist();
}

export async function renamePreset(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  set({ presets: get().presets.map((p) => (p.id === id ? { ...p, name: trimmed } : p)), error: null });
  await persist();
}

export function clearPresetError(): void {
  set({ error: null });
}
