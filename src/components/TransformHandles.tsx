import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LayerTransform } from "../layers/types";
import {
  CORNER_INDICES,
  EDGE_INDICES,
  computeHandleGeometry,
  overlayRectFromClientRects,
  sameOverlayRect,
  transformFromCornerDrag,
  transformFromEdgeDrag,
  rotationFromPointer,
  snapAngle,
  type CornerIndex,
  type EdgeIndex,
  type OverlayRect,
} from "../ui/transform";
import "./TransformHandles.css";

interface Props {
  transform: LayerTransform;
  photoSize: { width: number; height: number };
  bgSize: { width: number; height: number };
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onTransformChange: (transform: LayerTransform) => void;
  onTransformCommit: () => void;
  /**
   * Consulté AVANT de démarrer un déplacement (toile de montage T1) : rend
   * `true` si le clic appartenait à une AUTRE image, auquel cas la sélection
   * lui a été cédée et AUCUN drag ne démarre.
   *
   * Existe parce que le corps de la box est cliquable et se superpose au
   * canvas sur toute la surface du calque sélectionné : sans ce relais, un clic
   * sur une image posée PAR-DESSUS la sélection n'atteindrait jamais le canvas
   * et déplacerait la sélection courante — soit exactement le cas du collage à
   * images qui se recouvrent que T1 vise.
   *
   * Ne concerne QUE le corps de la box : les poignées de coin et de rotation
   * sont des cibles explicites et petites, elles gardent la priorité absolue.
   */
  onPickThrough?: (x: number, y: number) => boolean;
}

type DragKind =
  // L'index du coin tiré est indispensable : c'est lui qui désigne le coin
  // OPPOSÉ, qui doit rester immobile pendant l'échelle (`transformFromCornerDrag`).
  | { kind: "corner"; index: CornerIndex }
  // Même forme que `corner` et pas un booléen sur celui-ci : un côté et un coin
  // n'ont ni la même table de normales ni le même nombre d'axes touchés, les
  // confondre rendrait l'index ambigu.
  | { kind: "edge"; index: EdgeIndex }
  | { kind: "rotate" }
  | { kind: "move"; startX: number; startY: number; originTransform: LayerTransform };

/**
 * Overlay de poignées type Photoshop pour un calque de photo (double
 * exposure) : 4 coins pour l'échelle uniforme, 1 poignée dédiée pour la
 * rotation, corps de la box pour déplacer. Même famille de gestion pointer
 * que `MaskPainter`/le pan-zoom existants (`pointerdown`/`pointermove`/
 * `pointerup` + `setPointerCapture`) — toute la géométrie vit dans
 * `ui/transform.ts`, ce composant ne fait que traduire écran<->pixels du
 * fond et déléguer.
 */
