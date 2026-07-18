import type { LayerState } from "../layers/types";
import { LayerPanel } from "./LayerPanel";
import { ParamPanel } from "./ParamPanel";

export interface InspectorProps {
  layers: LayerState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (effectId: string) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, newIndex: number) => void;
  layer: LayerState | null;
  onParamChange: (id: string, params: Record<string, number>) => void;
  onParamCommit: () => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onOpacityCommit: () => void;
  onBlendModeChange: (id: string, blendMode: string) => void;
  maskPaintMode: boolean;
  onToggleMaskPaint: () => void;
}

export function Inspector({
  layers,
  selectedId,
  onSelect,
  onToggle,
  onAdd,
  onRemove,
  onReorder,
  layer,
  onParamChange,
  onParamCommit,
  onOpacityChange,
  onOpacityCommit,
  onBlendModeChange,
  maskPaintMode,
  onToggleMaskPaint,
}: InspectorProps) {
  return (
    <aside className="inspector" aria-label="Inspecteur">
      <section className="inspector__layers" aria-labelledby="layers-title">
        <h2 id="layers-title" className="inspector__section-title">
          Calques
        </h2>
        <LayerPanel
          layers={layers}
          selectedId={selectedId}
          onSelect={onSelect}
          onToggle={onToggle}
          onAdd={onAdd}
          onRemove={onRemove}
          onReorder={onReorder}
          onOpacityChange={onOpacityChange}
          onOpacityCommit={onOpacityCommit}
          onBlendModeChange={onBlendModeChange}
        />
      </section>
      <section className="inspector__parameters" aria-labelledby="parameters-title">
        <h2 id="parameters-title" className="inspector__section-title">
          Réglages
        </h2>
        <ParamPanel
          layer={layer}
          onParamChange={onParamChange}
          onParamCommit={onParamCommit}
          maskPaintMode={maskPaintMode}
          onToggleMaskPaint={onToggleMaskPaint}
        />
      </section>
    </aside>
  );
}
