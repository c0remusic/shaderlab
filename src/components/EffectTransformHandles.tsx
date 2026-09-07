import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EffectTransform } from "../layers/types";
import {
  MAX_EFFECT_SCALE,
  MIN_EFFECT_SCALE,
  STRETCH_HANDLES,
  handlePoint,
  stretchScale,
  transformedFrame,
  type Anchor,
  type StretchHandle,
} from "../ui/effectStretch";
import { overlayRectFromClientRects, sameOverlayRect, type OverlayRect } from "../ui/transform";
import "./EffectTransformHandles.css";

interface Props {
  /** L'étirement courant du calque (`LayerState.effectTransform`), absent =
   *  identité. */
  scale: EffectTransform;
  /** L'ANCRE de la déformation, en fractions du cadre — le point FIXE de
   *  l'étirement, résolu par `resolveEffectAnchor` (position de l'effet, centre
   *  sinon). Les poignées pivotent dessus, comme le fait le moteur. */
  anchor: Anchor;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Nom de l'effet, pour le nom accessible du cadre. */
  effectName: string;
  onChange: (scale: EffectTransform) => void;
  onCommit: () => void;
}

/** Pas de l'étirement au clavier, en fraction d'échelle. Petit par défaut,
 *  large avec Maj — même famille que le déplacement au pixel de
 *  `TransformHandles`, transposée à une échelle sans unité. */
const NUDGE_STEP = 0.02;
const NUDGE_STEP_LARGE = 0.1;

/** Ce qu'une flèche fait à l'échelle : droite/gauche élargit/rétrécit `scaleX`,
 *  bas/haut étire/aplatit `scaleY`. Le repère est celui du champ, pas de
 *  l'écran — cohérent avec le sens des côtés (`e` élargit, `s` étire). */
const NUDGE_BY_KEY: Readonly<Record<string, { sx: number; sy: number }>> = {
  ArrowRight: { sx: 1, sy: 0 },
  ArrowLeft: { sx: -1, sy: 0 },
  ArrowDown: { sx: 0, sy: 1 },
  ArrowUp: { sx: 0, sy: -1 },
};

function clampScale(valeur: number): number {
  return Math.min(MAX_EFFECT_SCALE, Math.max(MIN_EFFECT_SCALE, valeur));
}

/** État d'un glissement de poignée. `depart` est l'échelle à l'APPUI et
 *  `(clientX, clientY)` le point d'appui : le patch se calcule toujours depuis
 *  eux, delta cumulé, jamais incrémental (voir `effectStretch.ts`). L'ancre est
 *  figée à l'appui elle aussi — un étirement ne bouge pas la position, donc elle
 *  ne change pas, mais la figer rend le geste indépendant d'un rendu qui
 *  passerait entre-temps. */
interface Drag {
  handle: StretchHandle;
  pointerId: number;
  clientX: number;
  clientY: number;
  depart: EffectTransform;
  anchor: Anchor;
}

/**
 * POIGNÉES D'ÉTIREMENT D'UN CALQUE D'EFFET PLACÉ (ticket 24, tranche 3).
 *
 * Huit pastilles autour du CADRE TRANSFORMÉ (le champ [0,1]² étiré autour de
 * l'ancre) : tirer un côté ou un coin écrit un `{ scaleX, scaleY }` via
 * `effectStretch.ts`. Toute la géométrie vit dans ce module pur ; ce composant
 * ne fait que mesurer le rectangle affiché du canvas, cumuler un delta et
 * déléguer.
 *
 * ── SA PLACE DANS L'ARBRE, ET POURQUOI ELLE FONCTIONNE DANS LES DEUX MODES ───
 *
 * Montée APRÈS `EffectMoveSurface` et `AutoSelectMoveSurface` dans le JSX, donc
 * AU-DESSUS d'elles dans l'ordre de prise : ces surfaces couvrent toute la toile
 * et TRANSLATENT (ticket 20/26), les pastilles ÉTIRENT. Les deux gestes ne se
 * disputent rien parce que les pastilles sont de petites cibles explicites et
 * que le reste de cet overlay — le cadre, son corps — est `pointer-events: none`
 * (contrairement au corps de `TransformHandles`, qui déplace la photo et doit
 * donc s'effacer sous Sélection auto). Le déplacement reste l'affaire de la
 * surface du dessous, dans les deux modes ; seul l'étirement passe par ici.
 *
 * Enfant du canvas comme les autres overlays : zoomé, le canvas déborde de la
 * zone visible, et une surface posée plus haut dans l'arbre s'étendrait sur le
 * dock.
 *
 * ── CLAVIER ─────────────────────────────────────────────────────────────────
 *
 * Le cadre est l'unique cible clavier (flèches = étirer/aplatir), parce que
 * `effectTransform` n'a AUCUN champ de panneau ni aucune autre route clavier —
 * contrairement à l'échelle d'un calque photo, couverte par les champs
 * Largeur/Hauteur. Committer sur le `keyup` fait une entrée d'historique par
 * appui, pas par répétition (même raison que `TransformHandles`). Le cadre est
 * `pointer-events: none` : il se prend au Tab, jamais au clic, donc il ne vole
 * pas le glissement de translation de la surface du dessous.
 */
export function EffectTransformHandles({ scale, anchor, canvasRef, effectName, onChange, onCommit }: Props) {
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

  const frame = transformedFrame(anchor, scale);

  /** Fraction du cadre → % de l'overlay (qui coïncide avec le rectangle affiché
   *  du canvas). Peut sortir de [0, 100] quand le champ déborde — voulu. */
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
    dragRef.current = { handle, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, depart: scale, anchor };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !rect) return;
    // Delta TOTAL depuis l'appui, en fractions du cadre (le rect mesuré EST le
    // rectangle affiché, zoom compris) : `stretchScale` en tire l'échelle.
    const dx = (e.clientX - drag.clientX) / rect.width;
    const dy = (e.clientY - drag.clientY) / rect.height;
    onChange(stretchScale(drag.handle, drag.anchor, drag.depart, dx, dy));
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
  // committer, même sémantique que `TransformHandles` et `EffectMoveSurface`.
  function handlePointerCancel(e: React.PointerEvent) {
    fermer(e);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (dragRef.current) return; // un geste souris en cours a la priorité
    if (e.key === "Escape") {
      // Rendre le focus, rien de plus — l'annulation est Ctrl+Z, quitter l'outil
      // est le Échap global d'`App`. Même choix que `TransformHandles`.
      (e.currentTarget as SVGElement).blur();
      return;
    }
    const nudge = NUDGE_BY_KEY[e.key];
    if (!nudge) return;
    e.preventDefault(); // sinon les flèches défilent la zone de travail
    const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
    nudgingRef.current = true;
    onChange({
      scaleX: clampScale(scale.scaleX + nudge.sx * step),
      scaleY: clampScale(scale.scaleY + nudge.sy * step),
    });
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
                quel contenu, exactement comme `TransformHandles`. Les deux sont
                `pointer-events: none` — le cadre ne capte pas la souris, seul le
                Tab l'atteint (voir l'en-tête). */}
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
              aria-label={`Étirement de ${effectName} — flèches pour étirer et aplatir, Maj+flèches par pas plus grand`}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
            />
          </svg>
          {/* LES HUIT PASTILLES sont des affordances de SOURIS, `aria-hidden` :
              leur fonction est atteignable au clavier par le cadre focusable
              ci-dessus. Les annoncer sans réponse clavier propre promettrait
              huit contrôles muets — même choix que les pastilles de
              `TransformHandles`. */}
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
