import { useCallback, useRef } from "react";
import type { LayerTransform } from "../layers/types";
import { computeHandleGeometry, scaleFromCornerDrag, rotationFromPointer } from "../ui/transform";
import "./TransformHandles.css";

interface Props {
  transform: LayerTransform;
  photoSize: { width: number; height: number };
  bgSize: { width: number; height: number };
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onTransformChange: (transform: LayerTransform) => void;
  onTransformCommit: () => void;
}

type DragKind = { kind: "corner" } | { kind: "rotate" } | { kind: "move"; startX: number; startY: number; originTransform: LayerTransform };

/**
 * Overlay de poignées type Photoshop pour un calque de photo (double
 * exposure) : 4 coins pour l'échelle uniforme, 1 poignée dédiée pour la
 * rotation, corps de la box pour déplacer. Même famille de gestion pointer
 * que `MaskPainter`/le pan-zoom existants (`pointerdown`/`pointermove`/
 * `pointerup` + `setPointerCapture`) — toute la géométrie vit dans
 * `ui/transform.ts`, ce composant ne fait que traduire écran<->pixels du
 * fond et déléguer.
 */
export function TransformHandles({ transform, photoSize, bgSize, canvasRef, onTransformChange, onTransformCommit }: Props) {
  const dragRef = useRef<DragKind | null>(null);

  const screenToImagePixels = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    },
    [canvasRef],
  );

  const { corners, rotationHandle } = computeHandleGeometry(transform, photoSize);
  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxX = Math.max(...corners.map((c) => c.x));
  const maxY = Math.max(...corners.map((c) => c.y));

  function toScreenStyle(point: { x: number; y: number }): React.CSSProperties {
    // Positionnement en % du canvas (le canvas est affiché réduit via
    // max-width/height 100%, même principe que le curseur pinceau) — évite
    // de recalculer un pixel-ratio à chaque render, se redimensionne seul
    // avec le canvas.
    return {
      left: `${(point.x / bgSize.width) * 100}%`,
      top: `${(point.y / bgSize.height) * 100}%`,
    };
  }

  function handlePointerDown(e: React.PointerEvent, kind: DragKind) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = kind;
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const pointer = screenToImagePixels(e.clientX, e.clientY);
    if (!pointer) return;
    if (drag.kind === "corner") {
      const scale = scaleFromCornerDrag(transform, photoSize, pointer);
      onTransformChange({ ...transform, scale });
    } else if (drag.kind === "rotate") {
      const rotation = rotationFromPointer(transform, pointer);
      onTransformChange({ ...transform, rotation });
    } else {
      const dx = pointer.x - drag.startX;
      const dy = pointer.y - drag.startY;
      onTransformChange({ ...drag.originTransform, x: drag.originTransform.x + dx, y: drag.originTransform.y + dy });
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    onTransformCommit();
  }

  return (
    <div className="transform-handles">
      <div
        className="transform-handles__box"
        style={{
          left: `${(minX / bgSize.width) * 100}%`,
          top: `${(minY / bgSize.height) * 100}%`,
          width: `${((maxX - minX) / bgSize.width) * 100}%`,
          height: `${((maxY - minY) / bgSize.height) * 100}%`,
          pointerEvents: "auto",
          cursor: "move",
        }}
        onPointerDown={(e) => handlePointerDown(e, { kind: "move", startX: screenToImagePixels(e.clientX, e.clientY)?.x ?? 0, startY: screenToImagePixels(e.clientX, e.clientY)?.y ?? 0, originTransform: transform })}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {corners.map((corner, i) => (
        <div
          key={i}
          className="transform-handles__corner"
          style={toScreenStyle(corner)}
          onPointerDown={(e) => handlePointerDown(e, { kind: "corner" })}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      ))}
      <div
        className="transform-handles__rotation"
        style={toScreenStyle(rotationHandle)}
        onPointerDown={(e) => handlePointerDown(e, { kind: "rotate" })}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}
