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
  duotone: "Couleur",
  channelMixer: "Couleur",
  curves: "Couleur",
  gradientMap: "Couleur",
  hatching: "Impression",
  halftone: "Impression",
  dither: "Impression",
  outlines: "Impression",
  isolines: "Impression",
  grain: "Texture",
  texture: "Texture",
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
