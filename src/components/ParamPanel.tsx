import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";
import type { CanvasControl, EffectParam } from "../render/effects/types";
import { CircleDot, MoveRight } from "lucide-react";
import "./ParamPanel.css";
import { LabeledSlider } from "./ui/labeled-slider";
import { Disclosure } from "./ui/collapsible";
import { Checkbox } from "./ui/checkbox";
import { Select } from "./ui/select";
import { ColorGroupControl } from "./ui/color-group-control";
import { formatControlValue } from "../ui/formatValue";
import { useState } from "react";
import { CurveControl } from "./CurveControl";
import { TonalRangeControl } from "./TonalRangeControl";
import { ColorRampControl } from "./ColorRampControl";
import type { CurvePoint } from "../ui/curveControl";
import { TexturePicker } from "./TexturePicker";
import type { TextureThumbnail } from "../textures/thumbnailCache";

export type ParamRenderItem =
  | { kind: "single"; reactKey: string; param: EffectParam; spatialId?: string }
  | { kind: "spatial-header"; reactKey: string; id: string; label: string; controlKind: CanvasControl["kind"]; visibleWhen?: { param: string; equals: number | number[] } }
  | { kind: "group"; reactKey: string; key: string; label: string; hue: EffectParam; saturation: EffectParam; lightness: EffectParam; isFirst: boolean };

/** Groups params sharing the same `colorGroup.key` (see EffectParam) into a
 *  single swatch+disclosure render item, in the order each group first
 *  appears. Ungrouped params pass through unchanged. Fails fast if a group is
 *  declared with fewer than its three required roles — a silent partial
 *  group would render a swatch that doesn't reflect an editable color.
 *
 *  `reactKey` EST PRÉFIXÉ PAR ESPACE DE NOMS, et ce n'est pas de la coquetterie
 *  — c'est la correction d'un bug trouvé sur pièce le 2026-08-02. `gooeyMerge`
 *  déclare un paramètre nommé `tint` ET un `colorGroup` de clé `"tint"` : les
 *  deux items de rendu recevaient donc la MÊME clé React. Une clé dupliquée
 *  casse la réconciliation de liste, et au démontage React laissait le bloc de
 *  couleur derrière lui — un fantôme « Couleur des gouttes » qui survivait au
 *  changement d'effet, s'accumulait à chaque passage, et ne répondait plus à
 *  aucun clic puisque React ne le possédait plus.
 *
 *  Préfixer rend la collision IMPOSSIBLE par construction plutôt que de
 *  demander aux auteurs d'effets de ne pas nommer un paramètre comme un groupe.
 *  `test/components/paramRenderKeys.test.ts` le vérifie sur tout le registre. */
