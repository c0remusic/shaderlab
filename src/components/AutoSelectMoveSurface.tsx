import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { documentClientRect, overlayRectFromClientRects, sameOverlayRect, type FrameRectLike, type OverlayRect } from "../ui/transform";
import "./AutoSelectMoveSurface.css";

/**
 * Ce qui déplace le calque désigné par `begin`, ou `null` quand il n'y a rien à
 * déplacer (aucun calque touché, calque verrouillé, effet sans ancrage) —
 * l'appelant a alors déjà changé la SÉLECTION, seul le mouvement est sans objet.
 *
 * `move` reçoit un delta en FRACTIONS du cadre (mêmes unités que
 * `EffectMoveSurface`), cumulé depuis l'appui : l'appelant convertit selon ce
 * qu'il déplace (pixels du fond pour un transform photo, fraction pour un
 * paramètre spatial d'effet). Cumulé depuis l'appui et non incrémental, pour la
 * même raison que `deplacementPatch` — un delta incrémental dérive dès qu'un axe
 * touche sa borne.
 */
export interface AutoSelectMover {
  move: (fractionX: number, fractionY: number) => void;
  commit: () => void;
}

interface Props {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Dimensions du document, pour le rectangle virtuel sous un cadre. */
  imageSize: { width: number; height: number };
  /** Cadre de recadrage courant, ou `null` — voir `TransformHandles.frame`. */
  frame?: FrameRectLike | null;
  /**
   * Ouvre le geste : hit-test du pixel `(imgX, imgY)`, CHANGE la sélection
   * (sur l'appui, comme Photoshop en Auto-Select), et rend de quoi déplacer le
   * calque désigné — ou `null` s'il n'y a rien à déplacer.
   */
  begin: (imgX: number, imgY: number) => AutoSelectMover | null;
}

/** Seuil sous lequel un geste reste un CLIC, en pixels d'ÉCRAN — identique à
 *  `EffectMoveSurface`, et pour la même raison (un seuil de main, pas de
 *  document, donc invariant au zoom). */
const SEUIL_CLIC_PX = 3;

interface Geste {
  pointerId: number;
  clientX: number;
  clientY: number;
  mover: AutoSelectMover | null;
  deplace: boolean;
}

/**
 * SURFACE DE SÉLECTION AUTOMATIQUE (ticket 26), active seulement quand la case
 * « Sélection auto » de l'outil Déplacer est cochée.
 *
 * Elle couvre tout le rectangle affiché du canvas et unifie, en un seul geste,
 * la SÉLECTION et le DÉPLACEMENT de N'IMPORTE QUEL calque : à l'appui, elle
 * hit-teste le pixel visé, sélectionne le calque couvrant le plus haut, puis —
 * sans lever le bouton — traduit le glissement en déplacement de CE calque
 * (transform d'un calque photo, paramètre spatial d'un effet à ancrage). Toute
 * la décision vit dans `begin`, fourni par `App` ; ce composant ne fait que
 * mesurer, distinguer clic et glissement, et cumuler un delta.
 *
 * ── SA PLACE DANS L'ARBRE ────────────────────────────────────────────────────
 *
 * Montée AVANT les poignées précises (`TransformHandles`, `CanvasControls`) donc
 * DERRIÈRE elles dans l'ordre de prise : les pastilles d'échelle, de rotation et
 * les manipulateurs d'effet gardent la priorité sur les gestes fins qu'elle ne
 * sait pas faire. Le CORPS de `TransformHandles` est rendu inerte tant que la
 * Sélection auto est active (`corpsInteractif={false}`, côté `App`), pour que
 * cette surface soit le seul propriétaire du déplacement.
 *
 * Elle REMPLACE `EffectMoveSurface` pendant que la Sélection auto est active :
 * les deux couvrent toute la toile, en monter deux se disputerait le pointeur.
 *
 * ── PAN DE LA VUE ────────────────────────────────────────────────────────────
 *
 * Comme `EffectMoveSurface`, elle rend la main au déplacement de la vue par CSS
 * (`.pasteboard__view--pan`) et laisse bouillonner le bouton du milieu (aucun
 * `stopPropagation` hors bouton principal), qui devient un pan au pasteboard.
 */
