/**
 * ÉTAGE DE DÉVELOPPEMENT — l'état pur, hors de tout GPU et de tout React.
 *
 * `DevelopSettings` porte les réglages de l'étage de développement du DOCUMENT
 * (portage du module *Develop* de Lightroom, ticket 03 de `.scratch/lightroom-
 * develop/`) : un jeu de valeurs par MODULE de l'étage, indexé par nom de module
 * puis par nom de paramètre. Un module absent, ou un paramètre absent, prend son
 * défaut déclaré (`developRegistry.ts`) — exactement comme un calque dont
 * `params` ne cite pas tous les paramètres de son effet.
 *
 * CE N'EST PAS UN CALQUE, et c'est tout le sens de l'étage. Antoine, 2026-09-11 :
 * « je ne veux pas que ce soit des "calques à effet", je veux que ce soit des
 * options permanentes pour modifier l'image », « en fin de chaîne, après tous
 * les calques ». L'étage s'applique au COMPOSITE de toute la pile, avant la
 * présentation et l'export — un seul pipeline. Voir `render/developRegistry.ts`
 * pour la liste ordonnée des modules et `render/framePipelineExecutor.ts` pour
 * l'endroit exact où il s'exécute.
 *
 * IL VIT SUR `LayerStack`, à côté de `cadre`, POUR LA MÊME RAISON : c'est l'état
 * que `History` prend en instantané, donc régler l'étage devient annulable par
 * le même Ctrl+Z, sans un second canal d'undo (précédent : le recadrage,
 * ticket 32). Aucun raster n'y entre — `displayLayers()` est inchangé, l'invariant
 * anti-OOM tient.
 */
export type DevelopSettings = Record<string, Record<string, number>>;

/** Copie PROFONDE d'un `DevelopSettings` — chaque sous-objet est frais, pour que
 *  muter le clone (un geste vivant, un `clone()` de `LayerStack`) ne réécrive
 *  jamais un instantané d'historique qui partagerait la référence. Même
 *  discipline que le `{ ...this.cadre }` de `LayerStack.clone()`. */
export function cloneDevelopSettings(develop: DevelopSettings): DevelopSettings {
  const copy: DevelopSettings = {};
  for (const moduleId of Object.keys(develop)) {
    copy[moduleId] = { ...develop[moduleId] };
  }
  return copy;
}
