// presets-state.test.ts — save/apply/delete presets without a host.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADJUSTMENTS_DEFAULT } from '@shared/adjustments';
import { FILM_PARAMS_DEFAULT } from '@shared/params';

const writes: { area: string; name: string; value: unknown }[] = [];

const sidecar = {
  params: { ...FILM_PARAMS_DEFAULT, filmStock: 'kodak_portra_800' },
  adjustments: { ...ADJUSTMENTS_DEFAULT, contrast: 12 },
};

const setParams = vi.fn();
const setAdjustments = vi.fn();

vi.mock('../platform', () => ({
  platform: () => ({
    storeRead: async (area: string, name: string) => writes.find((w) => w.area === area && w.name === name)?.value ?? null,
    storeWrite: async (area: string, name: string, value: unknown) => {
      writes.push({ area, name, value });
    },
  }),
}));

vi.mock('./session', () => ({
  sessionStore: { getState: () => ({ sidecar }) },
  setParams: (fn: (p: typeof sidecar.params) => typeof sidecar.params) => {
    const next = fn(sidecar.params);
    setParams(next);
  },
  setAdjustments: (fn: (a: typeof sidecar.adjustments) => typeof sidecar.adjustments) => {
    const next = fn(sidecar.adjustments);
    setAdjustments(next);
  },
}));

import { applyPreset, bootPresets, deletePreset, presetsStore, saveCurrentPreset } from './presets';

describe('presets state', () => {
  beforeEach(() => {
    writes.length = 0;
    setParams.mockClear();
    setAdjustments.mockClear();
    presetsStore.setState({ presets: [], ready: false, error: null });
  });

  it('boots from the store and tolerates a missing entry', async () => {
    await bootPresets();
    expect(presetsStore.getState().ready).toBe(true);
    expect(presetsStore.getState().presets).toEqual([]);
  });

  it('saves the open photograph and persists the file', async () => {
    await bootPresets();
    const id = await saveCurrentPreset('Warm eight hundred');
    expect(id).toMatch(/^preset-/);
    expect(presetsStore.getState().presets[0]?.name).toBe('Warm eight hundred');
    const written = writes.filter((w) => w.area === 'Presets' && w.name === 'presets.json');
    expect(written.length).toBeGreaterThan(0);
    const value = written[written.length - 1]!.value as { presets: { id: string }[] };
    expect(value.presets[0]?.id).toBe(id);
  });

  it('applies a preset through the session setters', async () => {
    await bootPresets();
    const id = (await saveCurrentPreset('Look'))!;
    expect(applyPreset(id)).toBe(true);
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ filmStock: 'kodak_portra_800' }));
    expect(setAdjustments).toHaveBeenCalledWith(expect.objectContaining({ contrast: 12 }));
    expect(applyPreset('missing')).toBe(false);
  });

  it('deletes a preset and persists the removal', async () => {
    await bootPresets();
    const id = (await saveCurrentPreset('Temp'))!;
    await deletePreset(id);
    expect(presetsStore.getState().presets).toEqual([]);
    const value = writes[writes.length - 1]!.value as { presets: { id: string }[] };
    expect(value.presets).toEqual([]);
  });
});
