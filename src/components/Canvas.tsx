import { forwardRef, useRef, useEffect, useState, useCallback } from "react";
import { EmptyWorkspace } from "./EmptyWorkspace";
import { panBy, zoomByWheel, type Size, type ViewportState } from "../ui/viewport";

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
    return spaceHeld || e.button === 1;
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

  function toImageCoords(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null {
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
      className={`canvas-stage ${isDragActive ? "canvas-stage--drag-active" : ""}`.trim()}
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
    >
      {!hasImage && <EmptyWorkspace onOpenFile={onOpenFile} />}
      <div ref={viewRef} className={`canvas-stage__view ${spaceHeld ? "canvas-stage__view--pan" : ""}`.trim()}>
      <canvas
        ref={ref}
        aria-label="Zone de travail image"
        className={`canvas-stage__canvas ${maskPaintMode && !spaceHeld ? "canvas-stage__canvas--paint" : ""}`.trim()}
        // Zoom/déplacement en TRANSFORM CSS, `transform-origin: 0 0` (posé en
        // CSS) : le coin haut-gauche du canvas atterrit exactement sur
        // `(offsetX, offsetY)` et sa taille affichée vaut `contentSize * scale`,
        // ce qui est la définition littérale de `ViewportState`. Comme
        // `getBoundingClientRect()` reflète les transforms, toutes les
        // conversions écran→pixels image du projet restent justes SANS
        // modification (voir l'en-tête de `src/ui/viewport.ts`).
        style={{ transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale})` }}
        onPointerDown={(e) => {
          if (isPanGesture(e)) {
            beginPan(e);
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
          if (movePan(e)) return;
          if (!maskPaintMode || spaceHeld) return;
          updateCursor(e);
          if (!isPaintingRef.current) return;
          const pt = toImageCoords(e);
          // Pas de clamp ici : un point hors bornes reste valide, les dabs
          // du pinceau se clampent déjà aux bords de l'image (MaskPainter).
          if (pt) schedulePaint(pt.x, pt.y);
        }}
        onPointerEnter={(e) => {
          if (maskPaintMode && !spaceHeld) updateCursor(e);
        }}
        onPointerUp={(e) => {
          if (endPan(e)) return;
          endStroke();
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={(e) => {
          if (endPan(e)) return;
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
        {children}
      </div>
      <div ref={cursorRef} className="canvas-stage__brush-cursor" aria-hidden="true" />
    </div>
  );
});
