import { useState } from "react";
import type { LayerState } from "../layers/types";
import type { RefineEdgeParams } from "../mask/types";
import { isParametricMaskSource } from "../mask/types";
import { maskSourceRegistry, getMaskSourceModule } from "../mask/sources/registry";
import "./ParamPanel.css";
import { LabeledSlider } from "./ui/labeled-slider";
import { Button } from "./ui/button";
import { IconButton } from "./ui/icon-button";
import { Disclosure } from "./ui/collapsible";
import { Checkbox } from "./ui/checkbox";
import { Toggle } from "./ui/toggle";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Trash2, Eye, EyeOff } from "lucide-react";

interface Props {
  layer: LayerState | null;
  maskPaintMode: boolean;
  onToggleMaskPaint: () => void;
  overlayForceHidden: boolean;
  onToggleOverlayForceHidden: () => void;
  onAddMaskSource: (layerId: string, type: "gradient" | "luminosity" | "colorRange") => void;
  onRemoveMaskSource: (layerId: string, sourceId: string) => void;
  onMaskSourceParamsChange: (layerId: string, sourceId: string, params: Record<string, number | number[]>) => void;
  onMaskSourceParamsCommit: () => void;
  onMaskSourceCombineModeChange: (layerId: string, sourceId: string, mode: "add" | "subtract" | "intersect") => void;
  onMaskSourceEnabledChange: (layerId: string, sourceId: string, enabled: boolean) => void;
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

const MASK_PARAM_LABELS: Record<string, string> = {
  angle: "Angle",
  startX: "Départ X",
  startY: "Départ Y",
  endX: "Arrivée X",
  endY: "Arrivée Y",
  feather: "Adoucissement",
  invert: "Inverser",
  shadowsMin: "Ombres min.",
  shadowsMax: "Ombres max.",
  highlightsMin: "Hautes lumières min.",
  highlightsMax: "Hautes lumières max.",
  tolerance: "Tolérance",
  hardness: "Dureté",
};

/** Plage/pas générique par clé de `params` — heuristique couvrant les 3
 *  modules de sources (gradient/luminosity/colorRange). Pas de métadonnée
 *  min/max par module (hors scope de cette tâche, cf. brief Step 10 : rendu
 *  générique via `Object.entries`) — ces valeurs sont un choix raisonnable
 *  documenté dans le rapport de tâche, pas une donnée du design. */
function paramRange(key: string): { min: number; max: number; step: number } {
  if (key === "angle") return { min: 0, max: 360, step: 1 };
  return { min: 0, max: 1, step: 0.01 };
}

export function MaskPanel({
  layer,
  maskPaintMode,
  onToggleMaskPaint,
  overlayForceHidden,
  onToggleOverlayForceHidden,
  onAddMaskSource,
  onRemoveMaskSource,
  onMaskSourceParamsChange,
  onMaskSourceParamsCommit,
  onMaskSourceCombineModeChange,
  onMaskSourceEnabledChange,
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
  // Seules les sources PARAMÉTRIQUES sont éditées ici — une source "brush"
  // (peinture, cf. LayerStack.updateBrushMask) n'a pas de module dans
  // maskSourceRegistry (gradient/luminosity/colorRange seulement) : la
  // laisser dans cette liste ferait planter getMaskSourceModule() au premier
  // calque peint au pinceau qui ouvre son panneau Masque. Garde de type
  // (mask/types.ts) plutôt qu'un cast `as` sur `source.type` plus bas.
  const sources = layer.mask.sources.filter(isParametricMaskSource);
  const activeSourceId = selectedSourceId && sources.some((s) => s.id === selectedSourceId)
    ? selectedSourceId
    : (sources[0]?.id ?? null);
  const activeSource = sources.find((s) => s.id === activeSourceId) ?? null;
  const refineEdge = layer.mask.refineEdge;

  return (
    <div className="param-panel">
      <Disclosure title="Masque" defaultOpen>
        <div className="param-panel__group">
          <div className="param-panel__visibility-row">
            <IconButton
              label={overlayForceHidden ? "Afficher l'overlay" : "Masquer l'overlay"}
              tooltip={overlayForceHidden ? "Afficher l'overlay" : "Masquer l'overlay"}
              onClick={onToggleOverlayForceHidden}
              className={overlayForceHidden ? undefined : "param-panel__visibility-icon--on"}
            >
              {overlayForceHidden ? (
                <EyeOff className="icon-sm icon-stroke" aria-hidden="true" />
              ) : (
                <Eye className="icon-sm icon-stroke" aria-hidden="true" />
              )}
            </IconButton>
            <span className="param-panel__visibility-label">
              {overlayForceHidden ? "Overlay masqué" : "Overlay visible"}
            </span>
          </div>
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
            <div className="param-panel__visibility-row">
              <IconButton
                label={layer.mask.enabled ? "Désactiver le masque" : "Activer le masque"}
                tooltip="Masque actif"
                onClick={() => onMaskEnabledChange(layer.id, !layer.mask.enabled)}
                className={layer.mask.enabled ? "param-panel__visibility-icon--on" : undefined}
              >
                {layer.mask.enabled ? (
                  <Eye className="icon-sm icon-stroke" aria-hidden="true" />
                ) : (
                  <EyeOff className="icon-sm icon-stroke" aria-hidden="true" />
                )}
              </IconButton>
              <span className="param-panel__visibility-label">Masque actif</span>
            </div>
            <Checkbox
              label="Inverser"
              checked={layer.mask.invert}
              onChange={(invert) => onMaskInvertChange(layer.id, invert)}
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="secondary">Ajouter une source</Button>} />
            <DropdownMenuContent align="start">
              {maskSourceRegistry.map((m) => (
                <DropdownMenuItem key={m.id} onClick={() => onAddMaskSource(layer.id, m.id)}>
                  {m.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {sources.length > 0 && (
            <ul className="param-panel__source-list">
              {sources.map((source) => {
                const module = getMaskSourceModule(source.type);
                return (
                  <li
                    key={source.id}
                    className={`param-panel__source-row ${
                      source.id === activeSourceId ? "param-panel__source-row--active" : ""
                    }`.trim()}
                  >
                    <IconButton
                      label={source.enabled ? "Désactiver la source" : "Activer la source"}
                      tooltip="Actif"
                      onClick={() => onMaskSourceEnabledChange(layer.id, source.id, !source.enabled)}
                      className={source.enabled ? "param-panel__visibility-icon--on" : undefined}
                    >
                      {source.enabled ? (
                        <Eye className="icon-sm icon-stroke" aria-hidden="true" />
                      ) : (
                        <EyeOff className="icon-sm icon-stroke" aria-hidden="true" />
                      )}
                    </IconButton>
                    <button
                      type="button"
                      className="param-panel__source-name"
                      onClick={() => setSelectedSourceId(source.id)}
                    >
                      {module.name}
                    </button>
                    {source.id === activeSourceId && (
                      <span className="param-panel__source-active-badge">EN COURS</span>
                    )}
                    <div className="param-panel__combine-mode" role="group" aria-label="Mode de combinaison">
                      {COMBINE_MODE_OPTIONS.map((option) => (
                        <Toggle
                          key={option.value}
                          size="sm"
                          title={option.label}
                          aria-label={option.label}
                          pressed={source.combineMode === option.value}
                          onPressedChange={(pressed) => {
                            if (pressed) {
                              onMaskSourceCombineModeChange(
                                layer.id,
                                source.id,
                                option.value as "add" | "subtract" | "intersect",
                              );
                            }
                          }}
                        >
                          {option.value === "add" ? "+" : option.value === "subtract" ? "−" : "∩"}
                        </Toggle>
                      ))}
                    </div>
                    <IconButton
                      label="Supprimer la source"
                      tooltip="Supprimer"
                      variant="danger"
                      onClick={() => onRemoveMaskSource(layer.id, source.id)}
                    >
                      <Trash2 className="icon-sm icon-stroke" aria-hidden="true" />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}

          {activeSource && activeSource.params && (
            <div className="param-panel__source-params">
              <p className="param-panel__source-params-title">
                Réglages · {getMaskSourceModule(activeSource.type).name}
              </p>
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
                  <LabeledSlider
                    key={key}
                    label={MASK_PARAM_LABELS[key] ?? key}
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
      {sources.length > 0 && (
      <Disclosure title="Affiner le bord">
        <div className="param-panel__group">
          <LabeledSlider
            label="Adoucir le bord"
            value={refineEdge.feather}
            min={0}
            max={50}
            step={1}
            onChange={(v) => onRefineEdgeChange(layer.id, { feather: v })}
            onCommit={onRefineEdgeCommit}
          />
          <LabeledSlider
            label="Contracter/dilater"
            value={refineEdge.contract}
            min={-50}
            max={50}
            step={1}
            onChange={(v) => onRefineEdgeChange(layer.id, { contract: v })}
            onCommit={onRefineEdgeCommit}
          />
          <LabeledSlider
            label="Lisser"
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
              <LabeledSlider
                label="Rayon des contours"
                value={refineEdge.edgeRadius}
                min={1}
                max={50}
                step={1}
                onChange={(v) => onRefineEdgeChange(layer.id, { edgeRadius: v })}
                onCommit={onRefineEdgeCommit}
              />
              <LabeledSlider
                label="Force des contours"
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
      )}
    </div>
  );
}
