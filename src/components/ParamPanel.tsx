import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";

interface Props {
  layer: LayerState | null;
  onParamChange: (id: string, params: Record<string, number>) => void;
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
  maskPaintMode,
  onToggleMaskPaint,
  brushSize,
  onBrushSizeChange,
  brushHardness,
  onBrushHardnessChange,
  erase,
  onEraseChange,
}: Props) {
  if (!layer) return <div style={{ width: 260, padding: 8 }}>Sélectionne un calque.</div>;
  const effect = getEffect(layer.effectId);

  return (
    <div style={{ width: 260, borderLeft: "1px solid #333", padding: 8 }}>
      <h3>{effect.name}</h3>
      {effect.params.map((p) => (
        <div key={p.name} style={{ marginBottom: 8 }}>
          <label>
            {p.name}: {(layer.params[p.name] ?? p.default).toFixed(3)}
          </label>
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={layer.params[p.name] ?? p.default}
            onChange={(e) => onParamChange(layer.id, { [p.name]: parseFloat(e.target.value) })}
            style={{ width: "100%" }}
          />
        </div>
      ))}
      <hr style={{ margin: "12px 0", borderColor: "#333" }} />
      <h4>Masque</h4>
      <button onClick={onToggleMaskPaint} style={{ marginBottom: 8 }}>
        {maskPaintMode ? "Arrêter de peindre" : "Peindre le masque"}
      </button>
      <div style={{ marginBottom: 8 }}>
        <label>Taille: {brushSize}</label>
        <input
          type="range"
          min={2}
          max={200}
          value={brushSize}
          onChange={(e) => onBrushSizeChange(parseFloat(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <label>Dureté: {brushHardness.toFixed(2)}</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={brushHardness}
          onChange={(e) => onBrushHardnessChange(parseFloat(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>
      <label>
        <input type="checkbox" checked={erase} onChange={(e) => onEraseChange(e.target.checked)} /> Gomme
      </label>
    </div>
  );
}
