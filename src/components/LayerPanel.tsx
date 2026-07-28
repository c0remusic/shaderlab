import { memo, useCallback, useMemo } from "react";
import { usePointerReorder, type DropPosition } from "../ui/dragReorder";
import "../ui/dragReorder.css";
import { Copy, CornerLeftUp, Eye, EyeOff, GripVertical, Image as PhotoLayerIcon, Lock, Sparkles as EffectLayerIcon, Trash2 } from "lucide-react";
import type { LayerState } from "../layers/types";
import { eyeButtonLabels, isLayerVisible, isolationRole, isolationVisibleIds, type IsolationRole } from "../layers/isolation";
import { resolveClipping } from "../layers/clipping";
import { displayInsertToModelInsert } from "./layerDisplayOrder";
import { toLayerTreeRows } from "./layerTree";
import { effectRegistry, getEffect } from "../render/effects/registry";
import { PASSTHROUGH_EFFECT } from "../render/effectPassRunner";
import { blendRegistry } from "../render/blend/registry";
import { Select } from "./ui/select";
import { NumberField } from "./ui/number-field";
import { IconButton } from "./ui/icon-button";
import { formatOpacityPercent, layerControlsModel, opacityToPercent, parseOpacityPercent } from "./layerControlsModel";
import "./LayerPanel.css";

interface Props {
  layers: LayerState[];
  selectedId: string | null;
  hasImage: boolean;
  onSelect: (id: string) => void;
  /** Clic sur l'œil. `altKey` porte le geste d'ISOLATION (Alt+clic) : la
   *  décision de ce qu'il déclenche est prise par `layers/isolation.ts`, pas
   *  ici — ce composant ne fait que transmettre le modificateur. */
  onToggle: (id: string, altKey: boolean) => void;
  /** Id du calque isolé, ou null. Ne change QUE l'affichage (icône + libellé) :
   *  la visibilité stockée des calques n'est pas touchée. */
  isolatedLayerId?: string | null;
  onAdd: (effectId: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, newIndex: number) => void;
  /** Résout la vignette d'un calque photo par `sourceId`. La vignette est
   *  POSSÉDÉE par `PhotoSourceStore` (object URL, hors state React) — cette
   *  prop n'en transporte que la lecture, jamais le raster (invariant OOM).
   *  DOIT être référentiellement stable (`useCallback`) : elle traverse la
   *  mémoïsation de `LayerRow`. */
  thumbnailUrl?: (sourceId: string) => string | null;
  /** Nom de fichier du DOCUMENT (`documentFileName`, src/layers/documentName.ts),
   *  ou `null` si aucun document n'est ouvert. Pilote la ligne d'ARRIÈRE-PLAN,
   *  qui est DÉRIVÉE et non un `LayerState` : le document est `sourceTexture`,
   *  l'entrée du pipeline, pas un élément de la pile. Sans elle, l'utilisateur
   *  voyait deux sortes de « photos » — celles qu'il importe, listées, et celle
   *  qui a ouvert le document, invisible. */
  backgroundName?: string | null;
}

/** Contrôles CENTRALISÉS : ils ne vivent plus sur chaque ligne mais une seule
 *  fois, dans la zone de contrôles fixe de la carte Effets (`DockedPanelCard`,
 *  slot `controls`), et agissent sur le calque SÉLECTIONNÉ. Ce composant est
 *  monté par `App.tsx` DEHORS de `LayerPanel` — c'est ce qui lui permet de ne
 *  pas défiler avec la liste. Depuis le 2026-07-28 la zone est posée en PIED
 *  (`controlsPlacement: "bottom"`) : on lit d'abord ce qui est modifié, puis
 *  les réglages. Ex-`LayerHeader`. */
export interface LayerControlsProps {
  layers: LayerState[];
  selectedId: string | null;
  onOpacityChange: (id: string, opacity: number) => void;
  onOpacityCommit: () => void;
  onBlendModeChange: (id: string, blendMode: string) => void;
  onEffectChange: (id: string, effectId: string) => void;
}

