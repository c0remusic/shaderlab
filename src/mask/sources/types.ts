export interface MaskSourceModule {
  id: "gradient" | "luminosity" | "colorRange";
  name: string;
  /** Valeurs par défaut de `MaskSource.params` pour ce type — jamais un
   *  objet vide (voir mask/types.ts, la règle "params reste null tant que
   *  non implémenté" ne s'applique plus à ces 3 types après cette tâche). */
  defaultParams: Record<string, number | number[]>;
  /** WGSL définissant `fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32`.
   *  `uv` = coordonnées image [0,1]. `colorLinear` = couleur de la photo
   *  ORIGINALE (pas le calque en cours d'édition — la génération est
   *  ancrée sur l'image source, indépendante de l'empilement d'effets,
   *  cohérent avec "les sources décrivent une région de la photo").
   *  `params` = tableau fixe de 8 floats (même contrat que
   *  effects/types.ts `MAX_EFFECT_PARAMS`) — l'appelant sérialise
   *  `MaskSource.params` dans cet ordre fixe par type, documenté dans
   *  chaque module. Retourne la contribution masque brute, 0..1. */
  wgsl: string;
}
