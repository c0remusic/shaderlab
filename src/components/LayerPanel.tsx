import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePointerReorder, type DropPosition } from "../ui/dragReorder";
import "../ui/dragReorder.css";
import { ChevronDown, ChevronRight, Combine, Copy, Eye, EyeOff, GripVertical, Image as PhotoLayerIcon, Lock, Plus, Sparkles as EffectLayerIcon, Stamp, Trash2 } from "lucide-react";
import type { LayerState } from "../layers/types";
import { eyeButtonLabels, isLayerVisible, isolationRole, isolationVisibleIds, type IsolationRole } from "../layers/isolation";
import { displayInsertToModelInsert } from "./layerDisplayOrder";
import { toPileRows } from "./pileModel";
import {
  applyCollapse,
  EMPTY_COLLAPSE_STATE,
  visibleInsertToModelInsert,
  type CollapseState,
} from "./pileCollapse";
import {
  targetForLayerId,
  type PropertiesTarget,
} from "../ui/propertiesTarget";
import { effectRegistry, getEffect } from "../render/effects/registry";
import { PASSTHROUGH_EFFECT } from "../render/effectPassRunner";
import { blendRegistry } from "../render/blend/registry";
import { Select } from "./ui/select";
import { NumberField } from "./ui/number-field";
import { IconButton } from "./ui/icon-button";
import { EffectPicker } from "./EffectPicker";
import type { EffectThumbnailPicker } from "../hooks/useEffectThumbnails";
import { layerControlsModel, opacityToPercent, parseOpacityPercent } from "./layerControlsModel";
import { mergeDownVerdict, stampVerdict } from "../layers/flatten";
import "./LayerPanel.css";
import {
  isFullyLocked,
  isPartiallyLocked,
} from "../layers/layerLocks";
import type { LayerLocks } from "../layers/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { LayerActionsMenuItems, VERROUS } from "./layerActionsMenu";
import { LAYER_SHORTCUT_LABELS } from "../ui/shortcuts";

/** État du verrou tel que la LIGNE le montre. Trois valeurs, parce que
 *  Photoshop en distingue trois : rien, partiel (cadenas creux), tout (plein). */
export type LockState = "none" | "partial" | "full";

/** Réduit les quatre verrous d'un calque à ce que sa ligne doit rendre. */
export function lockStateOf(layer: Pick<LayerState, "locks">): LockState {
  if (isFullyLocked(layer)) return "full";
  if (isPartiallyLocked(layer)) return "partial";
  return "none";
}

interface Props {
  layers: LayerState[];
  selectedId: string | null;
  hasImage: boolean;
  onSelect: (id: string) => void;
  /** Facette sélectionnée dans le nouvel inspecteur. Optionnelle pendant la
   *  migration : en son absence, la ligne sélectionnée est sa cible principale. */
  selectedTarget?: PropertiesTarget | null;
  /** Sélectionne explicitement le corps de ligne ou sa vignette de masque. */
  onSelectTarget?: (target: PropertiesTarget) => void;
  /** Clic sur l'œil. `altKey` porte le geste d'ISOLATION (Alt+clic) : la
   *  décision de ce qu'il déclenche est prise par `layers/isolation.ts`, pas
   *  ici — ce composant ne fait que transmettre le modificateur. */
  onToggle: (id: string, altKey: boolean) => void;
  /** Id du calque isolé, ou null. Ne change QUE l'affichage (icône + libellé) :
   *  la visibilité stockée des calques n'est pas touchée. */
  isolatedLayerId?: string | null;
  onAdd: (effectId: string) => void;
  onReorder: (id: string, newIndex: number) => void;
  /** ACTIONS DU MENU CONTEXTUEL DE LIGNE (ticket 28). Ce sont EXACTEMENT les
   *  handlers que la zone de contrôles (`LayerControls`) reçoit déjà d'`App.tsx`
   *  — le menu en donne un SECOND accès, là où le pointeur est déjà, il n'en
   *  invente aucun. Optionnels : les stories et montages historiques qui ne les
   *  passent pas gardent des lignes sans menu d'action. `onToggle` (masquer /
   *  afficher) est déjà au-dessus. */
  onDuplicate?: (id: string) => void;
  onStamp?: (id: string) => void;
  onMergeDown?: (id: string) => void;
  onToggleLock?: (id: string, which: keyof LayerLocks, value: boolean) => void;
  onRemove?: (id: string) => void;
  /** RENOMMAGE EN PLACE (ticket 31). `renamingId` désigne la ligne qui porte le
   *  champ d'édition (ou `null`) — état d'INTERFACE tenu par `App`, jamais le
   *  modèle (rien à annuler à l'ouverture). Le double-clic sur le nom et
   *  « Renommer… » OUVRENT (`onStartRename`), Entrée/blur COMMITENT
   *  (`onRename`, un pas d'undo côté `App`), Échap ANNULE (`onCancelRename`).
   *  Optionnels : sans eux, la ligne n'a pas de renommage (stories historiques). */
  renamingId?: string | null;
  onStartRename?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onCancelRename?: () => void;
  /** REPLI DES GROUPES (2026-08-16). État d'INTERFACE, jamais le modèle —
   *  arbitrage d'Antoine : un repli est une aide de visée, et le passer par
   *  `LayerState` le rendrait annulable par Ctrl+Z. Absent = panneau monté sans
   *  repli, tout est déplié (stories historiques). Règles pures et testées dans
   *  `pileCollapse.ts`. */
  collapseState?: CollapseState;
  onToggleGroup?: (parentId: string) => void;
  /** Résout la vignette d'un calque photo par `sourceId`. La vignette est
   *  POSSÉDÉE par `PhotoSourceStore` (object URL, hors state React) — cette
   *  prop n'en transporte que la lecture, jamais le raster (invariant OOM).
   *  DOIT être référentiellement stable (`useCallback`) : elle traverse la
   *  mémoïsation de `LayerRow`. */
  thumbnailUrl?: (sourceId: string) => string | null;
  /** APERÇU AU SURVOL DE LA GALERIE D'EFFETS (ticket 05). Transporté d'un BLOC
   *  et non en quatre props séparées — même patron que `textureLibrary` sur
   *  `ParamPanel` — parce que ce panneau ne fait que le faire suivre à
   *  `EffectPicker` : il n'en lit aucun champ. Absent = sélecteur sans zone
   *  d'aperçu (stories, et tout montage sans GPU). */
  effectPreview?: EffectThumbnailPicker;
  /** OUVERTURE CONTRÔLÉE DU SÉLECTEUR D'EFFET (ticket 29). Le menu contextuel de
   *  la TOILE (« Ajouter un effet… ») vit hors de ce panneau, dans `App` : pour
   *  qu'il ouvre CE sélecteur, `App` en détient l'état et le passe ici.
   *  OPT-IN — absents, le panneau garde son état interne (piloté par son propre
   *  bouton et par le menu du vide de pile), donc les stories montent tel quel. */
  pickerOpen?: boolean;
  onPickerOpenChange?: (open: boolean) => void;
}

