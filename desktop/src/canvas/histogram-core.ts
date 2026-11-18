// histogram-core.ts — the counting itself, with no UI imports, so the Web
// Worker that runs it loads nothing but this file (a worker importing React
// through histogram.ts failed to start on a cold Vite dev server, and the
// histogram then never appeared).

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  y: Uint32Array;
}

export function computeHistogram(px: Uint8Array): Histogram {
  const h = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), y: new Uint32Array(256) };
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]!;
    const g = px[i + 1]!;
    const b = px[i + 2]!;
    h.r[r]!++;
    h.g[g]!++;
    h.b[b]!++;
    h.y[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]!++;
  }
  return h;
}

/** A moving average over the bins, so a 256-segment curve reads as a shape
 *  rather than a picket fence. The edges are weighted by what is actually
 *  there instead of being pulled to zero by missing neighbours. */
export function smoothBins(bins: Uint32Array, radius = 2): number[] {
  const n = bins.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(n - 1, i + radius); j++) {
      sum += bins[j]!;
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/** The ceiling the drawing uses: the 99.5th percentile bin, so a single spike
 *  does not flatten everything else. */
export function histogramPeak(values: Iterable<number>, quantile = 0.995): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 1;
  return Math.max(1, sorted[Math.floor(sorted.length * quantile)] ?? 1);
}

export interface HistogramStats {
  mean: number;
  clippedLow: number;
  clippedHigh: number;
  total: number;
}

/** Mean luma (0..1) and the share of pixels pinned at either end. */
export function histogramStats(h: Histogram): HistogramStats {
  const total = h.y.reduce((a, b) => a + b, 0);
  if (!total) return { mean: 0, clippedLow: 0, clippedHigh: 0, total: 0 };
  let weighted = 0;
  for (let i = 0; i < h.y.length; i++) weighted += i * h.y[i]!;
  return {
    mean: weighted / total / 255,
    clippedLow: (h.y[0] ?? 0) / total,
    clippedHigh: (h.y[h.y.length - 1] ?? 0) / total,
    total,
  };
}
