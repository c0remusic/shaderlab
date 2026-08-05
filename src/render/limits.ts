/**
 * Fail-fast AVANT createTexture : dépasser maxTextureDimension2D ferait
 * échouer la création avec une erreur de validation WebGPU générique
 * (souvent invisible côté JS). Un panorama > limite doit produire un
 * message clair, pas un canvas noir.
 */
/**
 * `maxTextureDimension2D` par DÉFAUT de la spec WebGPU.
 *
 * C'est la valeur réelle sur ce projet, pas un minorant prudent : shaderlab ne
 * passe aucun `requiredLimits` à `requestDevice`, donc le device reçoit les
 * limites par défaut quelle que soit la carte — une RTX qui sait faire 16384 en
 * expose 8192 ici. Conséquence pratique pour la bibliothèque de textures : un
 * scan « 8K » carré (8192 × 8192) passe EXACTEMENT à la limite, et 8193 est
 * refusé par `assertImageFitsGpu`.
 *
 * N'est PAS la source de vérité — `Renderer.maxTextureDimension` lit le device.
 * Sert de valeur d'attente là où l'interface doit afficher quelque chose avant
 * que le renderer existe (premier rendu de React). Un repli sur une valeur PLUS
 * GRANDE laisserait proposer une texture que l'import refuserait ensuite.
 */
export const DEFAULT_MAX_TEXTURE_DIMENSION = 8192;

export function assertImageFitsGpu(width: number, height: number, maxDimension: number): void {
  if (width > maxDimension || height > maxDimension) {
    throw new Error(
      `Image ${width}×${height} px trop grande pour ce GPU (limite ${maxDimension}×${maxDimension} px).`
    );
  }
}

/**
 * BORNE NOMMÉE DU BUDGET VRAM D'UNE TOILE — même statut que `MAX_PHOTO_LAYERS`
 * (`layers/photoLayer.ts`) : un plafond adossé à une mesure, pas à une
 * intuition. Posée par la tranche T2 du design
 * `docs/superpowers/specs/2026-07-29-shaderlab-toile-de-montage-design.md`
 * (§5.2), qui exigeait qu'une toile réglable ne soit pas un chèque en blanc.
 *
 * CALIBRAGE D'ORIGINE (mesures du projet, 2026-07-28/29) — conservé parce que
 * c'est lui que la mesure de T3 est venue vérifier :
 *  - À 5 photos de 26 Mpx, toile ≡ photo : 42,2 % de la VRAM.
 *  - Pire cas des sources mesuré : 67,8 % sur une carte de 6 Go, soit 4,07 Go.
 *  - Marge jusqu'à un plafond de sécurité de 90 % : 22,2 % ≈ 1,33 Go.
 *  - Coût d'un pixel de toile : au moins CINQ textures pleine toile (la toile,
 *    la paire de ping-pong, la cible d'export, la cible partagée de la pré-passe
 *    photo — design §5.1) × 4 octets = 20 o/px. Les allocations résidentes de
 *    `MaskTextureResolver` n'ont jamais été dénombrées : facteur de sûreté ×1,5
 *    → 30 o/px.
 *  - 1,33 Go / 30 o/px ≈ 44 Mpx de toile EN PLUS des 26 Mpx déjà mesurés, soit
 *    un plafond calculé de ~70 Mpx. Arrondi À LA BAISSE à 64 Mpx (8000 × 8000) :
 *    mémorable, et ~10 % de marge sous le calcul.
 *
 * ✅ MESURÉ À 64 Mpx le 2026-07-30 (tranche T3, RTX 2060 6144 Mo, toile libre
 * 8000 × 8000 = 64,0 Mpx, photos 6240 × 4160 toutes distinctes par MD5) :
 *  - Nominal, 5 calques photo : coût du document **2393 à 2597 Mo** sur quatre
 *    passes. C'est **~2× le coût à toile ≡ photo** (1275 Mo, mesuré le même jour
 *    au même instrument), pour 2,5× la surface de toile — le facteur de sûreté
 *    ×1,5 du calcul ci-dessus n'était donc pas de trop, mais il n'était pas
 *    excessif non plus.
 *  - **Pire cas des sources (le cas qui décide) : 4108 Mo, reproduit à
 *    l'identique sur deux passes**, garde levée exactement à 20/20. Rapporté à
 *    la ligne de base système du protocole (~1170 Mo), cela fait **~84 % de la
 *    VRAM** — contre 67,8 % à toile ≡ photo. Aucun `device.lost`.
 *  - Conclusion : la borne de 64 Mpx TIENT, et elle ne peut plus monter. Le
 *    couple (toile 64 Mpx, plafond de 5 calques) consomme désormais presque
 *    toute la marge d'une carte de 6 Go dans son pire cas.
 * Détail chiffré, passes, et ce que la mesure ne couvre pas :
 * `docs/superpowers/specs/2026-07-28-shaderlab-fond-comme-calque-design.md`
 * §4.5.
 *
 * Ce que la borne autorise sur la photo de référence (6240 × 4160) : carré
 * 38,9 Mpx, 4:5 orienté 31,2 Mpx, A3 à 300 dpi 17,4 Mpx. Les trois formats
 * proposés à l'ouverture passent — c'est cette contrainte qui a fixé l'arrondi.
 *
 * CRITÈRE DE RÉVISION (écrit ici, pas ailleurs) : la mesure toile ≠ photo qu'il
 * réclamait A ÉTÉ FAITE (T3, ci-dessus). Le critère lui-même ne change pas et
 * reste la règle pour la prochaine fois : si une mesure dépasse 90 % à 64 Mpx,
 * cette borne DESCEND ; si elle reste sous 70 %, elle peut monter. Le pire cas
 * mesuré vaut ~84 % : ni l'un ni l'autre, donc **la borne reste à 64 Mpx**, et
 * « elle peut monter » est désormais RÉFUTÉ, pas seulement non prouvé.
 * Corollaire mesuré, à ne pas perdre : cette borne et `MAX_PHOTO_LAYERS` sont
 * COUPLÉES par le pire cas des sources — aucune des deux ne peut monter sans
 * que l'autre descende. Jamais extrapolée : toujours re-mesurée.
 *
 * INDÉPENDANTE de `assertImageFitsGpu`, qui borne la dimension maximale d'une
 * texture et non le budget. Les deux s'appliquent, aucune ne remplace l'autre.
 */
