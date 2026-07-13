import { Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import type { LayerState } from "../layers/types";
import { effectRegistry, getEffect } from "../render/effects/registry";
import { Select } from "../ui/Select";
import { IconButton } from "../ui/IconButton";

interface Props {
  layers: LayerState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (effectId: string) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, newIndex: number) => void;
}

const addEffectOptions = effectRegistry.map((e) => ({ value: e.id, label: e.name }));

export function LayerPanel({ layers, selectedId, onSelect, onToggle, onAdd, onRemove, onReorder }: Props) {
  return (
    <div className="layer-panel">
      <Select
        label="Ajouter un effet"
        value={null}
        placeholder="+ Ajouter un effet"
        options={addEffectOptions}
        onChange={onAdd}
      />
      <ul className="layer-panel__list">
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
              className={`layer-panel__row ${selected ? "layer-panel__row--selected" : ""}`.trim()}
            >
              <span className="layer-panel__row-main">
                <GripVertical className="layer-panel__grip" size={14} strokeWidth={1.5} aria-hidden="true" />
                <IconButton
                  label={layer.enabled ? "Masquer le calque" : "Afficher le calque"}
                  size="compact"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(layer.id);
                  }}
                >
                  {layer.enabled ? (
                    <Eye size={14} strokeWidth={1.5} aria-hidden="true" />
                  ) : (
                    <EyeOff size={14} strokeWidth={1.5} aria-hidden="true" />
                  )}
                </IconButton>
                <span
                  className={`layer-panel__row-name ${selected ? "layer-panel__row-name--selected" : ""}`.trim()}
                >
                  {getEffect(layer.effectId).name}
                </span>
              </span>
              <IconButton
                label="Supprimer le calque"
                size="compact"
                variant="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(layer.id);
                }}
              >
                <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