interface LayerRowProps {
  layer: LayerState;
  /** Index de LIGNE AFFICHÉE (0 = première ligne, en haut), à ne pas confondre
   *  avec l'index dans `layers` même quand les deux coïncident : c'est le sens
   *  d'affichage en vigueur qui décide s'ils coïncident (ADR-0004 : oui,
   *  aujourd'hui), pas ce composant. C'est cette valeur que porte
   *  `data-layer-row-index`, sur laquelle le glisser-déposer fait son hit-test ;
   *  la conversion vers le modèle a lieu une seule fois, à la sortie du hook
   *  (voir `layerDisplayOrder.ts`). */
  index: number;
  selected: boolean;
  isDragging: boolean;
  dropPosition: DropPosition | null;
  /** Visibilité EFFECTIVE (isolation comprise) : pilote l'icône et le libellé.
   *  Booléen déjà calculé plutôt que l'id isolé, pour ne pas casser la
   *  mémoïsation de la ligne (`memo`) sur un calque non concerné. */
  visible: boolean;
  /** Rôle de CE calque dans l'isolation en cours (`none`/`isolated`/`other`) :
   *  pendant l'isolation, un clic simple sur n'importe quel œil en SORT, mais
   *  l'Alt+clic ne fait pas la même chose sur le calque isolé et sur les
   *  autres — voir `eyeButtonLabels`. Valeur déjà réduite à ce calque plutôt
   *  que l'id isolé, pour ne pas casser la mémoïsation de la ligne (`memo`)
   *  sur un calque non concerné. */
  role: IsolationRole;
  /** L'écrêtage de ce calque est-il EFFECTIF (une base photo existe sous lui) ?
   *  Déjà résolu par `resolveClipping` côté panneau plutôt que dérivé de
   *  `layer.clipToBelow` ici : l'attribut peut être posé sans qu'aucune base
   *  n'existe (calque écrêté en bas de pile), auquel cas le rendu est linéaire
   *  et la flèche ne doit pas apparaître. Booléen déjà réduit à ce calque pour
   *  ne pas casser la mémoïsation de la ligne (`memo`). */
  clipped: boolean;
  /** Profondeur d'IMBRICATION (0 racine, 1 sous une photo) et bornes du groupe,
   *  décidées par `toLayerTreeRows` (src/components/layerTree.ts). Passées
   *  RÉDUITES à cette ligne — jamais l'arbre entier — pour ne pas casser la
   *  mémoïsation (`memo`) d'une ligne dont le rattachement n'a pas bougé.
   *  N'affectent QUE l'affichage : ni le modèle, ni l'ordre d'exécution, ni
   *  l'index de ligne sur lequel le glisser-déposer fait son hit-test. */
  depth: 0 | 1;
  firstChild: boolean;
  lastChild: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, altKey: boolean) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onGripPointerDown: (id: string, pointerId: number, target: Element, clientX: number, clientY: number) => void;
  thumbnailUrl?: (sourceId: string) => string | null;
}

const addEffectOptions = effectRegistry.map((e) => ({ value: e.id, label: e.name }));
/** Sélecteur de CHANGEMENT d'effet : contrairement au sélecteur d'AJOUT, il
 *  expose `passthrough` — sous le libellé « Aucun effet », parce que c'est ce
 *  qu'il veut dire pour l'utilisateur, et parce qu'un calque photo doit pouvoir
 *  y revenir. `passthrough` reste hors de `effectRegistry` (contrat
 *  `render/effects/registry.ts`), donc il est ajouté ici explicitement. */
const changeEffectOptions = [{ value: PASSTHROUGH_EFFECT.id, label: "Aucun effet" }, ...addEffectOptions];
const blendModeOptions = blendRegistry.map((m) => ({ value: m.id, label: m.name }));

