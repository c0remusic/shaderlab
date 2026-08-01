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
}
