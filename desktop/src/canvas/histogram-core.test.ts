import { describe, expect, it } from 'vitest';
import { computeHistogram, histogramPeak, histogramStats, smoothBins } from './histogram-core';

const px = (values: number[]) => {
  const out = new Uint8Array(values.length * 4);
  values.forEach((v, i) => { out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255; });
  return out;
};

describe('histogram core', () => {
  it('counts RGB and luma bins', () => {
    const h = computeHistogram(px([0, 255, 128]));
    expect(h.r[0]).toBe(1); expect(h.g[255]).toBe(1); expect(h.b[128]).toBe(1);
    expect(h.y[0]).toBe(1); expect(h.y[255]).toBe(1);
  });

  it('reports mean and clipped shares', () => {
    const s = histogramStats(computeHistogram(px([0, 255, 255, 0])));
    expect(s.total).toBe(4);
    expect(s.clippedLow).toBeCloseTo(0.5);
    expect(s.clippedHigh).toBeCloseTo(0.5);
    expect(s.mean).toBeCloseTo(0.5, 6);
  });

  it('smooths bins without losing the edges', () => {
    const smooth = smoothBins(new Uint32Array([10, 0, 0, 0, 10]), 2);
    expect(smooth[0]).toBeGreaterThan(0);
    expect(smooth[1]).toBeGreaterThan(0);
    expect(smooth[4]).toBeGreaterThan(0);
  });

  it('caps the drawing at the 99.5th percentile so one spike cannot flatten the rest', () => {
    const bins = new Uint32Array(256).fill(1);
    bins[100] = 100000;
    expect(histogramPeak(bins)).toBe(1);
    // A histogram with many tall bins keeps a usable ceiling.
    const many = new Uint32Array(256).fill(1000);
    expect(histogramPeak(many)).toBe(1000);
  });
});