export function groupEffectParams(params: EffectParam[], controls: readonly CanvasControl[] = [], excluded = new Set<string>()): ParamRenderItem[] {
  const firstIndexByKey = new Map<string, number>();
  const roleByKey = new Map<string, { label: string; hue?: EffectParam; saturation?: EffectParam; lightness?: EffectParam }>();

  params.forEach((p, index) => {
    if (excluded.has(p.name)) return;
    if (!p.colorGroup) return;
    const { key, role, label } = p.colorGroup;
    if (!firstIndexByKey.has(key)) firstIndexByKey.set(key, index);
    const entry = roleByKey.get(key) ?? { label };
    entry[role] = p;
    roleByKey.set(key, entry);
  });

  let seenGroups = 0;
  const items: ParamRenderItem[] = [];
  const spatialByParam = new Map<string, CanvasControl>();
  const spatialFirstIndex = new Map<string, number>();
  for (const control of controls) {
    const names = control.kind === "point" ? [control.x, control.y]
      : control.kind === "disk" ? [control.x, control.y, control.radius]
      : [control.angle, control.length];
    for (const name of names) {
      if (spatialByParam.has(name)) throw new Error(`Paramètre spatial partagé par plusieurs contrôles : "${name}".`);
      spatialByParam.set(name, control);
      const index = params.findIndex((param) => param.name === name);
      spatialFirstIndex.set(control.id, Math.min(spatialFirstIndex.get(control.id) ?? index, index));
    }
  }
  params.forEach((p, index) => {
    if (excluded.has(p.name)) return;
    const spatial = spatialByParam.get(p.name);
    if (spatial && spatialFirstIndex.get(spatial.id) === index) {
      items.push({ kind: "spatial-header", reactKey: `spatial:${spatial.id}`, id: spatial.id, label: spatial.label, controlKind: spatial.kind, visibleWhen: spatial.visibleWhen });
    }
    if (!p.colorGroup) {
      items.push({ kind: "single", reactKey: `param:${p.name}`, param: p, spatialId: spatial?.id });
      return;
    }
    if (firstIndexByKey.get(p.colorGroup.key) !== index) return;
    const entry = roleByKey.get(p.colorGroup.key)!;
    if (!entry.hue || !entry.saturation || !entry.lightness) {
      throw new Error(`Groupe de couleur "${p.colorGroup.key}" incomplet : hue/saturation/lightness requis.`);
    }
    items.push({ kind: "group", reactKey: `groupe:${p.colorGroup.key}`, key: p.colorGroup.key, label: entry.label, hue: entry.hue, saturation: entry.saturation, lightness: entry.lightness, isFirst: seenGroups === 0 });
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
  /** Bibliothèque de textures, pour les effets qui déclarent
   *  `EffectModule.libraryTexture`. Injectée depuis `App` plutôt que lue ici :
   *  un composant ne connaît ni la bibliothèque ni le renderer
   *  (`ARCHITECTURE.md`). Absente, le paramètre retombe sur son curseur. */
  textureLibrary?: {
    files: readonly string[];
    thumbnails: ReadonlyMap<string, TextureThumbnail>;
    onRequestThumbnail: (path: string) => void;
  };
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

export function ParamPanel({ layer, onParamChange, onParamCommit, onClipChange, onOpenColorPicker, textureLibrary }: Props) {
  const [activeCurveChannel, setActiveCurveChannel] = useState("master");
  if (!layer) {
    return <p className="param-panel__empty">Sélectionne un calque.</p>;
  }
  const effect = getEffect(layer.effectId);

  const controlledParams = new Set<string>();
  for (const control of effect.curveControls ?? []) for (const channel of control.channels) {
    controlledParams.add(channel.startY); controlledParams.add(channel.endY);
    for (const point of channel.points) { controlledParams.add(point.x); controlledParams.add(point.y); }
  }
  if (effect.tonalRangeControl) Object.values(effect.tonalRangeControl).forEach((name) => controlledParams.add(name));
  for (const control of effect.colorRampControls ?? []) {
    controlledParams.add(control.blackPoint); controlledParams.add(control.whitePoint);
    for (const stop of control.stops) {
      controlledParams.add(stop.hue); controlledParams.add(stop.saturation); controlledParams.add(stop.lightness);
      if (stop.position) controlledParams.add(stop.position);
    }
  }

  // Paramètres RÉSOLUS (défauts appliqués), pour les `maxFrom` d'en bas. Même
  // forme que ce que `runInternalPasses` passe à `EffectPass.enabled` — un
  // prédicat sur les réglages courants ne doit pas voir un `undefined` là où le
  // shader verra un défaut.
  const resolvedParams: Record<string, number> = {};
  for (const p of effect.params) resolvedParams[p.name] = layer.params[p.name] ?? p.default;

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
          {(effect.curveControls ?? []).map((control) => {
            const channels = control.channels.map((channel) => {
              const points: CurvePoint[] = [{ x: 0, y: resolvedParams[channel.startY] }];
              for (const slot of channel.points) if (resolvedParams[slot.x] >= 0) points.push({ x: resolvedParams[slot.x], y: resolvedParams[slot.y] });
              points.push({ x: 1, y: resolvedParams[channel.endY] });
              return { id: channel.id, label: channel.label, points };
            });
            return <CurveControl key={`courbe:${control.id}`} channels={channels}
              activeChannelId={channels.some((channel) => channel.id === activeCurveChannel) ? activeCurveChannel : channels[0].id}
              disabled={locked} onActiveChannelChange={setActiveCurveChannel}
              onChange={(channelId, points) => {
                const channel = control.channels.find((candidate) => candidate.id === channelId);
                if (!channel) return;
                const patch: Record<string, number> = { [channel.startY]: points[0].y, [channel.endY]: points[points.length - 1].y };
                const interiors = points.slice(1, -1);
                channel.points.forEach((slot, index) => {
                  patch[slot.x] = interiors[index]?.x ?? -1;
                  patch[slot.y] = interiors[index]?.y ?? resolvedParams[slot.y];
                });
                onParamChange(layer.id, patch);
              }} onCommit={onParamCommit} />;
          })}
          {(effect.colorRampControls ?? []).map((control) => {
            const stops = control.stops.map((stop, index) => ({
              id: stop.id, label: stop.label,
              hue: resolvedParams[stop.hue], saturation: resolvedParams[stop.saturation], lightness: resolvedParams[stop.lightness],
              position: stop.position ? resolvedParams[stop.position] : index / (control.stops.length - 1),
              movable: stop.position !== undefined,
            })) as Parameters<typeof ColorRampControl>[0]["stops"];
            return <ColorRampControl key={`rampe:${control.id}`} label={control.label} stops={stops} disabled={locked}
              positions={{ shadowPosition: stops[0].position, midPosition: stops[1].position, highPosition: stops[2].position, blackPoint: resolvedParams[control.blackPoint], whitePoint: resolvedParams[control.whitePoint] }}
              onChange={(values) => {
                onParamChange(layer.id, {
                  [control.blackPoint]: values.blackPoint,
                  [control.whitePoint]: values.whitePoint,
                  ...(control.stops[0].position ? { [control.stops[0].position]: values.shadowPosition } : {}),
                  ...(control.stops[1].position ? { [control.stops[1].position]: values.midPosition } : {}),
                  ...(control.stops[2].position ? { [control.stops[2].position]: values.highPosition } : {}),
                });
              }}
              onCommit={onParamCommit}
              onOpenStop={(stopId, anchorTop) => {
                const declaration = control.stops.find((stop) => stop.id === stopId);
                if (!declaration) return;
                const hue = effect.params.find((param) => param.name === declaration.hue)!;
                const saturation = effect.params.find((param) => param.name === declaration.saturation)!;
                const lightness = effect.params.find((param) => param.name === declaration.lightness)!;
                onOpenColorPicker({ layerId: layer.id, effectId: layer.effectId, key: declaration.id, label: declaration.label, hue, saturation, lightness, anchorTop });
              }} />;
          })}
          {effect.tonalRangeControl && (() => {
            const declaration = effect.tonalRangeControl;
            return <TonalRangeControl key="plage-tonale:effet" kind="effect" disabled={locked} values={{
              shadowsMin: resolvedParams[declaration.shadowsMin], shadowsMax: resolvedParams[declaration.shadowsMax],
              highlightsMin: resolvedParams[declaration.highlightsMin], highlightsMax: resolvedParams[declaration.highlightsMax],
            }} onChange={(patch) => onParamChange(layer.id, Object.fromEntries(Object.entries(patch).map(([role, value]) => [declaration[role as keyof typeof declaration], value as number]))) }
              onCommit={onParamCommit} />;
          })()}
          {groupEffectParams(effect.params, effect.canvasControls, controlledParams).map((item) =>
            item.kind === "spatial-header" ? (
              (!item.visibleWhen || (Array.isArray(item.visibleWhen.equals)
                ? item.visibleWhen.equals.includes(resolvedParams[item.visibleWhen.param])
                : resolvedParams[item.visibleWhen.param] === item.visibleWhen.equals)) ? <div key={item.reactKey} className="param-panel__spatial-heading">
                {item.controlKind === "axis" ? <MoveRight className="icon-sm icon-stroke" aria-hidden="true" /> : <CircleDot className="icon-sm icon-stroke" aria-hidden="true" />}
                <span>{item.label}</span>
                <span className="param-panel__spatial-hint">sur la toile</span>
              </div> : null
            ) : item.kind === "single" && textureLibrary && effect.libraryTexture?.indexParam === item.param.name ? (
              // TEXTURE DE BIBLIOTHÈQUE. La valeur reste un nombre — le rang
              // dans le catalogue — mais un curseur afficherait « 3 » sans dire
              // de quelle matière il s'agit. Une texture se reconnaît en la
              // voyant.
              <TexturePicker
                key={item.reactKey}
                label={item.param.label}
                files={textureLibrary.files}
                thumbnails={textureLibrary.thumbnails}
                value={Math.round(layer.params[item.param.name] ?? item.param.default)}
                disabled={locked}
                onRequestThumbnail={textureLibrary.onRequestThumbnail}
                onChange={(index) => {
                  onParamChange(layer.id, { [item.param.name]: index });
                  // Geste ATOMIQUE, comme un choix discret : pas de phase « en
                  // cours », donc il valide son entrée d'historique tout de
                  // suite. Sans ça, changer de texture ne serait jamais
                  // annulable seul — le changement s'agrégerait au prochain
                  // relâchement de curseur.
                  onParamCommit();
                }}
              />
            ) : item.kind === "single" && item.param.choices ? (
              // Paramètre à CHOIX DISCRET (voir EffectParam.choices) : la valeur
              // reste un nombre — l'index du choix — parce que l'uniform est un
              // array<f32> et que rien d'autre ne franchit cette frontière. Un
              // curseur à pas 1 conviendrait mécaniquement mais afficherait « 0 »
              // ou « 1 » sans dire lequel est lequel.
              //
              // `labelPlacement="inline"` : la colonne du dock est haute et
              // étroite, une étiquette au-dessus coûterait une ligne entière
              // (ADR-0001 — la carte Effets déborde déjà).
              <div key={item.reactKey} title={item.param.hint}>
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
              (() => {
                // MAXIMUM EFFECTIF. Quand un paramètre en borne un autre
                // (`EffectParam.maxFrom`), le curseur doit s'arrêter là où
                // l'effet s'arrête — sinon le pouce avance, le nombre monte et
                // l'image ne bouge plus. C'était le cas du fondu de `sliceShift`
                // sur les trois quarts de sa course.
                //
                // La valeur AFFICHÉE est bornée elle aussi : elle doit dire ce
                // que le shader utilise, pas ce que le document a stocké. Une
                // valeur héritée au-dessus (preset, `updateParams`) reste dans le
                // document — on n'écrase rien en silence — mais on ne prétend pas
                // qu'elle agit. Le premier geste sur le curseur la ramène dans
                // la course.
                const brut = layer.params[item.param.name] ?? item.param.default;
                const plafond = item.param.maxFrom
                  ? Math.min(item.param.max, item.param.maxFrom(resolvedParams))
                  : item.param.max;
                const valeur = Math.min(brut, plafond);
                return (
                  <div key={item.reactKey} title={item.param.hint}>
                    <LabeledSlider
                      label={item.param.label}
                      value={valeur}
                      min={item.param.min}
                      max={plafond}
                      step={item.param.step}
                      displayValue={formatEffectParamValue(valeur, item.param)}
                      disabled={locked}
                      onChange={(v) => onParamChange(layer.id, { [item.param.name]: v })}
                      onCommit={onParamCommit}
                    />
                  </div>
                );
              })()
            ) : (
              <ColorGroupControl
                key={item.reactKey}
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
