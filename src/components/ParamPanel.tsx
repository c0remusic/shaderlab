import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";
import { Slider } from "../ui/Slider";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";

interface Props {
  layer: LayerState | null;
  onParamChange: (id: string, params: Record<string, number>) => void;
  onParamCommit: () => void;
  maskPaintMode: boolean;
  onToggleMaskPaint: () => void;
}

export function ParamPanel({
  layer,
  onParamChange,
  onParamCommit,
  maskPaintMode,
  onToggleMaskPaint,
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
          {/* Les réglages du pinceau (taille/dureté/gomme) vivent dans la
              barre d'options du pinceau (BrushToolbar), affichée en mode
              masque — pas ici, pour éviter la duplication. */}
        </div>
      </Disclosure>
    </div>
  );
}
