import { forwardRef, useRef, useEffect, useState, useCallback } from "react";
import { EmptyWorkspace } from "./EmptyWorkspace";
import { panBy, zoomByWheel, type Size, type ViewportState } from "../ui/viewport";
import { rectFromDrag, isDrawnRectUsable, type DrawnRect } from "../ui/shapeDraw";

interface Props {
  onFileDropped: (file: File) => void;
  hasImage: boolean;
  onOpenFile: () => void;
  maskPaintMode: boolean;
  onMaskStroke: (x: number, y: number) => void;
  onStrokeEnd: () => void;
  /** Zoom/déplacement courants (`src/ui/viewport.ts`). Appliqués en TRANSFORM
   *  CSS sur le canvas, jamais au pipeline de rendu : le canvas garde la
   *  résolution native du document. */
  viewport: ViewportState;
  /** Taille du document en pixels image (= `canvas.width/height`). Passée en
   *  prop plutôt que lue sur le ref : la géométrie du viewport doit se
   *  recalculer au RENDER quand le document change, pas au prochain effet. */
  contentSize: Size;
  onViewportChange: (viewport: ViewportState) => void;
  /** Remonte la taille de la zone visible à chaque redimensionnement. C'est
   *  l'appelant qui détient la taille PRÉCÉDENTE, dont `reconcileViewport` a
   *  besoin pour conserver le point regardé. */
  onViewResize: (size: Size) => void;
  /** Calques d'overlay posés DANS la zone visible (poignées de transform).
   *  Ils y sont pour être CLIPPÉS avec elle : zoomé, le canvas déborde de la
   *  vue, et un overlay posé plus haut dans l'arbre dessinerait ses poignées
   *  par-dessus le dock. Ils héritent aussi de son repère, donc ils suivent le
   *  zoom sans le connaître. */
  children?: React.ReactNode;
  /** Rayon du pinceau en pixels IMAGE (= `radius` de paintStroke). Sert à
   *  dimensionner le curseur cercle custom. */
  brushSize: number;
  /** Dureté 0..1 : fraction du rayon à pleine force (anneau interne du curseur). */
  brushHardness: number;
  /** Désignation directe d'une image au clic (toile de montage T1) : appelée
   *  avec le point en pixels IMAGE. `undefined` = sélection désactivée pour ce
   *  mode de canvas — l'appelant ne la passe QU'en mode `idle`, jamais en
   *  `maskPaint` ni en `crop`. Le pinceau garde la main sans exception : la
   *  branche peinture sort avant, inchangée. */
  onPick?: (x: number, y: number) => void;
  /** L'outil FORME est actif : un glissement sur la toile trace un rectangle au
   *  lieu de désigner un calque. Même exclusion que le pinceau — la branche
   *  peinture reste prioritaire et intacte. */
  shapeDrawMode?: boolean;
  /** Un rectangle vient d'être tracé, en pixels de la TOILE. N'est appelé que
   *  pour un geste d'ampleur suffisante (`isDrawnRectUsable`) : un clic simple
   *  ne crée rien, sinon chaque clic manqué laisserait un calque derrière lui. */
  onShapeDrawn?: (rect: DrawnRect) => void;
  /** Le rectangle a CHANGÉ pendant le tracé (à chaque mouvement) : l'appelant
   *  peut poser un APERÇU VIVANT — le marquee sur un calque d'effet sélectionné.
   *  Optionnel : le tracé d'aplat ne l'écoute pas, il ne crée qu'au relâcher. */
  onShapeDrawProgress?: (rect: DrawnRect) => void;
  /** Le tracé s'est terminé SANS créer (clic sans ampleur, ou `pointercancel`) :
   *  l'appelant défait alors l'aperçu vivant qu'il aurait posé. Sans ce signal,
   *  un geste rejeté laisserait le marquee prévisualisé à l'écran. */
  onShapeDrawCancel?: () => void;
}

