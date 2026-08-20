import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";
import type { CanvasControl, EffectParam, EffectSection, SectionLayout } from "../render/effects/types";
import { conditionRemplie } from "../render/effects/displayCondition";
import { CircleDot, MoveRight } from "lucide-react";
import "./ParamPanel.css";
import { LabeledSlider } from "./ui/labeled-slider";
import { Disclosure } from "./ui/collapsible";
import { Checkbox } from "./ui/checkbox";
import { Select } from "./ui/select";
import { ColorGroupControl } from "./ui/color-group-control";
import { formatControlValue, parsePercentValue } from "../ui/formatValue";
import { useState, type ReactNode } from "react";
import { CurveControl } from "./CurveControl";
import { TonalRangeControl } from "./TonalRangeControl";
import { ColorRampControl } from "./ColorRampControl";
import type { CurvePoint } from "../ui/curveControl";
import { TexturePicker } from "./TexturePicker";
import type { TextureThumbnail } from "../textures/thumbnailCache";
import { isPositionLocked, isStructureLocked } from "../layers/layerLocks";
import { controlFieldRoles, effectSpatialParams } from "../render/effects/spatialParams";
import { spatialPixelFactors, parsePixelInput } from "../render/effects/spatialPixels";

export type ParamRenderItem =
  | { kind: "single"; reactKey: string; param: EffectParam; spatialId?: string }
  | { kind: "spatial-header"; reactKey: string; id: string; label: string; controlKind: CanvasControl["kind"] }
  | { kind: "group"; reactKey: string; key: string; label: string; hue: EffectParam; saturation: EffectParam; lightness: EffectParam; isFirst: boolean };

/**
 * Un BLOC de rendu : les items d'une section déclarée, ou une suite d'items que
 * nulle section ne cite.
 *
 * ⚠️ Ce n'est PAS un réordonnancement de `params[]` — les index sont persistés
 * dans les presets. Un bloc regroupe des items de RENDU, et l'ordre interne à un
 * bloc reste celui de `params[]`.
 */
export interface ParamRenderBlock {
  reactKey: string;
  /** Titre de la section. `null` = bloc libre, rendu sans en-tête. */
  label: string | null;
  layout: SectionLayout;
  items: ParamRenderItem[];
}

export interface GroupEffectParamsOptions {
  /** Sections déclarées par l'effet (`EffectModule.sections`). */
  sections?: readonly EffectSection[];
  /** Paramètres du calque. Les manquants prennent leur défaut déclaré. */
  values?: Record<string, number>;
}

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
 *  `test/components/paramRenderKeys.test.ts` le vérifie sur tout le registre.
 *
 *  APPLICABILITÉ ET SECTIONS (2026-08-05). La fonction rend désormais des BLOCS
 *  et non plus une liste plate : elle masque ce qui n'a pas d'objet aux réglages
 *  courants (`EffectParam.appliesWhen`) et regroupe le reste par section
 *  (`EffectModule.sections`). Un effet sans section rend exactement ce qu'il
 *  rendait — un unique bloc libre, dans l'ordre de `params[]`.
 *
 *  ⚠️ AUCUN `if (effectId)` : tout ce qui suit lit le contrat déclaratif du
 *  module d'effet, jamais son identité (frontière d'`ARCHITECTURE.md`). */
