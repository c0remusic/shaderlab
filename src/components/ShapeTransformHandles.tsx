import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { handlePoint, STRETCH_HANDLES, type StretchHandle } from "../ui/effectStretch";
import { nudgeShapeBox, resizeShapeBox, shapeFrame } from "../ui/shapeHandles";
import type { ShapeBox } from "../ui/shapeDraw";
import type { PixelSize } from "../ui/transform";
import { overlayRectFromClientRects, sameOverlayRect, type OverlayRect } from "../ui/transform";
import "./EffectTransformHandles.css";

interface Props {
  /** La boîte de la source `shape` du calque, en coordonnées image [0,1]
   *  (`x0,y0,x1,y1`). L'ordre des coins est libre — le cadre affiché est min/max. */
  box: ShapeBox;
  /** Taille du DOCUMENT en pixels : sert au carré SUR LA TOILE (Maj), qui compte
   *  en pixels égaux et non en fractions image (anisotropes sur une toile non
   *  carrée). Même repère que `shapeBoxFromRect`. */
  canvasSize: PixelSize;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Nom du calque/effet portant la forme, pour le nom accessible du cadre. */
  effectName: string;
  onChange: (box: ShapeBox) => void;
  onCommit: () => void;
}

/** Pas du déplacement au clavier, en fraction d'image. Petit par défaut, large
 *  avec Maj — même famille que le déplacement au pixel de `TransformHandles`,
 *  transposée à une boîte en coordonnées normalisées. */
const NUDGE_STEP = 0.01;
const NUDGE_STEP_LARGE = 0.05;

/** Ce qu'une flèche fait à la boîte : DÉPLACER (les bords se règlent aux curseurs
 *  du panneau Masque, voir `shapeHandles.ts`). Le repère est celui de l'écran —
 *  droite/bas déplacent vers la droite/le bas. */
