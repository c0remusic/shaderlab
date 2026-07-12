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

  function toImageCoords(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = (ref as React.RefObject<HTMLCanvasElement>).current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function endStroke() {
    if (isPaintingRef.current) {
      isPaintingRef.current = false;
      onStrokeEnd();
    }
  }

  return (
    <div
      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#111", color: "#e8e8e8" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) onFileDropped(file);
      }}
    >
      <canvas
        ref={ref}
        style={{ maxWidth: "100%", maxHeight: "100%", cursor: maskPaintMode ? "crosshair" : "default" }}
        onPointerDown={(e) => {
          if (!maskPaintMode) return;
          isPaintingRef.current = true;
          const pt = toImageCoords(e);
          if (pt) onMaskStroke(pt.x, pt.y);
        }}
        onPointerMove={(e) => {
          if (!maskPaintMode || !isPaintingRef.current) return;
          const pt = toImageCoords(e);
          if (pt) onMaskStroke(pt.x, pt.y);
        }}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
      />
    </div>
  );
});
