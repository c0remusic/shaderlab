import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanvasControl, EffectParam } from "../render/effects/types";
import { deplacementPatch } from "../ui/effectMove";
import { overlayRectFromClientRects, sameOverlayRect, type OverlayRect } from "../ui/transform";
import "./EffectMoveSurface.css";

interface Props {
  controls: readonly CanvasControl[];
  params: readonly EffectParam[];
  values: Readonly<Record<string, number>>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onChange: (patch: Record<string, number>) => void;
  onCommit: () => void;
  /** Le geste n'était qu'un CLIC : rendu à la désignation habituelle de la
   *  toile, en pixels IMAGE. Sans ce relais, une surface qui couvre tout le
   *  canvas rendrait la sélection et la désélection inatteignables à la souris
   *  dès qu'un effet à ancrage est sélectionné. */
  onPick: (x: number, y: number) => void;
}

/**
 * Seuil sous lequel un geste reste un CLIC, en pixels d'ÉCRAN.
 *
 * En pixels d'écran et non d'image, délibérément : c'est un seuil de main, pas
 * de document. Trois pixels à l'écran valent la même imprécision de doigt quel
 * que soit le zoom, là où trois pixels d'image en vaudraient trente à 1000 %.
 */
const SEUIL_CLIC_PX = 3;

interface Geste {
  pointerId: number;
  clientX: number;
  clientY: number;
  /** Point d'appui en pixels IMAGE — ce que reçoit `onPick` si le geste reste
   *  un clic. Mémorisé à l'appui plutôt que relu au relâchement : c'est le point
   *  que l'utilisateur a VISÉ. */
  pickX: number;
  pickY: number;
  /** Valeurs du calque à l'APPUI. Le patch se calcule toujours depuis elles —
   *  voir `deplacementPatch` pour ce que coûte un delta incrémental. */
  depart: Record<string, number>;
  /** Le seuil a été franchi : à partir de là, c'est un déplacement et le
   *  relâchement committera au lieu de désigner. */
  deplace: boolean;
}

/**
 * SURFACE DE DÉPLACEMENT D'UN EFFET POSÉ (ticket 20).
 *
 * Elle couvre le rectangle affiché du canvas et traduit un glissement en
 * translation des paramètres spatiaux de l'effet sélectionné. Toute la règle —
 * quels champs bougent, lesquels restent, ce qu'un `visibleWhen` masque — vit
 * dans `ui/effectMove.ts` ; ce composant ne fait que mesurer, cumuler un delta
 * et déléguer.
 *
 * ── SA PLACE DANS L'ARBRE EST LOAD-BEARING ──────────────────────────────────
 *
 * Montée JUSTE AVANT `<CanvasControls>`, donc DERRIÈRE les poignées dans
 * l'ordre de peinture comme dans l'ordre de prise. Les petites poignées propres
 * (point, disque, axe, boîte) gardent la priorité absolue : elles règlent un
 * champ PRÉCIS — un rayon, un angle — que cette surface ne sait pas toucher.
 * Inverser les deux ferait perdre ces gestes-là au profit d'un seul.
 *
 * Enfant du canvas pour la même raison que les autres overlays : zoomé, le
 * canvas déborde de la zone visible, et une surface posée plus haut dans l'arbre
 * s'étendrait par-dessus le dock.
 *
 * ── ELLE REND LA MAIN AU DÉPLACEMENT DE LA VUE, EN CSS ──────────────────────
 *
 * Espace maintenu déplace la VUE depuis n'importe où, y compris au-dessus de la
 * toile. Ce geste appartient au pasteboard, qui le reçoit par bouillonnement :
 * une surface qui couvre tout le canvas et qui arrête l'évènement le rendrait
 * inatteignable — et bien plus complètement que ne le faisait le cadre de
 * `TransformHandles`, qui n'en couvre qu'une photo. La neutralisation passe donc
 * par la même règle que les quatre manipulateurs
 * (`.pasteboard__view--pan`, voir `canvasHandle.css` et `EffectMoveSurface.css`)
 * plutôt que par un état remonté jusqu'à `App` et redescendu en prop.
 *
 * Le bouton du MILIEU, lui, ne passe pas par le CSS : la surface le laisse
 * simplement bouillonner (aucun `stopPropagation`), et le pasteboard en fait un
 * déplacement de vue comme partout ailleurs.
 */