export const MAX_CANVAS_PIXELS = 64_000_000;

/** Refuse une toile dont la SURFACE dépasse le budget nommé. Lève plutôt que de
 *  rogner : une toile silencieusement réduite ferait un export aux mauvaises
 *  dimensions, et l'utilisateur ne l'apprendrait qu'en ouvrant le fichier.
 *
 *  UN SEUL SITE D'APPEL, et c'est une contrainte : `canvasSizeFor`
 *  (`layers/canvasFormat.ts`), pour les formats que l'utilisateur a CHOISIS.
 *  Le message parle de « Toile » et de « budget » — il n'est donc adressable
 *  qu'à quelqu'un qui a choisi une toile.
 *
 *  Le second site d'appel qu'avait la tranche T2 (`allocateCanvas`) a été
 *  RETIRÉ le 2026-07-30 : il ne voyait qu'une dimension, donc il refusait
 *  aussi les photos de plus de 64 Mpx, qui s'ouvraient avant T2. Ne pas le
 *  remettre « pour verrouiller tous les chemins » sans avoir d'abord résolu
 *  comment il distinguerait une toile demandée d'une photo décodée : c'est
 *  précisément ce que cet étage ne peut pas savoir (ADR-0007). */
export function assertCanvasWithinBudget(width: number, height: number): void {
  const pixels = width * height;
  if (pixels > MAX_CANVAS_PIXELS) {
    throw new Error(
      `Toile ${width}×${height} px = ${(pixels / 1e6).toFixed(1)} Mpx, au-delà du budget de ` +
        `${(MAX_CANVAS_PIXELS / 1e6).toFixed(0)} Mpx (au moins cinq textures pleine toile en VRAM — ` +
        "voir MAX_CANVAS_PIXELS dans render/limits.ts).",
    );
  }
}