export function groupEffectParams(
  params: EffectParam[],
  controls: readonly CanvasControl[] = [],
  excluded = new Set<string>(),
  options: GroupEffectParamsOptions = {},
): ParamRenderBlock[] {
  const sections = options.sections ?? [];

  // Valeurs RÉSOLUES : défauts appliqués, même contrat que `EffectPass.enabled`
  // et `EffectParam.maxFrom`. Un prédicat sur les réglages courants ne doit pas
  // voir un `undefined` là où le shader verra un défaut. Corollaire voulu : un
  // appelant qui ne passe rien (garde de registre, story de gabarit) décrit la
  // configuration PAR DÉFAUT de l'effet — et non une configuration vide où
  // toute condition serait fausse et où le panneau se viderait.
  const valeurs: Record<string, number> = {};
  for (const p of params) valeurs[p.name] = options.values?.[p.name] ?? p.default;

  const sectionParParam = new Map<string, EffectSection>();
  for (const section of sections) for (const name of section.params) sectionParParam.set(name, section);

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

  const spatialByParam = new Map<string, CanvasControl>();
  const spatialFirstIndex = new Map<string, number>();
  const nomsParControle = new Map<string, string[]>();
  for (const control of controls) {
    // Les champs du genre viennent de la table unique de `spatialParams.ts` —
    // même énumération, même ordre, aucune recopie à tenir à jour.
    const names = controlFieldRoles(control).map(([nom]) => nom);
    nomsParControle.set(control.id, names);
    for (const name of names) {
      if (spatialByParam.has(name)) throw new Error(`Paramètre spatial partagé par plusieurs contrôles : "${name}".`);
      spatialByParam.set(name, control);
      const index = params.findIndex((param) => param.name === name);
      spatialFirstIndex.set(control.id, Math.min(spatialFirstIndex.get(control.id) ?? index, index));
    }
  }

  // BLOCS ATOMIQUES. Un contrôle de toile et un groupe de couleur sont rendus
  // comme UNE chose à partir de plusieurs paramètres : l'en-tête « sur la
  // toile » se place à l'index du premier paramètre du contrôle, la pastille de
  // couleur à celui du premier des trois rôles. Une section qui n'en citerait
  // qu'une partie déplacerait la moitié du contrôle et laisserait l'autre en
  // arrière — un en-tête sans ses curseurs, ou une pastille orpheline. Ça ne
  // lève ni au type-check ni au chargement du registre, et aucune référence de
  // pixels ne peut le voir : on le refuse ici, là où le déplacement a lieu.
  const nommerSection = (name: string) => sectionParParam.get(name)?.id ?? "hors section";
  const verifierBlocAtomique = (quoi: string, noms: readonly string[]) => {
    const vues = [...new Set(noms.map(nommerSection))];
    if (vues.length > 1) {
      throw new Error(`${quoi} : ses paramètres sont répartis entre ${vues.join(" et ")}. Une section déplace un bloc atomique en entier, jamais à moitié.`);
    }
  };
  for (const [id, noms] of nomsParControle) verifierBlocAtomique(`Contrôle de toile "${id}"`, noms);
  for (const [key, entry] of roleByKey) {
    const noms = [entry.hue?.name, entry.saturation?.name, entry.lightness?.name].filter((name): name is string => name !== undefined);
    verifierBlocAtomique(`Groupe de couleur "${key}"`, noms);
  }

  // Un paramètre est masqué par SA condition, ou par celle de sa section — les
  // deux se cumulent. ⚠️ Masquer n'efface pas : la valeur reste au calque, part
  // telle quelle dans les presets, et le shader continue de la lire.
  const masque = (p: EffectParam): boolean => {
    if (p.appliesWhen && !conditionRemplie(p.appliesWhen, valeurs)) return true;
    const section = sectionParParam.get(p.name);
    return section?.appliesWhen !== undefined && !conditionRemplie(section.appliesWhen, valeurs);
  };

  let seenGroups = 0;
  const plats: { item: ParamRenderItem; section: EffectSection | null }[] = [];
  params.forEach((p, index) => {
    if (excluded.has(p.name)) return;
    const section = sectionParParam.get(p.name) ?? null;
    const spatial = spatialByParam.get(p.name);
    if (spatial && spatialFirstIndex.get(spatial.id) === index) {
      // L'en-tête suit la visibilité de son contrôle ET celle de ses
      // paramètres : « sur la toile » au-dessus de rien annoncerait un réglage
      // qui n'est plus là.
      const vivants = (nomsParControle.get(spatial.id) ?? []).some((name) => {
        const cible = params.find((candidate) => candidate.name === name);
        return cible !== undefined && !excluded.has(name) && !masque(cible);
      });
      if (vivants && (!spatial.visibleWhen || conditionRemplie(spatial.visibleWhen, valeurs))) {
        plats.push({ item: { kind: "spatial-header", reactKey: `spatial:${spatial.id}`, id: spatial.id, label: spatial.label, controlKind: spatial.kind }, section });
      }
    }
    if (!p.colorGroup) {
      if (!masque(p)) plats.push({ item: { kind: "single", reactKey: `param:${p.name}`, param: p, spatialId: spatial?.id }, section });
      return;
    }
    if (firstIndexByKey.get(p.colorGroup.key) !== index) return;
    const entry = roleByKey.get(p.colorGroup.key)!;
    if (!entry.hue || !entry.saturation || !entry.lightness) {
      throw new Error(`Groupe de couleur "${p.colorGroup.key}" incomplet : hue/saturation/lightness requis.`);
    }
    // TOUT OU RIEN. `ColorGroupControl` a besoin de ses trois rôles pour
    // afficher une pastille qui reflète une couleur modifiable : un masquage
    // partiel n'est pas exprimable, il ne se DEVINE donc pas. Le groupe ne part
    // que si ses trois paramètres sont sans objet.
    if (masque(entry.hue) && masque(entry.saturation) && masque(entry.lightness)) return;
    // `isFirst` compte les groupes RENDUS, pas les groupes déclarés : c'est lui
    // qui décide du seul groupe déplié d'entrée, et un groupe masqué ne peut pas
    // être celui-là.
    plats.push({ item: { kind: "group", reactKey: `groupe:${p.colorGroup.key}`, key: p.colorGroup.key, label: entry.label, hue: entry.hue, saturation: entry.saturation, lightness: entry.lightness, isFirst: seenGroups === 0 }, section });
    seenGroups += 1;
  });

  // Une section s'ouvre à la place de son PREMIER item et attire les suivants ;
  // un item que nulle section ne cite reste à sa place, dans un bloc libre
  // ouvert là où il se trouve (et non renvoyé vers le premier bloc libre, ce qui
  // le déplacerait). Une section dont tous les items sont masqués n'ouvre aucun
  // bloc : elle disparaît, en-tête compris — ADR-0001 prime sur la stabilité
  // visuelle (arbitrage du plan, 2026-08-05).
  const blocs: ParamRenderBlock[] = [];
  const blocParSection = new Map<string, ParamRenderBlock>();
  let libre: ParamRenderBlock | null = null;
  for (const { item, section } of plats) {
    if (!section) {
      if (!libre) {
        libre = { reactKey: `libre:${item.reactKey}`, label: null, layout: "liste", items: [] };
        blocs.push(libre);
      }
      libre.items.push(item);
      continue;
    }
    let bloc = blocParSection.get(section.id);
    if (!bloc) {
      bloc = { reactKey: `section:${section.id}`, label: section.label, layout: section.layout, items: [] };
      blocParSection.set(section.id, bloc);
      blocs.push(bloc);
      // ⚠️ ON NE FERME LE BLOC LIBRE QUE SI UNE SECTION S'OUVRE ICI. Rejoindre
      // une section DÉJÀ ouverte plus haut n'interrompt rien à cet endroit :
      // fermer le bloc libre là aussi couperait en deux une suite de paramètres
      // libres qui se suivent, pour n'y insérer aucun titre.
      libre = null;
    }
    bloc.items.push(item);
  }
  return blocs;
}

