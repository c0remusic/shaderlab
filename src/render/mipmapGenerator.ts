import { FULLSCREEN_VERTEX_WGSL } from "./shaderCompose";

/**
 * GÉNÉRATION DE MIPMAPS pour les textures de bibliothèque.
 *
 * POURQUOI CE FICHIER EXISTE (constat du 2026-08-14). `textureLibraryStore`
 * créait ses textures sans `mipLevelCount`, donc avec UN SEUL niveau. Les scans
 * montent jusqu'à 8192x8192 et sont échantillonnés à l'échelle de l'écran, soit
 * un rapport de l'ordre de 1:8. Sans mipmap, deux pixels voisins à l'écran
 * lisent des texels distants de huit texels en mémoire : le cache de texture ne
 * sert quasiment à rien, chaque prélèvement part en VRAM. Et ça aliase — un
 * scan de papier réduit sans mip scintille.
 *
 * ⚠️ CE DÉFAUT NE POUVAIT PAS ÊTRE ATTRAPÉ PAR UN TEST. Un `createTexture` sans
 * `mipLevelCount` compile, valide, et rend une image correcte ; les références
 * de pixels ont été figées AVEC ce défaut, donc l'absence de mip fait partie de
 * ce qui est verrouillé. Un test compare à ce qui existe, jamais à ce qui serait
 * possible.
 *
 * WebGPU n'a AUCUNE génération de mipmaps intégrée, contrairement à WebGL
 * (`generateMipmap`). Il faut la chaîne de blits ci-dessous : chaque niveau est
 * rendu depuis le précédent par un triangle plein écran en échantillonnage
 * linéaire, ce qui fait la moyenne de 2x2 texels.
 *
 * LE FORMAT FAIT LE TRAVAIL DE COULEUR, comme partout ailleurs dans ce dépôt.
 * La source et la cible sont des vues sRGB : l'échantillonnage DÉCODE vers le
 * linéaire, la moyenne se fait donc en linéaire, et l'écriture RÉ-ENCODE. C'est
 * la seule façon correcte de réduire une image, et elle est gratuite ici — un
 * `mix` manuel en WGSL serait mathématiquement faux pour la même raison que
 * l'invariant sRGB de `gpuContext.ts`.
 */

const MIPMAP_WGSL = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

@fragment
fn fs_mip(in: VertexOut) -> @location(0) vec4<f32> {
  return textureSample(srcTexture, srcSampler, in.uv);
}
`;

/** Nombre de niveaux d'une pyramide complète : on descend jusqu'au 1x1. */
export function mipLevelCountFor(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

export class MipmapGenerator {
  private pipeline: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private sampler: GPUSampler | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
  ) {}

  /**
   * Remplit les niveaux 1..N-1 de `texture` depuis son niveau 0.
   *
   * La texture DOIT porter `RENDER_ATTACHMENT` en plus de `TEXTURE_BINDING`
   * (chaque niveau est une cible de rendu) et avoir été créée avec son
   * `mipLevelCount` définitif — un niveau ne s'ajoute pas après coup.
   *
   * Encode et soumet son propre command buffer : appelée une fois au
   * chargement d'un scan, jamais dans la boucle de frame.
   */
  generate(texture: GPUTexture): void {
    if (texture.mipLevelCount <= 1) return;
    this.ensureResources();
    const encoder = this.device.createCommandEncoder();
    for (let niveau = 1; niveau < texture.mipLevelCount; niveau++) {
      // Vue SOURCE bornée au niveau précédent. Sans `mipLevelCount: 1`, la vue
      // porterait toute la pyramide et le sampler pourrait lire un niveau qu'on
      // n'a pas encore écrit — une dépendance lecture/écriture sur la même
      // ressource, que WebGPU refuse.
      const source = texture.createView({
        baseMipLevel: niveau - 1,
        mipLevelCount: 1,
      });
      const cible = texture.createView({ baseMipLevel: niveau, mipLevelCount: 1 });
      const bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout!,
        entries: [
          { binding: 0, resource: source },
          { binding: 1, resource: this.sampler! },
        ],
      });
      const passe = encoder.beginRenderPass({
        colorAttachments: [
          { view: cible, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      passe.setPipeline(this.pipeline!);
      passe.setBindGroup(0, bindGroup);
      passe.draw(3);
      passe.end();
    }
    this.device.queue.submit([encoder.finish()]);
  }

  private ensureResources(): void {
    if (this.pipeline) return;
    // Sampler PROPRE au générateur, et non celui du renderer : celui-ci doit
    // rester en `mipmapFilter` neutre pendant la construction, puisqu'il n'y a
    // par définition qu'un seul niveau lisible à chaque étape.
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    const module = this.device.createShaderModule({ code: MIPMAP_WGSL });
    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_mip", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
    });
  }
}
