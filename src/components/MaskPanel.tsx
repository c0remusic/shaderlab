import { useState } from "react";
import type { LayerState } from "../layers/types";
import type { RefineEdgeParams } from "../mask/types";
import { isParametricMaskSource } from "../mask/types";
import { maskSourceRegistry, getMaskSourceModule } from "../mask/sources/registry";
import { angleToEndpoints } from "../mask/sources/gradient";
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
  // Calque VERROUILLÉ. `LayerStack.isLocked` refuse TOUTE la famille masque
  // (`addMaskSource` en levant, le reste en no-op `false`) : chaque contrôle
  // qui la déclenche est rendu inerte ci-dessous. Trois exceptions, adossées au
  // modèle et non au confort :
  //  - l'œil d'overlay est une préférence de VUE (`setOverlayForceHidden`,
  //    App.tsx), il ne mute aucun calque ;
  //  - le nom d'une source ne fait que choisir laquelle CONSULTER
  //    (`setSelectedSourceId`, état local de ce composant) ;
  //  - les replis (`Disclosure`) doivent continuer de s'ouvrir, sans quoi les
  //    valeurs ne seraient pas désactivées mais inaccessibles.
  // `disabled` par CONTRÔLE plutôt qu'un `<fieldset disabled>` : voir la note
  // équivalente dans ParamPanel.tsx — un fieldset n'émet pas le `data-disabled`
  // des primitives Base UI (rendu inerte mais d'apparence vive) et emporterait
  // ces trois exceptions avec le reste.
  const locked = layer.locked === true;
  const sources = layer.mask.sources.filter(isParametricMaskSource);
  const activeSourceId = selectedSourceId && sources.some((s) => s.id === selectedSourceId)
    ? selectedSourceId
    : (sources[0]?.id ?? null);
  const activeSource = sources.find((s) => s.id === activeSourceId) ?? null;
  const refineEdge = layer.mask.refineEdge;

  return (
    // `title` plutôt qu'une ligne de texte pour DIRE pourquoi les contrôles
    // sont inertes : la hauteur des cartes est sous budget (ADR-0001). Même
    // traitement que la zone de contrôles du panneau Calques.
    <div className="param-panel" title={locked ? "Calque verrouillé" : undefined}>
      <Disclosure title="Masque" defaultOpen>
        <div className="param-panel__group">
          <div className="param-panel__visibility-row">
            <IconButton
              label={overlayForceHidden ? "Afficher l'overlay" : "Masquer l'overlay"}
              tooltip={overlayForceHidden ? "Afficher l'overlay" : "Masquer l'overlay"}
              size="compact"
              aria-pressed={!overlayForceHidden}
              onClick={onToggleOverlayForceHidden}
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
              Mode peinture actif — les poignées de la photo sont masquées. Pour la déplacer ou la
              redimensionner, quitte d'abord la peinture avec « Quitter la peinture » dans la barre
              d'outils du pinceau.
            </p>
          ) : (
            // ARBITRAGE : ce bouton ne mute rien lui-même (il bascule le mode
            // de canvas, `usePhotoLayer.toggleMaskPaintMode`), mais il est
            // l'UNIQUE porte d'entrée de `updateBrushMask`, que la garde
            // refuse. Le laisser actif offrirait un mode peinture où chaque
            // touche de pinceau ne fait rien en silence — le piège même que
            // cette tranche ferme. Sans commune mesure avec `toggleLayer`, que
            // la garde laisse passer par DÉCISION assumée du modèle
            // (`layerStack.ts` § Opérations AUTORISÉES) et qui reste actif.
            <Button variant="secondary" disabled={locked} onClick={onToggleMaskPaint}>
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
                size="compact"
                aria-pressed={layer.mask.enabled}
                disabled={locked}
                onClick={() => onMaskEnabledChange(layer.id, !layer.mask.enabled)}
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
              disabled={locked}
              onChange={(invert) => onMaskInvertChange(layer.id, invert)}
            />
          </div>

          <DropdownMenu>
            {/* Calque VERROUILLÉ : `LayerStack.addMaskSource` LÈVE dans ce cas
                (elle rend un id, elle n'a pas de canal d'échec no-op comme les
                autres mutateurs). Ce `disabled` est ce qui rend la levée
                inatteignable depuis l'UI — la garde reste dans le modèle, ici
                on ne fait que ne pas offrir le geste. Les autres contrôles de
                masque de ce panneau sont refusés par le modèle en no-op et
                sont désormais désactivés eux aussi (`locked`, ci-dessus) —
                celui-ci n'est plus le cas particulier qu'il était. */}
            <DropdownMenuTrigger render={<Button variant="secondary" disabled={locked}>Ajouter une source</Button>} />
            <DropdownMenuContent align="start">
              {maskSourceRegistry.map((m) => (
                <DropdownMenuItem key={m.id} onClick={() => onAddMaskSource(layer.id, m.id)}>
                  {m.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {sources.length > 0 && (
            <ul
              // `data-dock-list` : voir PanelColumn.tsx § COÛT DU HORS-LISTE —
              // les contrôles de pinceau et le menu d'ajout de source vivent
              // dans la même boîte défilante que cette liste.
              data-dock-list=""
              className="param-panel__source-list"
            >
              {sources.map((source) => {
                const module = getMaskSourceModule(source.type);
                return (
                  <li
                    key={source.id}
                    className={`param-panel__source-row ${
                      source.id === activeSourceId ? "param-panel__source-row--active" : ""
                    }`.trim()}
                  >
                    <div className="param-panel__source-row-main">
                      <IconButton
                        label={source.enabled ? "Désactiver la source" : "Activer la source"}
                        tooltip="Actif"
                        size="compact"
                        aria-pressed={source.enabled}
                        disabled={locked}
                        onClick={() => onMaskSourceEnabledChange(layer.id, source.id, !source.enabled)}
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
                      <IconButton
                        label="Supprimer la source"
                        tooltip="Supprimer"
                        size="compact"
                        variant="danger"
                        disabled={locked}
                        onClick={() => onRemoveMaskSource(layer.id, source.id)}
                      >
                        <Trash2 className="icon-sm icon-stroke" aria-hidden="true" />
                      </IconButton>
                    </div>
                    <div className="param-panel__source-row-secondary">
                      <div className="param-panel__combine-mode" role="group" aria-label="Mode de combinaison">
                        {COMBINE_MODE_OPTIONS.map((option) => (
                          <Toggle
                            key={option.value}
                            size="sm"
                            title={option.label}
                            aria-label={option.label}
                            disabled={locked}
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
                    </div>
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
                      <Button variant="secondary" disabled={locked} onClick={() => onAddColorSample(layer.id, activeSource.id)}>
                        Ajouter un échantillon (centre canvas)
                      </Button>
                    </div>
                  );
                }
                if (key === "invert") {
                  // Binaire (0/1 côté wgsl, voir gradient.ts/luminosity.ts) —
                  // un LabeledSlider 0..1 pas-0.01 le rendait comme un
                  // continu alors qu'il ne prend que deux états, incohérent
                  // avec le Checkbox déjà utilisé pour layer.mask.invert
                  // juste au-dessus (ligne ~159).
                  return (
                    <Checkbox
                      key={key}
                      label={MASK_PARAM_LABELS[key] ?? key}
                      checked={value === 1}
                      disabled={locked}
                      onChange={(checked) => {
                        onMaskSourceParamsChange(layer.id, activeSource.id, {
                          ...activeSource.params,
                          invert: checked ? 1 : 0,
                        });
                        onMaskSourceParamsCommit();
                      }}
                    />
                  );
                }
                const range = paramRange(key);
                // "angle" (source gradient) n'est pas un paramètre lu par le
                // shader (voir gradient.ts) — juste une commodité de saisie
                // qui doit recalculer start/end à chaque changement, sinon
                // le slider bouge sans aucun effet visuel.
                const onAngleChange =
                  key === "angle" && activeSource.type === "gradient"
                    ? (v: number) =>
                        onMaskSourceParamsChange(layer.id, activeSource.id, {
                          ...activeSource.params,
                          angle: v,
                          ...angleToEndpoints(activeSource.params as { startX: number; startY: number; endX: number; endY: number }, v),
                        })
                    : (v: number) => onMaskSourceParamsChange(layer.id, activeSource.id, { ...activeSource.params, [key]: v });
                return (
                  <LabeledSlider
                    key={key}
                    label={MASK_PARAM_LABELS[key] ?? key}
                    value={value as number}
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    disabled={locked}
                    onChange={onAngleChange}
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
            disabled={locked}
            onChange={(v) => onRefineEdgeChange(layer.id, { feather: v })}
            onCommit={onRefineEdgeCommit}
          />
          <LabeledSlider
            label="Contracter/dilater"
            value={refineEdge.contract}
            min={-50}
            max={50}
            step={1}
            disabled={locked}
            onChange={(v) => onRefineEdgeChange(layer.id, { contract: v })}
            onCommit={onRefineEdgeCommit}
          />
          <LabeledSlider
            label="Lisser"
            value={refineEdge.smooth}
            min={0}
            max={10}
            step={1}
            disabled={locked}
            onChange={(v) => onRefineEdgeChange(layer.id, { smooth: v })}
            onCommit={onRefineEdgeCommit}
          />
          <Checkbox
            label="Accroché aux contours (edge-aware)"
            checked={refineEdge.edgeAware}
            disabled={locked}
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
                disabled={locked}
                onChange={(v) => onRefineEdgeChange(layer.id, { edgeRadius: v })}
                onCommit={onRefineEdgeCommit}
              />
              <LabeledSlider
                label="Force des contours"
                value={refineEdge.edgeStrength}
                min={0}
                max={2}
                step={0.05}
                disabled={locked}
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
