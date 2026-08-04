import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { pointFromOverlayWithinRanges, pointToOverlay, type NumericRange } from "../ui/canvasControls";
import { overlayRectFromClientRects, sameOverlayRect, type OverlayRect } from "../ui/transform";
import "./PointHandles.css";

interface Props {
  point: { x: number; y: number };
  xRange: NumericRange;
  yRange: NumericRange;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  label: string;
  disabled?: boolean;
  onChange: (point: { x: number; y: number }) => void;
  onCommit: () => void;
}

const STEP = 0.005;
const LARGE_STEP = 0.05;

export function PointHandles({ point, xRange, yRange, canvasRef, label, disabled = false, onChange, onCommit }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<OverlayRect | null>(null);
  const dragging = useRef(false);
  const grab = useRef({ x: 0, y: 0 });
  const nudging = useRef(false);

  const measure = useCallback(() => {
    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    const parent = overlay?.offsetParent;
    if (!overlay || !canvas || !parent) return;
    const next = overlayRectFromClientRects(canvas.getBoundingClientRect(), parent.getBoundingClientRect());
    setRect((previous) => previous && sameOverlayRect(previous, next) ? previous : next);
  }, [canvasRef]);

  useLayoutEffect(() => { measure(); });
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = overlayRef.current?.offsetParent;
    if (!canvas || !parent) return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [canvasRef, measure]);

  const toOverlay = useCallback((clientX: number, clientY: number) => {
    const parent = overlayRef.current?.offsetParent?.getBoundingClientRect();
    return parent ? { x: clientX - parent.left, y: clientY - parent.top } : null;
  }, []);

  if (!rect) return <div ref={overlayRef} className="point-handles" />;
  const drawn = pointToOverlay(point, rect);

  const updateFromPointer = (event: React.PointerEvent) => {
    if (!dragging.current) return;
    const position = toOverlay(event.clientX, event.clientY);
    if (!position) return;
    onChange(pointFromOverlayWithinRanges(position.x - grab.current.x, position.y - grab.current.y, rect, xRange, yRange));
  };

  return <div ref={overlayRef} className="point-handles" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
    <button type="button" className="point-handles__handle"
      disabled={disabled}
      style={{ left: drawn.x - rect.left, top: drawn.y - rect.top }}
      aria-label={`${label} — position. Flèches pour déplacer, Maj pour un pas large.`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const position = toOverlay(event.clientX, event.clientY);
        if (!position) return;
        event.stopPropagation();
        dragging.current = true;
        grab.current = { x: position.x - drawn.x, y: position.y - drawn.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={updateFromPointer}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        onCommit();
      }}
      onPointerCancel={() => { dragging.current = false; }}
      onKeyDown={(event) => {
        const amount = event.shiftKey ? LARGE_STEP : STEP;
        const delta = event.key === "ArrowLeft" ? { x: -amount, y: 0 }
          : event.key === "ArrowRight" ? { x: amount, y: 0 }
          : event.key === "ArrowUp" ? { x: 0, y: -amount }
          : event.key === "ArrowDown" ? { x: 0, y: amount }
          : null;
        if (!delta) return;
        event.preventDefault();
        nudging.current = true;
        onChange({
          x: Math.min(xRange.max, Math.max(xRange.min, point.x + delta.x)),
          y: Math.min(yRange.max, Math.max(yRange.min, point.y + delta.y)),
        });
      }}
      onKeyUp={() => { if (nudging.current) { nudging.current = false; onCommit(); } }} />
  </div>;
}
