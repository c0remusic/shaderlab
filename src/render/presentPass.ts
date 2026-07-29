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
export type PresentBackgroundKind = "checker" | "black";

/** Fond d'aplatissement, avec ce qu'il faut pour le dessiner. La taille de case
 *  vit DANS le cas `checker` : le cas `black` — le seul que l'export puisse
 *  obtenir — n'a aucun champ où la loger, donc « une taille de case, à
 *  l'export » n'est pas exprimable. Même garde par construction que
 *  `PresentDestination` lui-même. */
export type PresentBackground =
  | { kind: "checker"; cellPx: number }
  | { kind: "black" };

/** Surface finale d'un rendu. Le type existe pour que le fond d'aplatissement
 *  ne soit JAMAIS choisi à la main par un appelant — voir
 *  `presentBackgroundFor`.
 *
 *  `displayScale` = px CSS de mise en page par px de canvas (`rect.width /
 *  canvas.width`). Le canvas a la résolution NATIVE de l'image et est réduit
 *  par CSS ; sans ce facteur, une case de damier exprimée en px de destination
 *  fait moins d'un pixel à l'écran sur une photo de 6240 px de large — c'est
 *  exactement le défaut constaté après T1. Ce facteur est porté par le cas
 *  `canvas` et par lui seul : il n'existe aucune mise en page pour une cible
 *  d'export, et le type interdit d'en inventer une. */
export type PresentDestination =
  | { kind: "canvas"; displayScale: number }
  | { kind: "export" };

/** Unique mapping destination → fond d'aplatissement. Le damier est un rendu
 *  d'ÉCRAN, jamais un contenu de fichier (design 2026-07-28 §3.2). */