export function AutoSelectMoveSurface({ canvasRef, imageSize, frame = null, begin }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<OverlayRect | null>(null);
  const gesteRef = useRef<Geste | null>(null);

  // Même mesure que les autres overlays : deux rects réels (le zoom en transform
  // CSS est déjà dans `getBoundingClientRect`), garde d'égalité pour ne pas
  // boucler sur un rendu qui ne change rien. Sous un cadre, rectangle document
  // VIRTUEL (ticket 32).
  const mesurer = useCallback(() => {
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;
    const parent = surface?.offsetParent;
    if (!surface || !canvas || !parent) return;
    const canvasRect = documentClientRect(canvas.getBoundingClientRect(), frame, imageSize);
    const next = overlayRectFromClientRects(canvasRect, parent.getBoundingClientRect());
    setRect((previous) => (previous && sameOverlayRect(previous, next) ? previous : next));
  }, [canvasRef, imageSize, frame]);

  useLayoutEffect(() => {
    mesurer();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = surfaceRef.current?.offsetParent;
    if (!canvas || !parent) return;
    const observer = new ResizeObserver(mesurer);
    observer.observe(canvas);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [canvasRef, mesurer]);

  /** Point écran → pixels IMAGE, exactement la conversion de `EffectMoveSurface`
   *  et `TransformHandles` : c'est l'unité qu'attend le hit-test. */
  const versPixelsImage = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return null;
      // Rectangle document VIRTUEL : pixels en espace d'origine même sous un
      // cadre (ticket 32), l'unité qu'attend le hit-test.
      const rectDoc = documentClientRect(bounds, frame, imageSize);
      return {
        x: ((clientX - rectDoc.left) / rectDoc.width) * imageSize.width,
        y: ((clientY - rectDoc.top) / rectDoc.height) * imageSize.height,
      };
    },
    [canvasRef, imageSize, frame],
  );

  function terminer(event: React.PointerEvent): Geste | null {
    const geste = gesteRef.current;
    if (!geste || geste.pointerId !== event.pointerId) return null;
    gesteRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    return geste;
  }

  return (
    <div
      ref={surfaceRef}
      className="auto-select-surface"
      // Affordance de souris seulement : la sélection au clavier passe par la
      // pile, le déplacement par les poignées et les champs — voir la même note
      // dans `EffectMoveSurface`.
      aria-hidden="true"
      style={rect ?? { width: 0, height: 0 }}
      onPointerDown={(event) => {
        // Bouton principal seulement ; le bouton du milieu bouillonne vers le
        // pasteboard, qui en fait un pan.
        if (event.button !== 0) return;
        const pick = versPixelsImage(event.clientX, event.clientY);
        if (!pick) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        // SÉLECTION SUR L'APPUI (Auto-Select de Photoshop) : `begin` change la
        // sélection maintenant, ce qui permet au glissement qui suit de déplacer
        // le calque NOUVELLEMENT sélectionné sans lever le bouton.
        const mover = begin(pick.x, pick.y);
        gesteRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          mover,
          deplace: false,
        };
      }}
      onPointerMove={(event) => {
        const geste = gesteRef.current;
        if (!geste || geste.pointerId !== event.pointerId || !rect) return;
        const ecranX = event.clientX - geste.clientX;
        const ecranY = event.clientY - geste.clientY;
        if (!geste.deplace && Math.hypot(ecranX, ecranY) < SEUIL_CLIC_PX) return;
        geste.deplace = true;
        // Fraction du cadre affiché, zoom compris (le rect EST le rectangle
        // affiché du canvas) — l'appelant convertit selon ce qu'il déplace.
        geste.mover?.move(ecranX / rect.width, ecranY / rect.height);
      }}
      onPointerUp={(event) => {
        const geste = terminer(event);
        if (!geste) return;
        // La sélection a déjà eu lieu à l'appui ; un clic sans mouvement n'a donc
        // rien de plus à faire, et un glissement committe son déplacement.
        if (geste.deplace) geste.mover?.commit();
      }}
      // Perte de capture : on abandonne le déplacement SANS committer (la
      // sélection posée à l'appui reste), même sémantique que les autres surfaces.
      onPointerCancel={terminer}
    />
  );
}
