import { forwardRef, useRef } from "react";

interface Props {
  onFileDropped: (file: File) => void;
  maskPaintMode: boolean;
  onMaskStroke: (x: number, y: number) => void;
  onStrokeEnd: () => void;
}

export const Canvas = forwardRef<HTMLCanvasElement, Props>(function Canvas(
  { onFileDropped, maskPaintMode, onMaskStroke, onStrokeEnd },
  ref
) {
  const isPaintingRef = useRef(false);

  // Coalesce mask painting to one paint+render per animation frame.
  //
  // A real mouse drag fires `pointermove` far more often than the display can
  // usefully repaint (matching mouse-polling rate, easily 100+ events/sec on
  // Windows). `handleMaskStroke` does a full-resolution mask clone
  // (`LayerStack.clone`/`updateMask`) plus a synchronous full GPU re-render on
  // every call — driving that per raw pointermove event stalls the main
  // thread solid for the duration of the stroke (confirmed: a real fast drag
  // froze the UI, while slow/sparse synthetic pointer events never triggered
  // it). Only the latest sample within a frame matters visually, so buffer it
  // in a ref and flush at most once per rAF tick instead of once per event.
  //
  // This is a scoped mitigation, not the full fix: the real fix (GPU-resident
  // masks, no per-sample full clone) is already tracked as a separate,
  // larger remediation task in
  // docs/superpowers/changes/2026-07-13-archi-remediation/design.md.
  // Note: App.tsx's requestRender() adds a second rAF hop on top of this one;
  // see the note in handleMaskStroke for details.
  const pendingPointRef = useRef<{ x: number; y: number } | null>(null);
  const rafHandleRef = useRef<number | null>(null);

  function toImageCoords(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = (ref as React.RefObject<HTMLCanvasElement>).current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function flushPendingPoint() {
    rafHandleRef.current = null;
    const pt = pendingPointRef.current;
    pendingPointRef.current = null;
    if (pt) onMaskStroke(pt.x, pt.y);
  }

  function schedulePaint(x: number, y: number) {
    pendingPointRef.current = { x, y };
    if (rafHandleRef.current === null) {
      rafHandleRef.current = requestAnimationFrame(flushPendingPoint);
    }
  }

  function endStroke() {
    if (isPaintingRef.current) {
      isPaintingRef.current = false;
      // Flush any coalesced sample so the stroke's last position is painted
      // before it's committed to history, then stop coalescing.
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        flushPendingPoint();
      }
      onStrokeEnd();
    }
  }

  return (
    <div
      className="canvas-stage"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) onFileDropped(file);
      }}
    >
      <canvas
        ref={ref}
        aria-label="Zone de travail image"
        className={`canvas-stage__canvas ${maskPaintMode ? "canvas-stage__canvas--paint" : ""}`.trim()}
        onPointerDown={(e) => {
          if (!maskPaintMode) return;
          isPaintingRef.current = true;
          const pt = toImageCoords(e);
          // The stroke's first point paints immediately (no coalescing) so
          // there's no visible input lag on press.
          if (pt) onMaskStroke(pt.x, pt.y);
        }}
        onPointerMove={(e) => {
          if (!maskPaintMode || !isPaintingRef.current) return;
          const pt = toImageCoords(e);
          if (pt) schedulePaint(pt.x, pt.y);
        }}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
      />
    </div>
  );
});
