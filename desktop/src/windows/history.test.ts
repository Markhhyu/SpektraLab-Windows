// history.test.ts — the wording of the Ctrl+H list. Pure function, no store.

import { describe, expect, it } from 'vitest';
import { ADJUSTMENTS_DEFAULT } from '../shared/adjustments';
import { FILM_PARAMS_DEFAULT } from '../shared/params';
import { GEOMETRY_DEFAULT } from '../shared/geometry';
import { DECODE_DEFAULT } from '../shared/sidecar';
import { describeChange } from './history';

const stockName = (id: string) => (id === 'kodak_portra_400' ? 'Kodak Portra 400' : id);

function snap(over: Record<string, unknown> = {}) {
  return {
    noFilm: false,
    params: { ...FILM_PARAMS_DEFAULT },
    adjustments: { ...ADJUSTMENTS_DEFAULT },
    geometry: { ...GEOMETRY_DEFAULT },
    decode: { ...DECODE_DEFAULT },
    ...over,
  };
}

describe('describeChange', () => {
  it('labels the first snapshot and stock changes', () => {
    expect(describeChange(null, snap(), stockName)).toMatch(/Initial state|初始状态/);
    expect(describeChange(snap(), snap({ params: { ...FILM_PARAMS_DEFAULT, filmStock: 'kodak_portra_800' } }), stockName)).toContain('kodak_portra_800');
  });

  it('labels exposure and adjustment edits with values', () => {
    const before = snap();
    const after = snap({ params: { ...FILM_PARAMS_DEFAULT, exposureCompensationEV: 0.5 } });
    expect(describeChange(before, after, stockName)).toMatch(/Exposure compensation|曝光补偿/);
    const adj = snap({ adjustments: { ...ADJUSTMENTS_DEFAULT, contrast: 12 } });
    expect(describeChange(before, adj, stockName)).toMatch(/Contrast|对比度/);
  });

  it('labels crops and white balance', () => {
    const before = snap();
    const crop = snap({ geometry: { ...GEOMETRY_DEFAULT, crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } } });
    expect(describeChange(before, crop, stockName)).toMatch(/Crop|裁剪/);
    const wb = snap({ decode: { ...DECODE_DEFAULT, whiteBalance: 'Daylight', temperature: 5500 } });
    expect(describeChange(before, wb, stockName)).toMatch(/White balance|白平衡/);
  });

  it('falls back to a generic edit label', () => {
    const before = snap();
    const after = snap();
    expect(describeChange(before, after, stockName)).toMatch(/Edit|编辑/);
  });
});