// Mémoïsée : sans ça, un drag de slider (paramètre d'effet, pinceau)
// re-render (re-diffe) la liste ENTIÈRE des calques à chaque frame — coût qui
// grandit avec le nombre de calques. Ne sert à rien sans callbacks
// stables côté App.tsx (useCallback) : voir le commentaire équivalent là-bas.
const LayerRow = memo(function LayerRow({
  layer,
  index,
  selected,
  isDragging,
  dropPosition,
  visible,
  role,
  clipped,
  depth,
  firstChild,
  lastChild,
  onSelect,
  onToggle,
  onDuplicate,
  onRemove,
  onGripPointerDown,
  thumbnailUrl,
}: LayerRowProps) {
  // Identité du calque (parité calque photo, T1) : le nom du calque prime,
  // et l'affichage retombe sur le nom de l'effet pour tout calque non nommé
  // (c'est-à-dire tous les calques d'effet, inchangés).
  const displayName = layer.name ?? getEffect(layer.effectId).name;
  const thumbnail = layer.imageSource ? thumbnailUrl?.(layer.imageSource.sourceId) ?? null : null;
  // Libellés du bouton œil : dérivés de l'état réel par une fonction pure
  // (testée dans test/layers/isolation.test.ts), jamais écrits en dur ici —
  // pendant l'isolation, le clic simple et l'Alt+clic ne font pas la même chose
  // selon la ligne, et une infobulle qui annonce la mauvaise action est pire
  // qu'une absence d'infobulle.
  const eyeLabels = eyeButtonLabels(visible, role);
  // Écrêtage : la flèche coudée, et RIEN d'autre. L'indentation livrée le
  // 2026-07-27 a été retirée après observation directe de Photoshop web
  // (docs/design-system/photoshop-web-observations-2026-07-27.md §5ter) : une
  // ligne écrêtée y reste alignée sur les autres, seule une petite flèche
  // apparaît entre l'œil et la vignette. L'indentation avait été validée sur
  // une maquette qui la présentait à tort comme la convention Photoshop.
  // `clipped` arrive RÉSOLU en prop — voir `LayerRowProps.clipped`.
  const rowClass = [
    "layer-panel__row",
    depth > 0 && "layer-panel__row--nested",
    selected && "layer-panel__row--selected",
    isDragging && "layer-panel__row--dragging",
    dropPosition === "before" && "layer-panel__row--drop-before",
    dropPosition === "after" && "layer-panel__row--drop-after",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li
      onClick={() => onSelect(layer.id)}
      data-layer-row-index={index}
      className={rowClass}
    >
      {/* Filet vertical vers la photo parente. `aria-hidden` : purement
          décoratif — l'indentation est un raccourci VISUEL, et annoncer une
          hiérarchie exigerait `role="tree"` avec sa navigation clavier, ce que
          cette liste n'implémente pas. Un `aria-level` sans `role` de tree est
          de l'ARIA invalide, donc pire que rien. */}
      {depth > 0 && (
        <span
          className={[
            "layer-panel__rail",
            firstChild && "layer-panel__rail--first",
            lastChild && "layer-panel__rail--last",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        />
      )}
      <div className="layer-panel__row-top">
        <span className="layer-panel__row-main">
          <span
            className="layer-panel__grip-handle"
            onPointerDown={(e) => {
              e.stopPropagation();
              onGripPointerDown(layer.id, e.pointerId, e.currentTarget, e.clientX, e.clientY);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="layer-panel__grip icon-sm icon-stroke" aria-hidden="true" />
          </span>
          <IconButton
            // Pendant l'isolation, l'œil affiche la visibilité EFFECTIVE et le
            // clic simple sert à en sortir : le libellé dit donc ce que le clic
            // fait réellement, jamais "Masquer/Afficher" sur une valeur que
            // l'utilisateur ne voit pas (voir `eyeClickOutcome`).
            label={eyeLabels.label}
            tooltip={eyeLabels.tooltip}
            size="compact"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(layer.id, e.altKey);
            }}
          >
            {visible ? (
              <Eye className="icon-sm icon-stroke" aria-hidden="true" />
            ) : (
              <EyeOff className="icon-sm icon-stroke" aria-hidden="true" />
            )}
          </IconButton>
          {/* NATURE de la ligne (2026-07-27) : la pile de shaderlab est une
              chaîne de traitement, pas un empilement de contenus — le panneau
              s'appelle « Effets », et cette icône est ce qui empêche ce titre
              de devenir faux quand une photo importée est dans la pile. Rien
              d'autre ne distinguait un effet d'une photo à part la vignette.
              `aria-hidden` : purement décorative, elle double le nom du calque
              (et la vignette), déjà lisibles. Position FIXE (juste après
              l'œil, avant tout ce qui est optionnel) pour qu'elle forme une
              colonne scannable d'une ligne à l'autre. */}
          {layer.imageSource ? (
            <PhotoLayerIcon className="layer-panel__row-nature icon-sm icon-stroke" aria-hidden="true" />
          ) : (
            <EffectLayerIcon className="layer-panel__row-nature icon-sm icon-stroke" aria-hidden="true" />
          )}
          {clipped && (
            // La ligne de base est celle appliquée AVANT dans la pile. Depuis
            // le sens causal (ADR-0004, `layerDisplayOrder.ts`), elle est la
            // ligne du DESSUS dans la LISTE — la flèche pointe donc vers le
            // HAUT (elle pointait vers le bas sous l'ADR-0003). Elle ne
            // s'affiche que si une base EXISTE : un calque écrêté en bas de
            // pile n'a rien avant lui, `resolveClipping` le rend `inert` (il
            // rend linéairement), et une flèche qui désigne une base
            // inexistante est un mensonge.
            <CornerLeftUp
              className="layer-panel__clip-arrow icon-sm icon-stroke"
              role="img"
              aria-label="Écrêté sur le calque du dessus"
            />
          )}
          {layer.imageSource &&
            (thumbnail ? (
              <img className="layer-panel__thumbnail" src={thumbnail} alt="" aria-hidden="true" />
            ) : (
              // Emplacement réservé : la vignette peut manquer (pas
              // d'OffscreenCanvas). La ligne ne doit pas se réaligner selon
              // qu'elle est disponible ou non.
              <span className="layer-panel__thumbnail layer-panel__thumbnail--empty" aria-hidden="true" />
            ))}
          <span
            className={`layer-panel__row-name ${selected ? "layer-panel__row-name--selected" : ""}`.trim()}
            title={displayName}
          >
            {displayName}
          </span>
        </span>
        {/* Mêmes affordances que la suppression (IconButton compact,
            libellé accessible explicite, stopPropagation pour ne pas
            déclencher la sélection de la ligne) — la duplication se range
            avec elle, à droite de la ligne. */}
        <span className="layer-panel__row-actions">
          {/* Opacité en LECTURE SEULE : le contrôle a quitté la ligne pour
              la zone de contrôles, mais comparer les opacités de la pile d'un coup d'œil
              reste un besoin — sans quoi il faudrait sélectionner chaque
              calque pour lire sa valeur. Elle est ANNONCÉE (2026-07-27) : le
              champ de la zone de contrôles ne couvre que le calque sélectionné, donc la
              masquer partout retirait l'opacité de tous les autres calques aux
              technologies d'assistance. MÊME UNITÉ que ce champ — un
              pourcentage entier, jamais un 0..1 — pour qu'une valeur lue sur
              une ligne et la même valeur lue dans la zone de contrôles soient
              comparables. Sur la ligne SÉLECTIONNÉE, `aria-hidden` évite de
              doubler ce que le champ annonce déjà. */}
          <span className="layer-panel__row-opacity" aria-hidden={selected || undefined}>
            <span className="sr-only">Opacité </span>
            {formatOpacityPercent(layer.opacity)}
          </span>
          <IconButton
            label="Dupliquer le calque"
            size="compact"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(layer.id);
            }}
          >
            <Copy className="icon-sm icon-stroke" aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Supprimer le calque"
            size="compact"
            variant="danger"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(layer.id);
            }}
          >
            <Trash2 className="icon-sm icon-stroke" aria-hidden="true" />
          </IconButton>
        </span>
      </div>
      {dropPosition && <span className={`drag-reorder__alignment-guide layer-panel__alignment-guide--${dropPosition}`} aria-hidden="true" />}
    </li>
  );
});