export function TransformHandles({ transform, photoSize, bgSize, canvasRef, onTransformChange, onTransformCommit, onPickThrough }: Props) {
  const dragRef = useRef<DragKind | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);

  // Cale l'overlay sur le rectangle AFFICHÉ du canvas plutôt que sur son
  // conteneur (voir `overlayRectFromClientRects` pour le défaut que ça corrige).
  // Deux rects mesurés, jamais une hypothèse de mise en page : un zoom posé sur
  // le canvas par transform CSS est déjà dans `getBoundingClientRect()`.
  const measureOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    const parent = overlay?.offsetParent;
    if (!overlay || !canvas || !parent) return;
    const next = overlayRectFromClientRects(canvas.getBoundingClientRect(), parent.getBoundingClientRect());
    setOverlayRect((previous) => (previous && sameOverlayRect(previous, next) ? previous : next));
  }, [canvasRef]);

  // Sans tableau de dépendances, DÉLIBÉRÉMENT : un zoom/déplacement du canvas
  // par transform CSS ne change aucune taille de boîte, donc n'émet AUCUN
  // `ResizeObserver` — seule une mesure à chaque rendu le rattrape. La garde
  // d'égalité dans `measureOverlay` est ce qui empêche la boucle de rendu.
  // `useLayoutEffect` et non `useEffect` : la mesure doit être posée avant la
  // peinture, sinon les poignées apparaissent une frame à la mauvaise place.
  useLayoutEffect(() => {
    measureOverlay();
  });

  // Filet pour ce qui bouge SANS rendu React : redimensionnement de fenêtre,
  // ouverture/fermeture d'une colonne du dock (qui change le padding du stage,
  // donc la taille affichée du canvas).
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = overlayRef.current?.offsetParent;
    if (!canvas || !parent) return;
    const observer = new ResizeObserver(measureOverlay);
    observer.observe(canvas);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [canvasRef, measureOverlay]);

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

  const { corners, edges, rotationHandle } = computeHandleGeometry(transform, photoSize);

  function toScreenStyle(point: { x: number; y: number }): React.CSSProperties {
    // Positionnement en % de l'overlay — qui coïncide maintenant exactement
    // avec le rectangle affiché du canvas (`measureOverlay`). Le % évite de
    // recalculer un pixel-ratio par poignée : une seule mesure sert aux cinq.
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
      // `Alt` maintenu = ancrage sur le CENTRE (l'ancien comportement, qui
      // faisait grossir la photo dans les 4 directions) ; sans `Alt`, le coin
      // opposé reste fixe, comme Photoshop. Même famille de modificateur que le
      // `Shift` de la rotation : lu sur l'événement, aucun listener clavier.
      // `Maj` CONTRAINT les proportions (convention Figma, choix utilisateur
      // 2026-07-31) : le coin est LIBRE par défaut, ce qui est le geste qui
      // manquait — jusqu'ici aucun geste ne pouvait étirer une photo.
      onTransformChange(
        transformFromCornerDrag(
          transform,
          photoSize,
          pointer,
          drag.index,
          e.altKey ? "center" : "oppositeCorner",
          e.shiftKey,
        ),
      );
    } else if (drag.kind === "edge") {
      onTransformChange(
        transformFromEdgeDrag(transform, photoSize, pointer, drag.index, e.altKey ? "center" : "oppositeCorner"),
      );
    } else if (drag.kind === "rotate") {
      // Snap d'angle à 15° (design 2026-07-26 §3.4) : déclencheur = `Shift`
      // maintenu pendant le drag, disponible sans aucun listener clavier.
      // La saisie au clavier dans le panneau Photo reste littérale.
      const raw = rotationFromPointer(transform, pointer);
      const rotation = e.shiftKey ? snapAngle(raw) : raw;
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

  function handlePointerCancel(e: React.PointerEvent) {
    // Perte de capture (alt-tab, interruption OS/tactile) : annule le drag
    // SANS committer, contrairement à pointerup — même sémantique que
    // dragReorder.ts (pointercancel n'est pas un dépôt valide). Évite un
    // état de drag stale et une modif de transform jamais commitée.
    if (!dragRef.current) return;
    if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  }

  return (
    <div
      ref={overlayRef}
      className="transform-handles"
      // Rendu invisible tant que la mesure n'a pas eu lieu : un overlay
      // dimensionné par défaut afficherait des poignées hors de la photo.
      style={overlayRect ?? { width: 0, height: 0 }}
    >
      {overlayRect && (
        <>
          {/* Le contour est le QUADRILATÈRE réel de la photo transformée, pas
              son englobante alignée aux axes : cette dernière est strictement
              plus grande dès qu'il y a une rotation, et laissait un cadre droit
              trop grand avec les pastilles flottant à l'intérieur. Un SVG à
              `viewBox` en pixels du fond mappe exactement comme le % des
              pastilles (`toScreenStyle`), donc contour et pastilles ne peuvent
              pas diverger ; `non-scaling-stroke` garde un trait de 1px quel que
              soit le facteur d'affichage. Le corps cliquable est le `fill` de ce
              même polygone — un clic dans un coin de l'ancienne englobante,
              hors de la photo tournée, n'attrape donc plus rien. */}
          <svg
            className="transform-handles__outline"
            viewBox={`0 0 ${bgSize.width} ${bgSize.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {/* HALO. Le même quadrilatère, tracé d'abord en encre sombre et
                plus large. Sans lui le cadre était un seul trait sombre
                semi-transparent (`--outline-contrast`) : invisible sur une
                photo sombre, c'est-à-dire précisément là où on recadre un ciel
                de nuit ou une silhouette à contre-jour — signalé à l'usage le
                2026-07-31. Un cadre doit se lire sur N'IMPORTE quel contenu, et
                aucune couleur unique ne le peut : il faut le contraste d'une
                paire. `pointer-events: none` — la prise reste sur le polygone
                du dessus, un seul et même chemin, donc la zone cliquable ne
                bouge pas d'un pixel. */}
            <polygon
              className="transform-handles__box-halo"
              points={corners.map((corner) => `${corner.x},${corner.y}`).join(" ")}
              vectorEffect="non-scaling-stroke"
            />
            <polygon
              className="transform-handles__box"
              points={corners.map((corner) => `${corner.x},${corner.y}`).join(" ")}
              vectorEffect="non-scaling-stroke"
              onPointerDown={(e) => {
                const origin = screenToImagePixels(e.clientX, e.clientY);
                // Une image posée par-dessus reprend la sélection au lieu de laisser
                // la box déplacer le calque courant (voir `onPickThrough`).
                if (origin && onPickThrough?.(origin.x, origin.y)) {
                  e.stopPropagation();
                  return;
                }
                handlePointerDown(e, { kind: "move", startX: origin?.x ?? 0, startY: origin?.y ?? 0, originTransform: transform });
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            />
          </svg>
          {CORNER_INDICES.map((index) => (
            <div
              key={index}
              className="transform-handles__corner"
              style={toScreenStyle(corners[index])}
              onPointerDown={(e) => handlePointerDown(e, { kind: "corner", index })}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            />
          ))}
          {/* POIGNÉES DE CÔTÉ. Elles n'existaient pas tant que l'échelle était
              unique : sans second axe, une poignée de côté aurait fait
              exactement ce que fait un coin. Chacune ne touche QUE l'axe de sa
              normale, en repère local — tirer la poignée droite d'une photo
              tournée à 30° étire toujours sa largeur À ELLE. */}
          {EDGE_INDICES.map((index) => (
            <div
              key={`edge-${index}`}
              className={`transform-handles__edge transform-handles__edge--${index % 2 === 0 ? "vertical" : "horizontal"}`}
              style={toScreenStyle(edges[index])}
              onPointerDown={(e) => handlePointerDown(e, { kind: "edge", index })}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            />
          ))}
          <div
            className="transform-handles__rotation"
            style={toScreenStyle(rotationHandle)}
            onPointerDown={(e) => handlePointerDown(e, { kind: "rotate" })}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          />
        </>
      )}
    </div>
  );
}
