// presets.test.ts — create, encode/decode round trip and tolerance.

import { describe, expect, it } from 'vitest';
import { ADJUSTMENTS_DEFAULT } from './adjustments';
import { FILM_PARAMS_DEFAULT } from './params';
import {
  EMPTY_PRESETS,
  PRESETS_SCHEMA_VERSION,
  createPreset,
  decodePresets,
  encodePresets,
  patchFromPreset,
  presetId,
} from './presets';

describe('presets', () => {
  it('creates a deep copy of the live settings', () => {
    const params = { ...FILM_PARAMS_DEFAULT, filmStock: 'kodak_portra_800' };
    const adjustments = { ...ADJUSTMENTS_DEFAULT, contrast: 12 };
    const preset = createPreset('Warm street', params, adjustments, 1000);
    expect(preset.name).toBe('Warm street');
    expect(preset.id).toMatch(/^preset-/);
    params.filmStock = 'velvia_100';
    adjustments.contrast = 0;
    expect(preset.params.filmStock).toBe('kodak_portra_800');
    expect(preset.adjustments.contrast).toBe(12);
  });

  it('round-trips through the store encoding', () => {
    const preset = createPreset('Look', FILM_PARAMS_DEFAULT, ADJUSTMENTS_DEFAULT, 1000);
    const file = encodePresets({ schemaVersion: PRESETS_SCHEMA_VERSION, presets: [preset] });
    const decoded = decodePresets(JSON.parse(JSON.stringify(file)));
    expect(decoded.presets).toHaveLength(1);
    expect(decoded.presets[0]).toEqual(preset);
  });

  it('decodes tolerantly', () => {
    expect(decodePresets(null).presets).toEqual([]);
    expect(decodePresets({ presets: 'nope' }).presets).toEqual([]);
    const good = createPreset('One', FILM_PARAMS_DEFAULT, ADJUSTMENTS_DEFAULT, 1);
    const decoded = decodePresets({ presets: [good, { id: good.id, name: 'dupe' }, null, { id: 'x' }, { ...good, id: 'two', name: 42 }] });
    expect(decoded.presets.map((p) => p.id)).toEqual([good.id]);
  });

  it('exposes a detached patch and deterministic ids', () => {
    const preset = createPreset('P', FILM_PARAMS_DEFAULT, ADJUSTMENTS_DEFAULT, 1);
    const patch = patchFromPreset(preset);
    patch.params.filmStock = 'changed';
    expect(preset.params.filmStock).toBe(FILM_PARAMS_DEFAULT.filmStock);
    expect(presetId(1, 0.5)).toBe(presetId(1, 0.5));
    expect(EMPTY_PRESETS.presets).toEqual([]);
  });
});
