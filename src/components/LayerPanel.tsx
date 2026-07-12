import type { LayerState } from "../layers/types";
import { effectRegistry } from "../render/effects/registry";

interface Props {
  layers: LayerState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (effectId: string) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, newIndex: number) => void;
}

export function LayerPanel({ layers, selectedId, onSelect, onToggle, onAdd, onRemove, onReorder }: Props) {
  return (
    <div
      style={{
        width: 220,
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border-default)",
        padding: "var(--space-2)",
        color: "var(--text-primary)",
      }}
    >
      <select
        onChange={(e) => e.target.value && onAdd(e.target.value)}
        value=""
        style={{
          width: "100%",
          background: "var(--bg-input)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-sm)",
          padding: "var(--space-1) var(--space-2)",
          marginBottom: "var(--space-2)",
        }}
      >
        <option value="" disabled>
          + Ajouter un effet
        </option>
        {effectRegistry.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {layers.map((layer, index) => {
          const selected = layer.id === selectedId;
          return (
            <li
              key={layer.id}
              onClick={() => onSelect(layer.id)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", layer.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData("text/plain");
                if (draggedId && draggedId !== layer.id) onReorder(draggedId, index);
              }}
              style={{
                padding: "var(--space-2)",
                marginBottom: "var(--space-1)",
                background: selected ? "var(--accent-muted)" : "transparent",
                borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)",
                cursor: "grab",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(layer.id);
                  }}
                  style={{
                    padding: "2px 6px",
                    background: "transparent",
                    border: "none",
                    color: layer.enabled ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {layer.enabled ? "👁" : "—"}
                </button>
                <span style={{ color: selected ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {layer.effectId}
                </span>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(layer.id);
                }}
                style={{
                  padding: "2px 6px",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-tertiary)",
                }}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
