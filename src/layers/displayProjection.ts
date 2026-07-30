import type { LayerState } from "./types";

/**
 * Projection d'affichage d'une pile de calques : identique aux calques
 * d'origine SANS les DONNÉES des buffers `raster` des sources de masque.
 *
 * Généralisation du fix crash 24MP (root cause : un gros buffer masque dans
 * le state React fait CRASHER WebView2 au re-render de `setLayers()`, voir
 * `docs/superpowers/specs/2026-07-17-native-wgpu-decision.md`). Avant cette
 * tâche, un seul buffer de masque par calque (l'ancien champ unique de
 * `LayerState`) portait ce risque ; le modèle
 * `LayerMask` généralise à N sources, donc CHAQUE `raster` de CHAQUE source
 * doit être vidé, pas seulement un champ unique.
 *
 * Depuis que `MaskSource` est une union discriminée (Task 1, mask-integrity),
 * une source `"brush"` ne peut PLUS avoir `raster: null` (invariant "valide
 * par construction") : le vidage utilise donc un `Uint8Array` VIDE plutôt que
 * `null` — même effet mémoire (aucune donnée peinte ne survit dans le state
 * React), type valide.
 *
 * Un calque SANS AUCUN raster non-vide est renvoyé PAR IDENTITÉ (même objet)
 * — pas de nouvelle allocation, pour ne pas provoquer de re-render superflu
 * des lignes inchangées (comportement hérité de la version précédente).
 *
 * IDENTITÉ DU TABLEAU (2026-07-30, mesure CPU). L'identité des calques était
 * déjà préservée, mais le `layers.map(...)` rendait un tableau NEUF à chaque
 * appel, y compris quand rien n'avait changé : `setLayers()` voyait donc
 * toujours une valeur différente, React re-rendait l'arbre entier, et toute
 * mémoïsation en aval était inopérante par construction. Les deux mémos
 * ci-dessous rendent la projection stable PAR IDENTITÉ tant que la source ne
 * change pas d'identité — un appel sans changement rend LE MÊME tableau, donc
 * `setLayers()` bail-out sans re-render.
 *
 * HYPOTHÈSE (celle de tout le projet, pas une nouvelle) : les calques et le
 * tableau qui les porte sont REMPLACÉS, jamais mutés en place —
 * `LayerStack.clone()` fabrique des conteneurs frais à chaque commit, et les
 * chemins vivants (`replaceLiveLayers`) construisent un tableau neuf. Une
 * mutation en place d'un calque déjà projeté rendrait la projection périmée
 * (elle casserait déjà `React.memo` sur `LayerRow` aujourd'hui, pour la même
 * raison). Les mémos sont des `WeakMap` : rien n'est retenu au-delà de la vie
 * des objets sources.
 */
const strippedByLayer = new WeakMap<LayerState, LayerState>();
const projectionByLayers = new WeakMap<LayerState[], LayerState[]>();

function stripRasters(layer: LayerState): LayerState {
  const hasRaster = layer.mask.sources.some((s) => s.raster !== null && s.raster.length > 0);
  if (!hasRaster) return layer;
  const cached = strippedByLayer.get(layer);
  if (cached) return cached;
  const stripped: LayerState = {
    ...layer,
    mask: {
      ...layer.mask,
      sources: layer.mask.sources.map((s) =>
        s.raster && s.raster.length > 0 ? { ...s, raster: new Uint8Array(0) } : s
      ),
    },
  };
  strippedByLayer.set(layer, stripped);
  return stripped;
}

export function toDisplayLayers(layers: LayerState[]): LayerState[] {
  const cached = projectionByLayers.get(layers);
  if (cached) return cached;
  const projected = layers.map(stripRasters);
  // Aucun calque n'a eu besoin d'être vidé -> on rend le tableau SOURCE
  // lui-même : une allocation de moins, et une identité qui suit exactement
  // celle de la pile.
  const result = projected.every((l, i) => l === layers[i]) ? layers : projected;
  projectionByLayers.set(layers, result);
  return result;
}
