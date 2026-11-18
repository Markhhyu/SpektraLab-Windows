// histogram.ts — counts of the *output* (the canvas's frame: geometry and
// Layer 2 applied — AGENTS.md trap 33), off the main thread.

import { createElement } from 'react';

import { computeHistogram, histogramPeak, histogramStats, smoothBins, type Histogram } from './histogram-core';

export { computeHistogram, type Histogram };

let worker: Worker | null = null;
let workerFailed = false;
let seq = 0;
// Each request keeps its own pixels, so a worker that dies can still be answered.
const waiting = new Map<number, { px: Uint8Array; resolve: (h: Histogram) => void }>();

/** The worker failed to load or crashed: answer everything inline from now on. */
function abandonWorker() {
  workerFailed = true;
  worker?.terminate();
  worker = null;
  for (const { px, resolve } of waiting.values()) resolve(computeHistogram(px));
  waiting.clear();
}

/** In a Web Worker when one can be started; inline otherwise. */
export function histogramOf(px: Uint8Array): Promise<Histogram> {
  if (workerFailed) return Promise.resolve(computeHistogram(px));
  try {
    if (!worker) {
      worker = new Worker(new URL('./histogram.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; h: Histogram }>) => {
        waiting.get(e.data.id)?.resolve(e.data.h);
        waiting.delete(e.data.id);
      };
      worker.onerror = abandonWorker;
      worker.onmessageerror = abandonWorker;
    }
    const id = ++seq;
    return new Promise((resolve) => {
      waiting.set(id, { px, resolve });
      const copy = px.slice();
      worker!.postMessage({ id, px: copy }, [copy.buffer]);
    });
  } catch {
    abandonWorker();
    return Promise.resolve(computeHistogram(px));
  }
}

function smoothPath(bins: Uint32Array, peak: number, w: number, h: number, pad = 2): string {
  const values = smoothBins(bins, 2);
  let d = `M0 ${h}`;
  for (let i = 0; i < w; i++) {
    const v = values[Math.round((i / Math.max(1, w - 1)) * (values.length - 1))] ?? 0;
    const y = h - (Math.min(v, peak) / peak) * (h - pad);
    d += ` L${i.toFixed(1)} ${y.toFixed(2)}`;
  }
  return d + ` L${w} ${h} Z`;
}

function edgePath(bins: Uint32Array, peak: number, w: number, h: number): string {
  const values = smoothBins(bins, 2);
  let d = '';
  for (let i = 0; i < w; i++) {
    const v = values[Math.round((i / Math.max(1, w - 1)) * (values.length - 1))] ?? 0;
    const y = h - (Math.min(v, peak) / peak) * (h - 2);
    d += (i === 0 ? 'M' : ' L') + `${i.toFixed(1)} ${y.toFixed(2)}`;
  }
  return d;
}

export function HistogramOverlay({ h, width = 176, height = 58 }: { h: Histogram; width?: number; height?: number }) {
  const peak = histogramPeak([...h.r, ...h.g, ...h.b], 0.995);
  const stats = histogramStats(h);
  const grid = [0.25, 0.5, 0.75];
  const axisY = height - 0.5;
  return createElement(
    'svg',
    { className: 'histogram', width, height, viewBox: `0 0 ${width} ${height}`, 'data-testid': 'histogram' },
    grid.map((f) => createElement('line', {
      key: f, className: 'hist-grid', x1: f * width, x2: f * width, y1: 0, y2: axisY,
    })),
    createElement('line', { className: 'hist-axis', x1: 0, x2: width, y1: axisY, y2: axisY }),
    createElement('path', { d: smoothPath(h.y, peak, width, height), fill: 'var(--hist-y)', fillOpacity: 0.5, className: 'hist-luma' }),
    createElement('path', { d: smoothPath(h.r, peak, width, height), fill: 'var(--hist-r)', fillOpacity: 0.4, className: 'hist-channel' }),
    createElement('path', { d: smoothPath(h.g, peak, width, height), fill: 'var(--hist-g)', fillOpacity: 0.4, className: 'hist-channel' }),
    createElement('path', { d: smoothPath(h.b, peak, width, height), fill: 'var(--hist-b)', fillOpacity: 0.4, className: 'hist-channel' }),
    createElement('path', { d: edgePath(h.y, peak, width, height), fill: 'none', stroke: 'var(--hist-y)', strokeOpacity: 0.9, strokeWidth: 1 }),
    stats.clippedLow > 0.0005 && createElement('path', { className: 'hist-clip', d: 'M0 0 L7 0 L0 7 Z' }),
    stats.clippedHigh > 0.0005 && createElement('path', { className: 'hist-clip', d: `M${width} 0 L${width - 7} 0 L${width} 7 Z` }),
  );
}