/* LA LIGNE D'ARRIÈRE-PLAN DÉRIVÉE A ÉTÉ SUPPRIMÉE (tranche T1 du design
   2026-07-28, arbitrage n°2). Elle rendait un objet qui n'existait pas dans le
   modèle : ni œil, ni poignée, ni sélection — d'où un vide de 50 px à gauche de
   son nom, deux fois signalé à l'écran. La photo de fond est désormais un
   `LayerState` ordinaire, rendue par `LayerRow` comme tout autre calque photo,
   ce qui résout ce vide mécaniquement plutôt que par un rattrapage de style.
   Avec elle partent la prop `backgroundName` et l'id conventionnel
   `BACKGROUND_LAYER_ID` (`layerTree.ts`). Ne pas les réintroduire. */

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
  /** APERÇU AU SURVOL (ticket 01 retour-usage) : survoler un mode le rend sur la
   *  toile sans l'engager, quitter revient à la valeur engagée. Optionnels — les
   *  stories qui ne les passent pas gardent le comportement d'avant. */
  onBlendModePreview?: (id: string, blendMode: string) => void;
  onBlendModePreviewEnd?: () => void;
  onEffectChange: (id: string, effectId: string) => void;
  /** ACTIONS migrées depuis la ligne le 2026-07-29 (ADR-0001). Elles s'y
   *  répétaient sur chaque calque — trois contrôles × N lignes — et mangeaient
   *  la largeur du nom, mesurée à 52 px au dock par défaut : « Chromatic bleed »
   *  s'affichait « C… ». Elles agissent désormais sur le calque SÉLECTIONNÉ.
   *
   *  Le verrou est le seul dont une trace reste sur la ligne, et seulement
   *  quand il est POSÉ : point 5 de la checklist de l'ADR-0001 — un état qu'on
   *  doit pouvoir comparer sans sélectionner chaque calque. Un verrou ouvert
   *  n'est rien à voir ; sur la ligne, c'est un MARQUEUR (`role="img"`), le
   *  contrôle vit ici. */
  /** `which` désigne LEQUEL des quatre verrous bascule. */
  onToggleLock: (id: string, which: keyof LayerLocks, value: boolean) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  /** APLATIR EN NOUVEAU CALQUE (Tampon, ticket 27) : rastérise le composite
   *  jusqu'au calque sélectionné inclus dans un nouveau calque photo posé
   *  au-dessus. Rien n'est détruit. */
  onStamp: (id: string) => void;
  /** FUSIONNER AVEC LE DESSOUS (ticket 27) : rastérise le même composite mais
   *  REMPLACE le sélectionné et tout ce qui est en dessous. Destructif,
   *  annulable. */
  onMergeDown: (id: string) => void;
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
  maskSelected: boolean;
  maskPresent: boolean;
  maskSourceCount: number;
  maskEnabled: boolean;
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
  /** État du VERROU de ce calque, déjà réduit à la ligne (et non `layer.locks`,
   *  qui est optionnel) pour qu'elle ne raisonne jamais sur l'absence du champ.
   *
   *  TROIS valeurs et non un booléen depuis le 2026-08-19 : Photoshop marque la
   *  ligne d'un cadenas **plein quand le calque est entièrement verrouillé,
   *  creux quand il l'est partiellement**, et un booléen ne peut pas porter la
   *  différence. Depuis le 2026-07-29 le marqueur ne pilote plus un bouton mais
   *  dit seulement un ÉTAT : le contrôle vit dans la zone de contrôles (voir
   *  `LayerControlsProps.onToggleLock`). */
  lockState: LockState;
  /** VERDICTS D'APLATISSEMENT du menu contextuel (ticket 28), déjà réduits à
   *  cette ligne par `LayerPanel` — qui seul a la pile — plutôt que passés en
   *  bloc `layers` à chaque ligne, ce qui casserait la mémoïsation (`memo`) sur
   *  chaque frame de curseur. Ce sont des PRIMITIVES issues des fonctions PURES
   *  `stampVerdict` / `mergeDownVerdict` (`layers/flatten.ts`), le même verdict
   *  que la zone de contrôles, jamais une copie. `reason` est vide quand `ok`. */
  stampOk: boolean;
  stampReason: string;
  mergeOk: boolean;
  mergeReason: string;
  /** SUPPRESSION permise ? `removeLayer` la refuse sur un calque entièrement
   *  verrouillé (`isLocked` = verrou « Tout ») — même garde que le bouton
   *  Supprimer de la zone de contrôles. */
  removable: boolean;
  /** Profondeur d'IMBRICATION (0 racine, 1 sous une photo) et bornes du groupe,
   *  décidées par `toLayerTreeRows` (src/components/layerTree.ts). Passées
   *  RÉDUITES à cette ligne — jamais l'arbre entier — pour ne pas casser la
   *  mémoïsation (`memo`) d'une ligne dont le rattachement n'a pas bougé.
   *  N'affectent QUE l'affichage : ni le modèle, ni l'ordre d'exécution, ni
   *  l'index de ligne sur lequel le glisser-déposer fait son hit-test. */
  depth: 0 | 1;
  firstChild: boolean;
  lastChild: boolean;
  /** REPLI (2026-08-16). Trois booléens/compte déjà RÉDUITS à cette ligne par
   *  `applyCollapse`, jamais l'état de repli entier — même raison que `depth` :
   *  replier un groupe ne doit pas re-rendre les lignes d'un autre (`memo`).
   *  `collapsible` est faux sur une photo sans effet rattaché : un chevron qui
   *  ne fait rien est pire qu'un chevron absent. */
  collapsible: boolean;
  collapsed: boolean;
  hiddenCount: number;
  onSelect: (id: string) => void;
  onSelectMask: (id: string) => void;
  /** Bascule le repli du groupe ouvert par CETTE ligne. Absent = panneau monté
   *  sans repli (stories historiques) : le chevron n'est alors pas rendu. */
  onToggleCollapse?: (parentId: string) => void;
  onToggle: (id: string, altKey: boolean) => void;
  /** ACTIONS DU MENU CONTEXTUEL (ticket 28), transmises depuis `App.tsx` via
   *  `LayerPanel`. Optionnelles : sans elles, la ligne n'a pas de menu d'action
   *  (stories et montages historiques). */
  onDuplicate?: (id: string) => void;
  onStamp?: (id: string) => void;
  onMergeDown?: (id: string) => void;
  onToggleLock?: (id: string, which: keyof LayerLocks, value: boolean) => void;
  onRemove?: (id: string) => void;
  /** RENOMMAGE (ticket 31), déjà réduit à cette ligne : `renaming` dit si CETTE
   *  ligne porte le champ d'édition (booléen et non l'id, pour ne pas casser la
   *  mémoïsation d'une ligne non concernée). `onStartRename` ouvre (double-clic /
   *  menu), `onRename` commit, `onCancelRename` annule. */
  renaming?: boolean;
  onStartRename?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onCancelRename?: () => void;
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

