import { forwardRef, useRef, useEffect, useState } from "react";
import { EmptyWorkspace } from "./EmptyWorkspace";

interface Props {
  onFileDropped: (file: File) => void;
  hasImage: boolean;
  onOpenFile: () => void;
  maskPaintMode: boolean;
  onMaskStroke: (x: number, y: number) => void;
  onStrokeEnd: () => void;
  /** Rayon du pinceau en pixels IMAGE (= `radius` de paintStroke). Sert à
   *  dimensionner le curseur cercle custom. */
  brushSize: number;
  /** Dureté 0..1 : fraction du rayon à pleine force (anneau interne du curseur). */
  brushHardness: number;
}

export const Canvas = forwardRef<HTMLCanvasElement, Props>(function Canvas(
  { onFileDropped, hasImage, onOpenFile, maskPaintMode, onMaskStroke, onStrokeEnd, brushSize, brushHardness },
  ref
) {
  const isPaintingRef = useRef(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <canvas
        ref={ref}
        aria-label="Zone de travail image"
        className={`canvas-stage__canvas ${maskPaintMode ? "canvas-stage__canvas--paint" : ""}`.trim()}
        onPointerDown={(e) => {
          if (!maskPaintMode) return;
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
          if (!maskPaintMode) return;
          updateCursor(e);
          if (!isPaintingRef.current) return;
          const pt = toImageCoords(e);
          // Pas de clamp ici : un point hors bornes reste valide, les dabs
          // du pinceau se clampent déjà aux bords de l'image (MaskPainter).
          if (pt) schedulePaint(pt.x, pt.y);
        }}
        onPointerEnter={(e) => {
          if (maskPaintMode) updateCursor(e);
        }}
        onPointerUp={(e) => {
          endStroke();
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={endStroke}
        onPointerLeave={() => {
          // Ne termine PAS le trait : grâce au pointer capture, peindre
          // continue hors du canvas tant que le bouton est maintenu (voir
          // onPointerUp). Seul le curseur visuel custom se cache — le vrai
          // curseur OS prend le relais hors de notre zone dessinée.
          hideCursor();
        }}
      />
      <div ref={cursorRef} className="canvas-stage__brush-cursor" aria-hidden="true" />
    </div>
  );
});
