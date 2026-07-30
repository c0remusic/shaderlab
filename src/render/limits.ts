/**
 * Fail-fast AVANT createTexture : dépasser maxTextureDimension2D ferait
 * échouer la création avec une erreur de validation WebGPU générique
 * (souvent invisible côté JS). Un panorama > limite doit produire un
 * message clair, pas un canvas noir.
 */
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
 * CALIBRAGE (mesures du projet, 2026-07-28/29) :
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
 * Ce que la borne autorise sur la photo de référence (6240 × 4160) : carré
 * 38,9 Mpx, 4:5 orienté 31,2 Mpx, A3 à 300 dpi 17,4 Mpx. Les trois formats
 * proposés à l'ouverture passent — c'est cette contrainte qui a fixé l'arrondi.
 *
 * CRITÈRE DE RÉVISION (écrit ici, pas ailleurs) : re-mesurer la VRAM avec une
 * toile STRICTEMENT plus grande que les photos. Le protocole existant mesure
 * toile ≡ photo, donc un autre produit (voir T3 du design). Si la mesure dépasse
 * 90 % à 64 Mpx, cette borne DESCEND ; si elle reste sous 70 %, elle peut
 * monter. Jamais extrapolée : toujours re-mesurée.
 *
 * INDÉPENDANTE de `assertImageFitsGpu`, qui borne la dimension maximale d'une
 * texture et non le budget. Les deux s'appliquent, aucune ne remplace l'autre.
 */
export const MAX_CANVAS_PIXELS = 64_000_000;

/** Refuse une toile dont la SURFACE dépasse le budget nommé. Lève plutôt que de
 *  rogner : une toile silencieusement réduite ferait un export aux mauvaises
 *  dimensions, et l'utilisateur ne l'apprendrait qu'en ouvrant le fichier.
 *
 *  Appelée aux DEUX bouts, volontairement : à la dérivation d'un format
 *  (`layers/canvasFormat.ts`, pour refuser avant toute allocation) et dans
 *  `ImageFrameResources.allocateCanvas` (pour qu'aucun chemin d'allocation, y
 *  compris un futur appelant qui contournerait la dérivation, ne puisse
 *  dépasser le budget). */
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
