import { useCallback, useState } from "react";
import { DockedPanelCard } from "./DockedPanelCard";
import type { DockDropTarget, DockLayout } from "../../ui/dockLayout";
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
}

interface DockDragState {
  draggedId: string;
  pointerId: number;
  grabOffset: { x: number; y: number };
  pointerPosition: { x: number; y: number };
  target: DockDropTarget | null;
}

export function PanelColumn({ panels, layout, onMove }: PanelColumnProps) {
  const [dragState, setDragState] = useState<DockDragState | null>(null);
  const draggedPanel = dragState ? panels.find((panel) => panel.id === dragState.draggedId) : null;

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
    });
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setDragState((current) => {
      if (!current || event.pointerId !== current.pointerId) return current;
      const card = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-dock-column]");
      const pointerPosition = { x: event.clientX, y: event.clientY };
      if (!card) return { ...current, pointerPosition, target: null };

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
      return { ...current, pointerPosition, target };
    });
  }, []);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    setDragState((current) => {
      if (!current || event.pointerId !== current.pointerId) return current;
      if (commit && current.target) onMove(current.draggedId, current.target);
      return null;
    });
  }, [onMove]);

  let chipStyle: React.CSSProperties | null = null;
  let chipClassName = "drag-reorder__insert-chip";
  if (dragState?.target) {
    const dock = document.querySelector<HTMLElement>(".panel-column");
    if (dock) {
      if (dragState.target.kind === "vertical") {
        const card = document.querySelector<HTMLElement>(`[data-dock-column="${dragState.target.columnIndex}"][data-dock-row="${dragState.target.rowIndex}"]`);
        if (card) {
          const cardRect = card.getBoundingClientRect();
          chipStyle = {
            top: (dragState.target.position === "before" ? cardRect.top : cardRect.bottom) - dock.getBoundingClientRect().top,
          };
        }
      } else {
        chipClassName += " panel-column__insert-chip--horizontal";
        chipStyle = {
          left: dragState.pointerPosition.x - dock.getBoundingClientRect().left,
          top: dragState.pointerPosition.y - dock.getBoundingClientRect().top,
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