export function presentBackgroundFor(destination: PresentDestination): PresentBackground {
  return destination.kind === "canvas"
    ? { kind: "checker", cellPx: checkerCellPx(destination.displayScale) }
    : { kind: "black" };
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

/** Côté d'une case du damier, en **pixels CSS d'écran** — la seule unité dans
 *  laquelle « lisible mais discret » veut dire quelque chose. C'EST LE SEUL
 *  RÉGLAGE : le changer d'une ligne change la taille perçue, à toute résolution
 *  d'image et à tout facteur de réduction.
 *
 *  Ordre de grandeur Photoshop (grille de transparence : petite 8, moyenne 16) —
 *  12 se lit sans devenir le sujet de l'écran. Volontairement PAS multiplié par
 *  `devicePixelRatio` : la référence est le px CSS, comme tout le reste de
 *  l'interface, pour que le damier garde la même taille apparente que les
 *  contrôles autour de lui.
 *
 *  Valeur de confort, pas un token de design : le damier n'existe pas dans le
 *  DOM et n'a aucun équivalent en CSS dans ce projet. */
export const CHECKER_CELL_SCREEN_PX = 12;

/**
 * Côté d'une case en pixels de la DESTINATION, à partir du facteur de
 * réduction CSS du canvas. Arrondi à l'entier : une case non entière ferait
 * flotter ses bords entre deux pixels sans rien gagner en régularité.
 *
 * Lève plutôt que de replier sur une valeur par défaut : un facteur nul,
 * négatif ou non fini n'est pas une situation de rendu, c'est un appelant qui
 * n'a pas mesuré. Le seul appelant réel (`App.tsx`) filtre déjà les mesures de
 * largeur nulle, qu'un `ResizeObserver` produit légitimement sur un canvas pas
 * encore mis en page.
 */
export function checkerCellPx(displayScale: number): number {
  if (!Number.isFinite(displayScale) || displayScale <= 0) {
    throw new Error(`Facteur d'échelle d'affichage invalide: ${displayScale}`);
  }
  return Math.max(1, Math.round(CHECKER_CELL_SCREEN_PX / displayScale));
}

/** Uniforme de la passe damier : `x` = côté d'une case en px de destination.
 *  Un uniforme et pas une constante compilée dans le WGSL, parce que la valeur
 *  change à chaque redimensionnement de la fenêtre ou ouverture de panneau —
 *  la compiler recréerait un pipeline par largeur de fenêtre traversée. */
const CHECKER_UNIFORM_BYTES = 16;

export function buildPresentWgsl(background: PresentBackgroundKind): string {
  // `in.position.xy` = coordonnées en pixels de la cible — le damier est donc
  // aligné sur la grille de la destination, pas sur l'UV de l'image.
  const backgroundExpr = background === "checker"
    ? `let cell = floor(in.position.xy / max(checkerParams.x, 1.0));
  let odd = step(0.5, fract((cell.x + cell.y) * 0.5));
  // Gris posés en valeurs sRGB puis décodés : la cible est une texture -srgb,
  // le fragment doit sortir du linéaire (aucun gamma manuel sur les couleurs
  // du pipeline, seulement sur ces deux constantes d'interface).
  //
  // Paire SOMBRE, pas la paire claire de Photoshop : cette application est une
  // surface sombre de jugement photographique, et un damier quasi blanc y
  // serait l'objet le plus lumineux de l'écran — il fausserait l'adaptation de
  // l'œil, donc la lecture d'exposition des photos elles-mêmes, et passerait
  // devant les images en montage. Les deux gris reprennent des neutres réels
  // de la palette (primitives.css : --primitive-neutral-850 = #323232 et
  // --primitive-neutral-1000 = #1b1b1b), pour que le vide se lise comme le
  // châssis de l'app derrière la toile.
  let bg = srgb2lin(mix(vec3<f32>(0.196078), vec3<f32>(0.105882), odd));`
    : `let bg = vec3<f32>(0.0);`;

  const checkerUniform = background === "checker"
    ? `@group(0) @binding(2) var<uniform> checkerParams: vec4<f32>;`
    : "";

  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var presentSrc: texture_2d<f32>;
@group(0) @binding(1) var presentSampler: sampler;
${checkerUniform}

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
    PresentBackgroundKind,
    { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout }
  >();
  /** Alloué à la PREMIÈRE présentation en damier, jamais sur le chemin
   *  d'export : le pipeline `black` n'a pas de binding 2 du tout. */
  private checkerUniform: GPUBuffer | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly sampler: GPUSampler,
  ) {}

  clearPipelines(): void {
    this.pipelineCache.clear();
    this.checkerUniform?.destroy();
    this.checkerUniform = null;
  }

  encode(
    encoder: GPUCommandEncoder,
    sourceView: GPUTextureView,
    targetView: GPUTextureView,
    background: PresentBackground,
  ): void {
    let cached = this.pipelineCache.get(background.kind);
    if (!cached) {
      const module = this.device.createShaderModule({ code: buildPresentWgsl(background.kind) });
      const bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          ...(background.kind === "checker"
            ? [{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" as const } }]
            : []),
        ],
      });
      const pipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_present", targets: [{ format: this.srgbFormat }] },
      });
      cached = { pipeline, bindGroupLayout };
      this.pipelineCache.set(background.kind, cached);
    }
    if (background.kind === "checker") {
      this.checkerUniform ??= this.device.createBuffer({
        size: CHECKER_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      // Réécrit à chaque frame plutôt que sur changement : la comparaison
      // coûterait plus que l'écriture de 16 octets, et un état « dernière
      // valeur écrite » se désynchroniserait de la recréation du buffer.
      this.device.queue.writeBuffer(
        this.checkerUniform,
        0,
        new Float32Array([background.cellPx, 0, 0, 0]),
      );
    }
    const bindGroup = this.device.createBindGroup({
      layout: cached.bindGroupLayout,
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: this.sampler },
        ...(background.kind === "checker"
          ? [{ binding: 2, resource: { buffer: this.checkerUniform! } }]
          : []),
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
