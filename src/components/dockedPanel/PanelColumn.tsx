import { Fragment } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { DockedPanelCard } from "./DockedPanelCard";
import { usePointerReorder } from "../../ui/dragReorder";
import "./PanelColumn.css";

export interface DockedPanelSpec { id: string; title: string; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void; content: React.ReactNode; }
export interface PanelColumnProps { panels: DockedPanelSpec[]; onReorder: (id: string, newIndex: number) => void; }
const SLOT_SIZES = [{ defaultSize: "45", minSize: "20", maxSize: "80" }, { defaultSize: "55", minSize: "20", maxSize: "80" }];

export function PanelColumn({ panels, onReorder }: PanelColumnProps) {
  const { dragState, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } = usePointerReorder(panels, (panel) => panel.id, "data-reorder-index", onReorder);
  const draggedPanel = dragState ? panels.find((p) => p.id === dragState.draggedId) : null;
  let chipTop: number | null = null;
  if (dragState && dragState.overIndex !== null && dragState.overPosition !== null) {
    const overEl = document.querySelector<HTMLElement>(`[data-reorder-index="${dragState.overIndex}"]`);
    const columnEl = document.querySelector<HTMLElement>(".panel-column");
    if (overEl && columnEl) { const rect = overEl.getBoundingClientRect(); const columnRect = columnEl.getBoundingClientRect(); chipTop = (dragState.overPosition === "before" ? rect.top : rect.bottom) - columnRect.top; }
  }
  return (
    <div className="panel-column" onPointerMove={dragState ? handlePointerMove : undefined} onPointerUp={dragState ? handlePointerUp : undefined} onPointerCancel={dragState ? handlePointerCancel : undefined}>
      <Group orientation="vertical" className="panel-column__group">
        {panels.map((panel, index) => { const slot = SLOT_SIZES[index] ?? SLOT_SIZES[SLOT_SIZES.length - 1]; return (
          <Fragment key={`${panel.id}-${index}`}>
            {index > 0 && <Separator className="panel-column__handle" aria-label="Redimensionner les panneaux" />}
            <Panel id={panel.id} defaultSize={slot.defaultSize} minSize={slot.minSize} maxSize={slot.maxSize} className="panel-column__pane">
              <DockedPanelCard title={panel.title} collapsed={panel.collapsed} onCollapsedChange={panel.onCollapsedChange} reorderIndex={index} dragging={dragState?.draggedId === panel.id} titlebarProps={{ onPointerDown: (e) => { const cardEl = e.currentTarget.closest<HTMLElement>(".docked-panel-card"); if (cardEl) handlePointerDown(panel.id, e.pointerId, e.currentTarget, cardEl, e.clientX, e.clientY); } }}>{panel.content}</DockedPanelCard>
            </Panel>
          </Fragment>
        ); })}
      </Group>
      {dragState && chipTop !== null && <div className="panel-column__insert-chip panel-column__insert-chip--visible" style={{ top: chipTop }} aria-hidden="true" />}
      {dragState && draggedPanel && <div className="panel-column__ghost" style={{ transform: `translate(${dragState.pointerPosition.x - dragState.grabOffset.x}px, ${dragState.pointerPosition.y - dragState.grabOffset.y}px)` }} aria-hidden="true"><div className="docked-panel-card"><div className="docked-panel-card__titlebar"><span className="docked-panel-card__title">{draggedPanel.title}</span></div>{!draggedPanel.collapsed && <div className="docked-panel-card__content">{draggedPanel.content}</div>}</div></div>}
    </div>
  );
}