export function EffectMoveSurface({ controls, params, values, canvasRef, onChange, onCommit, onPick }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<OverlayRect | null>(null);
  const gesteRef = useRef<Geste | null>(null);

  // Même mesure que les quatre manipulateurs : deux rects réels, jamais une
  // hypothèse de mise en page. Le zoom posé en transform CSS sur le canvas est
  // déjà dans `getBoundingClientRect()`.
  const mesurer = useCallback(() => {
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;
    const parent = surface?.offsetParent;
    if (!surface || !canvas || !parent) return;
    const next = overlayRectFromClientRects(canvas.getBoundingClientRect(), parent.getBoundingClientRect());
    setRect((previous) => (previous && sameOverlayRect(previous, next) ? previous : next));
  }, [canvasRef]);

  // Sans tableau de dépendances, comme `TransformHandles` : un zoom par
  // transform CSS ne change aucune taille de boîte, donc n'émet aucun
  // `ResizeObserver`. La garde d'égalité de `mesurer` empêche la boucle.
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

  /** Point écran → pixels IMAGE, exactement la conversion de
   *  `TransformHandles.screenToImagePixels` : c'est l'unité qu'attend
   *  `handleCanvasPick`, et deux conventions divergentes désigneraient deux
   *  calques différents pour le même clic. */
  const versPixelsImage = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return null;
      return {
        x: (clientX - bounds.left) * (canvas.width / bounds.width),
        y: (clientY - bounds.top) * (canvas.height / bounds.height),
      };
    },
    [canvasRef],
  );

  /** Ferme le geste et le rend, ou `null` si l'évènement vient d'un AUTRE
   *  pointeur — un second doigt ne relâche pas la capture du premier. */
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
      className="effect-move-surface"
      // AFFORDANCE DE SOURIS SEULEMENT, donc retirée de l'arbre d'accessibilité.
      // Les mêmes paramètres sont atteignables au clavier par deux chemins qui
      // existent déjà : les flèches sur la poignée de point (`PointHandles`) et
      // les champs du panneau. L'exposer sans la rendre actionnable au clavier
      // annoncerait un contrôle qui ne répondrait pas.
      aria-hidden="true"
      // Rendue invisible tant que la mesure n'a pas eu lieu : une surface
      // dimensionnée par défaut capterait des clics hors de la toile.
      style={rect ?? { width: 0, height: 0 }}
      onPointerDown={(event) => {
        // BOUTON PRINCIPAL SEULEMENT, et surtout : PAS de `stopPropagation` sur
        // les autres. Le bouton du milieu doit continuer de remonter jusqu'au
        // pasteboard, qui en fait un déplacement de la vue.
        if (event.button !== 0) return;
        const pick = versPixelsImage(event.clientX, event.clientY);
        if (!pick) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesteRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          pickX: pick.x,
          pickY: pick.y,
          depart: { ...values },
          deplace: false,
        };
      }}
      onPointerMove={(event) => {
        const geste = gesteRef.current;
        if (!geste || geste.pointerId !== event.pointerId || !rect) return;
        const ecranX = event.clientX - geste.clientX;
        const ecranY = event.clientY - geste.clientY;
        // Tant que le seuil n'est pas franchi, RIEN n'est écrit : un clic de
        // désignation ne doit pas laisser une entrée d'historique derrière lui
        // parce que la main a tremblé d'un pixel.
        if (!geste.deplace && Math.hypot(ecranX, ecranY) < SEUIL_CLIC_PX) return;
        geste.deplace = true;
        // Le rect mesuré EST le rectangle affiché du canvas, zoom compris : la
        // division rend donc une fraction du CADRE, l'unité des paramètres
        // spatiaux, sans avoir à connaître l'échelle de vue.
        const patch = deplacementPatch(controls, params, geste.depart, ecranX / rect.width, ecranY / rect.height);
        if (patch) onChange(patch);
      }}
      onPointerUp={(event) => {
        const geste = terminer(event);
        if (!geste) return;
        // Un geste sous le seuil n'a rien écrit : il redevient le clic de
        // désignation habituel de la toile.
        if (geste.deplace) onCommit();
        else onPick(geste.pickX, geste.pickY);
      }}
      // Perte de capture (alt-tab, interruption OS/tactile) : on abandonne SANS
      // committer et sans désigner — même sémantique que `TransformHandles` et
      // que `dragReorder`, où `pointercancel` n'est pas un dépôt valide.
      onPointerCancel={terminer}
    />
  );
}
