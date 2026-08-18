import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { axisFromOverlay, axisToOverlay } from "../ui/canvasControls";
import { overlayRectFromClientRects, sameOverlayRect, type OverlayRect } from "../ui/transform";
import "./AxisHandles.css";

interface Props {
  angle: number; length: number; lengthRange: { min: number; max: number };
  imageSize: { width: number; height: number };
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  label: string;
  disabled?: boolean;
  onChange: (angle: number, length: number) => void;
  onCommit: () => void;
}

export function AxisHandles({ angle, length, lengthRange, imageSize, canvasRef, label, disabled = false, onChange, onCommit }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<OverlayRect | null>(null);
  const dragging = useRef(false);
  const nudging = useRef(false);
  const measure = useCallback(() => {
    const overlay = overlayRef.current, canvas = canvasRef.current, parent = overlay?.offsetParent;
    if (!overlay || !canvas || !parent) return;
    const next = overlayRectFromClientRects(canvas.getBoundingClientRect(), parent.getBoundingClientRect());
    setRect((previous) => previous && sameOverlayRect(previous, next) ? previous : next);
  }, [canvasRef]);
  useLayoutEffect(() => { measure(); });
  useEffect(() => {
    const canvas = canvasRef.current, parent = overlayRef.current?.offsetParent;
    if (!canvas || !parent) return;
    const observer = new ResizeObserver(measure); observer.observe(canvas); observer.observe(parent);
    return () => observer.disconnect();
  }, [canvasRef, measure]);
  const move = useCallback((event: React.PointerEvent) => {
    if (!dragging.current || !rect) return;
    const parent = overlayRef.current?.offsetParent?.getBoundingClientRect(); if (!parent) return;
    const next = axisFromOverlay(event.clientX - parent.left, event.clientY - parent.top, imageSize, rect, lengthRange.min, lengthRange.max);
    onChange(next.angle, next.length);
  }, [rect, imageSize, lengthRange, onChange]);
  const end = useCallback((event: React.PointerEvent) => {
    if (!dragging.current) return; dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit();
  }, [onCommit]);
  if (!rect) return <div ref={overlayRef} className="axis-handles" />;
  const drawn = axisToOverlay(angle, length, imageSize, rect);
  return <div ref={overlayRef} className="axis-handles" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
    <svg className="axis-handles__svg" width={rect.width} height={rect.height} aria-hidden="true">
      <line className="axis-handles__halo" x1={drawn.cx - rect.left} y1={drawn.cy - rect.top} x2={drawn.x - rect.left} y2={drawn.y - rect.top} />
      <line className="axis-handles__line" x1={drawn.cx - rect.left} y1={drawn.cy - rect.top} x2={drawn.x - rect.left} y2={drawn.y - rect.top} />
    </svg>
    <button type="button" className="canvas-handle axis-handles__end" style={{ left: drawn.x - rect.left, top: drawn.y - rect.top }}
      disabled={disabled}
      aria-label={`${label} — direction et longueur`}
      onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={() => { dragging.current = false; }}
      onKeyDown={(event) => {
        const large = event.shiftKey ? 10 : 1;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") onChange(angle + (event.key === "ArrowLeft" ? -large : large), length);
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") onChange(angle, Math.min(lengthRange.max, Math.max(lengthRange.min, length + (event.key === "ArrowDown" ? -large : large))));
        else return;
        event.preventDefault(); nudging.current = true;
      }}
      onKeyUp={() => { if (nudging.current) { nudging.current = false; onCommit(); } }} />
  </div>;
}
