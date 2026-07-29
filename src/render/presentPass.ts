import { FULLSCREEN_VERTEX_WGSL, SRGB_HELPERS_WGSL } from "./shaderCompose";

/**
 * Où vit la séparation « alpha à l'écran / opaque à l'export ».
 *
 * La chaîne de compositing produit un alpha DROIT réellement composé
 * (`shaderCompose.ts`, tranche T0 du design 2026-07-28). Aucune des deux
 * surfaces finales ne sait le consommer :
 *  - le canvas est configuré `alphaMode: "opaque"` (`gpuContext.ts`) — l'alpha
 *    y serait ignoré, une zone non couverte s'afficherait en noir ;
 *  - l'export encode en JPEG via `putImageData` + `convertToBlob`
 *    (`export/exportImage.ts`) — un JPEG n'a PAS de canal alpha, et la
 *    spécification HTML compose alors sur du NOIR, en silence. Un alpha 0 qui
 *    arrive jusque-là produit un JPEG entièrement noir sans le moindre message.
 *
 * Cette passe est le SEUL endroit qui écrit l'une ou l'autre de ces surfaces
 * (voir `Renderer.runPipeline`) : elle aplatit le composite sur un fond opaque
 * et sort toujours `alpha = 1`. Le fond diffère — damier à l'écran, noir à
 * l'export — et ce choix n'est pas un paramètre laissé à l'appelant : il est
 * dérivé de la DESTINATION par `presentBackgroundFor`, si bien qu'aucun site
 * d'appel ne peut demander « le damier, dans le fichier exporté ».
 *
 * Deuxième verrou, en aval et indépendant : `assertOpaqueForJpeg`
 * (`export/exportImage.ts`) refuse d'encoder un pixel non opaque. Si quelqu'un
 * court-circuite un jour cette passe sur le chemin d'export, il obtient une
 * exception nommée, jamais un JPEG noir.
 */
export type PresentBackground = "checker" | "black";

/** Surface finale d'un rendu. Le type existe pour que le fond d'aplatissement
 *  ne soit JAMAIS choisi à la main par un appelant — voir
 *  `presentBackgroundFor`. */
export type PresentDestination = { kind: "canvas" } | { kind: "export" };

/** Unique mapping destination → fond d'aplatissement. Le damier est un rendu
 *  d'ÉCRAN, jamais un contenu de fichier (design 2026-07-28 §3.2). */
export function presentBackgroundFor(destination: PresentDestination): PresentBackground {
  return destination.kind === "canvas" ? "checker" : "black";
}

/**
 * Unique mapping destination → overlay de masque autorisé. Même statut que
 * `presentBackgroundFor`, pour la même raison : l'overlay safelight (voile
 * rouge + contour animé) est une AIDE DE VISÉE, exactement comme le damier
 * est un fond d'écran. Ni l'un ni l'autre n'est un contenu de fichier.
 *
 * Défaut mesuré le 2026-07-29 par `scripts/render-check.mjs --diagnostic` :
 * `exportFrame` passait `Renderer.maskOverlayLayerId` tel quel à
 * `FramePipelineExecutor.run`, donc exporter pendant un aperçu de masque
 * écrivait le safelight DANS le JPEG — 19,6 % des canaux de l'image, sans le
 * moindre avertissement. L'utilisateur ne s'en apercevait qu'en rouvrant le
 * fichier.
 *
 * `activeLayerId` est l'état d'interface courant (`setMaskOverlay`) ; le
 * retour est ce que la DESTINATION autorise à en faire. Aucun site d'appel ne
 * peut donc demander « l'overlay, dans le fichier exporté » : la seule chose
 * qu'un appelant fournit est un `PresentDestination`, type fermé à deux cas.
 */
export function maskOverlayFor(
  destination: PresentDestination,
  activeLayerId: string | null,
): string | null {
  return destination.kind === "canvas" ? activeLayerId : null;
}

/** Côté d'une case du damier, en pixels de la texture de destination (donc en
 *  pixels du canvas, pas de l'image affichée à l'échelle). Valeur de confort,
 *  pas un token de design : le damier n'existe pas dans le DOM et n'a aucun
 *  équivalent en CSS dans ce projet. */
export const CHECKER_CELL_PX = 8;

export function buildPresentWgsl(background: PresentBackground): string {
  // `in.position.xy` = coordonnées en pixels de la cible — le damier est donc
  // aligné sur la grille de la destination, pas sur l'UV de l'image.
  const backgroundExpr = background === "checker"
    ? `let cell = floor(in.position.xy / ${CHECKER_CELL_PX}.0);
  let odd = step(0.5, fract((cell.x + cell.y) * 0.5));
  // Gris posés en valeurs sRGB puis décodés : la cible est une texture -srgb,
  // le fragment doit sortir du linéaire (aucun gamma manuel sur les couleurs
  // du pipeline, seulement sur ces deux constantes d'interface).
  let bg = srgb2lin(mix(vec3<f32>(1.0), vec3<f32>(0.8), odd));`
    : `let bg = vec3<f32>(0.0);`;

  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var presentSrc: texture_2d<f32>;
@group(0) @binding(1) var presentSampler: sampler;

${SRGB_HELPERS_WGSL}

@fragment
fn fs_present(in: VertexOut) -> @location(0) vec4<f32> {
  let src = textureSample(presentSrc, presentSampler, in.uv);
  ${backgroundExpr}
  // Source-over d'un composite à alpha DROIT sur un fond OPAQUE : l'alpha de
  // sortie vaut 1 par construction, quelle que soit l'entrée.
  //
  // IDENTITÉ (non-régression) : avec src.a = 1 — le seul cas qui existe tant
  // que la toile porte la photo — ceci rend src.rgb inchangé, pour les DEUX
  // fonds. Un export avant/après ce changement doit donc être identique.
  return vec4<f32>(src.rgb * src.a + bg * (1.0 - src.a), 1.0);
}
`;
}

/**
 * Aplatit le composite (alpha droit) sur un fond opaque, dans la surface
 * finale. Une passe plein écran de plus par frame — le prix du damier, assumé
 * à l'arbitrage du 2026-07-28.
 */
export class PresentPass {
  private readonly pipelineCache = new Map<
    PresentBackground,
    { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout }
  >();

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly sampler: GPUSampler,
  ) {}

  clearPipelines(): void {
    this.pipelineCache.clear();
  }

  encode(
    encoder: GPUCommandEncoder,
    sourceView: GPUTextureView,
    targetView: GPUTextureView,
    background: PresentBackground,
  ): void {
    let cached = this.pipelineCache.get(background);
    if (!cached) {
      const module = this.device.createShaderModule({ code: buildPresentWgsl(background) });
      const bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        ],
      });
      const pipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_present", targets: [{ format: this.srgbFormat }] },
      });
      cached = { pipeline, bindGroupLayout };
      this.pipelineCache.set(background, cached);
    }
    const bindGroup = this.device.createBindGroup({
      layout: cached.bindGroupLayout,
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: this.sampler },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(cached.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
}