/**
 * Rend un bloc de paramètres selon son GABARIT (`SectionLayout`).
 *
 * Le gabarit ne choisit pas des pixels, il choisit un régime : toute la densité
 * reste dans `ParamPanel.css`, par tokens. Exporté pour que les stories puissent
 * montrer chaque gabarit — aucun effet du registre n'en déclare avant la tâche
 * qui pose les sections.
 */
export function ParamSection({ label, layout, children }: { label: string | null; layout: SectionLayout; children: ReactNode }) {
  return (
    <div className={`param-panel__section param-panel__section--${layout}`}>
      {label !== null && <div className="param-panel__section-title">{label}</div>}
      <div className="param-panel__section-body">{children}</div>
    </div>
  );
}

interface Props {
  layer: LayerState | null;
  /** Dimensions du cadre en pixels, pour lire les contrôles spatiaux en pixels
   *  plutôt qu'en fraction (voie B, symétrie panneau/toile). La MÊME valeur que
   *  celle passée à `CanvasControls`, pour que panneau et toile disent le même
   *  nombre. `{0,0}` (aucun document) ou absente = affichage en pourcentage,
   *  inchangé — les stories qui ne la passent pas rendent comme avant. */
  imageSize?: { width: number; height: number };
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
    dir: string | null;
    files: readonly string[];
    thumbnails: ReadonlyMap<string, TextureThumbnail>;
    error: string | null;
    onRequestThumbnail: (path: string) => void;
    onPickFolder: () => void;
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

export function ParamPanel({ layer, imageSize, onParamChange, onParamCommit, onClipChange, onOpenColorPicker, textureLibrary }: Props) {
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
  const locked = isStructureLocked(layer);
  // La GEOMETRIE s'eteint a part : le verrou Position gele les parametres
  // cites par `canvasControls` et laisse les autres vivants — c'est le
  // geste « je tiens le placement, je cherche encore la couleur ».
  const geometrieGelee = isPositionLocked(layer);
  const paramsSpatiaux = new Set(effectSpatialParams(effect));
  // Contrôles spatiaux montrés en PIXELS (voie B). Le facteur (× W, × H, ou
  // × sqrt(W·H)) vient de la structure du `canvasControls`, jamais du nom, et
  // il MATCHE la toile — voir `spatialPixels.ts`. La conversion ne s'arme que
  // pour un cadre réel : `{0,0}` retombe sur l'affichage en pourcentage.
  const pixelFactors = spatialPixelFactors(effect, imageSize);
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
          {/* Ce qui est MASQUÉ et ce qui est GROUPÉ se décide dans
              `groupEffectParams`, sur le contrat déclaratif du module d'effet.
              Le JSX ci-dessous ne connaît que des items et des gabarits — il
              n'interroge jamais l'identité de l'effet. */}
          {groupEffectParams(effect.params, effect.canvasControls, controlledParams, {
            sections: effect.sections,
            values: resolvedParams,
          }).map((bloc) => (
          <ParamSection key={bloc.reactKey} label={bloc.label} layout={bloc.layout}>
          {bloc.items.map((item) =>
            item.kind === "spatial-header" ? (
              <div key={item.reactKey} className="param-panel__spatial-heading">
                {item.controlKind === "axis" ? <MoveRight className="icon-sm icon-stroke" aria-hidden="true" /> : <CircleDot className="icon-sm icon-stroke" aria-hidden="true" />}
                <span>{item.label}</span>
                <span className="param-panel__spatial-hint">sur la toile</span>
              </div>
            ) : item.kind === "single" && textureLibrary && effect.libraryTexture?.indexParam === item.param.name ? (
              // TEXTURE DE BIBLIOTHÈQUE. La valeur reste un nombre — le rang
              // dans le catalogue — mais un curseur afficherait « 3 » sans dire
              // de quelle matière il s'agit. Une texture se reconnaît en la
              // voyant.
              <TexturePicker
                key={item.reactKey}
                label={item.param.label}
                dir={textureLibrary.dir}
                files={textureLibrary.files}
                thumbnails={textureLibrary.thumbnails}
                error={textureLibrary.error}
                value={Math.round(layer.params[item.param.name] ?? item.param.default)}
                disabled={locked}
                onPickFolder={textureLibrary.onPickFolder}
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
                // CONTRÔLE SPATIAL EN PIXELS (voie B). Le curseur reste en
                // FRACTION — min/max/step/défaut inchangés, donc le double-clic
                // de retour au défaut, la marque et le round-trip sont EXACTS et
                // `test:render` ne bouge pas. Seuls le texte affiché et la
                // saisie passent en pixels, via le même facteur que la toile.
                const facteurPx = pixelFactors.get(item.param.name);
                // Le pixel est une unité DÉJÀ connue du formateur : la valeur
                // convertie passe par la même branche que n'importe quel
                // paramètre déclaré en `pixels`, plutôt qu'un « px » recollé ici.
                const displayValue = facteurPx !== undefined
                  ? formatEffectParamValue(valeur * facteurPx, { unit: "pixels", step: 1 })
                  : formatEffectParamValue(valeur, item.param);
                // Saisie dans l'UNITÉ AFFICHÉE, ramenée en fraction avant de
                // borner sur les bornes du CURSEUR et de caler sur son pas :
                // pixels d'un contrôle spatial via `parsePixelInput`, pourcents
                // d'un paramètre `percent` via `parsePercentValue` (l'affichage
                // est ×100 pendant que le curseur reste en fraction). Sans le
                // second, la frappe passait par `parseControlValue` avec les
                // bornes FRACTION : « 60 » tapé dans un champ montrant « 50 % »
                // s'écrêtait à 1 (= 100 %). `pixels`/`degrees`/`none` affichent
                // l'unité du curseur, le parse standard leur suffit.
                const parseSaisie = facteurPx !== undefined
                  ? (raw: string) => parsePixelInput(raw, facteurPx, { min: item.param.min, max: plafond, step: item.param.step })
                  : item.param.unit === "percent"
                    ? (raw: string) => parsePercentValue(raw, item.param.min, plafond, item.param.step)
                    : undefined;
                return (
                  <div key={item.reactKey} title={item.param.hint}>
                    <LabeledSlider
                      label={item.param.label}
                      value={valeur}
                      min={item.param.min}
                      max={plafond}
                      step={item.param.step}
                      displayValue={displayValue}
                      parse={parseSaisie}
                      // Le verrou POSITION n'éteint QUE les paramètres cités par
                      // un `canvasControls` — la géométrie. Les autres restent
                      // vivants : c'est tout l'intérêt d'un verrou partiel, et
                      // éteindre le panneau entier reviendrait à n'avoir qu'un
                      // seul verrou déguisé en quatre.
                      // ⚠️ Mesuré le 2026-08-19 : sur 5 effets à contrôle
                      // spatial, 3 mélangent spatial et non-spatial dans la MÊME
                      // section (`motionBlur`, `pixelStretch`, `aplat`). Le
                      // panneau y sera donc en DAMIER — des curseurs éteints
                      // entre des vifs. C'est le prix d'éteindre exactement ce
                      // qui est gelé ; griser la section entière griserait des
                      // curseurs encore modifiables, ce qui serait un mensonge.
                      disabled={locked || (geometrieGelee && paramsSpatiaux.has(item.param.name))}
                      // LE DÉFAUT VIENT DU MODULE D'EFFET, sa seule source de
                      // vérité (ticket 11). C'est lui qui arme le double-clic de
                      // retour au défaut et la marque sur la piste — recopier
                      // une valeur ici aurait créé un second endroit où vit le
                      // défaut d'un paramètre, et les deux auraient dérivé.
                      defaultValue={item.param.default}
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
          </ParamSection>
          ))}
        </div>
      </Disclosure>
    </div>
  );
}
