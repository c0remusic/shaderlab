import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";
import type { EffectParam } from "../render/effects/types";
import "./ParamPanel.css";
import { LabeledSlider } from "./ui/labeled-slider";
import { Disclosure } from "./ui/collapsible";
import { Checkbox } from "./ui/checkbox";
import { Select } from "./ui/select";
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
  /** Bascule l'écrêtage du calque SÉLECTIONNÉ (design 2026-07-27 §3.7). En
   *  en-tête plutôt qu'une case par ligne de la pile : un contrôle qui se
   *  répète sur chaque ligne devient un contrôle unique agissant sur la
   *  sélection. Jamais rendu pour un calque photo — c'est le calque d'EFFET qui
   *  porte l'attribut, une photo ne peut pas être écrêtée. */
  onClipChange: (id: string, clip: boolean) => void;
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

export function ParamPanel({ layer, onParamChange, onParamCommit, onClipChange, onOpenColorPicker }: Props) {
  if (!layer) {
    return <p className="param-panel__empty">Sélectionne un calque.</p>;
  }
  const effect = getEffect(layer.effectId);

  // Calque VERROUILLÉ. `LayerStack.isLocked` refuse `setLayerClip` et
  // `updateParams` : les DEUX seules mutations que ce panneau déclenche sont
  // donc mortes, et un contrôle qui bouge sans rien changer est exactement
  // l'échec silencieux que ce dépôt proscrit.
  //
  // `disabled` par CONTRÔLE, et non un `<fieldset disabled>` englobant : le
  // fieldset natif rend inertes tous ses descendants d'un bloc, sans poser le
  // `data-disabled` dont dépend le rendu désactivé des primitives Base UI
  // (checkbox/slider/toggle) — l'interface mentirait alors dans l'autre sens,
  // inerte mais d'apparence vive. Il emporterait de surcroît les replis
  // (`Disclosure`) et la pastille de couleur, donc la LISIBILITÉ des valeurs,
  // qui est précisément ce qu'un verrou doit préserver.
  const locked = layer.locked === true;
  // `title` plutôt qu'une ligne de texte : la hauteur des cartes est sous
  // budget (ADR-0001, la carte Effets déborde déjà à six lignes). Même
  // traitement que la zone de contrôles du panneau Calques
  // (`LayerPanel.tsx` : `title={model.locked ? "Calque verrouillé" : undefined}`).
  const lockedTitle = locked ? "Calque verrouillé" : undefined;

  // État vide EXPLICITE plutôt qu'un `Disclosure "Effet"` vide (design
  // 2026-07-27 §3.7) : un calque photo porte `passthrough`, dont la liste de
  // paramètres est vide — le cadre vide ne disait pas pourquoi. Deux causes
  // distinctes, deux phrases : aucun effet du tout, ou un effet sans réglage.
  // L'écrêtage est une propriété du CALQUE, pas de son effet : il reste donc
  // accessible même quand l'effet n'a aucun paramètre. Le sortir du chemin
  // « avec paramètres » corrige un piège sans issue — un calque écrêté repassé
  // à « Aucun effet » gardait `clipToBelow: true` sans plus aucun moyen de le
  // décocher, l'état vide étant retourné avant la case (seul un undo en
  // sortait).
  const clipRow = layer.imageSource === undefined && (
    <div className="param-panel__clip-row">
      <Checkbox
        // « du dessus » depuis l'ADR-0004 : la base d'un écrêtage est le calque
        // appliqué AVANT, qui est la ligne du dessus dans la liste causale (elle
        // était en dessous sous l'ADR-0003). Le libellé décrit ce que
        // l'utilisateur VOIT, comme la flèche d'écrêtage de `LayerPanel`.
        label="Écrêter sur la photo du dessus"
        checked={layer.clipToBelow ?? false}
        disabled={locked}
        onChange={(clip) => onClipChange(layer.id, clip)}
      />
    </div>
  );

  if (effect.params.length === 0) {
    return (
      <div className="param-panel" title={lockedTitle}>
        {clipRow}
        <p className="param-panel__empty">
          {layer.effectId === "passthrough" ? "Aucun effet appliqué à ce calque." : "Cet effet n'a pas de paramètres."}
        </p>
      </div>
    );
  }

  return (
    <div className="param-panel" title={lockedTitle}>
      {clipRow}
      <Disclosure title="Effet" defaultOpen>
        <div className="param-panel__group">
          {groupEffectParams(effect.params).map((item) =>
            item.kind === "single" && item.param.choices ? (
              // Paramètre à CHOIX DISCRET (voir EffectParam.choices) : la valeur
              // reste un nombre — l'index du choix — parce que l'uniform est un
              // array<f32> et que rien d'autre ne franchit cette frontière. Un
              // curseur à pas 1 conviendrait mécaniquement mais afficherait « 0 »
              // ou « 1 » sans dire lequel est lequel.
              //
              // `labelPlacement="inline"` : la colonne du dock est haute et
              // étroite, une étiquette au-dessus coûterait une ligne entière
              // (ADR-0001 — la carte Effets déborde déjà).
              <div key={item.param.name} title={item.param.hint}>
                <Select
                  label={item.param.label}
                  labelPlacement="inline"
                  value={String(Math.round(layer.params[item.param.name] ?? item.param.default))}
                  options={item.param.choices.map((label, index) => ({ value: String(index), label }))}
                  disabled={locked}
                  onChange={(v) => {
                    onParamChange(layer.id, { [item.param.name]: Number(v) });
                    // Un choix est un geste ATOMIQUE, pas un glissement : il
                    // n'a pas de phase « en cours » comme un curseur, donc il
                    // valide son entrée d'historique immédiatement. Sans ça, le
                    // changement de mode ne serait jamais annulable seul — il
                    // s'agrégerait au prochain relâchement de curseur.
                    onParamCommit();
                  }}
                />
              </div>
            ) : item.kind === "single" ? (
              <div key={item.param.name} title={item.param.hint}>
                <LabeledSlider
                  label={item.param.label}
                  value={layer.params[item.param.name] ?? item.param.default}
                  min={item.param.min}
                  max={item.param.max}
                  step={item.param.step}
                  displayValue={formatEffectParamValue(layer.params[item.param.name] ?? item.param.default, item.param)}
                  disabled={locked}
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
                disabled={locked}
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
