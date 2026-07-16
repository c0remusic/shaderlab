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
  maskPaintMode: boolean;
  onToggleMaskPaint: () => void;
  brushSize: number;
  onBrushSizeChange: (v: number) => void;
  brushHardness: number;
  onBrushHardnessChange: (v: number) => void;
  erase: boolean;
  onEraseChange: (v: boolean) => void;
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
  maskPaintMode,
  onToggleMaskPaint,
  brushSize,
  onBrushSizeChange,
  brushHardness,
  onBrushHardnessChange,
  erase,
  onEraseChange,
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
          brushSize={brushSize}
          onBrushSizeChange={onBrushSizeChange}
          brushHardness={brushHardness}
          onBrushHardnessChange={onBrushHardnessChange}
          erase={erase}
          onEraseChange={onEraseChange}
        />
      </section>
    </aside>
  );
}
