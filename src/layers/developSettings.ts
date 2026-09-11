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

/**
 * CLÉ RÉSERVÉE de `DevelopSettings` portant l'ÉTAT D'ACTIVATION de chaque module
 * (l'œil de l'accordéon Lightroom, ticket 07). Elle vit DANS `DevelopSettings`
 * plutôt qu'en champ séparé pour une raison de plomberie : l'objet develop
 * traverse déjà renderer → executor, History (clone) et les presets (capture)
 * SANS modification à chacune de ces frontières. Un second champ aurait dû être
 * threadé à chacune ; une sous-entrée réservée voyage gratuitement.
 *
 * ⚠️ Ce n'est PAS l'id d'un module — aucun module de l'étage ne s'appelle ainsi
 * (ids : `reglagesDeBase`, `hsl`, `etalonnage`). Les boucles qui itèrent les
 * modules réels (`runDevelopStage`, `DevelopPanel`) passent par
 * `developApplyOrder`/`developDisplayOrder`, jamais par `Object.keys(develop)`,
 * donc elles ne la voient pas. Le SEUL endroit qui itère les clés comme des
 * modules est l'application de preset (`presetDocument.ts`) : il la laisse
 * passer par un cas gardé explicite. Sa valeur est un `Record<moduleId, 0|1>`
 * (0 = désactivé), ce qui la fait rentrer dans le type sans le changer.
 *
 * ABSENCE = ACTIVÉ. Une clé absente, ou un module absent de la clé, vaut activé
 * (1) : les `DevelopSettings` existants (aucune clé) et toutes les références de
 * rendu restent donc byte-identiques — un module au défaut ET activé n'émet
 * aucune passe, exactement comme avant.
 */
export const DEVELOP_ENABLED_KEY = "__moduleEnabled";

/** Le module `moduleId` est-il ACTIF ? Absent = actif (voir `DEVELOP_ENABLED_KEY`). */
export function isDevelopModuleEnabled(develop: DevelopSettings, moduleId: string): boolean {
  return (develop[DEVELOP_ENABLED_KEY]?.[moduleId] ?? 1) !== 0;
}

/** Rend un `DevelopSettings` FRAIS où `moduleId` porte l'activation `enabled`.
 *  N'écrit une valeur explicite (0/1) que ce qu'il faut : une remise à ACTIF
 *  d'un module jamais désactivé n'ajoute pas la clé, pour que le cas nominal
 *  (tout activé) reste sans clé et donc byte-identique. */
export function setDevelopModuleEnabled(develop: DevelopSettings, moduleId: string, enabled: boolean): DevelopSettings {
  const current = develop[DEVELOP_ENABLED_KEY] ?? {};
  const next: Record<string, number> = { ...current };
  if (enabled) delete next[moduleId];
  else next[moduleId] = 0;
  const copy: DevelopSettings = { ...develop };
  if (Object.keys(next).length === 0) delete copy[DEVELOP_ENABLED_KEY];
  else copy[DEVELOP_ENABLED_KEY] = next;
  return copy;
}

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
