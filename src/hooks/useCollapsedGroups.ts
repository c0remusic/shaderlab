import { useCallback, useEffect, useState } from "react";
import type { LayerState } from "../layers/types";
import {
  EMPTY_COLLAPSE_STATE,
  reconcileCollapse,
  toggleGroup,
  type CollapseState,
} from "../components/pileCollapse";

interface Deps {
  /** Projection d'affichage des calques (state React). Sert à trouver le
   *  rattachement de la sélection et à réconcilier l'état sur une pile qui a
   *  changé — jamais à rendre. */
  layers: LayerState[];
  selectedId: string | null;
  /** Sélection normale (`App.handleSelect`). Le repli peut la DÉPLACER, jamais
   *  la créer de rien : il n'appelle ce rappel que lorsqu'il la change. */
  onSelect: (id: string) => void;
}

/**
 * REPLI DES GROUPES DE LA PILE. Suit le modèle `useLayerIsolation` (ARCHITECTURE.md
 * §7 R6) : la feature apporte son hook, `App.tsx` n'en garde que le câblage, et
 * toutes les règles vivent pures et testées dans `components/pileCollapse.ts`.
 *
 * L'état ne touche NI le modèle NI l'historique — arbitrage d'Antoine du
 * 2026-08-16 : un repli est une aide de visée, et le passer par `LayerState` le
 * rendrait annulable par Ctrl+Z (`History.push` snapshotte la pile entière).
 * Même raison, même place que `isolatedLayerId`.
 */
export function useCollapsedGroups({ layers, selectedId, onSelect }: Deps) {
  const [collapseState, setCollapseState] = useState<CollapseState>(EMPTY_COLLAPSE_STATE);

  // Garde structurel, même forme que la réconciliation de `useLayerIsolation` :
  // suppression d'une photo repliée, undo qui la fait disparaître, ou changement
  // de document. `reconcileCollapse` rend la même référence quand rien ne bouge,
  // donc c'est un no-op React dans le cas courant.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciliation d'un etat local sur une pile qui a change SOUS lui (suppression, undo, changement de document) : `reconcileCollapse` rend la meme reference quand rien ne bouge, donc aucun rendu en cascade dans le cas courant.
    setCollapseState((state) => reconcileCollapse(state, layers.map((l) => l.id)));
  }, [layers]);

  // L'état est lu dans la fermeture et non dans un updater `setState` : la
  // bascule doit AUSSI déplacer la sélection, et un updater peut être rejoué
  // (StrictMode) — un rappel externe déclenché depuis là partirait deux fois.
  // Même forme que `handleEyeClick` dans `useLayerIsolation`.
  const handleToggleGroup = useCallback(
    (parentId: string) => {
      const outcome = toggleGroup(collapseState, parentId, layers, selectedId);
      setCollapseState(outcome.state);
      // La sélection n'est poussée que si elle CHANGE. `null` n'arrive que
      // quand elle était déjà nulle et le reste, donc jamais ici.
      if (outcome.selectedId !== selectedId && outcome.selectedId !== null) {
        onSelect(outcome.selectedId);
      }
    },
    [collapseState, layers, selectedId, onSelect],
  );

  return { collapseState, handleToggleGroup };
}
