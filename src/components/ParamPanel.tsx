import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";
import type { EffectParam } from "../render/effects/types";
import "./ParamPanel.css";
import { LabeledSlider } from "./ui/labeled-slider";
import { Disclosure } from "./ui/collapsible";
import { ColorGroupControl } from "./ui/color-group-control";
import { formatControlValue } from "../ui/formatValue";

type ParamRenderItem =
  | { kind: "single"; param: EffectParam }
  | { kind: "group"; key: string; label: string; hue: EffectParam; saturation: EffectParam; lightness: EffectParam; isFirst: boolean };

/** Groups params sharing the same `colorGroup.key` (see EffectParam) into a
 *  single swatch+disclosure render item, in the order each group first
 *  appears. Ungrouped params pass through unchanged. Fails fast if a group is
 *  declared with fewer than its three required roles — a silent partial
 *  group would render a swatch that doesn't reflect an editable color. */
function groupEffectParams(params: EffectParam[]): ParamRenderItem[] {
  const firstIndexByKey = new Map<string, number>();
  const roleByKey = new Map<string, { label: string; hue?: EffectParam; saturation?: EffectParam; lightness?: EffectParam }>();

  params.forEach((p, index) => {
    if (!p.colorGroup) return;
    const { key, role, label } = p.colorGroup;
    if (!firstIndexByKey.has(key)) firstIndexByKey.set(key, index);
    const entry = roleByKey.get(key) ?? { label };
    entry[role] = p;
    roleByKey.set(key, entry);
  });

  let seenGroups = 0;
  const items: ParamRenderItem[] = [];
  params.forEach((p, index) => {
    if (!p.colorGroup) {
      items.push({ kind: "single", param: p });
      return;
    }
    if (firstIndexByKey.get(p.colorGroup.key) !== index) return;
    const entry = roleByKey.get(p.colorGroup.key)!;
    if (!entry.hue || !entry.saturation || !entry.lightness) {
      throw new Error(`Groupe de couleur "${p.colorGroup.key}" incomplet : hue/saturation/lightness requis.`);
    }
    items.push({ kind: "group", key: p.colorGroup.key, label: entry.label, hue: entry.hue, saturation: entry.saturation, lightness: entry.lightness, isFirst: seenGroups === 0 });
    seenGroups += 1;
  });
  return items;
}

interface Props {
  layer: LayerState | null;
  onParamChange: (id: string, params: Record<string, number>) => void;
  onParamCommit: () => void;
  onOpenColorPicker: (group: { layerId: string; effectId: string; key: string; label: string; hue: EffectParam; saturation: EffectParam; lightness: EffectParam; anchorTop: number }) => void;
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

export function ParamPanel({ layer, onParamChange, onParamCommit, onOpenColorPicker }: Props) {
  if (!layer) {
    return <p className="param-panel__empty">Sélectionne un calque.</p>;
  }
  const effect = getEffect(layer.effectId);

  // État vide EXPLICITE plutôt qu'un `Disclosure "Effet"` vide (design
  // 2026-07-27 §3.7) : un calque photo porte `passthrough`, dont la liste de
  // paramètres est vide — le cadre vide ne disait pas pourquoi. Deux causes
  // distinctes, deux phrases : aucun effet du tout, ou un effet sans réglage.
  if (effect.params.length === 0) {
    return (
      <p className="param-panel__empty">
        {layer.effectId === "passthrough" ? "Aucun effet appliqué à ce calque." : "Cet effet n'a pas de paramètres."}
      </p>
    );
  }

  return (
    <div className="param-panel">
      <Disclosure title="Effet" defaultOpen>
        <div className="param-panel__group">
          {groupEffectParams(effect.params).map((item) =>
            item.kind === "single" ? (
              <div key={item.param.name} title={item.param.hint}>
                <LabeledSlider
                  label={item.param.label}
                  value={layer.params[item.param.name] ?? item.param.default}
                  min={item.param.min}
                  max={item.param.max}
                  step={item.param.step}
                  displayValue={formatEffectParamValue(layer.params[item.param.name] ?? item.param.default, item.param)}
                  onChange={(v) => onParamChange(layer.id, { [item.param.name]: v })}
                  onCommit={onParamCommit}
                />
              </div>
            ) : (
              <ColorGroupControl
                key={item.key}
                label={item.label}
                hueParam={item.hue}
                saturationParam={item.saturation}
                lightnessParam={item.lightness}
                hue={layer.params[item.hue.name] ?? item.hue.default}
                saturation={layer.params[item.saturation.name] ?? item.saturation.default}
                lightness={layer.params[item.lightness.name] ?? item.lightness.default}
                defaultOpen={item.isFirst}
                onChange={(name, v) => onParamChange(layer.id, { [name]: v })}
                onCommit={onParamCommit}
                onOpenPicker={(anchorTop) =>
                  // `effectId` capturé avec le groupe : les EffectParam ci-dessus
                  // n'appartiennent qu'à CET effet. Si l'effet du calque change
                  // (setLayerEffect vide `params`), le picker ouvert doit
                  // disparaître au lieu de piloter des paramètres qui n'existent
                  // plus — c'est App.tsx qui le compare au rendu.
                  onOpenColorPicker({ layerId: layer.id, effectId: layer.effectId, key: item.key, label: item.label, hue: item.hue, saturation: item.saturation, lightness: item.lightness, anchorTop })
                }
              />
            ),
          )}
        </div>
      </Disclosure>
    </div>
  );
}
