import type { EffectModule } from "./types";
import { MAX_EFFECT_PARAMS } from "../shaderCompose";

/**
 * Fail-fast au chargement du registry. Sans cette validation, un effet
 * déclarant plus de MAX_EFFECT_PARAMS paramètres était TRONQUÉ en silence :
 * l'écriture hors-borne d'un Float32Array est un no-op, le shader lisait 0
 * pour les paramètres excédentaires — contraire au principe fail-fast du
 * projet.
 */
export function validateEffect(effect: EffectModule): void {
  if (effect.params.length > MAX_EFFECT_PARAMS) {
    throw new Error(
      `Effet "${effect.id}" : ${effect.params.length} paramètres déclarés, ` +
        `maximum ${MAX_EFFECT_PARAMS} (taille du uniform array<f32, ${MAX_EFFECT_PARAMS}> du shader). ` +
        `Élargir MAX_EFFECT_PARAMS et le header WGSL ensemble si nécessaire.`
    );
  }

  // Paramètres à choix discret (`EffectParam.choices`). Les bornes et le pas ne
  // sont pas décoratifs : le panneau lit la valeur comme un INDEX dans le
  // tableau d'étiquettes, et le shader la lit comme un entier. Une borne
  // désaccordée produirait un choix affiché qui ne correspond à rien dans le
  // shader, ou un état du shader que l'interface ne sait pas nommer — un échec
  // silencieux des deux côtés à la fois.
  for (const param of effect.params) {
    if (!param.choices) continue;
    if (param.choices.length < 2) {
      throw new Error(
        `Effet "${effect.id}", paramètre "${param.name}" : un paramètre à choix ` +
          `doit proposer au moins deux états (${param.choices.length} déclaré).`
      );
    }
    const attendu = { min: 0, step: 1, max: param.choices.length - 1 };
    if (param.min !== attendu.min || param.step !== attendu.step || param.max !== attendu.max) {
      throw new Error(
        `Effet "${effect.id}", paramètre "${param.name}" : bornes incompatibles avec ` +
          `ses ${param.choices.length} choix — attendu min=${attendu.min}, max=${attendu.max}, ` +
          `step=${attendu.step} ; déclaré min=${param.min}, max=${param.max}, step=${param.step}.`
      );
    }
    if (!Number.isInteger(param.default) || param.default < 0 || param.default > attendu.max) {
      throw new Error(
        `Effet "${effect.id}", paramètre "${param.name}" : défaut ${param.default} ` +
          `hors de l'intervalle des choix (0..${attendu.max}, entier).`
      );
    }
    if (param.colorGroup) {
      throw new Error(
        `Effet "${effect.id}", paramètre "${param.name}" : \`choices\` et \`colorGroup\` ` +
          `sont exclusifs — le panneau ne peut pas rendre un même paramètre des deux façons.`
      );
    }
  }

  // MAXIMUM DYNAMIQUE (`maxFrom`). Il ne peut que RESSERRER la course, jamais
  // l'élargir : `max` reste la borne que le panneau, les presets et toute
  // relecture prennent pour la vérité du paramètre. Un `maxFrom` au-dessus
  // rendrait un curseur qui va plus loin que ce que l'effet déclare — l'inverse
  // exact du défaut qu'il vient corriger. Vérifié sur les DÉFAUTS, seul jeu de
  // valeurs connu au chargement ; les autres sont bornés à l'usage par `Math.min`.
  const defauts: Record<string, number> = {};
  for (const p of effect.params) defauts[p.name] = p.default;
  for (const param of effect.params) {
    if (!param.maxFrom) continue;
    const effectif = param.maxFrom(defauts);
    if (!Number.isFinite(effectif) || effectif > param.max || effectif < param.min) {
      throw new Error(
        `Effet "${effect.id}", paramètre "${param.name}" : \`maxFrom\` rend ${effectif} ` +
          `aux valeurs par défaut, hors de l'intervalle déclaré ${param.min}..${param.max}. ` +
          `Un maximum dynamique resserre la course, il ne l'élargit pas.`
      );
    }
  }

  // MANIPULATEUR DE RÉGION (`canvasRegion`). Les trois noms doivent désigner de
  // vrais paramètres : sans cette garde, une faute de frappe ne lèverait rien et
  // le cercle ne s'afficherait simplement PAS sur la toile — un échec muet, et
  // le plus difficile à relier à sa cause puisque rien n'a l'air cassé.
  if (effect.canvasRegion) {
    const connus = new Set(effect.params.map((p) => p.name));
    for (const [role, nom] of Object.entries(effect.canvasRegion)) {
      if (!connus.has(nom)) {
        throw new Error(
          `Effet "${effect.id}" : \`canvasRegion.${role}\` désigne "${nom}", ` +
            `qui n'est pas un paramètre déclaré de cet effet.`
        );
      }
    }
  }
}
