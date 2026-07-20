import { Fragment } from "react";
import { DockedPanelCard } from "./DockedPanelCard";
import { usePointerReorder } from "../../ui/dragReorder";
import "./PanelColumn.css";

export interface DockedPanelSpec { id: string; title: string; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void; content: React.ReactNode; }
export interface PanelColumnProps { panels: DockedPanelSpec[]; onReorder: (id: string, newIndex: number) => void; }

export function PanelColumn({ panels, onReorder }: PanelColumnProps) {
  const { dragState, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } = usePointerReorder(panels, (panel) => panel.id, "data-reorder-index", onReorder);
  const draggedPanel = dragState ? panels.find((p) => p.id === dragState.draggedId) : null;
  let chipTop: number | null = null;
  if (dragState && dragState.overIndex !== null && dragState.overPosition !== null) {
    const overEl = document.querySelector<HTMLElement>(`[data-reorder-index="${dragState.overIndex}"]`);
    const columnEl = document.querySelector<HTMLElement>(".panel-column");
    if (overEl && columnEl) { const rect = overEl.getBoundingClientRect(); chipTop = (dragState.overPosition === "before" ? rect.top : rect.bottom) - columnEl.getBoundingClientRect().top; }
  }
  return <div className="panel-column" onPointerMove={dragState ? handlePointerMove : undefined} onPointerUp={dragState ? handlePointerUp : undefined} onPointerCancel={dragState ? handlePointerCancel : undefined}>
    <div className="panel-column__stack">{panels.map((panel, index) => <Fragment key={panel.id}><DockedPanelCard title={panel.title} collapsed={panel.collapsed} onCollapsedChange={panel.onCollapsedChange} reorderIndex={index} dragging={dragState?.draggedId === panel.id} titlebarProps={{ onPointerDown: (e) => { const cardEl = e.currentTarget.closest<HTMLElement>(".docked-panel-card"); if (cardEl) handlePointerDown(panel.id, e.pointerId, e.currentTarget, cardEl, e.clientX, e.clientY); } }}>{panel.content}</DockedPanelCard></Fragment>)}</div>
    {dragState && chipTop !== null && <div className="panel-column__insert-chip panel-column__insert-chip--visible" style={{ top: chipTop }} aria-hidden="true" />}
    {dragState && draggedPanel && <div className="panel-column__ghost" style={{ transform: `translate(${dragState.pointerPosition.x - dragState.grabOffset.x}px, ${dragState.pointerPosition.y - dragState.grabOffset.y}px)` }} aria-hidden="true"><div className="docked-panel-card"><div className="docked-panel-card__titlebar"><span className="docked-panel-card__title">{draggedPanel.title}</span></div>{!draggedPanel.collapsed && <div className="docked-panel-card__content">{draggedPanel.content}</div>}</div></div>}
  </div>;
}
