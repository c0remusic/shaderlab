import { memo, useCallback, useState } from "react";
import { Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import type { LayerState } from "../layers/types";
import { effectRegistry, getEffect } from "../render/effects/registry";
import { blendRegistry } from "../render/blend/registry";
import { Select } from "../ui/Select";
import { Slider } from "../ui/Slider";
import { IconButton } from "../ui/IconButton";

interface Props {
  layers: LayerState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (effectId: string) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, newIndex: number) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onOpacityCommit: () => void;
  onBlendModeChange: (id: string, blendMode: string) => void;
}

interface LayerRowProps {
  layer: LayerState;
  index: number;
  selected: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onGripPointerDown: (id: string, pointerId: number, target: Element) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onOpacityCommit: () => void;
  onBlendModeChange: (id: string, blendMode: string) => void;
}

const addEffectOptions = effectRegistry.map((e) => ({ value: e.id, label: e.name }));
const blendModeOptions = blendRegistry.map((m) => ({ value: m.id, label: m.name }));

// Mémoïsée : sans ça, un drag du slider d'opacité d'UN calque re-render
// (re-diffe) la liste ENTIÈRE des calques à chaque frame — coût qui grandit
// avec le nombre de calques, contrairement au slider de paramètre d'effet
// (ParamPanel) qui ne porte qu'un seul calque. Ne sert à rien sans callbacks
// stables côté App.tsx (useCallback) : voir le commentaire équivalent là-bas.
const LayerRow = memo(function LayerRow({
  layer,
  index,
  selected,
  isDragging,
  isDropTarget,
  onSelect,
  onToggle,
  onRemove,
  onGripPointerDown,
  onOpacityChange,
  onOpacityCommit,
  onBlendModeChange,
}: LayerRowProps) {
  const rowClass = [
    "layer-panel__row",
    selected && "layer-panel__row--selected",
    isDragging && "layer-panel__row--dragging",
    isDropTarget && "layer-panel__row--drop-target",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li
      onClick={() => onSelect(layer.id)}
      data-layer-row-index={index}
      className={rowClass}
    >
      <div className="layer-panel__row-top">
        <span className="layer-panel__row-main">
          <span
            className="layer-panel__grip-handle"
            onPointerDown={(e) => {
              e.stopPropagation();
              onGripPointerDown(layer.id, e.pointerId, e.currentTarget);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="layer-panel__grip" size={14} strokeWidth={1.5} aria-hidden="true" />
          </span>
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
          <span className={`layer-panel__row-name ${selected ? "layer-panel__row-name--selected" : ""}`.trim()}>
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
      </div>
      <div className="layer-panel__row-controls" onClick={(e) => e.stopPropagation()}>
        <Slider
          label="Opacité"
          value={layer.opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onOpacityChange(layer.id, v)}
          onCommit={onOpacityCommit}
        />
        <Select
          label="Fusion"
          value={layer.blendMode}
          options={blendModeOptions}
          onChange={(v) => onBlendModeChange(layer.id, v)}
        />
      </div>
    </li>
  );
});

// Réordonnancement par pointer events, PAS le DnD HTML5 natif (draggable/
// onDragStart/onDragOver/onDrop) — abandonné après preuve obtenue via une
// sonde CDP sur un geste humain réel : dragstart se déclenche correctement,
// mais WebView2 ne relaie ensuite JAMAIS dragover/drop au contenu web,
// quelle que soit la distance parcourue par la souris. Bug d'intégration
// WebView2/DnD natif, pas une erreur de câblage React — même famille que
// d'autres quirks WebView2 déjà rencontrés sur ce projet (dialog plugin,
// drag HTML5 non fiable depuis 2026-07-13). Les pointer events, eux,
// fonctionnent déjà pour le pinceau et le pan/zoom.
interface DragState {
  draggedId: string;
  pointerId: number;
  overIndex: number | null;
}

export function LayerPanel({
  layers,
  selectedId,
  onSelect,
  onToggle,
  onAdd,
  onRemove,
  onReorder,
  onOpacityChange,
  onOpacityCommit,
  onBlendModeChange,
}: Props) {
  const [dragState, setDragState] = useState<DragState | null>(null);

  const handleGripPointerDown = useCallback((id: string, pointerId: number, target: Element) => {
    target.setPointerCapture(pointerId);
    setDragState({ draggedId: id, pointerId, overIndex: null });
  }, []);

  // Attachés sur la POIGNÉE (via setPointerCapture ci-dessus, ces deux
  // handlers continuent de recevoir les événements même quand le pointeur
  // sort de son rectangle) — elementFromPoint fait le hit-test manuel sur
  // la ligne survolée, puisqu'aucun événement natif de survol/drop ne peut
  // être exploité ici (raison ci-dessus).
  const handleGripPointerMove = useCallback((e: React.PointerEvent) => {
    setDragState((prev) => {
      if (!prev) return prev;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const rowEl = el?.closest<HTMLElement>("[data-layer-row-index]");
      const overIndex = rowEl ? Number(rowEl.dataset.layerRowIndex) : null;
      return overIndex === prev.overIndex ? prev : { ...prev, overIndex };
    });
  }, []);

  const handleGripPointerUp = useCallback(() => {
    setDragState((prev) => {
      if (prev && prev.overIndex !== null) onReorder(prev.draggedId, prev.overIndex);
      return null;
    });
  }, [onReorder]);

  return (
    <div className="layer-panel">
      <Select
        label="Ajouter un effet"
        value={null}
        placeholder="+ Ajouter un effet"
        options={addEffectOptions}
        onChange={onAdd}
      />
      <ul
        className="layer-panel__list"
        onPointerMove={dragState ? handleGripPointerMove : undefined}
        onPointerUp={dragState ? handleGripPointerUp : undefined}
        onPointerCancel={dragState ? handleGripPointerUp : undefined}
      >
        {layers.map((layer, index) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            index={index}
            selected={layer.id === selectedId}
            isDragging={dragState?.draggedId === layer.id}
            isDropTarget={dragState !== null && dragState.overIndex === index && dragState.draggedId !== layer.id}
            onSelect={onSelect}
            onToggle={onToggle}
            onRemove={onRemove}
            onGripPointerDown={handleGripPointerDown}
            onOpacityChange={onOpacityChange}
            onOpacityCommit={onOpacityCommit}
            onBlendModeChange={onBlendModeChange}
          />
        ))}
      </ul>
    </div>
  );
}
