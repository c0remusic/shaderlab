import type { EffectModule } from "./types";

export const EFFECT_CATEGORIES = [
  "Lumière",
  "Optique",
  "Déformation",
  "Couleur",
  "Impression",
  "Texture",
] as const;

export type EffectCategory = (typeof EFFECT_CATEGORIES)[number];

/** Taxonomie éditoriale : explicite et centralisée, jamais inférée du nom. */
export const effectCategoryById: Readonly<Record<string, EffectCategory>> = {
  glow: "Lumière",
  halation: "Lumière",
  lensFlare: "Lumière",
  lightLeak: "Lumière",
  lensDistortion: "Optique",
  lensBlur: "Optique",
  motionBlur: "Optique",
  glass: "Optique",
  warp: "Déformation",
  gooeyMerge: "Déformation",
  pixelStretch: "Déformation",
  sliceShift: "Déformation",
  // Avec `warp` et `glass`, dont il ne diffère que par la PROVENANCE du champ :
  // les deux le calculent, celui-ci le lit dans une image.
  displacementMap: "Déformation",
  duotone: "Couleur",
  channelMixer: "Couleur",
  curves: "Couleur",
  gradientMap: "Couleur",
  // ⚠️ La famille tonale, et non `Optique` près des flous dont il est l'inverse
  // spatial : cette table classe le MÉCANISME, et une accentuation n'est
  // produite par aucun verre. Arbitrage visible plutôt que rangement muet.
  nettete: "Couleur",
  hatching: "Impression",
  halftone: "Impression",
  dither: "Impression",
  outlines: "Impression",
  isolines: "Impression",
  // Le gaufrage est un procédé d'impression, et cet effet ne fabrique aucune
  // matière — il éclaire celle que l'image porte déjà. D'où Impression et non
  // Texture, où l'on aurait pu le ranger sur son seul nom.
  emboss: "Impression",
  grain: "Texture",
  texture: "Texture",
  // Pendant procédural de `texture` : il ne lit aucune image, il GÉNÈRE un champ
  // de bruit fractal. Matière fabriquée par le shader — sa place est ici.
  noise: "Texture",
  // ⚠️ PROTOTYPE (ticket 23). Rangé en Couleur et non en Texture : il ne
  // fabrique aucune matière, il pose UNE couleur — la question qu'il sert est
  // « de quoi une forme a-t-elle besoin », pas « quel grain ».
  aplat: "Couleur",
};

export interface EffectCatalogGroup {
  category: EffectCategory;
  effects: EffectModule[];
}

export function buildEffectCatalog(
  effects: readonly EffectModule[],
  query = "",
): EffectCatalogGroup[] {
  const registered = new Set(effects.map((effect) => effect.id));
  const declared = Object.keys(effectCategoryById);
  const missing = effects.filter((effect) => !effectCategoryById[effect.id]);
  const stale = declared.filter((id) => !registered.has(id));
  if (missing.length || stale.length) {
    throw new Error(`Catalogue d'effets invalide (sans catégorie: ${missing.map((e) => e.id).join(", ") || "aucun"}; inconnus: ${stale.join(", ") || "aucun"})`);
  }

  const needle = query.trim().toLocaleLowerCase("fr");
  return EFFECT_CATEGORIES.map((category) => ({
    category,
    effects: effects.filter((effect) =>
      effectCategoryById[effect.id] === category &&
      (!needle || effect.name.toLocaleLowerCase("fr").includes(needle)),
    ),
  })).filter((group) => group.effects.length > 0);
}
