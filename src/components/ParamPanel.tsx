import { useState } from "react";
import type { LayerState } from "../layers/types";
import type { RefineEdgeParams } from "../mask/types";
import { getEffect } from "../render/effects/registry";
import { maskSourceRegistry, getMaskSourceModule } from "../mask/sources/registry";
import "./ParamPanel.css";
import { Slider } from "../ui/Slider";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Disclosure } from "../ui/Disclosure";
import { Select } from "../ui/Select";
import { Checkbox } from "../ui/Checkbox";
import { Menu } from "../ui/Menu";
import { Trash2 } from "lucide-react";

interface Props {
  layer: LayerState | null;
  onParamChange: (id: string, params: Record<string, number>) => void;
  onParamCommit: () => void;
  maskPaintMode: boolean;
  onToggleMaskPaint: () => void;
  onAddMaskSource: (layerId: string, type: "gradient" | "luminosity" | "colorRange") => void;
  onRemoveMaskSource: (layerId: string, sourceId: string) => void;
  onMaskSourceParamsChange: (layerId: string, sourceId: string, params: Record<string, number | number[]>) => void;
  onMaskSourceParamsCommit: () => void;
  onMaskSourceCombineModeChange: (layerId: string, sourceId: string, mode: "add" | "subtract" | "intersect") => void;
  onMaskInvertChange: (layerId: string, invert: boolean) => void;
  onMaskEnabledChange: (layerId: string, enabled: boolean) => void;
  onRefineEdgeChange: (layerId: string, refineEdge: Partial<RefineEdgeParams>) => void;
  onRefineEdgeCommit: () => void;
  /** Ajoute un échantillon de couleur (source colorRange) — limitation
   *  documentée Tranche 3 : prend la couleur du CENTRE du canvas (pas un
   *  picker au clic, hors scope, voir Tranche 4/panneau flottant). */
  onAddColorSample: (layerId: string, sourceId: string) => void;
}

const COMBINE_MODE_OPTIONS = [
  { value: "add", label: "+ Ajouter" },
  { value: "subtract", label: "− Soustraire" },
  { value: "intersect", label: "∩ Intersecter" },
];

/** Plage/pas générique par clé de `params` — heuristique couvrant les 3
 *  modules de sources (gradient/luminosity/colorRange). Pas de métadonnée
 *  min/max par module (hors scope de cette tâche, cf. brief Step 10 : rendu
 *  générique via `Object.entries`) — ces valeurs sont un choix raisonnable
 *  documenté dans le rapport de tâche, pas une donnée du design. */
function paramRange(key: string): { min: number; max: number; step: number } {
  if (key === "angle") return { min: 0, max: 360, step: 1 };
  return { min: 0, max: 1, step: 0.01 };
}

