import { useCallback, useRef, useState } from "react";
import { DockedPanelCard } from "./DockedPanelCard";
import { isNoOpDockDrop, type DockDropTarget, type DockLayout } from "../../ui/dockLayout";
import { clampDockWidth } from "./dockWidth";
import "../../ui/dragReorder.css";
import "./PanelColumn.css";

export interface DockedPanelSpec {
  id: string;
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  content: React.ReactNode;
}

export interface PanelColumnProps {
  panels: DockedPanelSpec[];
  layout: DockLayout;
  onMove: (id: string, target: DockDropTarget) => void;
  width: number;
  onWidthChange: (width: number) => void;
}

interface DockDragState {
  draggedId: string;
  pointerId: number;
  grabOffset: { x: number; y: number };
  pointerPosition: { x: number; y: number };
  target: DockDropTarget | null;
  targetBounds: { top: number; right: number; bottom: number; left: number } | null;
}

export function PanelColumn({ panels, layout, onMove, width, onWidthChange }: PanelColumnProps) {
  const [dragState, setDragState] = useState<DockDragState | null>(null);
  const draggedPanel = dragState ? panels.find((panel) => panel.id === dragState.draggedId) : null;

  // Redimensionnement en largeur — poignée sur le bord GAUCHE de TOUT le
  // conteneur .panel-column (toutes colonnes confondues, décision Antoine
  // 2026-07-21 : largeur globale partagée, pas de redimensionnement par
  // colonne indépendant). La colonne est ancrée à droite (right: var(--space-6)),
  // donc glisser vers la GAUCHE agrandit la largeur, vers la DROITE la réduit —
  // pas de magnétisme, juste un clamp aux bornes. État de drag en ref (pas
  // besoin de re-render pendant le geste : la largeur elle-même vit dans
  // App.tsx via onWidthChange, appelé à chaque pointermove).
  const widthDragRef = useRef<{ pointerId: number; startClientX: number; startWidth: number } | null>(null);

  const handleWidthPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      widthDragRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startWidth: width };
    },
    [width]
  );

  const handleWidthPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = widthDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const delta = e.clientX - drag.startClientX;
      onWidthChange(clampDockWidth(drag.startWidth - delta));
    },
    [onWidthChange]
  );

  const handleWidthPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = widthDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    widthDragRef.current = null;
  }, []);

  const handleWidthPointerCancel = handleWidthPointerUp;

  const handlePointerDown = useCallback((id: string, event: React.PointerEvent<HTMLDivElement>) => {
    const card = event.currentTarget.closest<HTMLElement>(".panel-column__item");
    if (!card) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = card.getBoundingClientRect();
    setDragState((current) => current ?? {
      draggedId: id,
      pointerId: event.pointerId,
      grabOffset: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      pointerPosition: { x: event.clientX, y: event.clientY },
      target: null,
      targetBounds: null,
    });
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setDragState((current) => {
      if (!current || event.pointerId !== current.pointerId) return current;
      const card = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-dock-column]");
      const pointerPosition = { x: event.clientX, y: event.clientY };
      if (!card) return { ...current, pointerPosition, target: null, targetBounds: null };

      const columnIndex = Number(card.dataset.dockColumn);
      const rowIndex = Number(card.dataset.dockRow);
      const rect = card.getBoundingClientRect();
      const relativeX = (event.clientX - rect.left) / rect.width;
      const target: DockDropTarget = relativeX < .25
        ? { kind: "horizontal", columnIndex, position: "left" }
        : relativeX > .75
          ? { kind: "horizontal", columnIndex, position: "right" }
          : {
              kind: "vertical",
              columnIndex,
              rowIndex,
              position: event.clientY - rect.top < rect.height / 2 ? "before" : "after",
            };
      if (isNoOpDockDrop(layout, current.draggedId, target)) return { ...current, pointerPosition, target: null, targetBounds: null };
      return { ...current, pointerPosition, target, targetBounds: rect };
    });
  }, [layout]);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (commit && dragState.target) onMove(dragState.draggedId, dragState.target);
    setDragState(null);
  }, [dragState, onMove]);

  let chipStyle: React.CSSProperties | null = null;
  let chipClassName = "drag-reorder__insert-chip";
  if (dragState?.target && dragState.targetBounds) {
    const dock = document.querySelector<HTMLElement>(".panel-column");
    if (dock) {
      if (dragState.target.kind === "vertical") {
        chipStyle = {
          left: (dragState.targetBounds.left + dragState.targetBounds.right) / 2 - dock.getBoundingClientRect().left,
          top: (dragState.target.position === "before" ? dragState.targetBounds.top : dragState.targetBounds.bottom) - dock.getBoundingClientRect().top,
        };
      } else {
        chipClassName += " panel-column__insert-chip--horizontal";
        chipStyle = {
          left: (dragState.target.position === "left" ? dragState.targetBounds.left : dragState.targetBounds.right) - dock.getBoundingClientRect().left,
          top: (dragState.targetBounds.top + dragState.targetBounds.bottom) / 2 - dock.getBoundingClientRect().top,
        };
      }
    }
  }

  return (
    <div
      className="panel-column"
      onPointerMove={dragState ? handlePointerMove : undefined}
      onPointerUp={dragState ? (event) => finishDrag(event, true) : undefined}
      onPointerCancel={dragState ? (event) => finishDrag(event, false) : undefined}
    >
      <div
        className="panel-column__width-handle"
        onPointerDown={handleWidthPointerDown}
        onPointerMove={handleWidthPointerMove}
        onPointerUp={handleWidthPointerUp}
        onPointerCancel={handleWidthPointerCancel}
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionner la largeur du dock"
        tabIndex={0}
      />
      <div className="panel-column__grid">
        {layout.map((column, columnIndex) => (
          <div className="panel-column__stack" key={column.join("-")}>
            {column.map((id, rowIndex) => {
              const panel = panels.find((candidate) => candidate.id === id);
              if (!panel) return null;
              return (
                <div className="panel-column__item" data-dock-column={columnIndex} data-dock-row={rowIndex} key={panel.id}>
                  <DockedPanelCard
                    title={panel.title}
                    collapsed={panel.collapsed}
                    onCollapsedChange={panel.onCollapsedChange}
                    reorderIndex={rowIndex}
                    dragging={dragState?.draggedId === panel.id}
                    titlebarProps={{ onPointerDown: (event) => handlePointerDown(panel.id, event) }}
                  >
                    {panel.content}
                  </DockedPanelCard>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {chipStyle && <div className={chipClassName} style={chipStyle} aria-hidden="true" />}
      {dragState && draggedPanel && (
        <div
          className="panel-column__ghost"
          style={{ transform: `translate(${dragState.pointerPosition.x - dragState.grabOffset.x}px, ${dragState.pointerPosition.y - dragState.grabOffset.y}px)` }}
          aria-hidden="true"
        >
          <div className="docked-panel-card">
            <div className="docked-panel-card__titlebar"><span className="docked-panel-card__title">{draggedPanel.title}</span></div>
            {!draggedPanel.collapsed && <div className="docked-panel-card__content">{draggedPanel.content}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
