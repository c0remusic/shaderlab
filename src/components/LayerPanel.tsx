import { memo, useCallback, useMemo } from "react";
import { usePointerReorder, type DropPosition } from "../ui/dragReorder";
import "../ui/dragReorder.css";
import { Copy, CornerLeftUp, Eye, EyeOff, GripVertical, Image as PhotoLayerIcon, Sparkles as EffectLayerIcon, Trash2 } from "lucide-react";
import type { LayerState } from "../layers/types";
import { eyeButtonLabels, isLayerVisible, isolationRole, isolationVisibleIds, type IsolationRole } from "../layers/isolation";
import { effectRegistry, getEffect } from "../render/effects/registry";
import { PASSTHROUGH_EFFECT } from "../render/effectPassRunner";
import { blendRegistry } from "../render/blend/registry";
import { Select } from "./ui/select";
import { LabeledSlider } from "./ui/labeled-slider";
import { IconButton } from "./ui/icon-button";
import { formatOpacityPercent, layerHeaderModel } from "./layerHeaderModel";
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
}

/** Contrôles de l'EN-TÊTE : ils ne vivent plus sur chaque ligne mais une seule
 *  fois, dans le slot d'en-tête de la carte Calques (`DockedPanelCard`), et
 *  agissent sur le calque SÉLECTIONNÉ. Ce composant est monté par `App.tsx`
 *  DEHORS de `LayerPanel` — c'est ce qui lui permet de ne pas défiler avec la
 *  liste. */
export interface LayerHeaderProps {
  layers: LayerState[];
  selectedId: string | null;
  onOpacityChange: (id: string, opacity: number) => void;
  onOpacityCommit: () => void;
  onBlendModeChange: (id: string, blendMode: string) => void;
  onEffectChange: (id: string, effectId: string) => void;
}

interface LayerRowProps {
  layer: LayerState;
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

// Mémoïsée : sans ça, un drag du slider d'opacité d'UN calque re-render
// (re-diffe) la liste ENTIÈRE des calques à chaque frame — coût qui grandit
// avec le nombre de calques, contrairement au slider de paramètre d'effet
// (ParamPanel) qui ne porte qu'un seul calque. Ne sert à rien sans callbacks
// stables côté App.tsx (useCallback) : voir le commentaire équivalent là-bas.
const LayerRow = memo(function LayerRow({
  layer,
  index,
  selected,
  isDragging,
  dropPosition,
  visible,
  role,
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
  // Écrêtage (design 2026-07-27 §3.8) : indentation + flèche vers le calque
  // qui sert de base. Le marquage de sélection n'est PAS cassé par
  // l'indentation — c'est le padding intérieur de la ligne qui augmente, pas
  // sa marge : le fond de sélection couvre toujours la ligne entière (voir
  // .layer-panel__row--clipped).
  const clipped = layer.clipToBelow === true;
  const rowClass = [
    "layer-panel__row",
    clipped && "layer-panel__row--clipped",
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
            // La ligne de base est celle du DESSOUS dans la pile — donc
            // JUSTE AU-DESSUS dans cette liste, qui affiche le bas de pile en
            // premier. La flèche pointe vers elle : vers le haut de la liste.
            <CornerLeftUp
              className="layer-panel__clip-arrow icon-sm icon-stroke"
              role="img"
              aria-label="Écrêté sur le calque du dessous"
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
          {/* Opacité en LECTURE SEULE : le slider a quitté la ligne pour
              l'en-tête, mais comparer les opacités de la pile d'un coup d'œil
              reste un besoin — sans quoi il faudrait sélectionner chaque
              calque pour lire sa valeur. Elle est ANNONCÉE (2026-07-27) : le
              slider de l'en-tête ne couvre que le calque sélectionné, donc la
              masquer partout retirait l'opacité de tous les autres calques aux
              technologies d'assistance. Le libellé porté ici évite le chiffre
              nu ; sur la ligne SÉLECTIONNÉE, `aria-hidden` évite au contraire
              de doubler ce que le slider annonce déjà. */}
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
 * En-tête FIXE de la carte Calques : opacité, fusion et effet du calque
 * SÉLECTIONNÉ. Monté dans le slot `header` de `DockedPanelCard` (donc hors du
 * conteneur défilant), il reste visible quelle que soit la position dans la
 * liste — modèle observé sur Photoshop web (voir
 * `docs/design-system/photoshop-web-observations-2026-07-27.md` §2 et §5bis).
 *
 * Le sélecteur d'effet reste disponible sur un calque PHOTO : appliquer des
 * effets différents selon la photo est un usage voulu, et « Aucun effet »
 * (passthrough) permet d'y revenir.
 */
export function LayerHeader({
  layers,
  selectedId,
  onOpacityChange,
  onOpacityCommit,
  onBlendModeChange,
  onEffectChange,
}: LayerHeaderProps) {
  // Aucune sélection : l'en-tête reste MONTÉ mais désactivé. Le faire
  // disparaître ferait sauter la liste de toute sa hauteur à chaque
  // désélection (et rendrait le panneau instable au clic).
  const model = layerHeaderModel(layers, selectedId);
  return (
    <div className="layer-header">
      <Select
        label="Effet"
        value={model.effectId}
        placeholder="Aucun calque sélectionné"
        options={changeEffectOptions}
        disabled={!model.enabled}
        onChange={(v) => model.layerId !== null && onEffectChange(model.layerId, v)}
      />
      <Select
        label="Fusion"
        value={model.blendMode}
        placeholder="Aucun calque sélectionné"
        options={blendModeOptions}
        disabled={!model.enabled}
        onChange={(v) => model.layerId !== null && onBlendModeChange(model.layerId, v)}
      />
      <LabeledSlider
        label="Opacité"
        value={model.opacity}
        min={0}
        max={1}
        step={0.01}
        disabled={!model.enabled}
        onChange={(v) => model.layerId !== null && onOpacityChange(model.layerId, v)}
        onCommit={onOpacityCommit}
      />
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
}: Props) {
  const { dragState, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } = usePointerReorder(
    layers,
    (layer) => layer.id,
    "data-layer-row-index",
    onReorder
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
        className="layer-panel__list"
        onPointerMove={dragState ? handlePointerMove : undefined}
        onPointerUp={dragState ? handlePointerUp : undefined}
        onPointerCancel={dragState ? handlePointerCancel : undefined}
      >
        {layers.map((layer, index) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            index={index}
            selected={layer.id === selectedId}
            visible={isLayerVisible(layer, visibleIds)}
            role={isolationRole(layer.id, isolatedLayerId)}
            isDragging={dragState?.draggedId === layer.id}
            dropPosition={
              dragState !== null && dragState.overIndex === index && dragState.draggedId !== layer.id
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
