import { useRef, useState, type PointerEvent } from 'react';
import { clamp } from '@shared/params';
import type { LocalAdjustment } from '@shared/localAdjust';
import { setAdjustments } from '../state/session';

type Shape = Pick<LocalAdjustment, 'cx' | 'cy' | 'radius' | 'radiusY'>;
type Action = 'draw' | 'move' | 'width' | 'height';

export function RadialMaskOverlay({ layer, left, top, width, height }: {
  layer: LocalAdjustment; left: number; top: number; width: number; height: number;
}) {
  const drag = useRef<{ id: number; x: number; y: number; action: Action; original: Shape } | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const shape = draft ?? layer;
  const cx = shape.cx * width, cy = shape.cy * height;
  const rx = shape.radius * width, ry = (shape.radiusY ?? shape.radius * height / width) * height;
  const inner = 1 - layer.feather / 2;

  const point = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };
  const geometry = (event: PointerEvent<SVGSVGElement>): Shape | null => {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return null;
    const { x, y } = point(event);
    const { original, action } = gesture;
    if (action === 'move') return { ...original, cx: clamp(original.cx + x - gesture.x, -1, 2), cy: clamp(original.cy + y - gesture.y, -1, 2) };
    if (action === 'width') return { ...original, radius: clamp(Math.abs(x - original.cx), .02, 2),
      radiusY: original.radiusY ?? clamp(original.radius * height / width, .02, 2) };
    if (action === 'height') return { ...original, radiusY: clamp(Math.abs(y - original.cy), .02, 2) };
    if (Math.hypot((x - gesture.x) * width, (y - gesture.y) * height) < 3) return null;
    return { cx: gesture.x, cy: gesture.y, radius: clamp(Math.abs(x - gesture.x), .02, 2),
      radiusY: clamp(Math.abs(y - gesture.y), .02, 2) };
  };

  return <svg data-testid="radial-mask-overlay" aria-hidden="true"
    style={{ position: 'absolute', left, top, width, height, cursor: 'crosshair', touchAction: 'none' }}
    onPointerDown={(event) => {
      if (event.button !== 0 || drag.current) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const { x, y } = point(event);
      const action = (event.target as SVGElement).getAttribute('data-action') as Action | null;
      drag.current = { id: event.pointerId, x, y, action: action ?? 'draw',
        original: { cx: layer.cx, cy: layer.cy, radius: layer.radius, radiusY: layer.radiusY } };
    }}
    onPointerMove={(event) => { if (drag.current) { event.stopPropagation(); setDraft(geometry(event)); } }}
    onPointerUp={(event) => {
      if (drag.current?.id !== event.pointerId) return;
      event.stopPropagation();
      const next = geometry(event);
      drag.current = null;
      setDraft(null);
      if (next) setAdjustments((a) => ({ ...a, local: a.local?.map((l) => l.id === layer.id ? { ...l, ...next } : l) }));
    }}
    onLostPointerCapture={() => { drag.current = null; setDraft(null); }}>
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="#161616" strokeWidth={3} />
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="white" strokeWidth={1.2} />
    <ellipse cx={cx} cy={cy} rx={rx * inner} ry={ry * inner} fill="none" stroke="white" strokeDasharray="4 4" />
    <circle data-action="move" cx={cx} cy={cy} r={6} fill="white" stroke="#333" style={{ cursor: 'move' }} />
    <circle data-action="width" cx={cx + rx} cy={cy} r={5} fill="white" stroke="#333" style={{ cursor: 'ew-resize' }} />
    <circle data-action="height" cx={cx} cy={cy + ry} r={5} fill="white" stroke="#333" style={{ cursor: 'ns-resize' }} />
  </svg>;
}