/**
 * Zone de contrôles FIXE de la carte Calques : opacité, fusion et effet du calque
 * SÉLECTIONNÉ. Monté dans le slot `header` de `DockedPanelCard` (donc hors du
 * conteneur défilant), il reste visible quelle que soit la position dans la
 * liste — modèle observé sur Photoshop web (voir
 * `docs/design-system/photoshop-web-observations-2026-07-27.md` §2 et §5bis).
 *
 * Le sélecteur d'effet reste disponible sur un calque PHOTO : appliquer des
 * effets différents selon la photo est un usage voulu, et « Aucun effet »
 * (passthrough) permet d'y revenir.
 */
export function LayerControls({
  layers,
  selectedId,
  onOpacityChange,
  onOpacityCommit,
  onBlendModeChange,
  onEffectChange,
}: LayerControlsProps) {
  // Aucune sélection : la zone de contrôles reste MONTÉ mais désactivé. Le faire
  // disparaître ferait sauter la liste de toute sa hauteur à chaque
  // désélection (et rendrait le panneau instable au clic).
  const model = layerControlsModel(layers, selectedId);
  return (
    <div className="layer-controls">
      {/* Ligne 1 — EFFET seul, étiquette à gauche. Il ne rejoint pas la ligne
          suivante : c'est le contrôle aux libellés les plus longs
          (« Aberration chromatique »), et le partager à trois le réduirait à
          une poignée de caractères dans une colonne de 240 à 400 px. */}
      <div className="layer-controls__row">
        <Select
          label="Effet"
          labelPlacement="inline"
          value={model.effectId}
          placeholder="Aucun calque sélectionné"
          options={changeEffectOptions}
          disabled={!model.enabled}
          onChange={(v) => model.layerId !== null && onEffectChange(model.layerId, v)}
        />
      </div>
      {/* Ligne 2 — FUSION + OPACITÉ côte à côte, comme observé sur Photoshop
          web (§2 des observations du 2026-07-27).

          L'opacité est un CHAMP, pas une piste. C'est le contrôle le plus
          utilisé de la zone de contrôles, et une piste partagée à deux sur une ligne de
          dock perd l'essentiel de sa course : mesuré au banc avant ce
          changement, 116,9 px de piste au dock 240 px — et le champ de valeur
          qui l'accompagnait débordait de sa propre boîte. Un champ, lui, ne
          perd aucune précision en rétrécissant, et c'est exactement ce que
          Photoshop web met là (§2 : « Opacité » puis un champ « 100 % »).
          `flex: 0 0 auto` via `.layer-controls__opacity` : le champ prend sa
          largeur de contenu et rend TOUT le reste de la ligne au sélecteur de
          fusion, dont les libellés sont longs.

          Étiquette en `sr-only` : le « % » du champ dit déjà de quoi il
          s'agit à l'œil, et le nom accessible reste porté par le `<label
          htmlFor>` du champ. */}
      <div className="layer-controls__row">
        <Select
          label="Fusion"
          labelPlacement="inline"
          value={model.blendMode}
          placeholder="Aucun calque sélectionné"
          options={blendModeOptions}
          disabled={!model.enabled}
          onChange={(v) => model.layerId !== null && onBlendModeChange(model.layerId, v)}
        />
        <NumberField
          label="Opacité"
          labelPlacement="hidden"
          classNames={{ root: "layer-controls__opacity", field: "layer-controls__opacity-field", input: "layer-controls__opacity-input", unit: "layer-controls__opacity-unit" }}
          value={opacityToPercent(model.opacity)}
          unit="%"
          min={0}
          max={100}
          step={1}
          parse={parseOpacityPercent}
          disabled={!model.enabled}
          // Un commit de champ = un `onOpacityChange` puis un
          // `onOpacityCommit`, soit EXACTEMENT une entrée d'historique (le
          // champ ne rappelle rien tant que la valeur n'a pas changé).
          onCommit={(percent) => {
            if (model.layerId === null) return;
            onOpacityChange(model.layerId, percent / 100);
            onOpacityCommit();
          }}
        />
      </div>
    </div>
  );
}

