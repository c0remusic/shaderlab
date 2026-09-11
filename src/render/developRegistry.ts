import type { EffectModule } from "./effects/types";
import { validateEffect } from "./effects/validate";
import { etalonnage } from "./effects/etalonnage";
import { reglagesDeBase } from "./effects/reglagesDeBase";
import { hsl } from "./effects/hslDevelop";

/**
 * REGISTRE DE L'ÉTAGE DE DÉVELOPPEMENT (ticket 03 lightroom-develop).
 *
 * Les modules de l'étage sont des `EffectModule` — le MÊME contrat, le même
 * shader, le même `ParamPanel` — mais ils vivent ICI et non dans
 * `effects/registry.ts` : ils ne sont PAS choisissables comme calque. C'est
 * exactement le statut de `PASSTHROUGH_EFFECT` (« résolu mais hors du registre
 * des effets ») : `getEffect` sait les résoudre par id (pour que `ParamPanel` et
 * le moteur composent leur shader), mais `effectRegistry` — le tableau qui
 * alimente le sélecteur « ajouter un effet » — ne les contient pas.
 *
 * DEUX LISTES, PAS UNE, et elles ne coïncident pas — c'est le modèle de
 * Lightroom :
 *
 *  - `developApplyOrder` : l'ordre d'APPLICATION au composite. Lightroom applique
 *    l'Étalonnage EN PREMIER (c'est l'entrée du système de couleur), puis
 *    Réglages de base → Courbe → HSL → Color Grading → Détail → Effets. Cet
 *    ordre est GELÉ par une référence de rendu (`developpement-apres-pile`),
 *    au même titre que la famille des halos est gelée par `lensDistortion.test`.
 *
 *  - `developDisplayOrder` : l'ordre d'AFFICHAGE des panneaux dans la carte
 *    « Développement ». Lightroom montre Réglages de base, Courbe, HSL, Color
 *    Grading, Détail, Effets, PUIS Étalonnage — l'inverse (presque) de l'ordre
 *    d'application. C'est délibéré : on règle du plus courant au plus rare, on
 *    APPLIQUE du plus fondamental au plus cosmétique.
 *
 * TRANCHE 2 : `etalonnage` (ticket 01) et `reglagesDeBase` (ticket 02, le ton et
 * la courbe paramétrique en un seul effet). Les deux listes DIVERGENT désormais :
 * Lightroom APPLIQUE l'étalonnage en premier (il définit les primaires en
 * entrée), le ton vient après ; mais il AFFICHE les Réglages de base en tête du
 * panneau et l'Étalonnage tout en bas. Les modules suivants (HSL, Color Grading,
 * Détail, Vignettage) prendront chacun leur place dans CHACUNE des deux listes.
 */

/** Ordre d'APPLICATION au composite (fin de chaîne) : Étalonnage (primaires)
 *  PUIS Réglages de base (ton) PUIS HSL. Lightroom applique le HSL APRÈS le ton
 *  (une bande agit sur des couleurs déjà exposées et contrastées). */
export const developApplyOrder: readonly EffectModule[] = [etalonnage, reglagesDeBase, hsl];

/** Ordre d'AFFICHAGE des panneaux dans la carte « Développement » : Réglages de
 *  base, HSL, puis Étalonnage en bas (comme Lightroom). */
export const developDisplayOrder: readonly EffectModule[] = [reglagesDeBase, hsl, etalonnage];

/** Ensemble CANONIQUE des modules de l'étage, sans doublon — pour la validation
 *  au chargement et pour les gardes qui les énumèrent (câblage, WGSL, densité).
 *  Dérivé des deux listes ci-dessus, pas recopié : un module présent dans l'une
 *  et pas l'autre serait une erreur de déclaration, jamais un module qui échappe
 *  aux gardes. */
export const developModules: readonly EffectModule[] = (() => {
  const vus = new Map<string, EffectModule>();
  for (const module of [...developApplyOrder, ...developDisplayOrder]) {
    vus.set(module.id, module);
  }
  return [...vus.values()];
})();

// Même garde que `effectRegistry.forEach(validateEffect)` : un module de l'étage
// est validé exactement comme un effet de calque (bornes, sections, câblage des
// contrôles). Il n'échappe à rien parce qu'il n'est pas « un effet choisissable ».
developModules.forEach(validateEffect);

/** Résout un module de l'étage par son id, ou `undefined`. Consommé par
 *  `getEffect` (registry.ts), sur le modèle de la résolution de `passthrough`. */
export function getDevelopModule(id: string): EffectModule | undefined {
  return developModules.find((module) => module.id === id);
}

/**
 * Le module `module` est-il à SON défaut, aux valeurs `values` ?
 *
 * C'EST LE GATE DISCRIMINANT DE L'ÉTAGE. Un module au défaut n'émet AUCUNE passe
 * (`FramePipelineExecutor`), donc le composite est byte-identique à ce qu'il
 * était sans étage — ce qui garde `test:render` à zéro écart sur toutes les
 * références existantes tant qu'aucun réglage n'est posé. La comparaison se fait
 * aux DÉFAUTS déclarés du module, jamais à zéro : un paramètre dont le défaut
 * n'est pas 0 (un jour) doit compter comme « au défaut » à sa valeur par défaut.
 *
 * `values` absent (module jamais réglé) = au défaut, trivialement.
 */
export function isDevelopModuleAtDefault(
  module: EffectModule,
  values: Record<string, number> | undefined,
): boolean {
  if (!values) return true;
  return module.params.every((param) => (values[param.name] ?? param.default) === param.default);
}
