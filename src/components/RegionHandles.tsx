import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  overlayRectFromClientRects,
  sameOverlayRect,
  type OverlayRect,
} from "../ui/transform";
import {
  centerFromOverlayPoint,
  clampRegionCenter,
  clampRegionRadius,
  radiusFromOverlayPoint,
  radiusHandlePosition,
  regionToOverlay,
  type RegionCenter,
} from "../ui/regionHandles";
import "./RegionHandles.css";

interface Props {
  center: RegionCenter;
  radius: number;
  /** Bornes du rayon, lues sur le paramètre de l'effet — jamais redéclarées
   *  ici : un effet qui exposerait une autre plage doit marcher sans toucher à
   *  ce composant. */
  radiusRange: { min: number; max: number };
  bgSize: { width: number; height: number };
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Pendant le geste — appelé à chaque déplacement, sans entrée d'historique. */
  onRegionChange: (center: RegionCenter, radius: number) => void;
  /** Fin du geste — c'est LUI qui pose l'entrée d'historique. Même séparation
   *  live/commit que `TransformHandles`, pour la même raison : un commit par
   *  `pointermove` rendrait Ctrl+Z inutilisable. */
  onRegionCommit: () => void;
  /** Nom de l'effet, pour que le nom accessible dise de QUELLE zone il s'agit. */
  effectName?: string;
  disabled?: boolean;
}

/** Pas du déplacement au clavier, en fraction du cadre. 0,5 % par appui : assez
 *  fin pour viser, assez gros pour traverser l'image en un maintien. */
const NUDGE_STEP = 0.005;
const NUDGE_STEP_LARGE = 0.05;

const NUDGE_BY_KEY: Readonly<Record<string, { dx: number; dy: number }>> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

type DragKind = "center" | "radius";

/**
 * Manipulateur de RÉGION — le cercle qu'on pose sur la toile pour dire à un
 * effet où agir. Utilisé comme primitive disque par l'hôte `CanvasControls`.
 *
 * Toute la géométrie vit dans `ui/regionHandles.ts` et se teste en Node ; ce
 * fichier n'a que le DOM, la mesure et les gestes — même partage que
 * `TransformHandles` / `ui/transform.ts`.
 *
 * ⚠️ `onPointerCancel` n'est PAS décoratif. Sans lui, une capture perdue en
 * plein glissement laisse `dragRef` armé : le geste suivant reprend l'ancien
 * état et le commit d'historique est sauté en silence. Défaut réel, trouvé en
 * revue sur `TransformHandles` (double exposure, Task 4) — repris ici plutôt
 * que redécouvert.
 */
