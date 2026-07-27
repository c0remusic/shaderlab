import { useCallback, useEffect, useState, type RefObject } from "react";
import type { DocumentSession } from "../application/documentSession";
import type { LayerState } from "../layers/types";
import { eyeClickOutcome, reconcileIsolation } from "../layers/isolation";
import type { Renderer } from "../render/renderer";

interface Deps {
  sessionRef: RefObject<DocumentSession>;
  rendererRef: RefObject<Renderer | null>;
  /** Projection d'affichage des calques (state React) : sert UNIQUEMENT à
   *  détecter la disparition du calque isolé. */
  layers: LayerState[];
  /** Bascule normale de visibilité (`App.handleToggle`) : le seul chemin qui
   *  touche le modèle et crée une entrée d'historique. L'isolation, elle, n'en
   *  crée jamais. */
  toggleLayer: (id: string) => void;
}

/**
 * ISOLATION d'un calque (Alt+clic sur l'œil). Suit le modèle `usePhotoLayer`/
 * `usePresets` (ARCHITECTURE.md §7 R6) : la feature apporte son hook,
 * `App.tsx` n'en garde que le câblage.
 *
 * L'état est un simple `isolatedLayerId` — les règles et la projection sont
 * pures et testées dans `layers/isolation.ts`. Rien n'est mémorisé de l'état de
 * visibilité antérieur, parce que rien n'est modifié : le modèle reste la
 * source de vérité et reprend la main dès la sortie.
 */
export function useLayerIsolation({ sessionRef, rendererRef, layers, toggleLayer }: Deps) {
  const [isolatedLayerId, setIsolatedLayerId] = useState<string | null>(null);

  // Garde structurel (même forme que la réconciliation de `CanvasMode` dans
  // usePhotoLayer) : suppression du calque isolé, undo qui le fait disparaître,
  // ou changement de document -> abandon de l'isolation. Sans lui, un état
  // résiduel afficherait un document quasi vide sans raison visible.
  // `reconcileIsolation` rend la même valeur quand rien ne doit bouger, donc
  // c'est un no-op React dans le cas courant.
  useEffect(() => {
    setIsolatedLayerId((id) => reconcileIsolation(id, layers.map((l) => l.id)));
  }, [layers]);

  // Pousse l'état au renderer, qui l'applique à l'écran seulement (voir
  // `Renderer.setIsolatedLayer`). Un rendu explicite suit, comme pour l'overlay
  // de masque : le setter ne rend pas de lui-même.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setIsolatedLayer(isolatedLayerId);
    r.requestRender(sessionRef.current.layers());
  }, [isolatedLayerId, rendererRef, sessionRef]);

  const handleEyeClick = useCallback(
    (id: string, altKey: boolean) => {
      const outcome = eyeClickOutcome(isolatedLayerId, id, altKey);
      setIsolatedLayerId(outcome.isolatedLayerId);
      if (outcome.toggleEnabled) toggleLayer(id);
    },
    [isolatedLayerId, toggleLayer]
  );

  /** Bascule l'isolation d'un calque SANS souris (raccourci clavier). Réutilise
   *  `eyeClickOutcome(..., altKey: true)` plutôt que de redéfinir la règle :
   *  entrer, déplacer l'isolation, ou en sortir si c'est déjà ce calque — un
   *  seul endroit décide, testé unitairement. Comme l'Alt+clic, ne touche ni au
   *  modèle ni à l'historique (`toggleEnabled` est toujours faux sur ce chemin).
   *  `null` (aucun calque sélectionné) = no-op : le raccourci n'a alors pas de
   *  cible, et sortir de l'isolation « au passage » serait un effet surprise. */
  const toggleIsolation = useCallback((id: string | null) => {
    if (id === null) return;
    setIsolatedLayerId((current) => eyeClickOutcome(current, id, true).isolatedLayerId);
  }, []);

  return { isolatedLayerId, handleEyeClick, toggleIsolation };
}