/**
 * Champ d'édition EN PLACE du nom d'un calque (ticket 31). Monté SEULEMENT
 * pendant l'édition (rendu conditionnel dans `LayerRow`) : son état local naît
 * et meurt avec l'édition, donc pas de réconciliation d'un brouillon périmé.
 *
 * Patron repris de `PresetPanel` (renommage de preset, précédent du repo) :
 * `autoFocus` + `select()` au focus, Entrée `blur()` pour committer par le même
 * chemin que le clic ailleurs, Échap annule EXPLICITEMENT. Le `cancelledRef`
 * existe pour un piège de moteur documenté (CLAUDE.md) : un `blur` dispatché au
 * DÉMONTAGE de l'élément focalisé ferait passer l'annulation par `onBlur` et
 * VALIDERAIT à la place — le drapeau rend l'intention explicite quel que soit le
 * moteur. Le commit et l'annulation ne s'exécutent qu'UNE fois (`doneRef`).
 *
 * `stopPropagation` sur pointeur/clic : cliquer DANS le champ ne re-sélectionne
 * ni ne démarre un glissement de la ligne. `stopPropagation` sur les touches :
 * Entrée/Échap restent au champ et ne remontent ni à la ligne (`onSelect`) ni
 * aux écouteurs globaux.
 *
 * La HAUTEUR du champ est celle de la ligne (`layer-panel__row-rename`,
 * `LayerPanel.css`) : ADR-0001 — la ligne ne grandit pas pendant l'édition.
 */
function LayerNameEdit({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const cancelledRef = useRef(false);
  const doneRef = useRef(false);
  const finish = (cancel: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (cancel) onCancel();
    else onCommit(value);
  };
  return (
    <input
      type="text"
      // eslint-disable-next-line jsx-a11y/no-autofocus -- champ de renommage EN LIGNE qui n'existe que pendant l'edition : il remplace le libelle sur lequel l'utilisateur vient d'agir (double-clic, menu, F2), et sans focus automatique le geste demanderait une tabulation vers un champ qu'il a lui-meme ouvert.
      autoFocus
      className="layer-panel__row-rename"
      aria-label="Renommer le calque"
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(cancelledRef.current)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.currentTarget.blur(); // -> onBlur -> commit
        } else if (e.key === "Escape") {
          cancelledRef.current = true;
          e.currentTarget.blur(); // -> onBlur -> cancel (drapeau)
        }
      }}
    />
  );
}