export function ParamPanel({
  layer,
  onParamChange,
  onParamCommit,
  maskPaintMode,
  onToggleMaskPaint,
  onAddMaskSource,
  onRemoveMaskSource,
  onMaskSourceParamsChange,
  onMaskSourceParamsCommit,
  onMaskSourceCombineModeChange,
  onMaskInvertChange,
  onMaskEnabledChange,
  onRefineEdgeChange,
  onRefineEdgeCommit,
  onAddColorSample,
}: Props) {
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  if (!layer) {
    return <p className="param-panel__empty">Sélectionne un calque.</p>;
  }
  const effect = getEffect(layer.effectId);
  const sources = layer.mask.sources;
  const activeSourceId = selectedSourceId && sources.some((s) => s.id === selectedSourceId)
    ? selectedSourceId
    : (sources[0]?.id ?? null);
  const activeSource = sources.find((s) => s.id === activeSourceId) ?? null;
  const refineEdge = layer.mask.refineEdge;

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
          {maskPaintMode ? (
            <p className="param-panel__hint">
              Mode peinture actif — utilise « Terminer » dans la barre d'outils du pinceau.
            </p>
          ) : (
            <Button variant="secondary" onClick={onToggleMaskPaint}>
              Peindre le masque
            </Button>
          )}
          {/* Les réglages du pinceau (taille/dureté/gomme) vivent dans la
              barre d'options du pinceau (BrushToolbar), affichée en mode
              masque — pas ici, pour éviter la duplication. */}

          <div className="param-panel__mask-toggles">
            <Checkbox
              label="Masque actif"
              checked={layer.mask.enabled}
              onChange={(enabled) => onMaskEnabledChange(layer.id, enabled)}
            />
            <Checkbox
              label="Inverser"
              checked={layer.mask.invert}
              onChange={(invert) => onMaskInvertChange(layer.id, invert)}
            />
          </div>

          <Menu
            label="Ajouter une source"
            items={maskSourceRegistry.map((m) => ({
              value: m.id,
              label: m.name,
              onSelect: () => onAddMaskSource(layer.id, m.id),
            }))}
          />

          {sources.length > 0 && (
            <ul className="param-panel__source-list">
              {sources.map((source) => {
                const module = getMaskSourceModule(source.type as "gradient" | "luminosity" | "colorRange");
                return (
                  <li
                    key={source.id}
                    className={`param-panel__source-row ${
                      source.id === activeSourceId ? "param-panel__source-row--active" : ""
                    }`.trim()}
                  >
                    <button
                      type="button"
                      className="param-panel__source-name"
                      onClick={() => setSelectedSourceId(source.id)}
                    >
                      {module.name}
                    </button>
                    <Select
                      label="Mode"
                      value={source.combineMode}
                      options={COMBINE_MODE_OPTIONS}
                      onChange={(mode) =>
                        onMaskSourceCombineModeChange(layer.id, source.id, mode as "add" | "subtract" | "intersect")
                      }
                    />
                    <IconButton
                      label="Supprimer la source"
                      tooltip="Supprimer"
                      variant="danger"
                      onClick={() => onRemoveMaskSource(layer.id, source.id)}
                    >
                      <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}

          {activeSource && activeSource.params && (
            <div className="param-panel__source-params">
              {Object.entries(activeSource.params).map(([key, value]) => {
                if (key === "samples") {
                  const samples = (value as number[]) ?? [];
                  const sampleCount = Math.floor(samples.length / 3);
                  return (
                    <div key={key} className="param-panel__samples">
                      <p className="param-panel__hint">
                        {sampleCount} échantillon{sampleCount > 1 ? "s" : ""} — échantillonnage au clic sur le
                        canvas hors scope de cette tranche (Tranche 4) ; ce bouton prend la couleur du CENTRE du
                        canvas comme valeur de test minimale.
                      </p>
                      <Button variant="secondary" onClick={() => onAddColorSample(layer.id, activeSource.id)}>
                        Ajouter un échantillon (centre canvas)
                      </Button>
                    </div>
                  );
                }
                const range = paramRange(key);
                return (
                  <Slider
                    key={key}
                    label={key}
                    value={value as number}
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    onChange={(v) => onMaskSourceParamsChange(layer.id, activeSource.id, { ...activeSource.params, [key]: v })}
                    onCommit={onMaskSourceParamsCommit}
                  />
                );
              })}
            </div>
          )}
        </div>
      </Disclosure>
      <Disclosure title="Affiner le bord">
        <div className="param-panel__group">
          <Slider
            label="feather"
            value={refineEdge.feather}
            min={0}
            max={50}
            step={1}
            onChange={(v) => onRefineEdgeChange(layer.id, { feather: v })}
            onCommit={onRefineEdgeCommit}
          />
          <Slider
            label="contracter/dilater"
            value={refineEdge.contract}
            min={-50}
            max={50}
            step={1}
            onChange={(v) => onRefineEdgeChange(layer.id, { contract: v })}
            onCommit={onRefineEdgeCommit}
          />
          <Slider
            label="lisser"
            value={refineEdge.smooth}
            min={0}
            max={10}
            step={1}
            onChange={(v) => onRefineEdgeChange(layer.id, { smooth: v })}
            onCommit={onRefineEdgeCommit}
          />
          <Checkbox
            label="Accroché aux contours (edge-aware)"
            checked={refineEdge.edgeAware}
            onChange={(edgeAware) => {
              onRefineEdgeChange(layer.id, { edgeAware });
              onRefineEdgeCommit();
            }}
          />
          {refineEdge.edgeAware && (
            <>
              <Slider
                label="rayon des contours"
                value={refineEdge.edgeRadius}
                min={1}
                max={50}
                step={1}
                onChange={(v) => onRefineEdgeChange(layer.id, { edgeRadius: v })}
                onCommit={onRefineEdgeCommit}
              />
              <Slider
                label="force des contours"
                value={refineEdge.edgeStrength}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => onRefineEdgeChange(layer.id, { edgeStrength: v })}
                onCommit={onRefineEdgeCommit}
              />
            </>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
