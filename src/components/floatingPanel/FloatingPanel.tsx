import { useCallback, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { IconButton } from "../../ui/IconButton";
import { computeSnappedPosition, type SnapCandidate } from "./snapping";
import { computeNudgedPosition, type NudgeDirection } from "./keyboardNudge";
import "./FloatingPanel.css";

export interface FloatingPanelProps {
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  collapsed: boolean;
  onPositionChange: (position: { x: number; y: number }) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Les AUTRES panneaux visibles (jamais soi-même) — pour le magnétisme. */
  siblingRects: SnapCandidate[];
  canvasSize: { width: number; height: number };
  children: React.ReactNode;
}

interface DragGhostState {
  pointerId: number;
  /** Décalage curseur -> coin haut-gauche du panneau au moment du pointerdown,
   *  pour que le fantôme suive le curseur sans "sauter" au premier mouvement. */
  grabOffset: { x: number; y: number };
  /** Position courante du fantôme (coordonnées du conteneur canvas). */
  ghostPosition: { x: number; y: number };
}

const NUDGE_KEYS = new Set<NudgeDirection>(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * Conteneur générique flottant — Calques/Réglages aujourd'hui, Masques
 * (Tranche 4 du chantier calques/masquage) demain. Position et repli sont
 * TOUJOURS remontés à l'appelant (App.tsx) : ce composant ne possède aucun
 * state de position PERSISTANT — seul l'état éphémère du drag en cours
 * (fantôme) est local.
 *
 * Drag par pointer events (setPointerCapture), PAS le DnD HTML5 natif — même
 * décision et même raison que LayerPanel.tsx : dragstart HTML5 ne relaie pas
 * fiablement dragover/drop dans ce WebView2 (preuve CDP sur geste humain réel).
 *
 * Pendant le drag (design.md §4, observé sur Photoshop réel) : le panneau
 * reste visible à sa position d'origine, ESTOMPÉ, jusqu'au relâchement ; un
 * fantôme semi-transparent suit le curseur via transform (pas top/left, pour
 * rester fluide). Au relâchement, le magnétisme (snapping.ts) s'applique UNE
 * fois — jamais pendant le drag.
 *
 * Alternative clavier (finding revue adverse codex-crosscheck, convention
 * d'accessibilité du projet) : la poignée de titre est focusable, les flèches
 * directionnelles nudgent par pas fixe (keyboardNudge.ts), Shift = pas large.
 * Le magnétisme s'applique aussi à la position atteinte au clavier.
 */
export function FloatingPanel({
  title,
  position,
  size,
  collapsed,
  onPositionChange,
  onCollapsedChange,
  siblingRects,
  canvasSize,
  children,
}: FloatingPanelProps) {
  const [ghost, setGhost] = useState<DragGhostState | null>(null);
  const titlebarRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Ignore un 2e pointeur tant qu'un drag est en cours — même garde que
      // LayerPanel.handleGripPointerDown (finding codex-crosscheck original).
      if (ghost) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setGhost({
        pointerId: e.pointerId,
        grabOffset: { x: e.clientX - position.x, y: e.clientY - position.y },
        ghostPosition: position,
      });
    },
    [ghost, position]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    setGhost((prev) => {
      if (!prev || e.pointerId !== prev.pointerId) return prev;
      return {
        ...prev,
        ghostPosition: {
          x: e.clientX - prev.grabOffset.x,
          y: e.clientY - prev.grabOffset.y,
        },
      };
    });
  }, []);

  const commitGhostPosition = useCallback(
    (raw: { x: number; y: number }) => {
      const snapped = computeSnappedPosition(
        { ...raw, width: size.width, height: size.height },
        siblingRects,
        canvasSize
      );
      onPositionChange(snapped);
    },
    [size, siblingRects, canvasSize, onPositionChange]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      setGhost((prev) => {
        if (!prev || e.pointerId !== prev.pointerId) return prev;
        commitGhostPosition(prev.ghostPosition);
        return null;
      });
    },
    [commitGhostPosition]
  );

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    setGhost((prev) => (prev && e.pointerId === prev.pointerId ? null : prev));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!NUDGE_KEYS.has(e.key as NudgeDirection)) return;
      e.preventDefault();
      const nudged = computeNudgedPosition(
        { ...position, width: size.width, height: size.height },
        e.key as NudgeDirection,
        e.shiftKey,
        canvasSize
      );
      commitGhostPosition(nudged);
    },
    [position, size, canvasSize, commitGhostPosition]
  );

  return (
    <>
      <div
        className={`floating-panel ${ghost ? "floating-panel--origin-dimmed" : ""}`.trim()}
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      >
        <div
          ref={titlebarRef}
          className="floating-panel__titlebar"
          tabIndex={0}
          aria-label={`Déplacer le panneau ${title} (flèches pour nudger, Shift = pas large)`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onKeyDown={handleKeyDown}
        >
          <span className="floating-panel__title">{title}</span>
          <IconButton
            label={collapsed ? "Déplier le panneau" : "Replier le panneau"}
            size="compact"
            // stopPropagation : le bouton est imbriqué dans la poignée de
            // titre porteuse des handlers pointer de drag (finding auditor
            // 2026-07-20) — sans ça, un clic sur le chevron bubble jusqu'au
            // titlebar et déclenche un cycle drag (fantôme + re-snap au
            // relâchement) pour un simple repli/dépli.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onCollapsedChange(!collapsed);
            }}
          >
            {collapsed ? (
              <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
          </IconButton>
        </div>
        {!collapsed && <div className="floating-panel__content">{children}</div>}
      </div>
      {ghost && (
        <div
          className="floating-panel floating-panel--ghost"
          style={{
            transform: `translate(${ghost.ghostPosition.x}px, ${ghost.ghostPosition.y}px)`,
            width: size.width,
            height: size.height,
          }}
          aria-hidden="true"
        />
      )}
    </>
  );
}