const NUDGE_BY_KEY: Readonly<Record<string, { dx: number; dy: number }>> = {
  ArrowRight: { dx: 1, dy: 0 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowUp: { dx: 0, dy: -1 },
};

/** État d'un glissement de poignée. `depart` est la boîte à l'APPUI et
 *  `(clientX, clientY)` le point d'appui : le patch se calcule toujours depuis
 *  eux, delta cumulé, jamais incrémental (voir `shapeHandles.ts`). */
interface Drag {
  handle: StretchHandle;
  pointerId: number;
  clientX: number;
  clientY: number;
  depart: ShapeBox;
}

/**
 * POIGNÉES DE LA FORME (ticket 13). Huit pastilles autour de la boîte de la
 * source de masque `shape` d'un calque d'effet : tirer un côté ou un coin écrit
 * les deux coins de la boîte via `shapeHandles.ts`. Maj contraint au carré sur
 * la toile. Le cadre focusable déplace la boîte au clavier.
 *
 * ── CALQUÉ SUR `EffectTransformHandles`, ET POURQUOI ────────────────────────
 *
 * Même socle : overlay calé sur le rectangle AFFICHÉ du canvas, corps et cadre
 * en `pointer-events: none` (seules les pastilles captent la souris), cumul du
 * delta depuis l'appui, commit d'historique au relâcher. La géométrie diffère
 * (une boîte à deux coins, pas un facteur d'échelle autour d'une ancre) et vit
 * dans le module pur — ce composant ne fait que mesurer, cumuler et déléguer.
 *
 * ── SA PLACE DANS L'ARBRE ────────────────────────────────────────────────────
 *
 * Monté en mode `idle` ET `shapeDraw` (`showEffectControls`), pour qu'on retouche
 * juste après avoir tracé sans quitter l'outil Forme. Le corps de l'overlay est
 * `pointer-events: none`, donc un glissement sur le vide trace une NOUVELLE forme
 * (le Canvas garde le geste) et seules les pastilles retouchent — même choix que
 * les contrôles de `CanvasControls` en mode Forme.
 *
 * ── CLAVIER ─────────────────────────────────────────────────────────────────
 *
 * Le cadre est l'unique cible clavier (flèches = déplacer la boîte). Les BORDS
 * se règlent déjà aux quatre curseurs du panneau Masque ; le clavier couvre le
 * déplacement, qu'aucune autre route ne donne — même partage que
 * `TransformHandles` (flèches déplacent, champs Largeur/Hauteur redimensionnent).
 * Committer sur le `keyup` fait une entrée d'historique par appui.
 */
export function ShapeTransformHandles({ box, canvasSize, canvasRef, effectName, onChange, onCommit }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const nudgingRef = useRef(false);
  const [rect, setRect] = useState<OverlayRect | null>(null);

  // Même mesure que les autres overlays : deux rects réels (le zoom en transform
  // CSS est déjà dans `getBoundingClientRect`), garde d'égalité contre la boucle.
  const mesurer = useCallback(() => {
    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    const parent = overlay?.offsetParent;
    if (!overlay || !canvas || !parent) return;
    const next = overlayRectFromClientRects(canvas.getBoundingClientRect(), parent.getBoundingClientRect());
    setRect((previous) => (previous && sameOverlayRect(previous, next) ? previous : next));
  }, [canvasRef]);

  useLayoutEffect(() => {
    mesurer();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = overlayRef.current?.offsetParent;
    if (!canvas || !parent) return;
    const observer = new ResizeObserver(mesurer);
    observer.observe(canvas);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [canvasRef, mesurer]);

  const frame = shapeFrame(box);

  /** Fraction de l'image → % de l'overlay (qui coïncide avec le rectangle affiché
   *  du canvas). Borné à [0, 1] par `resizeShapeBox`, donc toujours dans le cadre. */
  const toStyle = (point: { x: number; y: number }): React.CSSProperties => ({
    left: `${point.x * 100}%`,
    top: `${point.y * 100}%`,
  });

  function handlePointerDown(e: React.PointerEvent, handle: StretchHandle) {
    // Bouton principal seulement : le bouton du milieu reste un pan de vue, il
    // bouillonne (aucun `stopPropagation`).
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { handle, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, depart: box };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !rect) return;
    // Delta TOTAL depuis l'appui, en fractions du canvas affiché (le rect mesuré
    // EST le rectangle affiché, zoom compris) = fractions image, la source étant
    // en [0,1]. `shapeHandles` en tire la boîte. Maj lu en direct (carré).
    const dx = (e.clientX - drag.clientX) / rect.width;
    const dy = (e.clientY - drag.clientY) / rect.height;
    onChange(resizeShapeBox(drag.handle, drag.depart, dx, dy, e.shiftKey, canvasSize));
  }

  function fermer(e: React.PointerEvent): boolean {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return false;
    dragRef.current = null;
    if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
    return true;
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (fermer(e)) onCommit();
  }

  // Perte de capture (alt-tab, interruption OS/tactile) : on abandonne SANS
  // committer, même sémantique que `EffectTransformHandles`.
  function handlePointerCancel(e: React.PointerEvent) {
    fermer(e);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (dragRef.current) return; // un geste souris en cours a la priorité
    if (e.key === "Escape") {
      // Rendre le focus, rien de plus — l'annulation est Ctrl+Z, quitter l'outil
      // est le Échap global d'`App`. Même choix que `EffectTransformHandles`.
      (e.currentTarget as SVGElement).blur();
      return;
    }
    const nudge = NUDGE_BY_KEY[e.key];
    if (!nudge) return;
    e.preventDefault(); // sinon les flèches défilent la zone de travail
    const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
    nudgingRef.current = true;
    onChange(nudgeShapeBox(box, nudge.dx * step, nudge.dy * step));
  }

  function handleKeyUp(e: React.KeyboardEvent) {
    if (!(e.key in NUDGE_BY_KEY) || !nudgingRef.current) return;
    nudgingRef.current = false;
    onCommit();
  }

  return (
    <div ref={overlayRef} className="effect-transform-handles" style={rect ?? { width: 0, height: 0 }}>
      {rect && (
        <>
          <svg className="effect-transform-handles__outline" viewBox="0 0 1 1" preserveAspectRatio="none" role="presentation">
            {/* HALO sombre + trait clair : un cadre doit se lire sur n'importe
                quel contenu, exactement comme `EffectTransformHandles`. Les deux
                sont `pointer-events: none` — seul le Tab atteint le cadre. */}
            <rect className="effect-transform-handles__box-halo" x={frame.left} y={frame.top} width={frame.right - frame.left} height={frame.bottom - frame.top} vectorEffect="non-scaling-stroke" aria-hidden="true" />
            <rect
              className="effect-transform-handles__box"
              x={frame.left}
              y={frame.top}
              width={frame.right - frame.left}
              height={frame.bottom - frame.top}
              vectorEffect="non-scaling-stroke"
              tabIndex={0}
              role="application"
              aria-label={`Forme de ${effectName} — flèches pour déplacer, Maj+flèches par pas plus grand`}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
            />
          </svg>
          {/* LES HUIT PASTILLES sont des affordances de SOURIS, `aria-hidden` :
              le redimensionnement est atteignable au clavier par les quatre
              curseurs de bord du panneau Masque, et le cadre focusable déplace.
              Même choix que les pastilles d'`EffectTransformHandles`. */}
          {STRETCH_HANDLES.map((handle) => {
            const axe = handle.h && handle.v ? (handle.id === "nw" || handle.id === "se" ? "nwse" : "nesw") : handle.h ? "ew" : "ns";
            return (
              <div
                key={handle.id}
                aria-hidden="true"
                className={`canvas-handle effect-transform-handles__handle effect-transform-handles__handle--${axe}`}
                style={toStyle(handlePoint(handle, frame))}
                onPointerDown={(e) => handlePointerDown(e, handle)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
