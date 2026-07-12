import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";

interface Props {
  layer: LayerState | null;
  onParamChange: (id: string, params: Record<string, number>) => void;
}

export function ParamPanel({ layer, onParamChange }: Props) {
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
    </div>
  );
}
