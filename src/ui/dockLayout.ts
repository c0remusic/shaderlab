export type DockLayout = string[][];

export type DockDropTarget =
  | { kind: "vertical"; columnIndex: number; rowIndex: number; position: "before" | "after" }
  | { kind: "horizontal"; columnIndex: number; position: "left" | "right" };

const HORIZONTAL_DOCK_SNAP_RATIO = 0.4;

export function getDockDropTarget(
  columnIndex: number,
  rowIndex: number,
  relativeX: number,
  relativeY: number,
): DockDropTarget {
  if (relativeX < HORIZONTAL_DOCK_SNAP_RATIO) {
    return { kind: "horizontal", columnIndex, position: "left" };
  }
  if (relativeX > 1 - HORIZONTAL_DOCK_SNAP_RATIO) {
    return { kind: "horizontal", columnIndex, position: "right" };
  }
  return {
    kind: "vertical",
    columnIndex,
    rowIndex,
    position: relativeY < 0.5 ? "before" : "after",
  };
}

function findPanel(layout: DockLayout, id: string): { columnIndex: number; rowIndex: number } | null {
  for (let columnIndex = 0; columnIndex < layout.length; columnIndex += 1) {
    const rowIndex = layout[columnIndex].indexOf(id);
    if (rowIndex !== -1) return { columnIndex, rowIndex };
  }
  return null;
}

function removePanel(layout: DockLayout, id: string): DockLayout {
  return layout
    .map((column) => column.filter((panelId) => panelId !== id))
    .filter((column) => column.length > 0);
}

export function isNoOpDockDrop(layout: DockLayout, id: string, target: DockDropTarget): boolean {
  const source = findPanel(layout, id);
  if (!source) return true;
  if (target.kind === "horizontal") return source.columnIndex === target.columnIndex && layout[source.columnIndex].length === 1;
  if (source.columnIndex !== target.columnIndex) return false;
  return target.position === "before"
    ? target.rowIndex === source.rowIndex || target.rowIndex === source.rowIndex + 1
    : target.rowIndex === source.rowIndex || target.rowIndex === source.rowIndex - 1;
}

export function movePanelInDock(layout: DockLayout, id: string, target: DockDropTarget): DockLayout {
  const source = findPanel(layout, id);
  if (!source || isNoOpDockDrop(layout, id, target)) return layout;

  const withoutPanel = removePanel(layout, id);
  const removedColumnBeforeTarget = source.columnIndex < target.columnIndex && layout[source.columnIndex].length === 1;
  const columnIndex = target.columnIndex - (removedColumnBeforeTarget ? 1 : 0);

  if (target.kind === "horizontal") {
    const insertionIndex = columnIndex + (target.position === "right" ? 1 : 0);
    return [...withoutPanel.slice(0, insertionIndex), [id], ...withoutPanel.slice(insertionIndex)];
  }

  const column = withoutPanel[columnIndex];
  if (!column) return layout;
  const targetRow = target.rowIndex - (source.columnIndex === target.columnIndex && source.rowIndex < target.rowIndex ? 1 : 0);
  const insertionIndex = targetRow + (target.position === "after" ? 1 : 0);
  return [
    ...withoutPanel.slice(0, columnIndex),
    [...column.slice(0, insertionIndex), id, ...column.slice(insertionIndex)],
    ...withoutPanel.slice(columnIndex + 1),
  ];
}
