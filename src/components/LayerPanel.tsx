import type { LayerState } from "../layers/types";
import { effectRegistry } from "../render/effects/registry";

interface Props {
  layers: LayerState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (effectId: string) => void;
  onRemove: (id: string) => void;
}

export function LayerPanel({ layers, selectedId, onSelect, onToggle, onAdd, onRemove }: Props) {
  return (
    <div style={{ width: 220, borderRight: "1px solid #333", padding: 8 }}>
      <select onChange={(e) => e.target.value && onAdd(e.target.value)} value="">
        <option value="" disabled>
          + Ajouter un effet
        </option>
        {effectRegistry.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {layers.map((layer) => (
          <li
            key={layer.id}
            onClick={() => onSelect(layer.id)}
            style={{
              padding: 6,
              background: layer.id === selectedId ? "#2a2a2a" : "transparent",
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(layer.id);
                }}
              >
                {layer.enabled ? "👁" : "—"}
              </button>{" "}
              {layer.effectId}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(layer.id);
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
