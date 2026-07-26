import { memo, useCallback } from "react";
import { usePointerReorder, type DropPosition } from "../ui/dragReorder";
import "../ui/dragReorder.css";
import { Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import type { LayerState } from "../layers/types";
import { effectRegistry, getEffect } from "../render/effects/registry";
import { blendRegistry } from "../render/blend/registry";
import { Select } from "./ui/select";
import { LabeledSlider } from "./ui/labeled-slider";
import { IconButton } from "./ui/icon-button";
import "./LayerPanel.css";

interface Props {
  layers: LayerState[];
  selectedId: string | null;
  hasImage: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (effectId: string) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, newIndex: number) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onOpacityCommit: () => void;
  onBlendModeChange: (id: string, blendMode: string) => void;
  /** Résout la vignette d'un calque photo par `sourceId`. La vignette est
   *  POSSÉDÉE par `PhotoSourceStore` (object URL, hors state React) — cette
   *  prop n'en transporte que la lecture, jamais le raster (invariant OOM).
   *  DOIT être référentiellement stable (`useCallback`) : elle traverse la
   *  mémoïsation de `LayerRow`. */
  thumbnailUrl?: (sourceId: string) => string | null;
}

interface LayerRowProps {
  layer: LayerState;
  index: number;
  selected: boolean;
  isDragging: boolean;
  dropPosition: DropPosition | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onGripPointerDown: (id: string, pointerId: number, target: Element, clientX: number, clientY: number) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onOpacityCommit: () => void;
  onBlendModeChange: (id: string, blendMode: string) => void;
  thumbnailUrl?: (sourceId: string) => string | null;
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
  dropPosition,
  onSelect,
  onToggle,
  onRemove,
  onGripPointerDown,
  onOpacityChange,
  onOpacityCommit,
  onBlendModeChange,
  thumbnailUrl,
}: LayerRowProps) {
  // Identité du calque (parité calque photo, T1) : le nom du calque prime,
  // et l'affichage retombe sur le nom de l'effet pour tout calque non nommé
  // (c'est-à-dire tous les calques d'effet, inchangés).
  const displayName = layer.name ?? getEffect(layer.effectId).name;
  const thumbnail = layer.imageSource ? thumbnailUrl?.(layer.imageSource.sourceId) ?? null : null;
  const rowClass = [
    "layer-panel__row",
    selected && "layer-panel__row--selected",
    isDragging && "layer-panel__row--dragging",
    dropPosition === "before" && "layer-panel__row--drop-before",
    dropPosition === "after" && "layer-panel__row--drop-after",
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
              onGripPointerDown(layer.id, e.pointerId, e.currentTarget, e.clientX, e.clientY);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="layer-panel__grip icon-sm icon-stroke" aria-hidden="true" />
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
              <Eye className="icon-sm icon-stroke" aria-hidden="true" />
            ) : (
              <EyeOff className="icon-sm icon-stroke" aria-hidden="true" />
            )}
          </IconButton>
          {layer.imageSource &&
            (thumbnail ? (
              <img className="layer-panel__thumbnail" src={thumbnail} alt="" aria-hidden="true" />
            ) : (
              // Emplacement réservé : la vignette peut manquer (pas
              // d'OffscreenCanvas). La ligne ne doit pas se réaligner selon
              // qu'elle est disponible ou non.
              <span className="layer-panel__thumbnail layer-panel__thumbnail--empty" aria-hidden="true" />
            ))}
          <span
            className={`layer-panel__row-name ${selected ? "layer-panel__row-name--selected" : ""}`.trim()}
            title={displayName}
          >
            {displayName}
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
          <Trash2 className="icon-sm icon-stroke" aria-hidden="true" />
        </IconButton>
      </div>
      {dropPosition && <span className={`drag-reorder__alignment-guide layer-panel__alignment-guide--${dropPosition}`} aria-hidden="true" />}
      <div className="layer-panel__row-controls" onClick={(e) => e.stopPropagation()}>
        <LabeledSlider
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

export function LayerPanel({
  layers,
  selectedId,
  hasImage,
  onSelect,
  onToggle,
  onAdd,
  onRemove,
  onReorder,
  onOpacityChange,
  onOpacityCommit,
  onBlendModeChange,
  thumbnailUrl,
}: Props) {
  const { dragState, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } = usePointerReorder(
    layers,
    (layer) => layer.id,
    "data-layer-row-index",
    onReorder
  );

  const handleGripPointerDown = useCallback(
    (id: string, pointerId: number, target: Element, clientX: number, clientY: number) => {
      // measureElement = target : LayerPanel n'utilise pas grabOffset/pointerPosition
      // (pas de fantôme), measurer la poignée elle-même suffit.
      handlePointerDown(id, pointerId, target, target, clientX, clientY);
    },
    [handlePointerDown]
  );

  return (
    <div className="layer-panel">
      <Select
        label="Ajouter un effet"
        value={null}
        placeholder="+ Ajouter un effet"
        options={addEffectOptions}
        disabled={!hasImage}
        onChange={onAdd}
      />
      <ul
        className="layer-panel__list"
        onPointerMove={dragState ? handlePointerMove : undefined}
        onPointerUp={dragState ? handlePointerUp : undefined}
        onPointerCancel={dragState ? handlePointerCancel : undefined}
      >
        {layers.map((layer, index) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            index={index}
            selected={layer.id === selectedId}
            isDragging={dragState?.draggedId === layer.id}
            dropPosition={
              dragState !== null && dragState.overIndex === index && dragState.draggedId !== layer.id
                ? dragState.overPosition
                : null
            }
            onSelect={onSelect}
            onToggle={onToggle}
            onRemove={onRemove}
            onGripPointerDown={handleGripPointerDown}
            onOpacityChange={onOpacityChange}
            onOpacityCommit={onOpacityCommit}
            onBlendModeChange={onBlendModeChange}
            thumbnailUrl={thumbnailUrl}
          />
        ))}
      </ul>
    </div>
  );
}
