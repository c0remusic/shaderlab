import { MipmapGenerator, mipLevelCountFor } from "./mipmapGenerator";

/**
 * COPIE À PYRAMIDE de la source d'un calque, pour les effets qui déclarent
 * `EffectModule.sourceMipmaps`.
 *
 * ─── POURQUOI UNE COPIE, ET PAS LA CIBLE DE PING-PONG ELLE-MÊME ─────────────
 *
 * La voie évidente — donner un `mipLevelCount` aux cibles de ping-pong — a été
 * essayée le 2026-08-17 et écartée sur deux constats, dans cet ordre :
 *
 * 1. **Elle casse le rendu, et pas là où on l'attend.** Une vue de CIBLE DE
 *    RENDU doit porter exactement UN niveau ; `createView()` sur une texture à
 *    pyramide les porte tous. Les passes échouent alors en validation
 *    (« The mip level count (13) … used as attachment is greater than 1 ») et la
 *    frame sort NOIRE. Quatre sites étaient concernés — cible de calque, blit du
 *    court-circuit, overlay d'animation, destination d'export — et **aucun n'est
 *    signalé par `tsc`**. Ici, la texture n'est jamais une cible de rendu : seule
 *    sa propre chaîne de blits y écrit, niveau par niveau.
 * 2. **Elle fait payer tout le monde.** Les cibles sont allouées à l'ouverture du
 *    document, avant qu'on sache ce que la pile contient : leur donner une
 *    pyramide coûte ~33 % de VRAM par cible à toutes les piles, y compris celles
 *    qui n'ont aucun effet concerné. Ici l'allocation est à la demande — un
 *    document sans effet déclarant ne crée jamais cette texture.
 *
 * ─── CE QUE ÇA COÛTE, MESURÉ ────────────────────────────────────────────────
 *
 * Une copie pleine résolution (`copyTextureToTexture`, pas de passe de rendu)
 * plus la chaîne de blits, PAR IMAGE. Ordre de grandeur à 26 Mpx : la copie est
 * un transfert mémoire pur, et la pyramide écrit ~1/3 des pixels du niveau 0 —
 * ensemble sous la milliseconde, contre les **73 ms** que le niveau grossier
 * fait gagner à `glass` sur un Pavé quadrillé.
 *
 * ⚠️ La source DOIT porter `COPY_SRC`. Les cibles de ping-pong l'ont depuis
 * toujours ; la TOILE l'a reçu pour ce fichier — elle est la source du premier
 * calque de la pile, donc le cas « un seul calque, et c'est l'effet déclarant »
 * la faisait sinon échouer en validation, et lui seul.
 */
export class MippedSourceCache {
  private texture: GPUTexture | null = null;
  private mipmapsLazy: MipmapGenerator | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
  ) {}

  private get mipmaps(): MipmapGenerator {
    return (this.mipmapsLazy ??= new MipmapGenerator(this.device, this.format));
  }

  /**
   * Rend une vue de `source` portant une pyramide complète, remplie dans
   * `encoder` — donc valable pour les passes encodées APRÈS cet appel, dans la
   * même frame.
   *
   * La texture interne est réutilisée d'une frame à l'autre et réallouée
   * seulement si les dimensions changent. Deux calques déclarants dans la même
   * pile la partagent : chacun appelle à son tour, et l'ordre d'encodage garantit
   * que chacun lit ce qu'il a demandé (les passes d'un même encodeur s'exécutent
   * dans l'ordre de soumission — même raisonnement que la cible partagée des
   * calques photo dans `framePipelineExecutor`).
   */
  viewFor(encoder: GPUCommandEncoder, source: GPUTexture): GPUTextureView {
    const { width, height } = source;
    if (!this.texture || this.texture.width !== width || this.texture.height !== height) {
      this.texture?.destroy();
      this.texture = this.device.createTexture({
        size: [width, height],
        format: this.format,
        mipLevelCount: mipLevelCountFor(width, height),
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    encoder.copyTextureToTexture(
      { texture: source },
      { texture: this.texture },
      [width, height],
    );
    this.mipmaps.generate(this.texture, encoder);
    return this.texture.createView();
  }

  dispose(): void {
    this.texture?.destroy();
    this.texture = null;
  }
}
