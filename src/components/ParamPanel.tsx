import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";
import { Slider } from "../ui/Slider";
import { Checkbox } from "../ui/Checkbox";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";

interface Props {
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

export function ParamPanel({
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
}: Props) {
  if (!layer) {
    return <p className="param-panel__empty">Sélectionne un calque.</p>;
  }
  const effect = getEffect(layer.effectId);

  return (
    <div className="param-panel">
      <h3 className="param-panel__effect-name">{effect.name}</h3>
      <Disclosure title="Effet" defaultOpen>
        <div className="param-panel__group">
          {effect.params.map((p) => (
            <Slider
              key={p.name}
              label={p.name}
              value={layer.params[p.name] ?? p.default}
              min={p.min}
              max={p.max}
              step={p.step}
              onChange={(v) => onParamChange(layer.id, { [p.name]: v })}
              onCommit={onParamCommit}
            />
          ))}
        </div>
      </Disclosure>
      <Disclosure title="Masque" defaultOpen>
        <div className="param-panel__group">
          <Button variant={maskPaintMode ? "primary" : "secondary"} onClick={onToggleMaskPaint}>
            {maskPaintMode ? "Arrêter de peindre" : "Peindre le masque"}
          </Button>
          <Slider label="Taille" value={brushSize} min={2} max={200} onChange={onBrushSizeChange} />
          <Slider
            label="Dureté"
            value={brushHardness}
            min={0}
            max={1}
            step={0.05}
            onChange={onBrushHardnessChange}
          />
          <Checkbox label="Gomme" checked={erase} onChange={onEraseChange} />
        </div>
      </Disclosure>
    </div>
  );
}
