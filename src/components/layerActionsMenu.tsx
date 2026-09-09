import { Brush, Combine, Copy, Eye, EyeOff, Grid2x2, Lock, Move, Stamp, Trash2 } from "lucide-react";
import type { LayerLocks, LayerState } from "../layers/types";
import {
  isFullyLocked,
  isMaskLocked,
  isPositionLocked,
  isTransparencyLocked,
} from "../layers/layerLocks";
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "./ui/context-menu";

/** LES QUATRE VERROUS, dans l'ordre de Photoshop : transparence, image,
 *  position, tout. L'ordre est celui d'Adobe et pas un choix — un utilisateur
 *  qui connaît la rangée la retrouve au même endroit.
 *
 *  Les icônes disent CE QUI est gelé, pas « verrouillé » : un damier pour la
 *  transparence (la zone hors masque), un pinceau pour ce que le calque couvre,
 *  une croix de déplacement pour la géométrie, et le cadenas pour « tout ».
 *
 *  ⚠️ EXPORTÉ ET PARTAGÉ (ticket 29). La rangée de la zone de contrôles
 *  (`LayerControls`) et le sous-menu du menu contextuel — celui de la LIGNE de
 *  pile (ticket 28) comme celui de la TOILE (ticket 29) — lisent tous cette
 *  MÊME table. Une seule déclaration, jamais une copie. */
export const VERROUS: readonly { cle: keyof LayerLocks; label: string; Icone: typeof Lock }[] = [
  { cle: "transparency", label: "Transparence — peindre dedans, jamais dehors", Icone: Grid2x2 },
  { cle: "mask", label: "Masque — ce que le calque couvre", Icone: Brush },
  { cle: "position", label: "Position — la géométrie", Icone: Move },
  { cle: "all", label: "Tout", Icone: Lock },
];

/** État COCHÉ d'un verrou dans le sous-menu du menu contextuel. On lit le verrou
 *  IMPLIQUÉ (via les helpers de `layerLocks.ts`), pas le champ brut : « Tout »
 *  implique les trois autres, donc quand il est posé les trois se montrent
 *  cochés (exigence du ticket 28). La rangée de la zone de contrôles, elle,
 *  montre l'état BRUT (`model.locks[cle]`) — deux lectures différentes du même
 *  modèle pour deux usages différents, aucune n'est une copie de l'autre. */
export const LOCK_IMPLIED: Record<keyof LayerLocks, (layer: Pick<LayerState, "locks">) => boolean> = {
  transparency: isTransparencyLocked,
  mask: isMaskLocked,
  position: isPositionLocked,
  all: isFullyLocked,
};

export interface LayerActionsMenuItemsProps {
  /** Le calque visé. Le bloc lit son `enabled` (libellé Masquer/Afficher) et
   *  l'état de ses verrous (`LOCK_IMPLIED`) ; tout le reste passe par les
   *  handlers reçus. */
  layer: LayerState;
  /** VERDICTS D'APLATISSEMENT (`layers/flatten.ts`), déjà réduits à ce calque
   *  par l'appelant qui a la pile — la ligne de pile (`LayerPanel`) comme la
   *  toile (`CanvasContextMenu`). PRIMITIVES, jamais une copie de la logique :
   *  `reason` est vide quand `ok`. */
  stampOk: boolean;
  stampReason: string;
  mergeOk: boolean;
  mergeReason: string;
  /** SUPPRESSION permise ? (`!isFullyLocked`, même garde que `removeLayer`). */
  removable: boolean;
  /** ACTIONS. Ce sont EXACTEMENT les handlers que la zone de contrôles reçoit
   *  d'`App.tsx` — le menu en donne un SECOND accès, il n'en invente aucun.
   *  Optionnels (sauf `onToggle`) : les stories et montages qui ne les passent
   *  pas gardent leurs entrées grisées. */
  onToggle: (id: string, altKey: boolean) => void;
  onDuplicate?: (id: string) => void;
  onStamp?: (id: string) => void;
  onMergeDown?: (id: string) => void;
  onToggleLock?: (id: string, which: keyof LayerLocks, value: boolean) => void;
  onRemove?: (id: string) => void;
}