export function RegionHandles({
  center,
  radius,
  radiusRange,
  bgSize,
  canvasRef,
  onRegionChange,
  onRegionCommit,
  effectName,
  disabled = false,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const dragRef = useRef<DragKind | null>(null);
  /** Écart entre le point SAISI et le centre, en pixels d'overlay. Sans lui, le
   *  premier `pointermove` téléporte le centre sous le curseur : attraper la
   *  pastille à trois pixels de son milieu ferait sauter la zone avant même que
   *  la main ait bougé. Même correctif que celui des poignées de coin. */
  const grabRef = useRef({ dx: 0, dy: 0 });
  const nudgingRef = useRef(false);

  // Même mesure que `TransformHandles`, et pour le même défaut : l'overlay doit
  // épouser le rectangle AFFICHÉ du canvas, plus petit que son conteneur
  // (lettreboxage) et décalé (compensation du dock).
  const measureOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    const parent = overlay?.offsetParent;
    if (!overlay || !canvas || !parent) return;
    const next = overlayRectFromClientRects(canvas.getBoundingClientRect(), parent.getBoundingClientRect());
    setOverlayRect((previous) => (previous && sameOverlayRect(previous, next) ? previous : next));
  }, [canvasRef]);

  // Sans tableau de dépendances, délibérément : un zoom par transform CSS
  // n'émet aucun `ResizeObserver`, seule une mesure à chaque rendu le rattrape.
  // La garde d'égalité empêche la boucle.
  useLayoutEffect(() => {
    measureOverlay();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = overlayRef.current?.offsetParent;
    if (!canvas || !parent) return;
    const observer = new ResizeObserver(measureOverlay);
    observer.observe(canvas);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [canvasRef, measureOverlay]);

  /** Position du pointeur dans le repère de l'overlay (celui d'`offsetParent`). */
  const toOverlayPoint = useCallback((event: React.PointerEvent) => {
    const parent = overlayRef.current?.offsetParent;
    if (!parent) return null;
    const rect = parent.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const startDrag = useCallback(
    (kind: DragKind) => (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      const point = toOverlayPoint(event);
      if (!point || !overlayRect) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = kind;
      const drawn = regionToOverlay(center, radius, bgSize, overlayRect);
      grabRef.current =
        kind === "center" ? { dx: point.x - drawn.cx, dy: point.y - drawn.cy } : { dx: 0, dy: 0 };
    },
    [toOverlayPoint, overlayRect, center, radius, bgSize],
  );

  const handleMove = useCallback(
    (event: React.PointerEvent) => {
      const kind = dragRef.current;
      if (!kind || !overlayRect) return;
      const point = toOverlayPoint(event);
      if (!point) return;
      if (kind === "center") {
        const next = centerFromOverlayPoint(
          point.x - grabRef.current.dx,
          point.y - grabRef.current.dy,
          overlayRect,
        );
        onRegionChange(clampRegionCenter(next), radius);
      } else {
        const next = radiusFromOverlayPoint(point.x, point.y, center, bgSize, overlayRect);
        onRegionChange(center, clampRegionRadius(next, radiusRange.min, radiusRange.max));
      }
    },
    [overlayRect, toOverlayPoint, onRegionChange, center, radius, bgSize, radiusRange],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onRegionCommit();
    },
    [onRegionCommit],
  );

  /** Capture perdue en plein geste : on ABANDONNE sans committer. Le rendu
   *  reste sur la dernière valeur live — comme `TransformHandles`, et pour la
   *  même raison : il n'y a pas de session modale à restaurer, et `Ctrl+Z`
   *  reste la sortie. Ce qui compte est de ne pas laisser `dragRef` armé. */
  const cancelDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const step = NUDGE_BY_KEY[event.key];
      if (!step) return;
      event.preventDefault();
      const amount = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      nudgingRef.current = true;
      onRegionChange(
        clampRegionCenter({ x: center.x + step.dx * amount, y: center.y + step.dy * amount }),
        radius,
      );
    },
    [center, radius, onRegionChange],
  );

  /** Commit au RELÂCHEMENT. Un appui maintenu répète le `keydown` et n'émet
   *  qu'un seul `keyup` : une entrée d'historique par appui, au lieu d'une
   *  dizaine par seconde. Même raisonnement que `TransformHandles`. */
  const handleKeyUp = useCallback(() => {
    if (!nudgingRef.current) return;
    nudgingRef.current = false;
    onRegionCommit();
  }, [onRegionCommit]);

  if (!overlayRect) {
    return <div ref={overlayRef} className="region-handles" />;
  }

  const drawn = regionToOverlay(center, radius, bgSize, overlayRect);
  const position = radiusHandlePosition(drawn, overlayRect);
  const rayon = { ...position, rabattue: Math.abs(position.x - (drawn.cx + drawn.r)) > 0.5 };
  const nom = effectName ? `Zone de ${effectName}` : "Zone de l'effet";

  return (
    <div
      ref={overlayRef}
      className="region-handles"
      style={{ left: overlayRect.left, top: overlayRect.top, width: overlayRect.width, height: overlayRect.height }}
    >
      {/* Le cercle est en coordonnées de l'OVERLAY, pas du parent : le conteneur
          est déjà posé au bon endroit, donc on retranche son origine. */}
      <svg className="region-handles__circle" width={overlayRect.width} height={overlayRect.height}>
        {/* DEUX TRAITS, même convention que le cadre de transformation : une
            seule couleur ne peut pas se lire sur du contenu quelconque. Le halo
            sombre large passe d'abord, le trait clair fin par-dessus. */}
        <circle
          className="region-handles__halo"
          cx={drawn.cx - overlayRect.left}
          cy={drawn.cy - overlayRect.top}
          r={Math.max(drawn.r, 1)}
        />
        <circle
          className="region-handles__ring"
          cx={drawn.cx - overlayRect.left}
          cy={drawn.cy - overlayRect.top}
          r={Math.max(drawn.r, 1)}
        />
      </svg>

      <button
        type="button"
        disabled={disabled}
        className="region-handles__center"
        style={{ left: drawn.cx - overlayRect.left, top: drawn.cy - overlayRect.top }}
        aria-label={`${nom} — centre. Flèches pour déplacer, Maj pour un pas large.`}
        onPointerDown={startDrag("center")}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      />
      {/* Poignée de RAYON, posée à droite du centre. Un seul point et non quatre :
          le rayon est un scalaire, quatre poignées auraient annoncé quatre axes
          réglables séparément — ce que la région n'a pas (c'est un disque, pas
          une ellipse ; voir `pixelStretch`, qui mesure sa distance dans l'espace
          isotrope justement pour que ce soit un disque).

          RABATTUE DANS LA VUE quand l'anneau en sort — voir
          `radiusHandlePosition`, et le défaut réel qu'elle corrige : au rayon
          par défaut, la poignée tombait hors écran et rien ne permettait plus
          de réduire la zone. */}
      <button
        type="button"
        disabled={disabled}
        className={`region-handles__radius${rayon.rabattue ? " region-handles__radius--rabattue" : ""}`}
        style={{ left: rayon.x - overlayRect.left, top: rayon.y - overlayRect.top }}
        aria-label={`${nom} — rayon`}
        onPointerDown={startDrag("radius")}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
      />
    </div>
  );
}