export const Canvas = forwardRef<HTMLCanvasElement, Props>(function Canvas(
  {
    onFileDropped,
    hasImage,
    onOpenFile,
    maskPaintMode,
    onMaskStroke,
    onStrokeEnd,
    brushSize,
    brushHardness,
    onPick,
    shapeDrawMode,
    onShapeDrawn,
    onShapeDrawProgress,
    onShapeDrawCancel,
    viewport,
    contentSize,
    onViewportChange,
    onViewResize,
    children,
  },
  ref
) {
  const isPaintingRef = useRef(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  // Espace maintenu = geste de déplacement (PRD pan/zoom). En state et pas en
  // ref : le curseur de préhension et la neutralisation du pinceau sont des
  // rendus, pas des effets de bord.
  const [spaceHeld, setSpaceHeld] = useState(false);
  /** Le clic gauche déplace la vue. UNE seule source depuis le 2026-07-31 soir :
   *  Espace maintenu. L'outil Main de la palette, qui posait la même chose de
   *  façon persistante, a été retiré — déplacer la vue est une parenthèse au
   *  milieu d'un autre geste, pas un outil qu'on choisit (voir `ui/tools.ts`). */
  const panning = spaceHeld;
  const panDragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);

  // Les handlers de molette et de déplacement lisent le viewport COURANT. Le
  // passer par une ref évite de réenregistrer l'écouteur natif de `wheel` à
  // chaque changement de zoom — un `removeEventListener`/`addEventListener` par
  // cran de molette, sur un écouteur non passif, est exactement le genre de
  // chose qui rend un geste continu saccadé.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const contentSizeRef = useRef(contentSize);
  contentSizeRef.current = contentSize;
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  const measureView = useCallback((): Size | null => {
    const view = viewRef.current;
    if (!view) return null;
    const rect = view.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { width: rect.width, height: rect.height };
  }, []);

  // Taille de la zone visible remontée à l'appelant : c'est LUI qui garde la
  // taille précédente, dont `reconcileViewport` a besoin pour conserver le
  // point regardé au centre (voir la doc de cette fonction).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const observer = new ResizeObserver(() => {
      const size = measureView();
      if (size) onViewResize(size);
    });
    observer.observe(view);
    const initial = measureView();
    if (initial) onViewResize(initial);
    return () => observer.disconnect();
  }, [measureView, onViewResize]);

  // Zoom molette. Écouteur DOM natif et non `onWheel` React : React 19
  // enregistre `wheel` en PASSIF, où `preventDefault()` est ignoré — sans lui,
  // la molette ferait défiler la page derrière le zoom (même raison et même
  // patron que `components/ui/labeled-slider.tsx`).
  //
  // Ctrl+molette n'est PAS intercepté ici : ce geste appartient à
  // `useGlobalControlWheel` (`src/ui/activeControl.ts`), qui ajuste le dernier
  // contrôle modifié et bloque le zoom natif de WebView2. Zoom canvas = molette
  // NUE, ce que demande le PRD.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey) return;
      const size = measureView();
      if (!size) return;
      event.preventDefault();
      const rect = view!.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      onViewportChangeRef.current(
        zoomByWheel(viewportRef.current, anchor, event.deltaY, contentSizeRef.current, size),
      );
    }
    view.addEventListener("wheel", handleWheel, { passive: false });
    return () => view.removeEventListener("wheel", handleWheel);
  }, [measureView]);

  // Espace = déplacement, tant qu'il est maintenu. Garde sur la cible : dans un
  // champ de saisie, Espace écrit une espace et n'a rien à voir avec le canvas.
  // `repeat` est ignoré, sinon l'auto-répétition du clavier rejouerait un
  // changement d'état à chaque tick.
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      // Sans ça, Espace active aussi le dernier bouton ayant le focus.
      event.preventDefault();
      setSpaceHeld(true);
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.code !== "Space") return;
      setSpaceHeld(false);
    }
    // Une perte de focus fenêtre pendant qu'Espace est enfoncé ne produit
    // jamais de `keyup` : sans ce filet, l'app resterait bloquée en mode
    // déplacement au retour, clic gauche inerte pour peindre.
    function handleBlur() {
      setSpaceHeld(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  /** Vrai ssi ce `pointerdown` doit démarrer un déplacement plutôt que l'action
   *  de l'outil courant : Espace maintenu, ou bouton du milieu (convention
   *  répandue, gratuite ici et utile quand les deux mains sont prises). */
  function isPanGesture(e: React.PointerEvent): boolean {
    return panning || e.button === 1;
  }

  function beginPan(e: React.PointerEvent) {
    panDragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // best-effort, même raison que la capture du pinceau plus bas.
    }
  }

  function movePan(e: React.PointerEvent): boolean {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return false;
    const size = measureView();
    if (size) {
      onViewportChangeRef.current(
        panBy(viewportRef.current, e.clientX - drag.lastX, e.clientY - drag.lastY, contentSizeRef.current, size),
      );
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    return true;
  }

  function endPan(e: React.PointerEvent): boolean {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return false;
    panDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    return true;
  }
  /** TRACÉ DE FORME EN COURS, en pixels de la TOILE.
   *
   *  En `useState` et non en ref, contrairement au geste de vue : la bande
   *  élastique doit se REDESSINER à chaque mouvement, donc elle doit passer par
   *  le rendu. Le geste de vue, lui, écrit une transformation CSS et n'a rien
   *  à re-rendre — c'est ce qui justifie sa ref, pas une préférence de style. */
  const [shapeDrag, setShapeDrag] = useState<{ pointerId: number; from: { x: number; y: number }; to: { x: number; y: number }; carre: boolean } | null>(null);

  // Dernière position souris connue (coordonnées écran), pour pouvoir
  // recalculer le curseur SANS bouger la souris — voir l'effet ci-dessous.
  const lastPointerScreenRef = useRef<{ clientX: number; clientY: number } | null>(null);

  // Curseur pinceau custom (type Adobe) : un cercle dimensionné au rayon du
  // pinceau qui suit la souris en mode masque. Positionné par manipulation DOM
  // directe (pas de state React) pour rester fluide à la fréquence pointermove.
  // Ne pilote QUE taille/position/dureté — la visibilité (opacity) est gérée
  // séparément par les appelants (show au move/enter, hide au leave), pour que
  // l'effet ci-dessous puisse rafraîchir taille/position sans forcer
  // l'affichage d'un curseur actuellement caché.
  function updateCursorGeometry(clientX: number, clientY: number) {
    const canvas = (ref as React.RefObject<HTMLCanvasElement>).current;
    const stage = stageRef.current;
    const cursor = cursorRef.current;
    if (!canvas || !stage || !cursor) return;
    const canvasRect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    // Échelle image→écran : le canvas est affiché réduit (max-width/height 100%).
    const scale = canvasRect.width / canvas.width;
    const screenRadius = brushSize * scale; // brushSize = rayon en px image
    const diameter = screenRadius * 2;
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.left = `${clientX - stageRect.left}px`;
    cursor.style.top = `${clientY - stageRect.top}px`;
    // Anneau interne = fraction à pleine force (dureté).
    cursor.style.setProperty("--brush-hardness", `${Math.round(brushHardness * 100)}%`);
  }

  function updateCursor(e: React.PointerEvent<HTMLCanvasElement>) {
    lastPointerScreenRef.current = { clientX: e.clientX, clientY: e.clientY };
    updateCursorGeometry(e.clientX, e.clientY);
    if (cursorRef.current) cursorRef.current.style.opacity = "1";
  }

  function hideCursor() {
    if (cursorRef.current) cursorRef.current.style.opacity = "0";
  }

  // Taille/dureté du pinceau réglées via les sliders (souris ailleurs, pas sur
  // le canvas) doivent se refléter sur le curseur IMMÉDIATEMENT, pas seulement
  // au prochain mouvement de souris — on rejoue la dernière position connue.
  useEffect(() => {
    const last = lastPointerScreenRef.current;
    if (last) updateCursorGeometry(last.clientX, last.clientY);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateCursorGeometry est redéfinie à chaque render ; l'inclure rejouerait l'effet en continu au lieu de le déclencher sur les seuls réglages de pinceau.
  }, [brushSize, brushHardness, maskPaintMode]);

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

  /** Point écran → pixels de l'image. Prend un simple porteur de `clientX/Y` et
   *  non un `PointerEvent<HTMLCanvasElement>` : le pasteboard émet les siens
   *  depuis un `<div>`, et le calcul ne lit de toute façon que ces deux
   *  nombres. Rend des coordonnées HORS bornes pour un point hors de l'image,
   *  volontairement — c'est ce qui permet au hit-test d'y répondre « rien ». */
  function toImageCoords(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
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

  // Un unmount pendant un trait en cours (ex. fermeture du panneau masque en
  // plein drag) laisserait le rAF coalescé en vol : il finirait par appeler
  // `onMaskStroke` sur un composant démonté, contre une prop potentiellement
  // périmée — annule le rAF en attente sans le flusher (pas de commit après
  // démontage, contrairement à `endStroke` qui flushe volontairement en fin
  // de trait normal).
  useEffect(() => {
    return () => {
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
    };
  }, []);

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
      ref={stageRef}
      className={`pasteboard ${isDragActive ? "pasteboard--drag-active" : ""}`.trim()}
      onDragEnter={(e) => {
        e.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragActive(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragActive(false);
        const file = e.dataTransfer.files[0];
        if (file) onFileDropped(file);
      }}
      // LE POURTOUR EST UNE SURFACE DE GESTE, pas un décor (décision Antoine,
      // 2026-08-01). Deux gestes y répondent, et ce sont les deux qu'on y
      // tente naturellement :
      //  — cliquer dedans DÉSÉLECTIONNE. C'était déjà le geste sur la toile
      //    (`handleCanvasPick`), mais il s'arrêtait au bord du `<canvas>` : dès
      //    qu'une photo couvrait la toile, il n'y avait plus un pixel de vide à
      //    viser et la sélection devenait inquittable à la souris.
      //  — Espace maintenu + glisser DÉPLACE LA VUE depuis n'importe où, pas
      //    seulement au-dessus de l'image.
      // Garde sur la cible : on ne traite ICI que le pourtour lui-même (ce
      // `<div>`) et la zone visible autour de la toile. La toile, l'overlay de
      // transformation et l'espace de travail vide gardent leurs propres
      // handlers — sans cette garde, chaque geste serait traité deux fois par
      // bouillonnement.
      onPointerDown={(e) => {
        // LE DÉPLACEMENT DE LA VUE A UN SEUL PROPRIÉTAIRE, et c'est cet
        // élément — le plus extérieur, donc celui qui reçoit tout par
        // bouillonnement, y compris ce qui a commencé sur la toile.
        //
        // Il en a fallu deux pendant une heure, et ça ne marchait pas : quand
        // le geste démarrait sur la toile, la capture allait à la toile, donc
        // `movePan` tournait DEUX fois par `pointermove` — une fois sur la
        // toile, une fois ici par bouillonnement. Le second appel lisait
        // `viewportRef.current` encore périmé (le `setState` du premier n'avait
        // pas eu lieu) et réécrivait l'ancienne valeur par-dessus la nouvelle.
        // Chaque déplacement s'annulait lui-même, et seulement au-dessus de la
        // toile — depuis le pourtour, la capture restait ici et il n'y avait
        // qu'un appel.
        //
        // AVANT la garde de cible, donc : un geste de vue commence où il veut.
        if (isPanGesture(e)) {
          beginPan(e);
          return;
        }
        // BOUTON PRINCIPAL SEULEMENT (ticket 29) : un clic droit sur le pourtour
        // ou le vide ouvre le menu contextuel de la toile — il ne DÉSÉLECTIONNE
        // pas. Sans ce garde, `onPick` tombait dans le vide et vidait la
        // sélection sous le menu qui s'ouvre.
        if (e.button !== 0) return;
        // La DÉSIGNATION, elle, reste locale : la toile et l'overlay de
        // transformation ont les leurs. Ici on ne traite que le pourtour
        // lui-même et la zone visible autour de la toile.
        if (e.target !== e.currentTarget && e.target !== viewRef.current) return;
        if (maskPaintMode || !onPick) return;
        const point = toImageCoords(e);
        // Coordonnées hors bornes attendues : le hit-test n'y trouve aucune
        // photo et rend `null`, ce que l'appelant traduit en désélection.
        if (point) onPick(point.x, point.y);
      }}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      {!hasImage && <EmptyWorkspace onOpenFile={onOpenFile} />}
      <div ref={viewRef} className={`pasteboard__view ${panning ? "pasteboard__view--pan" : ""}`.trim()}>
      <canvas
        ref={ref}
        aria-label="Zone de travail image"
        className={`pasteboard__canvas ${maskPaintMode && !panning ? "pasteboard__canvas--paint" : ""}`.trim()}
        // Zoom/déplacement en TRANSFORM CSS, `transform-origin: 0 0` (posé en
        // CSS) : le coin haut-gauche du canvas atterrit exactement sur
        // `(offsetX, offsetY)` et sa taille affichée vaut `contentSize * scale`,
        // ce qui est la définition littérale de `ViewportState`. Comme
        // `getBoundingClientRect()` reflète les transforms, toutes les
        // conversions écran→pixels image du projet restent justes SANS
        // modification (voir l'en-tête de `src/ui/viewport.ts`).
        style={{
          transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale})`,
          // AU-DESSUS DU PIXEL NATIF, on montre les PIXELS et non leur
          // interpolation. Le zoom monte désormais à 3200 % (`MAX_ZOOM`), et
          // son seul usage est d'inspecter ce qui ne se juge pas à 100 % : un
          // bord de masque pinceau, un liseré d'`outlines`, l'accroche d'un
          // coin. Lissés par le navigateur, ces bords deviennent flous
          // exactement là où on est venu les regarder — on aurait un zoom
          // profond qui ne montre rien de plus qu'à 100 %.
          // Sous 100 %, `auto` : la réduction DOIT rester lissée, sinon
          // l'échantillonnage au plus proche crénelle toute l'image.
          imageRendering: viewport.scale > 1 ? "pixelated" : "auto",
        }}
        onPointerDown={(e) => {
          // Le déplacement de la vue ne s'ouvre PAS ici : il appartient au
          // pasteboard, qui reçoit cet évènement juste après par
          // bouillonnement (voir son handler pour ce que coûtaient deux
          // propriétaires). On sort sans rien faire, et surtout sans peindre.
          if (isPanGesture(e)) return;
          // BOUTON PRINCIPAL SEULEMENT (ticket 29). Un clic droit sur la toile
          // ouvre le menu contextuel — il ne doit NI peindre, NI tracer une
          // forme, NI désigner un calque. Sans ce garde, `pointerdown` (qui
          // précède `contextmenu`) démarrait un trait ou un tracé et capturait le
          // pointeur, exactement comme le clic droit sur la poignée de pile avant
          // sa garde `button !== 0` (ticket 28). Le bouton du MILIEU est déjà
          // parti en déplacement de vue via `isPanGesture` ci-dessus.
          if (e.button !== 0) return;
          // TRACÉ DE FORME, avant la désignation : les deux partent du même
          // geste (bouton gauche enfoncé sur la toile) et ne peuvent pas
          // coexister. L'ordre suit celui de la palette — un outil choisi passe
          // avant le comportement par défaut.
          if (shapeDrawMode) {
            const pt = toImageCoords(e);
            if (!pt) return;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // best-effort, même raison que le pinceau : la capture est un
              // confort, son échec ne doit pas avorter le geste.
            }
            setShapeDrag({ pointerId: e.pointerId, from: pt, to: pt, carre: e.shiftKey });
            return;
          }
          if (!maskPaintMode) {
            // Désignation directe (T1). Hors mode peinture UNIQUEMENT, et
            // seulement si l'appelant l'a autorisée pour le mode courant : le
            // pinceau n'est jamais intercepté, la branche ci-dessous est
            // inchangée et prioritaire.
            if (onPick) {
              const pickPt = toImageCoords(e);
              if (pickPt) onPick(pickPt.x, pickPt.y);
            }
            return;
          }
          isPaintingRef.current = true;
          // Capture le pointeur : pointermove/pointerup continuent de cibler
          // le canvas même quand le curseur sort de ses bornes pendant qu'on
          // peint (bouton maintenu) — sans ça, sortir du canvas en peignant
          // interrompait le trait, obligeant à recliquer pour continuer.
          // try/catch délibéré : setPointerCapture peut lever NotFoundError
          // dans certaines circonstances (constaté avec des PointerEvent
          // synthétiques en test CDP — le pointeur n'est pas reconnu comme
          // "actif" par le moteur). La capture est un confort auxiliaire ; son
          // échec ne doit PAS empêcher l'action réellement critique (peindre)
          // qui suit — sans ce catch, l'exception non gérée avortait le
          // handler avant le premier tampon du trait, le faisant sauter en
          // silence.
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // best-effort : le trait continuera à fonctionner normalement
            // tant qu'on ne quitte pas les bornes du canvas pendant qu'on peint.
          }
          const pt = toImageCoords(e);
          // The stroke's first point paints immediately (no coalescing) so
          // there's no visible input lag on press.
          if (pt) onMaskStroke(pt.x, pt.y);
        }}
        onPointerMove={(e) => {
          // `movePan` N'EST PLUS APPELÉ ICI : le déplacement de la vue est
          // capturé par le pasteboard, donc pendant un geste de vue cet
          // élément ne reçoit même plus les mouvements. On sort quand même sur
          // un geste en cours, pour le cas d'un pointeur secondaire.
          if (panDragRef.current) return;
          // Le tracé lit `shiftKey` À CHAQUE MOUVEMENT et non au seul appui :
          // dans tous les éditeurs, Maj se presse et se relâche EN COURS de
          // geste et la contrainte suit. La mémoriser à l'appui obligerait à
          // recommencer le rectangle pour le passer en carré.
          if (shapeDrag && shapeDrag.pointerId === e.pointerId) {
            const pt = toImageCoords(e);
            if (pt) {
              setShapeDrag({ ...shapeDrag, to: pt, carre: e.shiftKey });
              // Aperçu vivant : le rect COURANT, calculé depuis les mêmes
              // valeurs que la bande élastique (setShapeDrag est asynchrone, on
              // ne lit donc pas l'état qu'on vient de poser).
              onShapeDrawProgress?.(rectFromDrag(shapeDrag.from, pt, e.shiftKey));
            }
            return;
          }
          if (!maskPaintMode || panning) return;
          updateCursor(e);
          if (!isPaintingRef.current) return;
          const pt = toImageCoords(e);
          // Pas de clamp ici : un point hors bornes reste valide, les dabs
          // du pinceau se clampent déjà aux bords de l'image (MaskPainter).
          if (pt) schedulePaint(pt.x, pt.y);
        }}
        onPointerEnter={(e) => {
          if (maskPaintMode && !panning) updateCursor(e);
        }}
        // `endPan` a disparu de ces deux handlers pour la même raison que
        // `movePan` : la fin d'un geste de vue arrive au pasteboard, qui
        // détient la capture. L'appeler ici aussi aurait relâché le geste
        // depuis le mauvais élément.
        onPointerUp={(e) => {
          // FIN DU TRACÉ. Le rectangle n'est remonté que s'il a de l'ampleur :
          // un clic simple ne doit rien créer, sinon chaque clic manqué laisse
          // un calque à annuler à la main. L'état se vide dans TOUS les cas —
          // y compris sur un geste rejeté, sinon la bande resterait à l'écran.
          if (shapeDrag && shapeDrag.pointerId === e.pointerId) {
            const rect = rectFromDrag(shapeDrag.from, shapeDrag.to, shapeDrag.carre);
            setShapeDrag(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            // Geste d'ampleur suffisante : on crée. Sinon on ANNULE, pour que
            // l'appelant défasse l'aperçu vivant du marquee (un clic manqué ne
            // doit rien laisser, ni calque ni sélection prévisualisée).
            if (isDrawnRectUsable(rect)) onShapeDrawn?.(rect);
            else onShapeDrawCancel?.();
            return;
          }
          endStroke();
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          // Un tracé annulé ne crée RIEN — même sémantique que le crop
          // abandonné : `pointercancel` n'est pas une validation. On prévient
          // l'appelant pour qu'il défasse l'aperçu vivant du marquee, le cas
          // échéant.
          if (shapeDrag) onShapeDrawCancel?.();
          setShapeDrag(null);
          endStroke();
        }}
        onPointerLeave={() => {
          // Ne termine PAS le trait : grâce au pointer capture, peindre
          // continue hors du canvas tant que le bouton est maintenu (voir
          // onPointerUp). Seul le curseur visuel custom se cache — le vrai
          // curseur OS prend le relais hors de notre zone dessinée.
          hideCursor();
        }}
      />
        {/* BANDE ÉLASTIQUE du tracé de forme.
          *
          * ⚠️ ELLE REPRODUIT LE TRANSFORM DU CANVAS, elle n'en hérite PAS. Le
          * zoom/déplacement est posé sur le `<canvas>` LUI-MÊME et non sur un
          * conteneur (voir son `style` plus haut) : une bande placée à côté de
          * lui ne reçoit donc rien. Mesuré le 2026-08-17 en la posant naïvement
          * — le rectangle sortait à 3371 px pour un geste au centre de la
          * fenêtre, soit à l'échelle 1:1 de l'image au lieu de l'échelle de vue.
          *
          * L'ORDRE DES TROIS TRANSFORMS EST LOAD-BEARING. Ils s'appliquent de
          * DROITE à GAUCHE : d'abord `translate(r.x, r.y)` en pixels d'IMAGE,
          * puis `scale`, puis `translate(offset)` en pixels d'ÉCRAN. C'est
          * exactement la chaîne que subit le canvas. Les intervertir placerait
          * la forme à un offset mis à l'échelle, donc juste au zoom 100 % et
          * faux partout ailleurs — le genre de bug qui se voit seulement quand
          * on a déjà zoomé.
          *
          * `pointerEvents: none` (en CSS) : elle est sous le curseur pendant
          * tout le geste, et sans ça elle volerait les `pointermove` au canvas
          * qui détient la capture. */}
        {shapeDrag && (() => {
          const r = rectFromDrag(shapeDrag.from, shapeDrag.to, shapeDrag.carre);
          return (
            <div
              className="pasteboard__shape-band"
              aria-hidden="true"
              style={{
                left: 0,
                top: 0,
                width: `${r.width}px`,
                height: `${r.height}px`,
                transformOrigin: "0 0",
                transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale}) translate(${r.x}px, ${r.y}px)`,
                // L'épaisseur du liseré est divisée par l'échelle pour rester
                // d'un pixel À L'ÉCRAN quel que soit le zoom. Sans ça, à 800 %
                // le trait ferait huit pixels et masquerait le bord qu'il
                // désigne ; à 13 % il disparaîtrait.
                borderWidth: `${1 / viewport.scale}px`,
              }}
            >
              {/* RETOUR CHIFFRÉ PENDANT LE GESTE (2026-08-18). Il manquait, et
                  c'est l'un des écarts que le ticket 17 avait mesurés sans le
                  corriger : on tirait une forme sans jamais savoir de quelle
                  taille. Photoshop affiche ses dimensions en traçant.

                  En PIXELS de l'image, pas en fraction du cadre : c'est
                  l'unité que l'utilisateur reconnaît, et la seule qui reste
                  vraie quand on zoome. Le shader, lui, continue de lire des
                  fractions — voir `aplatParamsFromRect`.

                  Contre-échelle sur l'étiquette : la bande est posée dans le
                  repère zoomé, donc sans elle le texte ferait huit fois sa
                  taille à 800 % et disparaîtrait à 13 %. Même raison que
                  l'épaisseur du liseré juste au-dessus. */}
              <span
                className="pasteboard__shape-band-mesure"
                style={{ transform: `scale(${1 / viewport.scale})` }}
              >
                {Math.round(r.width)} × {Math.round(r.height)} px
                {shapeDrag.carre ? " · carré" : ""}
              </span>
            </div>
          );
        })()}
        {children}
      </div>
      <div ref={cursorRef} className="pasteboard__brush-cursor" aria-hidden="true" />
    </div>
  );
});