/**
 * LES ENTRÉES D'ACTION D'UN CALQUE dans un menu contextuel (ticket 28, PARTAGÉ
 * par le ticket 29). Un FRAGMENT d'items — Masquer/Afficher · Dupliquer ·
 * Aplatir · Fusionner · Verrous (sous-menu à cases) · Supprimer — sans son
 * `ContextMenuContent` : l'appelant l'enveloppe (la LIGNE de pile via
 * `LayerPanel`, la TOILE via `CanvasContextMenu`). Aucune logique ici : chaque
 * entrée APPELLE un handler reçu, et les états grisés reprennent les verdicts
 * PURS de `layers/flatten.ts`, les mêmes que le bouton de la zone de contrôles,
 * jamais une copie. Les items désactivés gardent leurs événements de pointeur
 * (`data-disabled:pointer-events-auto`) pour que leur `title` porte la RAISON du
 * refus au survol ; Base UI bloque l'activation malgré tout, et le garde `ok &&`
 * du `onClick` est la seconde barrière.
 */
export function LayerActionsMenuItems({
  layer,
  stampOk,
  stampReason,
  mergeOk,
  mergeReason,
  removable,
  onToggle,
  onDuplicate,
  onStamp,
  onMergeDown,
  onToggleLock,
  onRemove,
}: LayerActionsMenuItemsProps) {
  return (
    <>
      <ContextMenuItem onClick={() => onToggle(layer.id, false)}>
        {layer.enabled ? (
          <EyeOff className="icon-sm icon-stroke" aria-hidden="true" />
        ) : (
          <Eye className="icon-sm icon-stroke" aria-hidden="true" />
        )}
        {layer.enabled ? "Masquer le calque" : "Afficher le calque"}
      </ContextMenuItem>
      <ContextMenuItem disabled={!onDuplicate} onClick={() => onDuplicate?.(layer.id)}>
        <Copy className="icon-sm icon-stroke" aria-hidden="true" />
        Dupliquer
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!stampOk || !onStamp}
        className="data-disabled:pointer-events-auto data-disabled:cursor-not-allowed"
        title={stampOk ? undefined : stampReason}
        onClick={() => { if (stampOk) onStamp?.(layer.id); }}
      >
        <Stamp className="icon-sm icon-stroke" aria-hidden="true" />
        Aplatir en nouveau calque
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!mergeOk || !onMergeDown}
        className="data-disabled:pointer-events-auto data-disabled:cursor-not-allowed"
        title={mergeOk ? undefined : mergeReason}
        onClick={() => { if (mergeOk) onMergeDown?.(layer.id); }}
      >
        <Combine className="icon-sm icon-stroke" aria-hidden="true" />
        Fusionner avec le dessous
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Lock className="icon-sm icon-stroke" aria-hidden="true" />
          Verrous
        </ContextMenuSubTrigger>
        <ContextMenuSubContent aria-label="Verrous du calque">
          {/* Les MÊMES quatre verrous que la rangée « Verrous : » de la zone de
              contrôles, lus dans `layerLocks.ts`. L'état coché reflète le
              verrou IMPLIQUÉ : « Tout » posé montre les trois autres cochés
              (`LOCK_IMPLIED`). Le libellé court tient sur une ligne (ADR-0001),
              le libellé complet passe en infobulle. */}
          {VERROUS.map(({ cle, label, Icone }) => (
            <ContextMenuCheckboxItem
              key={cle}
              checked={LOCK_IMPLIED[cle](layer)}
              title={label}
              disabled={!onToggleLock}
              onCheckedChange={(next) => onToggleLock?.(layer.id, cle, next)}
            >
              <Icone className="icon-sm icon-stroke" aria-hidden="true" />
              {label.split(" — ")[0]}
            </ContextMenuCheckboxItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        disabled={!removable || !onRemove}
        className="data-disabled:pointer-events-auto data-disabled:cursor-not-allowed"
        title={removable ? undefined : "Calque verrouillé (Tout) : déverrouille-le pour le supprimer."}
        onClick={() => { if (removable) onRemove?.(layer.id); }}
      >
        <Trash2 className="icon-sm icon-stroke" aria-hidden="true" />
        Supprimer le calque
      </ContextMenuItem>
    </>
  );
}
