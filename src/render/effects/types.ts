export interface EffectParam {
  name: string;
  label: string;
  unit?: "percent" | "pixels" | "degrees" | "none";
  hint?: string;
  min: number;
  max: number;
  default: number;
  step: number;
  /** Groups this param with its hue/saturation/lightness siblings (same `key`)
   *  under a single swatch + disclosure control in ParamPanel, instead of a
   *  standalone slider. All three roles must be present for a given `key` —
   *  ParamPanel throws otherwise (see groupEffectParams). */
  colorGroup?: { key: string; role: "hue" | "saturation" | "lightness"; label: string };
  /** Renders this param as a named CHOICE list instead of a slider. The param
   *  value stays a number — the index into this array — because the uniform is
   *  `array<f32, N>` and nothing else may cross that boundary.
   *
   *  Why a list and not a slider with `step: 1`. A slider labels its value with
   *  the number itself: a mode param would read "0" or "1" and say nothing about
   *  what either is. Distinct from `colorGroup`, which groups three CONTINUOUS
   *  params under one control; here a single param has discrete named states.
   *
   *  Reserved for genuinely discrete states — two settings of the SAME operation
   *  belong on a slider (see `channelMixer`'s `monochrome`, deliberately
   *  continuous so partial desaturations stay reachable). Use this when the
   *  intermediate values would model nothing. Validated by `validateEffect`:
   *  `min` must be 0, `step` 1, and `max` exactly `choices.length - 1`. */
  choices?: string[];
}

export interface EffectPass {
  /** Resolution scale of this pass's output target relative to the image (1 = full, 0.5 = half...). */
  scale: number;
  /** WGSL body defining fs_main(uv, color) — `color` samples this pass's INPUT texture (bound as
   *  srcTexture, same as any single-pass effect). Internal passes never see the mask or `prevPass`. */
  wgsl: string;
  /**
   * Cette passe sert-elle, aux paramètres courants ? Absent = toujours (le
   * comportement de tous les effets multi-passes écrits jusqu'ici).
   *
   * D'OÙ ÇA VIENT. `runInternalPasses` itérait `passes` sans condition, ce qui
   * allait tant qu'un effet multi-passes n'avait qu'un seul régime. Un effet à
   * MODES casse ce présupposé : `outlines` doit absorber `echoOutlines` (ADR-0013),
   * or celui-ci porte neuf passes de pyramide et le mode Contours n'en lit
   * aucune. Sans ce prédicat, choisir « Contours » ferait quand même tourner la
   * pyramide entière — sur 24 Mpx, la seule cible à l'échelle 0,5 pèse 24 Mo, et
   * la VRAM est un risque ouvert.
   *
   * ⚠️ CE N'EST PAS UNE OPTIMISATION, c'est une condition de correction du
   * modèle : une passe inutile n'est pas seulement lente, elle ALLOUE. Le
   * prédicat est donc évalué AVANT d'emprunter une cible au pool.
   *
   * ⚠️ SI TOUTES LES PASSES SAUTENT, la passe finale reçoit en `prevPass` la
   * texture SOURCE et non la sortie d'une pyramide. C'est cohérent (le
   * chaînage part de la source) mais le shader final doit être écrit en le
   * sachant : il ne doit lire `prevPass` que dans les modes dont les passes
   * tournent. Un mode qui lirait la source en croyant lire un champ flouté
   * rendrait n'importe quoi, sans erreur de compilation.
   *
   * Reçoit les paramètres RÉSOLUS (défauts appliqués), par nom.
   */
  enabled?: (params: Record<string, number>) => boolean;
}

export interface EffectModule {
  id: string;
  name: string;
  params: EffectParam[];
  /** WGSL fragment shader body. Must define fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32>
   *  and read params via the `params: array<f32, 8>` uniform (index order matches `params` above).
   *  Single-pass body (used directly when `passes` is absent). For multi-pass effects, this is the
   *  FINAL composite pass and additionally may sample `prevPass` (binding 4, the last internal
   *  pass's output) — this is also the only pass masking is applied to. */
  wgsl: string;
  /** Optional chain of internal passes run in order, each at its own resolution scale, before the
   *  final composite (`wgsl` above) runs. Each pass's input is the previous pass's output (the
   *  first pass's input is the layer's normal source texture). Masking is NOT applied to internal
   *  passes — only to the final composite. */
  passes?: EffectPass[];
  /**
   * Déclare qu'un DISQUE de cet effet se manipule directement sur la toile,
   * en nommant les paramètres qui le portent. `RegionHandles` en dessine alors
   * un cercle déplaçable, et le panneau garde ses curseurs.
   *
   * DÉCLARATIF ET NON DEVINÉ. La tentation était de repérer les paramètres au
   * nom (`regionX`/`centerX`…) : ça marche jusqu'au jour où un effet nomme
   * autrement, et ça échoue alors SANS RIEN DIRE — le manipulateur ne s'affiche
   * simplement pas. Ici, `validateEffect` vérifie que les trois noms existent
   * vraiment dans `params`, donc une faute de frappe lève au chargement du
   * registre.
   *
   * ⚠️ LES DEUX UNITÉS DIFFÈRENT, et `ui/regionHandles.ts` est le seul endroit
   * qui les convertit : le centre est en UV (0..1 du cadre), le rayon est en
   * espace ISOTROPE (pixels / sqrt(W*H)). Un effet qui exposerait un rayon en
   * UV ne peut pas se déclarer ici sans changer cette convention.
   */
  canvasRegion?: { centerX: string; centerY: string; radius: string };
}