// Mémoïsée : sans ça, un drag de slider (paramètre d'effet, pinceau)
// re-render (re-diffe) la liste ENTIÈRE des calques à chaque frame — coût qui
// grandit avec le nombre de calques. Ne sert à rien sans callbacks
// stables côté App.tsx (useCallback) : voir le commentaire équivalent là-bas.
const LayerRow = memo(function LayerRow({
  layer,
  index,
  selected,
  maskSelected,
  maskPresent,
  maskSourceCount,
  maskEnabled,
  isDragging,
  dropPosition,
  visible,
  role,
  lockState,
  stampOk,
  stampReason,
  mergeOk,
  mergeReason,
  removable,
  depth,
  firstChild,
  lastChild,
  collapsible,
  collapsed,
  hiddenCount,
  onSelect,
  onSelectMask,
  onToggle,
  onDuplicate,
  onStamp,
  onMergeDown,
  onToggleLock,
  onRemove,
  renaming,
  onStartRename,
  onRename,
  onCancelRename,
  onToggleCollapse,
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
  const rowClass = [
    "layer-panel__row",
    depth > 0 && "layer-panel__row--nested",
    collapsed && "layer-panel__row--collapsed",
    selected && "layer-panel__row--selected",
    isDragging && "layer-panel__row--dragging",
    dropPosition === "before" && "layer-panel__row--drop-before",
    dropPosition === "after" && "layer-panel__row--drop-after",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    // `role="option"` + `tabIndex` : la ligne EST le contrôle de sélection, et
    // l'ADR-0001 a centralisé opacité/fusion/effet dans une zone qui agit sur
    // la ligne sélectionnée — sans focus clavier ici, toute cette zone devenait
    // inatteignable au clavier (audit pré-release 2026-07-30, finding U2). La
    // liste porte `role="listbox"` en regard, sans quoi `option` serait de
    // l'ARIA invalide. Espace est intercepté (`preventDefault`) : sur un
    // élément focusable, il ferait défiler le panneau.
    <ContextMenu>
      <ContextMenuTrigger
        render={
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(layer.id)}
      onContextMenu={(e) => {
        // CLIC DROIT = SÉLECTIONNER D'ABORD (comme Photoshop), puis le menu
        // s'ouvre (Base UI, sur ce même `<li>` déclencheur). `stopPropagation`
        // empêche l'événement d'atteindre le déclencheur de la LISTE (le menu du
        // vide de pile) : la ligne a son menu, le vide a le sien, jamais les
        // deux. Le glissement, lui, ne part QUE du bouton principal (garde
        // `button === 0` sur la poignée) — un clic droit ne le déclenche pas.
        e.stopPropagation();
        onSelect(layer.id);
      }}
      onKeyDown={(e) => {
        // NE RÉAGIR QU'AUX TOUCHES REÇUES PAR LA LIGNE ELLE-MÊME. Sans ce
        // garde, le `preventDefault` ci-dessous ANNULE l'activation clavier du
        // bouton œil imbriqué : son keydown remonte jusqu'ici, et l'action par
        // défaut d'un `<button>` (le clic que produisent Entrée et Espace) est
        // décidée APRÈS la phase de bulle. Le `stopPropagation` posé sur le
        // `onClick` de l'œil ne protège rien dans ce cas — ce clic n'a jamais
        // lieu. Mesuré au navigateur avant le garde : œil focalisé + Entrée
        // (comme + Espace) donnait toggle=0, select=1, c'est-à-dire l'œil muet
        // et la ligne sélectionnée à sa place ; avec le garde, toggle=1,
        // select=0. Le clavier retrouve ainsi la parité avec la souris, où
        // cliquer l'œil ne sélectionne pas la ligne.
        if (e.target !== e.currentTarget) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect(layer.id);
      }}
      data-layer-row-index={index}
      // Marque la ligne SÉLECTIONNÉE pour que le panneau puisse la ramener dans
      // la vue (voir l'effet dans `LayerPanel`). Un attribut plutôt qu'une ref
      // par ligne : la liste est virtualisée par personne, mais le nombre de
      // lignes varie et une carte de refs se périmerait à chaque réordonnancement.
      data-layer-row-selected={selected ? "true" : undefined}
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
      {/* MOIGNON du groupe replié (traitement b du wireframe `pile-longue-repli`,
          recommandé pour ce qu'il ne coûte pas). Le filet ne relie plus, il
          ANNONCE : un segment de 14 px qui descend sous la photo et s'arrête.
          Même primitive, même abscisse, même couleur — seule une borne change,
          d'où l'absence de style nouveau. Il est porté par la ligne PARENTE
          puisque les lignes enfants n'existent plus dans le DOM. */}
      {collapsed && <span className="layer-panel__rail layer-panel__rail--stub" aria-hidden="true" />}
      <div className="layer-panel__row-top">
        <span className="layer-panel__row-main">
          {/* CHEVRON DE REPLI — piste RÉSERVÉE en permanence, comme le verrou.
              Rendu seulement sur une ligne qui OUVRE un groupe non vide, mais la
              piste existe sur toutes : sans elle, une ligne à groupe et une ligne
              sans groupe auraient leurs six autres pistes décalées de 16 px.

              Il n'y est PAS quand `onToggleCollapse` manque — le panneau est
              alors monté sans repli (stories historiques), et un chevron inerte
              serait pire qu'aucun chevron.

              `stopPropagation` : cliquer le chevron ne sélectionne pas la ligne,
              parité avec l'œil. Le geste a son propre effet sur la sélection —
              replier la remonte au parent — et le laisser en plus sélectionner
              la ligne cliquée le contredirait. */}
          {collapsible && onToggleCollapse ? (
            <IconButton
              label={collapsed ? `Déplier le groupe (${hiddenCount} calques)` : "Replier le groupe"}
              size="compact"
              className="layer-panel__col--collapse"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse(layer.id);
              }}
            >
              {collapsed ? (
                <ChevronRight className="icon-sm icon-stroke" aria-hidden="true" />
              ) : (
                <ChevronDown className="icon-sm icon-stroke" aria-hidden="true" />
              )}
            </IconButton>
          ) : (
            <span className="layer-panel__col--collapse" aria-hidden="true" />
          )}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- poignee de GLISSEMENT au pointeur (`onPointerDown`) ; son `onClick` ne fait que `stopPropagation`. Le clavier a deja sa voie sur la LIGNE elle-meme (Enter/Espace -> `onSelect`, plus haut) ; il n'existe pas de reordonnancement au clavier a exposer ici, et poser un `role`/`tabIndex` sur cette poignee ajouterait un arret de tabulation qui ne fait rien. */}
          <span
            className="layer-panel__grip-handle layer-panel__col--grip"
            onPointerDown={(e) => {
              // BOUTON PRINCIPAL SEULEMENT (ticket 28) : un clic droit sur la
              // poignée ne doit pas démarrer un glissement — il ouvre le menu
              // contextuel de la ligne. `usePointerReorder` ne filtre pas le
              // bouton, c'est donc ici que ça se décide.
              if (e.button !== 0) return;
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
            className="layer-panel__col--eye"
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
          {/* MARQUE — la colonne de la vignette. Elle a été PARTAGÉE avec la
              flèche d'écrêtage du 2026-07-29 au 2026-08-21 (fusion légitimée
              par leur exclusion mutuelle : un calque photo ne pouvait pas être
              écrêté). L'écrêtage retiré (ADR-0020), la piste ne porte plus
              qu'un contenu — sa largeur, elle, était DÉJÀ celle de la vignette,
              le plus large des deux, donc la grille ne bouge pas. */}
          {layer.imageSource &&
            (thumbnail ? (
              <img className="layer-panel__thumbnail layer-panel__col--mark" src={thumbnail} alt="" aria-hidden="true" />
            ) : (
              // Boîte vide bordée : la vignette peut manquer (pas
              // d'OffscreenCanvas), et la ligne doit tout de même dire « ceci
              // est une photo ». Ce n'est PLUS une cale d'alignement — c'est la
              // colonne de grille qui réserve la place, y compris sur les
              // lignes qui ne rendent rien ici.
              <span className="layer-panel__thumbnail layer-panel__thumbnail--empty layer-panel__col--mark" aria-hidden="true" />
            ))}
          <span
            className={`layer-panel__col--name layer-panel__row-name ${selected ? "layer-panel__row-name--selected" : ""}`.trim()}
            title={renaming ? undefined : displayName}
          >
            {renaming ? (
              // RENOMMAGE EN PLACE (ticket 31). `initial` = le nom EXPLICITE
              // (vide pour un calque jamais nommé, dont le placeholder montre
              // alors le nom d'effet grisé) — ainsi valider sans rien taper sur un
              // calque d'effet est un no-op propre, et vider un calque nommé le
              // ramène à son nom d'effet.
              <LayerNameEdit
                initial={layer.name ?? ""}
                placeholder={displayName}
                onCommit={(name) => onRename?.(layer.id, name)}
                onCancel={() => onCancelRename?.()}
              />
            ) : (
              // DOUBLE-CLIC sur le nom → édition (parité Photoshop). Le premier
              // clic sélectionne déjà la ligne (`onClick` du <li>).
              <span
                className="layer-panel__row-label"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onStartRename?.(layer.id);
                }}
              >
                {displayName}
              </span>
            )}
            {/* PASTILLE du groupe replié : le nombre de calques qu'on NE VOIT
                PLUS. Elle vit DANS la piste du nom plutôt que dans une piste à
                elle — elle n'existe que sur une ligne repliée, donc lui réserver
                une colonne permanente coûterait de la largeur sur toutes les
                autres pour rien. Le nom se tronque à sa place le cas échéant,
                et c'est le bon ordre de sacrifice : quand un groupe est replié,
                combien il cache est plus informatif que la fin de son nom.
                `aria-hidden` : le compte est déjà dans le libellé du chevron,
                qui est le contrôle — l'annoncer deux fois ferait un doublon au
                lecteur d'écran. */}
            {collapsed && (
              <span className="layer-panel__row-count" aria-hidden="true">
                {hiddenCount}
              </span>
            )}
          </span>
          {/* NATURE de la ligne (2026-07-27) : la pile de shaderlab est une
              chaîne de traitement, pas un empilement de contenus — le panneau
              s'appelle « Effets », et cette icône est ce qui empêche ce titre
              de devenir faux quand une photo importée est dans la pile. Rien
              d'autre ne distinguait un effet d'une photo à part la vignette.
              `aria-hidden` : purement décorative, elle double le nom du calque
              (et la vignette), déjà lisibles.

              À DROITE depuis le 2026-07-29 (demande d'Antoine). Elle vivait
              entre l'œil et la marque, où elle DOUBLAIT la vignette sur une
              ligne photo — deux façons de dire « ceci est une photo » collées
              l'une à l'autre — et où elle empêchait la zone gauche d'avoir la
              même forme d'une ligne à l'autre. Elle rejoint le verrou dans la
              zone d'ÉTAT : ce que la ligne EST, puis dans quel état elle est.
              Position tenue par la COLONNE `layer-panel__col--nature`, jamais
              par l'ordre des éléments (cette promesse-là avait déjà été
              fausse : un élément optionnel absent en amont décalait tout ce
              qui suit). */}
          <span className="layer-panel__row-state layer-panel__col--nature">
            {layer.imageSource ? (
              <PhotoLayerIcon className="layer-panel__row-nature icon-sm icon-stroke" aria-hidden="true" />
            ) : (
              <EffectLayerIcon className="layer-panel__row-nature icon-sm icon-stroke" aria-hidden="true" />
            )}
          {/* VERROU — MARQUEUR, et seulement quand il est POSÉ (2026-07-29).
              Le CONTRÔLE a migré dans la zone de contrôles de la carte
              (ADR-0001 : un contrôle répété sur chaque ligne devient unique et
              agit sur la sélection). Ce qui reste ici est l'ÉTAT, parce que le
              point 5 de la checklist de l'ADR exige de pouvoir le comparer sans
              sélectionner chaque calque : un verrou posé est un état à balayer,
              un verrou ouvert n'est rien à voir. La colonne, elle, est RÉSERVÉE
              en permanence par la grille — sans quoi le nom se décalerait selon
              la présence du cadenas, exactement le défaut d'alignement corrigé
              la veille.
              `role="img"` et non un bouton : un lecteur d'écran n'annonce pas
              une action qui n'existe plus ici. */}
            {lockState !== "none" && (
              // PLEIN = tout verrouillé, CREUX = partiellement (convention
              // Adobe, `research/01-conventions-adobe.md`). Le glyphe de lucide
              // est un contour : c'est donc le cas PLEIN qui ajoute un
              // remplissage, via `--full` (voir LayerPanel.css).
              <Lock
                className={`layer-panel__row-lock--active icon-sm icon-stroke${lockState === "full" ? " layer-panel__row-lock--full" : ""}`}
                role="img"
                aria-label={lockState === "full" ? "Calque verrouillé" : "Calque partiellement verrouillé"}
              />
            )}
          </span>
          <IconButton
            label={maskPresent ? `Modifier le masque de ${displayName}` : `Ajouter un masque à ${displayName}`}
            tooltip={maskPresent ? `${maskSourceCount} source${maskSourceCount > 1 ? "s" : ""} · ouvrir le masque` : "Ajouter un masque"}
            size="compact"
            className={`layer-panel__mask-target layer-panel__col--mask${maskSelected ? " layer-panel__mask-target--selected" : ""}${maskPresent && !maskEnabled ? " layer-panel__mask-target--disabled" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelectMask(layer.id);
            }}
          >
            {maskPresent ? (
              <span className="layer-panel__mask-thumbnail" aria-hidden="true">
                {maskSourceCount > 1 && <span className="layer-panel__mask-count">{maskSourceCount}</span>}
              </span>
            ) : (
              <Plus className="icon-sm icon-stroke" aria-hidden="true" />
            )}
          </IconButton>
        </span>
      </div>
      {dropPosition && <span className={`drag-reorder__alignment-guide layer-panel__alignment-guide--${dropPosition}`} aria-hidden="true" />}
    </li>
        }
      />
      {/* MENU CONTEXTUEL DE LA LIGNE (ticket 28). Chaque entrée APPELLE un
          handler reçu en prop — aucune logique ici — et les états grisés
          reprennent les verdicts PURS de `layers/flatten.ts` (`stampOk`,
          `mergeOk`), les mêmes que le bouton de la zone de contrôles, jamais une
          copie. Les items désactivés gardent leurs événements de pointeur
          (`data-disabled:pointer-events-auto`) pour que leur `title` porte la
          RAISON du refus au survol, comme l'infobulle du bouton ; Base UI bloque
          l'activation malgré tout, et le garde `ok &&` du `onClick` est la
          seconde barrière. */}
      <ContextMenuContent aria-label={`Actions du calque ${displayName}`}>
        {/* LE MÊME BLOC D'ENTRÉES QUE LA TOILE (ticket 29) : extrait en
            `LayerActionsMenuItems` (`layerActionsMenu.tsx`), partagé par la ligne
            de pile ET le menu de la toile — jamais recopié. Les verdicts sont
            réduits en primitives par `LayerPanel` (le seul qui a la pile), les
            handlers sont ceux d'`App`. */}
        <LayerActionsMenuItems
          layer={layer}
          stampOk={stampOk}
          stampReason={stampReason}
          mergeOk={mergeOk}
          mergeReason={mergeReason}
          removable={removable}
          onToggle={onToggle}
          onDuplicate={onDuplicate}
          onStamp={onStamp}
          onMergeDown={onMergeDown}
          onToggleLock={onToggleLock}
          onRemove={onRemove}
          onStartRename={onStartRename}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
});

/**
 * SÉLECTEUR D'EFFET du calque sélectionné — « ce que FAIT ce calque ».
 *
 * ⚠️ IL A QUITTÉ LA ZONE DE CONTRÔLES le 2026-08-21 (arbitrage d'Antoine devant
 * le wireframe du ticket 07) et vit désormais en TÊTE des Propriétés. Le
 * rangement suit le NIVEAU du contrôle : l'effet et ses réglages décrivent
 * l'EFFET, donc ils vont ensemble ; fusion, opacité et verrous décrivent le
 * CALQUE, donc ils restent avec la pile (`LayerControls` ci-dessous). C'est le
 * découpage de Photoshop entre son panneau *Properties* et son panneau Calques.
 *
 * Le sélecteur N'EST PAS proposé sur un calque PHOTO (décision produit du
 * 2026-07-31, ADR-0008) : un effet ne se pose jamais sur une photo, c'est un
 * calque à part, posé au-dessus. `LayerStack.setLayerEffect` porte le refus côté modèle ;
 * cette garde-ci retire l'affordance, sans quoi le contrôle resterait à l'écran
 * en ne faisant plus rien.
 */
export function EffectSelector({ layers, selectedId, onEffectChange }: Pick<LayerControlsProps, "layers" | "selectedId" | "onEffectChange">) {
  const model = layerControlsModel(layers, selectedId);
  return (
    <div className="layer-controls layer-controls--effect">
      <div className="layer-controls__row">
        {model.effectSelectable ? (
          <Select
            label="Effet"
            labelPlacement="inline"
            value={model.effectId}
            placeholder="Aucun calque sélectionné"
            options={changeEffectOptions}
            disabled={!model.enabled}
            onChange={(v) => model.layerId !== null && onEffectChange(model.layerId, v)}
          />
        ) : (
          /* CALQUE PHOTO — pas de sélecteur, une PHRASE à sa place. Un contrôle
             qui disparaît sans rien dire se lit comme un bug, pas comme une
             règle : le texte porte la règle, le `title` porte le geste de
             remplacement. */
          <p
            className="layer-controls__effect-na"
            title="Un effet ne se pose pas sur un calque photo. Ajoutez un calque d'effet au-dessus d'elle."
          >
            Aucun effet sur un calque photo
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Zone de contrôles FIXE de la carte PILE : fusion, opacité et VERROUS du calque
 * SÉLECTIONNÉ, plus dupliquer/supprimer. Montée hors du conteneur défilant, elle
 * reste visible quelle que soit la position dans la liste — modèle observé sur
 * Photoshop web (`docs/design-system/photoshop-web-observations-2026-07-27.md`
 * §2 et §5bis).
 *
 * ⚠️ ELLE A DÉMÉNAGÉ DEPUIS LES PROPRIÉTÉS le 2026-08-21, et c'est un défaut de
 * NIVEAU qui a été corrigé, pas un rangement. Ces contrôles agissent sur le
 * CALQUE, mais ils vivaient dans le panneau Propriétés, à côté du sélecteur
 * d'effet — donc dans une carte différente de la pile qu'ils commandent. Relevé
 * par Antoine (« les verrous devraient être au niveau des calques, pas du
 * sélecteur d'effets »), et le commentaire d'origine lui donnait raison en
 * toutes lettres : les quatre verrous avaient été posés sur la ligne « Effet »
 * parce qu'elle avait de la place libre. Photoshop groupe fusion, opacité et
 * *Lock:* au même endroit, dans le panneau Calques ; c'est ce qu'on fait ici.
 */
export function LayerControls({
  layers,
  selectedId,
  onOpacityChange,
  onOpacityCommit,
  onBlendModeChange,
  onBlendModePreview,
  onBlendModePreviewEnd,
  onToggleLock,
  onDuplicate,
  onRemove,
  onStamp,
  onMergeDown,
}: Omit<LayerControlsProps, "onEffectChange">) {
  // Aucune sélection : la zone de contrôles reste MONTÉ mais désactivé. Le faire
  // disparaître ferait sauter la liste de toute sa hauteur à chaque
  // désélection (et rendrait le panneau instable au clic).
  const model = layerControlsModel(layers, selectedId);
  // Verdicts d'APLATISSEMENT (ticket 27), logique pure partagée avec le hook qui
  // exécute le geste (`layers/flatten.ts`). Un bouton désactivé porte SA raison
  // en infobulle — un contrôle inerte muet est l'échec silencieux proscrit ici.
  const stamp = stampVerdict(layers, selectedId);
  const merge = mergeDownVerdict(layers, selectedId);
  return (
    // `title` sur un calque VERROUILLÉ : la zone est inerte et il faut dire
    // pourquoi, sans ajouter de ligne de texte — la hauteur de cette zone est
    // sous budget (ADR-0001 : elle existe pour rendre de la hauteur à la liste,
    // pas pour la lui prendre). Le porteur PRINCIPAL de l'information reste le
    // cadenas fermé, visible sur la ligne elle-même.
    <div className="layer-controls" title={model.locked ? "Calque verrouillé" : undefined}>
      {/* Ligne 1 — VERROUS puis ACTIONS. Elle porte le libellé « Verrous : »,
          repris de la rangée *Lock:* de Photoshop : quatre icônes nues ne
          disaient pas ce qu'elles étaient, et un verrou pris pour l'outil
          pinceau est très exactement ce qu'Antoine a signalé (« l'icône pinceau
          ne fait rien » — le verrou de masque avalait ses traits en silence).

          ACTIONS du calque sélectionné (2026-07-29). Elles vivaient sur CHAQUE
          ligne de la liste ; l'ADR-0001 veut un contrôle unique agissant sur la
          sélection, et c'est ce qui rend au NOM la largeur qu'elles lui prenaient
          (52 px mesurés au dock par défaut).

          ⚠️ CETTE LIGNE EXISTE MAINTENANT, et elle était refusée avant. Le
          commentaire d'origine notait qu'une troisième ligne ajoutait 36 px au
          pied et faisait déborder la carte de 2 px sur le document minimal —
          d'où les icônes logées dans la place libre de la ligne « Effet ». Ce qui
          a changé : l'effet est PARTI en Propriétés (colonne séparée depuis le
          2026-08-21), donc cette zone perd une ligne avant d'en gagner une, et
          la carte n'est plus dans la même colonne que les Propriétés. Le garde
          reste `PanelColumn.stories.tsx > FiveRowDocumentHidesNoRow`.

          Le VERROU reste actionnable sur un calque verrouillé — sinon le verrou
          serait une trappe sans sortie. `layerControlsModel.enabled` vaut
          `false` dès que le calque est verrouillé : on ne peut donc pas s'en
          servir ici, d'où la lecture directe de `model.layerId`.

          DUPLIQUER reste actif sur un calque verrouillé, SUPPRIMER non — c'est
          exactement ce que le modèle fait : `LayerStack.duplicateLayer` lit la
          source sans la muter (la copie hérite du verrou), `removeLayer`
          consulte `isLocked` et refuse. Un bouton actif dont le modèle refuse
          l'effet serait l'échec silencieux que ce dépôt proscrit. */}
      <div className="layer-controls__row">
        <span className="layer-controls__locks-label" aria-hidden="true">Verrous&nbsp;:</span>
        <div className="layer-controls__actions">
          {/* LES QUATRE VERROUS (2026-08-19), rangée reprise de Photoshop : Lock
              Transparent Pixels, Lock Image Pixels, Lock Position, Lock All.
              Ils sont INDÉPENDANTS — « Tout » n'écrase pas les trois autres,
              pour que le relâcher rende au calque les verrous partiels qu'il
              avait avant (comportement d'Adobe, voir `withLock`).
              Tous restent CLIQUABLES sur un calque verrouillé : un verrou
              irréversible est hostile, et c'est la seule exception que
              `LayerStack.setLayerLock` s'autorise. */}
          {VERROUS.map(({ cle, label, Icone }) => (
            <IconButton
              key={cle}
              label={`${model.locks[cle] === true ? "Déverrouiller" : "Verrouiller"} — ${label}`}
              tooltip={label}
              size="compact"
              disabled={model.layerId === null}
              // ÉTAT ENFONCÉ (2026-08-21, grilling ticket 05). La teinte seule
              // était trop muette — un verrou actif ne se lisait pas, d'où le
              // « l'icône pinceau ne fait rien » d'Antoine (le verrou avalait ses
              // traits en silence). `aria-pressed` porte l'état à l'assistive
              // tech ET sert d'ancre au style enfoncé (fond + bord accent).
              aria-pressed={model.locks[cle] === true}
              className={model.locks[cle] === true ? "layer-controls__lock--active" : undefined}
              onClick={() => model.layerId !== null && onToggleLock(model.layerId, cle, model.locks[cle] !== true)}
            >
              <Icone
                className={`icon-sm icon-stroke${model.locks[cle] === true ? " layer-panel__row-lock--active" : ""}`}
                aria-hidden="true"
              />
            </IconButton>
          ))}
          <IconButton
            label="Dupliquer le calque"
            tooltip={`Dupliquer le calque (${LAYER_SHORTCUT_LABELS.duplicate})`}
            size="compact"
            disabled={model.layerId === null}
            onClick={() => model.layerId !== null && onDuplicate(model.layerId)}
          >
            <Copy className="icon-sm icon-stroke" aria-hidden="true" />
          </IconButton>
          {/* APLATIR / FUSIONNER (ticket 27). Le libellé accessible reste
              CONSTANT quel que soit l'état — un nom d'action qui change casse la
              cible des tests et des lecteurs d'écran ; c'est l'infobulle qui
              porte la raison du refus quand le bouton est grisé. */}
          <IconButton
            label="Aplatir en nouveau calque"
            tooltip={stamp.ok ? `Copie aplatie du composite jusqu'ici, posée au-dessus (Tampon — ${LAYER_SHORTCUT_LABELS.stamp})` : stamp.reason}
            size="compact"
            disabled={!stamp.ok || model.layerId === null}
            onClick={() => model.layerId !== null && onStamp(model.layerId)}
          >
            <Stamp className="icon-sm icon-stroke" aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Fusionner avec le dessous"
            tooltip={merge.ok ? `Remplace ce calque et tout ce qui est en dessous par leur composite aplati (${LAYER_SHORTCUT_LABELS.merge})` : merge.reason}
            size="compact"
            disabled={!merge.ok || model.layerId === null}
            onClick={() => model.layerId !== null && onMergeDown(model.layerId)}
          >
            <Combine className="icon-sm icon-stroke" aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Supprimer le calque"
            tooltip={`Supprimer le calque (${LAYER_SHORTCUT_LABELS.delete})`}
            size="compact"
            variant="danger"
            disabled={!model.enabled}
            onClick={() => model.layerId !== null && onRemove(model.layerId)}
          >
            <Trash2 className="icon-sm icon-stroke" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      {/* Ligne 2 — FUSION + OPACITÉ côte à côte, comme observé sur Photoshop
          web (§2 des observations du 2026-07-27). Avec la ligne des verrous
          au-dessus, cette carte porte donc les trois attributs du CALQUE que
          Photoshop groupe au même endroit : fusion, opacité, verrous.

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
          onOptionPreview={onBlendModePreview ? (v) => model.layerId !== null && onBlendModePreview(model.layerId, v) : undefined}
          onOptionPreviewEnd={onBlendModePreviewEnd}
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
  selectedTarget,
  onSelectTarget,
  onToggle,
  isolatedLayerId = null,
  onAdd,
  onReorder,
  onDuplicate,
  onStamp,
  onMergeDown,
  onToggleLock,
  onRemove,
  renamingId = null,
  onStartRename,
  onRename,
  onCancelRename,
  collapseState = EMPTY_COLLAPSE_STATE,
  onToggleGroup,
  thumbnailUrl,
  effectPreview,
  pickerOpen,
  onPickerOpenChange,
}: Props) {
  // SENS D'AFFICHAGE (ADR-0004, 2026-07-28) : la liste se lit de haut en bas
  // dans l'ordre du TRAITEMENT. Le modèle ne bouge pas — `layers[0]` reste le
  // calque appliqué en premier — et il s'affiche en PREMIÈRE ligne. Depuis la
  // tranche T1 c'est en général la photo de fond, et les effets qui la traitent
  // suivent en dessous. La photo est la matière, l'effet est l'opération : la
  // matière vient avant.
  //
  // IMBRICATION (2026-07-28) : `toLayerTreeRows` rend ce MÊME ordre, chaque
  // ligne portant en plus sa profondeur et son rattachement (voir
  // src/components/layerTree.ts). L'ordre est inchangé par construction — c'est
  // ce qui laisse `data-layer-row-index` et `displayInsertToModelInsert`
  // valides, donc le glisser-déposer intact.
  //
  // Le FOND n'a plus de traitement à part : c'est un calque photo de `layers`,
  // que la règle de proximité trouve d'elle-même (tranche T1).
  const effectiveTarget = useMemo(
    () => selectedTarget ?? targetForLayerId(layers, selectedId),
    [selectedTarget, layers, selectedId],
  );
  // REPLI (2026-08-16) : une seconde projection, appliquée APRÈS `toPileRows`.
  // Elle n'ajoute que des annotations et RETIRE des lignes — elle ne réordonne
  // ni ne re-rattache rien, donc `layerTree` reste seul maître du rattachement.
  const rows = useMemo(
    () => applyCollapse(toPileRows(layers, effectiveTarget), collapseState),
    [layers, effectiveTarget, collapseState],
  );
  // Le hook de réordonnancement ne s'intéresse qu'aux identités, pas à la
  // hiérarchie : il reçoit la liste plate dans l'ordre affiché — c'est-à-dire,
  // depuis le repli, les lignes VISIBLES seulement.
  const displayLayers = useMemo(() => rows.map((row) => row.layer), [rows]);

  // Le glisser-déposer raisonne ENTIÈREMENT en espace d'affichage : le hook
  // reçoit la liste affichée, `data-layer-row-index` porte l'index de LIGNE, et
  // les indicateurs avant/après gardent donc leur sens visuel sans inversion.
  // Une seule frontière convertit — ici, à la sortie du hook, par la fonction
  // pure testée `displayInsertToModelInsert` (test/components/layerDisplayOrder.test.ts).
  // DEUX conversions en cascade, et la seconde n'est PAS décorative.
  //
  // `displayInsertToModelInsert` porte le SENS d'affichage, et elle suppose que
  // la liste rendue est la pile entière — hypothèse vraie jusqu'au repli. Avec
  // un groupe replié, la position 3 de la liste n'est plus l'indice 3 du
  // modèle, et rien n'aurait rougi : le calque serait simplement atterri
  // ailleurs que là où on l'a lâché, d'autant plus loin que le groupe replié
  // est gros. `visibleInsertToModelInsert` referme ce trou en passant par les
  // IDENTITÉS des lignes visibles (fonction pure testée, `pileCollapse.ts`).
  //
  // Ordre : d'abord le sens (affichage → modèle), ensuite le repli (visibles →
  // pile entière). L'inverse mélangerait deux espaces d'indices.
  const handleReorderFromDisplay = useCallback(
    (id: string, displayNewIndex: number) => {
      const visibleInsert = displayInsertToModelInsert(displayNewIndex, displayLayers.length);
      onReorder(
        id,
        visibleInsertToModelInsert(
          layers.map((l) => l.id),
          displayLayers.map((l) => l.id),
          id,
          visibleInsert,
        ),
      );
    },
    [onReorder, layers, displayLayers]
  );

  const { dragState, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } = usePointerReorder(
    displayLayers,
    (layer) => layer.id,
    "data-layer-row-index",
    handleReorderFromDisplay
  );

  // Visibilité effective, calculée une fois par render plutôt qu'une fois par
  // ligne. ⚠️ Elle a dépendu de la pile ENTIÈRE jusqu'au 2026-08-21 : isoler un
  // calque écrêté rendait aussi visible sa base photo. L'écrêtage retiré
  // (ADR-0020), `isolationVisibleIds` ne lit plus que l'id isolé.
  const visibleIds = useMemo(() => isolationVisibleIds(isolatedLayerId), [isolatedLayerId]);

  const handleGripPointerDown = useCallback(
    (id: string, pointerId: number, target: Element, clientX: number, clientY: number) => {
      // measureElement = target : LayerPanel n'utilise pas grabOffset/pointerPosition
      // (pas de fantôme), measurer la poignée elle-même suffit.
      handlePointerDown(id, pointerId, target, target, clientX, clientY);
    },
    [handlePointerDown]
  );

  const handleRowSelect = useCallback(
    (id: string) => {
      onSelect(id);
      const target = targetForLayerId(layers, id);
      if (target) onSelectTarget?.(target);
    },
    [layers, onSelect, onSelectTarget],
  );

  const handleMaskSelect = useCallback(
    (id: string) => {
      onSelect(id);
      onSelectTarget?.({ kind: "mask", layerId: id });
    },
    [onSelect, onSelectTarget],
  );

  const listRef = useRef<HTMLUListElement>(null);
  /**
   * RAMENER LA SÉLECTION DANS LA VUE.
   *
   * Défaut mesuré le 2026-08-13 devant l'app, à 7 calques : la carte n'en montre
   * que cinq — ça, c'est voulu (`--dock-card-list-rows: 5`) — mais `scrollTop`
   * restait à **0** pendant qu'on éditait les propriétés d'un calque
   * qu'on ne voyait pas. La sélection peut venir d'ailleurs que d'un clic sur la
   * ligne (raccourci, sélection d'un masque, ajout d'un calque, undo), donc rien
   * ne garantissait qu'elle soit visible.
   *
   * `block: "nearest"` ne bouge RIEN si la ligne est déjà dans la vue et fait le
   * déplacement MINIMAL sinon — c'est ce qui évite de recentrer la liste à
   * chaque clic, et ce qui laisse le défilement de l'utilisateur tranquille. Il
   * remonte aussi les ancêtres défilants, donc il fonctionne que ce soit la
   * liste ou la colonne du dock qui défile.
   *
   * `useLayoutEffect` et non `useEffect` : le défilement se fait AVANT la
   * peinture, sinon la ligne apparaît hors champ puis saute.
   */
  useLayoutEffect(() => {
    if (selectedId === null) return;
    const ligne = listRef.current?.querySelector<HTMLElement>('[data-layer-row-selected="true"]');
    ligne?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // OUVERTURE DU SÉLECTEUR D'EFFET (ticket 28) : état d'INTERFACE seulement,
  // piloté par son propre bouton ET par l'entrée « Ajouter un effet… » du menu
  // du vide de pile. N'entre pas dans le modèle (rien à annuler).
  //
  // CONTRÔLÉ PAR `App` LE CAS ÉCHÉANT (ticket 29) : le menu de la TOILE ouvre ce
  // MÊME sélecteur, et il vit hors du panneau. Si `App` fournit l'état, on
  // l'utilise ; sinon on garde l'état interne (nullish, pas `||` : un `false`
  // contrôlé ne doit pas retomber sur l'interne).
  const [internalPickerOpen, setInternalPickerOpen] = useState(false);
  const pickerIsOpen = pickerOpen ?? internalPickerOpen;
  const setPickerOpen = onPickerOpenChange ?? setInternalPickerOpen;

  return (
    <div className="layer-panel">
      <EffectPicker
        disabled={!hasImage}
        onSelect={onAdd}
        preview={effectPreview}
        // OUVERTURE PILOTÉE (tickets 28 et 29) : le menu du vide de la pile ET
        // celui de la toile ouvrent ce sélecteur. État d'INTERFACE.
        open={pickerIsOpen}
        onOpenChange={setPickerOpen}
      />
      {/* MENU CONTEXTUEL DU VIDE DE LA PILE (ticket 28) : clic droit sous la
          dernière ligne — ou sur une pile vide — propose « Ajouter un effet… »,
          qui ouvre le sélecteur existant sans qu'on ait à viser son bouton. La
          `<ul>` est le déclencheur ; chaque ligne a le sien et arrête
          l'événement (`stopPropagation` sur son `onContextMenu`), donc un clic
          droit SUR une ligne n'ouvre jamais CE menu-là, seulement celui de la
          ligne. Rien d'autre ici (tranche 1). */}
      <ContextMenu>
        <ContextMenuTrigger
          render={
      <ul
        ref={listRef}
        // `data-dock-list` : marque la LISTE dans la zone défilante de la
        // carte, pour que le plancher de compression compte séparément les
        // lignes et ce qui vit à côté d'elles — ici le sélecteur
        // « Ajouter un effet ». Voir PanelColumn.tsx § COÛT DU HORS-LISTE.
        data-dock-list=""
        // `listbox` : contrepartie obligatoire du `role="option"` porté par
        // chaque ligne (voir LayerRow). Un `option` hors d'un `listbox` est de
        // l'ARIA invalide, donc pire que pas d'ARIA du tout.
        role="listbox"
        aria-label="Calques"
        className="layer-panel__list"
        onPointerMove={dragState ? handlePointerMove : undefined}
        onPointerUp={dragState ? handlePointerUp : undefined}
        onPointerCancel={dragState ? handlePointerCancel : undefined}
      >
        {rows.map(({ layer, depth, firstChild, lastChild, selectedFacet, mask, collapsible, collapsed, hiddenCount }, displayRow) => {
          // VERDICTS par ligne, dérivés ICI (le seul endroit qui a la pile) des
          // fonctions PURES de `layers/flatten.ts` — le même verdict que la zone
          // de contrôles, jamais une copie. Réduits en primitives avant d'entrer
          // dans `LayerRow` (mémoïsée) pour ne pas la re-rendre à chaque frame.
          const stamp = stampVerdict(layers, layer.id);
          const merge = mergeDownVerdict(layers, layer.id);
          return (
          <LayerRow
            key={layer.id}
            layer={layer}
            index={displayRow}
            selected={layer.id === selectedId}
            maskSelected={selectedFacet === "mask"}
            maskPresent={mask.present}
            maskSourceCount={mask.sourceCount}
            maskEnabled={mask.enabled}
            visible={isLayerVisible(layer, visibleIds)}
            role={isolationRole(layer.id, isolatedLayerId)}
            lockState={lockStateOf(layer)}
            stampOk={stamp.ok}
            stampReason={stamp.ok ? "" : stamp.reason}
            mergeOk={merge.ok}
            mergeReason={merge.ok ? "" : merge.reason}
            removable={!isFullyLocked(layer)}
            depth={depth}
            firstChild={firstChild}
            lastChild={lastChild}
            collapsible={collapsible}
            collapsed={collapsed}
            hiddenCount={hiddenCount}
            isDragging={dragState?.draggedId === layer.id}
            dropPosition={
              dragState !== null && dragState.overIndex === displayRow && dragState.draggedId !== layer.id
                ? dragState.overPosition
                : null
            }
            onSelect={handleRowSelect}
            onSelectMask={handleMaskSelect}
            onToggle={onToggle}
            onDuplicate={onDuplicate}
            onStamp={onStamp}
            onMergeDown={onMergeDown}
            onToggleLock={onToggleLock}
            onRemove={onRemove}
            renaming={renamingId === layer.id}
            onStartRename={onStartRename}
            onRename={onRename}
            onCancelRename={onCancelRename}
            onToggleCollapse={onToggleGroup}
            onGripPointerDown={handleGripPointerDown}
            thumbnailUrl={thumbnailUrl}
          />
          );
        })}
      </ul>
          }
        />
        <ContextMenuContent aria-label="Ajouter à la pile">
          <ContextMenuItem disabled={!hasImage} onClick={() => setPickerOpen(true)}>
            <Plus className="icon-sm icon-stroke" aria-hidden="true" />
            Ajouter un effet…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
