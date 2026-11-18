// Local adjustments: mask shape, tolerant decode and clamping.

import { describe, expect, it } from 'vitest';
import {
  createLocalAdjustment,
  decodeLocalAdjustments,
  LOCAL_GRADE_DEFAULT,
  maskWeight,
} from '../shared/localAdjust';

describe('local adjustments', () => {
  it('creates a neutral layer of each kind', () => {
    const linear = createLocalAdjustment('linear');
    const radial = createLocalAdjustment('radial');
    expect(linear.kind).toBe('linear');
    expect(linear.id).not.toBe(radial.id);
    for (const key of Object.keys(LOCAL_GRADE_DEFAULT) as (keyof typeof LOCAL_GRADE_DEFAULT)[]) {
      expect(linear[key]).toBe(0);
      expect(radial[key]).toBe(0);
    }
    expect(linear.invert).toBe(false);
  });

  it('ramps a linear gradient along its axis and stays inside the frame', () => {
    const a = { ...createLocalAdjustment('linear'), x0: 0.25, y0: 0.5, x1: 0.75, y1: 0.5, feather: 0 };
    expect(maskWeight(a, 0.2, 0.5)).toBe(0);
    expect(maskWeight(a, 0.5, 0.5)).toBeCloseTo(0.5, 1);
    expect(maskWeight(a, 0.8, 0.5)).toBe(1);
    // Perpendicular distance does not matter for a linear gradient.
    expect(maskWeight(a, 0.8, 0.05)).toBe(1);
  });

  it('feathers the radial mask edge and honours the frame aspect', () => {
    const a = { ...createLocalAdjustment('radial'), cx: 0.5, cy: 0.5, radius: 0.25, feather: 0.1 };
    expect(maskWeight(a, 0.5, 0.5)).toBe(1);
    expect(maskWeight(a, 0.9, 0.5)).toBe(0);
    // A point 0.25 of the frame height away is inside a circular mask, but
    // outside once the aspect ratio stretches it.
    expect(maskWeight(a, 0.5, 0.75, 1)).toBeLessThan(0.2);
  });

  it('inverts the mask without changing its edge', () => {
    const a = createLocalAdjustment('radial');
    expect(maskWeight({ ...a, invert: true }, 0.5, 0.5)).toBe(0);
    expect(maskWeight({ ...a, invert: true }, 0.99, 0.99)).toBe(1);
  });

  it('decodes sidecars tolerantly and clamps out-of-range values', () => {
    const decoded = decodeLocalAdjustments([
      { kind: 'radial', radius: 99, exposure: 12, feather: -3, invert: true },
      { kind: 'bogus' },
      null,
      { kind: 'linear', x0: 'nope' },
    ]);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]!.radius).toBe(2);
    expect(decoded[0]!.exposure).toBe(4);
    expect(decoded[0]!.feather).toBe(0);
    expect(decoded[1]!.kind).toBe('linear');
    expect(decoded[1]!.x0).toBe(0.5);
    expect(decodeLocalAdjustments(undefined)).toEqual([]);
    expect(decodeLocalAdjustments('nope')).toEqual([]);
  });
});
