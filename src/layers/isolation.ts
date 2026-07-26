import type { LayerState } from "./types";

/**
 * ISOLATION d'un calque (geste Photoshop Alt+clic sur l'œil) : juger un calque
 * seul, puis revenir exactement à l'état d'avant.
 *
 * Décision structurante : l'isolation est un ÉTAT D'INTERFACE TRANSITOIRE, pas
 * une donnée de document. Le modèle de calques n'est JAMAIS muté — ni
 * `LayerState.enabled`, ni la pile, ni l'historique. Tout passe par la
 * projection pure ci-dessous, appliquée au moment du rendu écran
 * (`Renderer.render`). Conséquences directes, toutes voulues :
 *  - aucune entrée d'historique (l'isolation n'est pas une action de document) ;
 *  - restitution EXACTE de l'état antérieur par construction — il n'y a rien à
 *    mémoriser ni à restaurer, donc rien à désynchroniser : un calque déjà
 *    masqué avant l'isolation le redevient au retour parce qu'il ne l'a jamais
 *    cessé dans le modèle ;
 *  - un `commit()` déclenché par une AUTRE action pendant l'isolation ne peut
 *    pas figer l'isolation dans l'historique (ce que ferait une implémentation
 *    qui écrirait `enabled: false` sur les autres calques).
 *
 * L'export (`Renderer.exportFrame`) ne passe PAS par cette projection : ce qui
 * sort du document est le document, pas l'aide visuelle en cours.
 */

/** Visibilité EFFECTIVE d'un calque à l'écran compte tenu de l'isolation.
 *  Le calque isolé est forcé visible même si `enabled` est faux : Alt+clic sur
 *  l'œil d'un calque masqué veut dire « montre-moi celui-là seul », et rendre
 *  un écran noir serait un piège. Son `enabled` réel est intact et reprend la
 *  main dès la sortie d'isolation. */
export function isLayerVisible(layer: LayerState, isolatedLayerId: string | null): boolean {
  if (isolatedLayerId === null) return layer.enabled;
  return layer.id === isolatedLayerId;
}

/** Projection d'isolation : la même pile, avec `enabled` recalculé en
 *  visibilité effective. Rend le tableau PAR IDENTITÉ hors isolation, et chaque
 *  calque inchangé par identité — aucune allocation inutile, et surtout aucune
 *  copie de raster de masque (le `mask` est partagé par référence, même
 *  discipline que `LayerStack.clone`/`History`). */
export function projectIsolation(layers: LayerState[], isolatedLayerId: string | null): LayerState[] {
  if (isolatedLayerId === null) return layers;
  return layers.map((layer) => {
    const visible = isLayerVisible(layer, isolatedLayerId);
    return visible === layer.enabled ? layer : { ...layer, enabled: visible };
  });
}

/** Garde structurel : l'isolation ne survit pas à la disparition de son calque.
 *  Couvre d'un seul mécanisme la suppression du calque isolé, l'undo qui le
 *  fait disparaître, et le CHANGEMENT DE DOCUMENT (la nouvelle pile ne partage
 *  aucun id avec l'ancienne — `freshId()` est un compteur monotone qui ne
 *  recycle jamais, et un document neuf est vide). Sans ce garde, un état
 *  d'isolation résiduel afficherait un document quasi vide sans raison
 *  visible. */
export function reconcileIsolation(isolatedLayerId: string | null, layerIds: string[]): string | null {
  if (isolatedLayerId === null) return null;
  return layerIds.includes(isolatedLayerId) ? isolatedLayerId : null;
}

/** Ce qu'un clic sur l'œil doit produire, séparé de son exécution pour être
 *  testable (aucun test ne rend de composant React sur ce projet). */
export interface EyeClickOutcome {
  /** Nouvel état d'isolation après ce clic. */
  isolatedLayerId: string | null;
  /** Vrai si le clic doit AUSSI basculer `enabled` du calque dans le modèle
   *  (donc créer une entrée d'historique, via le chemin `toggleLayer` normal). */
  toggleEnabled: boolean;
}

/**
 * Règles du clic sur l'œil :
 *  - Alt+clic : entre en isolation sur ce calque, ou en sort si c'est déjà lui
 *    qui est isolé (Alt+clic sur un AUTRE calque déplace l'isolation, ce qui
 *    est le geste de comparaison attendu). Jamais de mutation du modèle.
 *  - Clic simple HORS isolation : bascule normale de visibilité (inchangé).
 *  - Clic simple PENDANT l'isolation : sort de l'isolation, SANS basculer quoi
 *    que ce soit. Choix tranché ici : pendant l'isolation les œils affichent la
 *    visibilité EFFECTIVE, pas la valeur stockée — écrire dans une valeur que
 *    l'utilisateur ne voit pas produirait une mutation invisible, révélée
 *    seulement à la sortie (« pourquoi ce calque est-il masqué ? »). Le clic
 *    est donc consommé par le retour à l'état antérieur, ce que le libellé du
 *    bouton annonce explicitement pendant l'isolation. Alternative écartée :
 *    absorber le changement dans l'isolation — elle demande de mémoriser un
 *    état antérieur mutable, exactement ce que cette conception évite.
 */
export function eyeClickOutcome(
  isolatedLayerId: string | null,
  layerId: string,
  altKey: boolean
): EyeClickOutcome {
  if (altKey) {
    return { isolatedLayerId: isolatedLayerId === layerId ? null : layerId, toggleEnabled: false };
  }
  if (isolatedLayerId !== null) return { isolatedLayerId: null, toggleEnabled: false };
  return { isolatedLayerId: null, toggleEnabled: true };
}
