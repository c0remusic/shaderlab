import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";
import "./ParamPanel.css";
import { LabeledSlider } from "./ui/labeled-slider";
import { Disclosure } from "./ui/collapsible";
import { formatControlValue } from "../ui/formatValue";

interface Props {
  layer: LayerState | null;
  onParamChange: (id: string, params: Record<string, number>) => void;
  onParamCommit: () => void;
}

function formatEffectParamValue(
  value: number,
  param: { unit?: "percent" | "pixels" | "degrees" | "none"; step: number },
): string {
  switch (param.unit) {
    case "percent":
      return `${Math.round(value * 100)} %`;
    case "pixels":
      return `${formatControlValue(value, param.step)} px`;
    case "degrees":
      return `${Math.round(value)}°`;
    case "none":
    default:
      return formatControlValue(value, param.step);
  }
}

export function ParamPanel({ layer, onParamChange, onParamCommit }: Props) {
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
            <div key={p.name} title={p.hint}>
              <LabeledSlider
                label={p.label}
                value={layer.params[p.name] ?? p.default}
                min={p.min}
                max={p.max}
                step={p.step}
                displayValue={formatEffectParamValue(layer.params[p.name] ?? p.default, p)}
                onChange={(v) => onParamChange(layer.id, { [p.name]: v })}
                onCommit={onParamCommit}
              />
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  );
}