export function LayerPanel({
  layers,
  selectedId,
  hasImage,
  onSelect,
  onToggle,
  isolatedLayerId = null,
  onAdd,
  onDuplicate,
  onRemove,
  onReorder,
  thumbnailUrl,
  backgroundName = null,
}: Props) {
  // SENS D'AFFICHAGE (ADR-0004, 2026-07-28) : la liste se lit de haut en bas
  // dans l'ordre du TRAITEMENT. Le modèle ne bouge pas — `layers[0]` reste le
  // calque appliqué en premier — et il s'affiche en PREMIÈRE ligne, juste sous
  // la ligne d'arrière-plan qu'il consomme. La photo est la matière, l'effet
  // est l'opération : la matière vient avant.
  //
  // IMBRICATION (2026-07-28) : `toLayerTreeRows` rend ce MÊME ordre, chaque
  // ligne portant en plus sa profondeur et son rattachement (voir
  // src/components/layerTree.ts). L'ordre est inchangé par construction — c'est
  // ce qui laisse `data-layer-row-index` et `displayInsertToModelInsert`
  // valides, donc le glisser-déposer intact.
  const rows = useMemo(() => toLayerTreeRows(layers), [layers]);
  // Le hook de réordonnancement ne s'intéresse qu'aux identités, pas à la
  // hiérarchie : il reçoit la liste plate dans l'ordre affiché.
  const displayLayers = useMemo(() => rows.map((row) => row.layer), [rows]);

  // Le glisser-déposer raisonne ENTIÈREMENT en espace d'affichage : le hook
  // reçoit la liste affichée, `data-layer-row-index` porte l'index de LIGNE, et
  // les indicateurs avant/après gardent donc leur sens visuel sans inversion.
  // Une seule frontière convertit — ici, à la sortie du hook, par la fonction
  // pure testée `displayInsertToModelInsert` (test/components/layerDisplayOrder.test.ts).
  const handleReorderFromDisplay = useCallback(
    (id: string, displayNewIndex: number) => {
      onReorder(id, displayInsertToModelInsert(displayNewIndex, layers.length));
    },
    [onReorder, layers.length]
  );

  const { dragState, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } = usePointerReorder(
    displayLayers,
    (layer) => layer.id,
    "data-layer-row-index",
    handleReorderFromDisplay
  );

  // Écrêtage EFFECTIF de toute la pile, calculé une fois par render. L'ensemble
  // « rendu » passé ici est la pile ENTIÈRE : la flèche marque un ATTACHEMENT
  // structurel, qui ne doit pas clignoter selon qu'un œil est fermé (même
  // invariance que `clipBaseId`, voir src/layers/clipping.ts). Seul le cas
  // `inert` — aucune base photo en dessous — retire la flèche.
  const clipResolutions = useMemo(
    () => resolveClipping(layers, new Set(layers.map((l) => l.id))),
    [layers]
  );

  // Visibilité effective de TOUTE la pile, calculée une fois par render plutôt
  // qu'une fois par ligne : isoler un calque écrêté rend aussi visible sa base
  // photo (`isolationVisibleIds`), donc la réponse dépend de la pile entière,
  // plus seulement de l'id isolé.
  const visibleIds = useMemo(() => isolationVisibleIds(layers, isolatedLayerId), [layers, isolatedLayerId]);

  const handleGripPointerDown = useCallback(
    (id: string, pointerId: number, target: Element, clientX: number, clientY: number) => {
      // measureElement = target : LayerPanel n'utilise pas grabOffset/pointerPosition
      // (pas de fantôme), measurer la poignée elle-même suffit.
      handlePointerDown(id, pointerId, target, target, clientX, clientY);
    },
    [handlePointerDown]
  );

  return (
    <div className="layer-panel">
      <Select
        label="Ajouter un effet"
        value={null}
        placeholder="+ Ajouter un effet"
        options={addEffectOptions}
        disabled={!hasImage}
        onChange={onAdd}
      />
      <ul
        // `data-dock-list` : marque la LISTE dans la zone défilante de la
        // carte, pour que le plancher de compression compte séparément les
        // lignes et ce qui vit à côté d'elles — ici le sélecteur
        // « Ajouter un effet ». Voir PanelColumn.tsx § COÛT DU HORS-LISTE.
        data-dock-list=""
        className="layer-panel__list"
        onPointerMove={dragState ? handlePointerMove : undefined}
        onPointerUp={dragState ? handlePointerUp : undefined}
        onPointerCancel={dragState ? handlePointerCancel : undefined}
      >
        {/* Ligne d'ARRIÈRE-PLAN — DÉRIVÉE du document, pas un `LayerState` :
            elle ne porte donc pas `data-layer-row-index` (invisible au
            réordonnancement, qui indexe par cet attribut), ne se sélectionne
            pas, ne se supprime pas et ne s'écrête pas. Le cadenas est la seule
            marque de ce statut, comme l'Arrière-plan verrouillé de Photoshop.
            Elle OUVRE la liste depuis l'ADR-0004 (elle la fermait par le bas
            sous l'ADR-0003) : elle alimente `layers[0]`, la ligne juste en
            dessous d'elle, et en sens causal la matière s'annonce avant les
            opérations qui la traitent.
            Aucune vignette : le document est `sourceTexture`, il n'est pas
            enregistré dans `PhotoSourceStore` et n'a donc pas d'object URL —
            l'emplacement reste réservé pour que les colonnes restent alignées
            sur celles des lignes de calque (aucun raster ne transite par le
            state React, invariant OOM 24MP). */}
        {backgroundName && (
          <li className="layer-panel__row layer-panel__row--background">
            <div className="layer-panel__row-top">
              <span className="layer-panel__row-main">
                <span className="layer-panel__row-slot layer-panel__row-slot--grip" aria-hidden="true" />
                <span className="layer-panel__row-slot layer-panel__row-slot--eye">
                  <Lock className="layer-panel__row-lock icon-sm icon-stroke" role="img" aria-label="Arrière-plan verrouillé" />
                </span>
                <PhotoLayerIcon className="layer-panel__row-nature icon-sm icon-stroke" aria-hidden="true" />
                <span className="layer-panel__thumbnail layer-panel__thumbnail--empty" aria-hidden="true" />
                <span className="layer-panel__row-name" title={backgroundName}>
                  {backgroundName}
                </span>
              </span>
            </div>
          </li>
        )}
        {rows.map(({ layer, depth, firstChild, lastChild }, displayRow) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            index={displayRow}
            selected={layer.id === selectedId}
            visible={isLayerVisible(layer, visibleIds)}
            role={isolationRole(layer.id, isolatedLayerId)}
            clipped={clipResolutions.get(layer.id)?.kind === "active"}
            depth={depth}
            firstChild={firstChild}
            lastChild={lastChild}
            isDragging={dragState?.draggedId === layer.id}
            dropPosition={
              dragState !== null && dragState.overIndex === displayRow && dragState.draggedId !== layer.id
                ? dragState.overPosition
                : null
            }
            onSelect={onSelect}
            onToggle={onToggle}
            onDuplicate={onDuplicate}
            onRemove={onRemove}
            onGripPointerDown={handleGripPointerDown}
            thumbnailUrl={thumbnailUrl}
          />
        ))}
      </ul>
    </div>
  );
}
