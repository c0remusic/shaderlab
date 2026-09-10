import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CROP_HANDLES,
  effectiveCropRatio,
  moveCropRect,
  resizeCropRect,
  type CropRatioId,
  type CropRect,
} from "../ui/cropTool";
import { overlayRectFromClientRects, sameOverlayRect, type OverlayRect } from "../ui/transform";
import type { StretchHandle } from "../ui/effectStretch";
import "./CropOverlay.css";

interface Props {
  /** Rectangle de recadrage en pixels de la toile d'ORIGINE. */
  rect: CropRect;
  imageSize: { width: number; height: number };
  ratio: CropRatioId;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Pendant le geste (glisser une poignée ou l'intérieur) : nouveau rectangle. */
  onChange: (rect: CropRect) => void;
  /** Double-clic dans le cadre : valide le recadrage (équivalent d'Entrée). */
  onValidate: () => void;
}

interface Drag {
  pointerId: number;
  clientX: number;
  clientY: number;
  start: CropRect;
  handle: StretchHandle | null; // null = déplacement de l'intérieur
}

/**
 * OVERLAY DE L'OUTIL RECADRER (ticket 32, tranche B).
 *
 * L'image ENTIÈRE est montrée (le renderer reçoit `setCadre(null)` tant que
 * l'outil est ouvert), donc cet overlay travaille en espace d'ORIGINE : il se
 * cale sur le rectangle affiché du canvas — qui couvre alors toute la toile —
 * comme les autres manipulateurs, ASSOMBRIT le hors-cadre (SVG, pas un shader —
 * un shader supposerait une passe de rendu pour un voile d'interface), et pose
 * huit poignées (`CROP_HANDLES`, la table partagée) plus une surface intérieure
 * de déplacement. Toute la géométrie (contrainte de ratio, bornes) vit dans
 * `ui/cropTool.ts` ; ce composant mesure, cumule un delta depuis l'appui et
 * délègue.
 *
 * `Maj` contraint au ratio choisi (`effectiveCropRatio`) et se lit À CHAQUE
 * mouvement, comme le carré du tracé de forme : on presse et relâche Maj en
 * cours de geste.
 */
export function CropOverlay({ rect, imageSize, ratio, canvasRef, onChange, onValidate }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<OverlayRect | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const measure = useCallback(() => {
    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    const parent = overlay?.offsetParent;
    if (!overlay || !canvas || !parent) return;
    const next = overlayRectFromClientRects(canvas.getBoundingClientRect(), parent.getBoundingClientRect());
    setBox((previous) => (previous && sameOverlayRect(previous, next) ? previous : next));
  }, [canvasRef]);

  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = overlayRef.current?.offsetParent;
    if (!canvas || !parent) return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [canvasRef, measure]);

  const handleMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !box) return;
      // Delta écran → delta en pixels de toile (le canvas montre toute la toile
      // pendant l'outil, donc le rect mesuré couvre `imageSize` pixels).
      const dx = ((event.clientX - drag.clientX) / box.width) * imageSize.width;
      const dy = ((event.clientY - drag.clientY) / box.height) * imageSize.height;
      if (drag.handle === null) {
        onChange(moveCropRect(drag.start, dx, dy, imageSize));
      } else {
        const r = effectiveCropRatio(ratio, imageSize, event.shiftKey);
        onChange(resizeCropRect(drag.start, drag.handle, dx, dy, r, imageSize));
      }
    },
    [box, imageSize, ratio, onChange],
  );

  // Non curryfié : `onPointerDown={(e) => handleDown(e, h)}` crée une closure
  // mais ne l'appelle pas pendant le rendu — un `startDrag(h)` appelé dans le JSX
  // accéderait à une ref pendant le rendu (règle `react-hooks/refs`).
  const handleDown = (event: React.PointerEvent, handle: StretchHandle | null) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, start: rect, handle };
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if ((event.currentTarget as Element).hasPointerCapture(event.pointerId)) {
      (event.currentTarget as Element).releasePointerCapture(event.pointerId);
    }
  };

  // Fractions [0,1] du cadre sur la toile, pour placer voile et poignées en %.
  const fx = (px: number) => (imageSize.width > 0 ? px / imageSize.width : 0);
  const fy = (px: number) => (imageSize.height > 0 ? px / imageSize.height : 0);
  const left = fx(rect.x);
  const top = fy(rect.y);
  const right = fx(rect.x + rect.width);
  const bottom = fy(rect.y + rect.height);

  const handlePos = (h: StretchHandle): { left: string; top: string } => {
    const x = h.h === "left" ? left : h.h === "right" ? right : (left + right) / 2;
    const y = h.v === "top" ? top : h.v === "bottom" ? bottom : (top + bottom) / 2;
    return { left: `${x * 100}%`, top: `${y * 100}%` };
  };

  return (
    <div ref={overlayRef} className="crop-overlay" style={box ?? { width: 0, height: 0 }}>
      {box && (
        <>
          {/* VOILE hors cadre : rectangle extérieur MOINS le cadre, en règle
              paire-impaire. Un voile d'interface, jamais une passe de rendu. */}
          <svg className="crop-overlay__scrim" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            <path
              fillRule="evenodd"
              d={`M0 0 H1 V1 H0 Z M${left} ${top} H${right} V${bottom} H${left} Z`}
            />
          </svg>
          {/* CADRE + tiers (repère Lightroom). `pointer-events: none` : la prise
              est sur la surface intérieure et les poignées. */}
          <svg className="crop-overlay__frame" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            <rect x={left} y={top} width={right - left} height={bottom - top} vectorEffect="non-scaling-stroke" />
            <line x1={left + (right - left) / 3} y1={top} x2={left + (right - left) / 3} y2={bottom} vectorEffect="non-scaling-stroke" className="crop-overlay__third" />
            <line x1={left + (2 * (right - left)) / 3} y1={top} x2={left + (2 * (right - left)) / 3} y2={bottom} vectorEffect="non-scaling-stroke" className="crop-overlay__third" />
            <line x1={left} y1={top + (bottom - top) / 3} x2={right} y2={top + (bottom - top) / 3} vectorEffect="non-scaling-stroke" className="crop-overlay__third" />
            <line x1={left} y1={top + (2 * (bottom - top)) / 3} x2={right} y2={top + (2 * (bottom - top)) / 3} vectorEffect="non-scaling-stroke" className="crop-overlay__third" />
          </svg>
          {/* SURFACE INTÉRIEURE : déplace le cadre, et double-clic = valider. */}
          <div
            className="crop-overlay__body"
            role="application"
            aria-label="Cadre de recadrage — glisser pour déplacer, poignées pour redimensionner, Entrée pour valider, Échap pour annuler"
            style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${(right - left) * 100}%`, height: `${(bottom - top) * 100}%` }}
            onPointerDown={(e) => handleDown(e, null)}
            onPointerMove={handleMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={onValidate}
          />
          {CROP_HANDLES.map((h) => {
            const axe = h.h && h.v ? (h.id === "nw" || h.id === "se" ? "nwse" : "nesw") : h.h ? "ew" : "ns";
            return (
              <div
                key={h.id}
                aria-hidden="true"
                className={`canvas-handle crop-overlay__handle crop-overlay__handle--${axe}`}
                style={handlePos(h)}
                onPointerDown={(e) => handleDown(e, h)}
                onPointerMove={handleMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
