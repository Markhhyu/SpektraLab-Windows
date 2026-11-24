// CurveEditor.tsx — `Controls/CurveEditor.swift`: click to add a point, drag
// to move it, double-click (or drag off the plot) to remove it. The output
// histogram sits behind the curve.
//
// It edits Layer 2's curves by default (`value`/`onChange` omitted). The Decode
// curve (Imaging path) reuses the same drawing with its own five curves and no
// histogram, so both curves are one component and one arithmetic.

import { useRef, useState } from 'react';
import { type Curve, type CurveChannel, evaluateCurve, insertPoint, movePoint, removePoint } from '@shared/adjustments';
import { beginGesture, setAdjustments, shownAdjustments, useSession } from '../state/session';
import { useOutput } from '../canvas/output';
import { computeHistogram } from '../canvas/histogram';
import { t } from '../i18n';

const S = 200;
const STROKE: Record<CurveChannel, string> = {
  rgb: 'var(--text)',
  luma: 'var(--hist-y)',
  red: 'var(--hist-r)',
  green: 'var(--hist-g)',
  blue: 'var(--hist-b)',
};

export function CurveEditor({ channel, value, onChange, histogram = true }: {
  channel: CurveChannel;
  /** Controlled mode: the curve to draw (the Decode curve's). Omit for Layer 2. */
  value?: Curve;
  onChange?: (c: Curve) => void;
  /** Draw the output histogram behind the plot (Layer 2 only). */
  histogram?: boolean;
}) {
  const sessionCurve = useSession((s) => shownAdjustments(s).curves[channel]);
  const curve = value ?? sessionCurve;
  const out = useOutput();
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const [readout, setReadout] = useState<string>('');

  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height };
  };
  const set = (fn: (c: Curve) => Curve) => {
    if (onChange) {
      onChange(fn(curve));
      return;
    }
    setAdjustments((a) => ({ ...a, curves: { ...a.curves, [channel]: fn(a.curves[channel]) } }));
  };

  const near = (p: { x: number; y: number }) => {
    let best = -1;
    let bd = 10 / S;
    curve.points.forEach(([x, y], i) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  let hist = '';
  if (out && histogram) {
    const h = computeHistogram(out.data);
    const bins = channel === 'red' ? h.r : channel === 'green' ? h.g : channel === 'blue' ? h.b : h.y;
    const peak = Math.max(1, ...Array.from(bins).sort((a, b) => a - b).slice(-3, -2));
    hist = `M0 ${S}` + Array.from(bins, (v, i) => ` L${(i / 255) * S} ${S - (Math.min(v, peak) / peak) * S * 0.9}`).join('') + ` L${S} ${S} Z`;
  }
  const line = Array.from({ length: 101 }, (_, i) => {
    const x = i / 100;
    return `${i ? 'L' : 'M'}${x * S} ${S - evaluateCurve(curve, x) * S}`;
  }).join(' ');

  return (
    <div>
      <svg
        ref={ref}
        className="plot"
        viewBox={`0 0 ${S} ${S}`}
        style={{ aspectRatio: '1', cursor: 'crosshair', touchAction: 'none' }}
        data-testid="curve-editor"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          const p = at(e);
          beginGesture();
          let i = near(p);
          if (i < 0) {
            const r = insertPoint(curve, p.x, p.y);
            set(() => r.curve);
            i = r.index;
          }
          drag.current = i;
        }}
        onPointerMove={(e) => {
          const p = at(e);
          setReadout(`${t('curveInput')}: ${Math.round(Math.min(Math.max(p.x, 0), 1) * 255)}  ${t('curveOutput')}: ${Math.round(evaluateCurve(curve, Math.min(Math.max(p.x, 0), 1)) * 255)}`);
          const i = drag.current;
          if (i == null) return;
          set((c) => movePoint(c, i, p.x, p.y));
        }}
        onPointerUp={(e) => {
          const p = at(e);
          const i = drag.current;
          drag.current = null;
          // Dragged well off the plot: the point goes.
          if (i != null && (p.y < -0.1 || p.y > 1.1)) set((c) => removePoint(c, i));
        }}
        onDoubleClick={(e) => {
          const i = near(at(e as unknown as React.PointerEvent));
          if (i >= 0) set((c) => removePoint(c, i));
        }}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} stroke="var(--plot-grid)" strokeWidth={0.5}>
            <line x1={g * S} y1={0} x2={g * S} y2={S} />
            <line x1={0} y1={g * S} x2={S} y2={g * S} />
          </g>
        ))}
        {hist && <path d={hist} fill={STROKE[channel]} fillOpacity={0.15} />}
        <line x1={0} y1={S} x2={S} y2={0} stroke="var(--plot-mid-grey)" strokeWidth={0.5} />
        <path d={line} fill="none" stroke={STROKE[channel]} strokeWidth={1.4} />
        {curve.points.map(([x, y], i) => (
          <circle key={i} cx={x * S} cy={S - y * S} r={3.5} fill="var(--card)" stroke={STROKE[channel]} strokeWidth={1.2} />
        ))}
      </svg>
      <div className="caption num">{readout || ' '}</div>
    </div>
  );
}
