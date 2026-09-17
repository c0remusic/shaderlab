import type { LayerState } from "../layers/types";
import { getBlendMode } from "./blend/registry";
import type { GpuTiming } from "./gpuTiming";
import type { EffectModule } from "./effects/types";
import { resolveEffectAnchor } from "./effects/spatialParams";
import { MAX_EFFECT_PARAMS, composeShader, FULLSCREEN_VERTEX_WGSL } from "./shaderCompose";

export const PASSTHROUGH_EFFECT: EffectModule = {
  id: "passthrough",
  // Libellé UTILISATEUR, pas un nom technique : ce `name` est affiché tel quel
  // dans la ligne de pile (`LayerPanel`, quand le calque n'a pas de `name`
  // propre) et dans le titre « Réglages · … » (`App.tsx`). « Passthrough » y
  // apparaissait pendant que le corps du panneau disait « Aucun effet » —
  // trois libellés pour une seule chose, dont deux incompréhensibles.
  // L'identifiant technique reste `passthrough` : c'est lui que le moteur
  // manipule, jamais ce libellé.
  name: "Aucun effet",
  params: [],
  wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }",
};

export const MASK_OVERLAY_WGSL = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var overlaySrc: texture_2d<f32>;
@group(0) @binding(1) var overlaySampler: sampler;
@group(0) @binding(2) var overlayMask: texture_2d<f32>;
@group(0) @binding(3) var<uniform> overlayTime: f32;

@fragment
fn fs_overlay(in: VertexOut) -> @location(0) vec4<f32> {
  let img = textureSample(overlaySrc, overlaySampler, in.uv);
  let m = textureSample(overlayMask, overlaySampler, in.uv).r;
  let tint = vec3<f32>(0.791, 0.045, 0.061);
  var rgb = mix(img.rgb, tint, m * 0.28);

  // LE VOILE lit le masque BRUT (m ci-dessus) : c'est l'affichage fidele de ce
  // qui sera applique. LE CONTOUR, lui, lit une version lissee — et seulement
  // lui. Arbitrage d'Antoine du 2026-08-13, apres avoir vu des hachures
  // diagonales couvrir toute une zone au lieu d'une ligne.
  //
  // Pourquoi il le fallait. Le contour s'allume ou le masque traverse 0.5, sur
  // une bande large de fwidth(m). Sur un masque PEINT, la valeur ne traverse
  // 0.5 qu'une fois, sur une frontiere franche : le test rend une ligne, ce
  // pour quoi il est ecrit. Sur un masque par TONALITE, elle la traverse des
  // milliers de fois — une par grain de la photo — donc fwidth est grand
  // partout dans la zone de transition, le contour s'allume partout, et le
  // motif de pointilles remplit la SURFACE. Ce n'etait pas du bruit : c'etait
  // une ligne de contour qui avait explose.
  //
  // Le lissage se fait a l'echelle de l'ECRAN et non de la texture (pas
  // derive de fwidth(uv)), pour que la ligne ait la meme allure a 13 % de zoom
  // qu'a 100 % — sans quoi elle se reformerait en hachures des qu'on dezoome,
  // exactement le cas ou le defaut a ete vu.
  // Le pas vaut au moins UN TEXEL du masque. Sans ce plancher, au-dessus de
  // 100 % de zoom un pixel ecran couvre moins d'un texel : les neuf taps
  // retombent sur le meme texel, la moyenne rend la valeur brute, et le
  // lissage ne fait plus rien — precisement la ou on regarde de pres pour
  // juger un bord. Verifie a 228 % de zoom, ou la premiere version restait
  // hachuree.
  let dims = vec2<f32>(textureDimensions(overlayMask, 0));
  let pasEcran = max(fwidth(in.uv) * 1.5, 1.0 / dims);
  // Rayon de DEUX pas (25 taps) et non un seul (9 taps). Mesure du 2026-08-13 :
  // a 9 taps, l'image restait hachuree a l'identique. Un masque par tonalite
  // traverse 0.5 des milliers de fois ; moyenner 9 texels divise l'amplitude
  // du bruit par 3 seulement, et la moyenne locale reste assez proche de 0.5
  // pour rallumer le contour. Ce qui compte n'est pas de reduire le bruit mais
  // d'ELOIGNER la moyenne locale du seuil.
  var mLisse = 0.0;
  for (var j = -2; j <= 2; j = j + 1) {
    for (var i = -2; i <= 2; i = i + 1) {
      let decalage = vec2<f32>(f32(i), f32(j)) * pasEcran;
      mLisse = mLisse + textureSample(overlayMask, overlaySampler, in.uv + decalage).r;
    }
  }
  mLisse = mLisse / 25.0;

  // Contour au seuil 0.5 : bande de ~1.5px via dérivée d'écran, jamais de
  // tracé d'isoligne CPU (design.md, "Contour, pas seuil binaire caché").
  // Pointillés : phase animée le long de la diagonale écran, indépendante
  // du contenu du masque.
  //
  // La borne sur edgeWidth est le second garde, et il est independant du
  // lissage : meme lissee, une transition tres raide garde un fwidth eleve.
  // Sans plafond, la bande resterait proportionnelle a la pente au lieu
  // d'etre une LIGNE, ce qu'un contour doit etre.
  let edgeWidth = min(fwidth(mLisse) * 1.5, 0.25) + 0.0001;
  let onContour = 1.0 - smoothstep(0.0, edgeWidth, abs(mLisse - 0.5));
  let dashPhase = fract((in.position.x + in.position.y) * 0.12 - overlayTime * 1.5);
  let dashColor = select(vec3<f32>(0.0), vec3<f32>(1.0), dashPhase > 0.5);
  rgb = mix(rgb, dashColor, onContour);

  return vec4<f32>(rgb, img.a);
}
`;

type PendingDestroy = (GPUTexture | GPUBuffer)[];
type MaskResolver = (
  layer: LayerState,
  encoder: GPUCommandEncoder,
  sourceView: GPUTextureView,
  pendingDestroy: PendingDestroy,
  guideEpoch: number
) => GPUTexture;

/** Encodes stateless colour passes. Frame submission and mask residency remain
 * the caller's responsibility. */
export class EffectPassRunner {
  private readonly pipelineCache = new Map<
    string,
    { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout }
  >();
  /** Buffer d'uniform réutilisé pour `overlayTime` — créé une fois, mis à
   *  jour par `writeBuffer` à chaque tick (animation OU rendu normal),
   *  jamais recréé/détruit par frame (évite la pression allocateur d'un
   *  buffer jetable à 60fps). Détruit dans `clearPipelines()`. */
  private timeBuffer: GPUBuffer | null = null;

  /** Texture 1×1 liée au binding 7 quand un effet DÉCLARE une texture de
   *  bibliothèque mais que l'appelant n'en fournit pas (banc de test, harnais
   *  de compilation de shaders, store absent).
   *
   *  Elle existe pour que le corps WGSL reste une chaîne fixe : un binding
   *  déclaré dans le shader et manquant du bind group fait échouer la
   *  compilation, et c'est exactement ce qu'a rapporté `test:gpu-shaders`
   *  (`unresolved value 'libraryTexture'`) avant qu'elle soit là. Créée à la
   *  première demande, détruite avec les pipelines. */
  private libraryPlaceholder: GPUTexture | null = null;

  /** POOL DES CIBLES DE PASSE INTERNE, indexé par dimensions.
   *
   *  Avant le 2026-08-02, `runInternalPasses` créait une texture NEUVE par
   *  passe et par frame, puis la détruisait. Le coût ne se voit pas sur une
   *  petite image et devient dominant sur une vraie photo : à 26 Mpx, une cible
   *  en demi-résolution pèse ~26 Mo, et `glow` en enchaîne onze, `gooeyMerge`
   *  neuf. Sur une pile Gooey merge + Motion blur, ça faisait ~121 Mo alloués ET
   *  détruits à CHAQUE image pendant un glissement de curseur — ce n'est pas le
   *  calcul qui bloque à ce régime, c'est l'allocateur.
   *
   *  Le baseline de performance du 2026-07-30 avait relevé le churn des buffers
   *  et des bind groups (15 + 11 par frame) sans voir celui-ci, qui est pourtant
   *  trois ordres de grandeur au-dessus en octets. Une texture de passe pèse des
   *  dizaines de Mo, un buffer d'uniform quelques dizaines d'octets.
   *
   *  Les textures sont PRÊTÉES pendant la frame et rendues après la soumission,
   *  jamais détruites. `width`/`height` étant `readonly`, un redimensionnement
   *  reconstruit le runner : le pool ne peut pas contenir de format périmé. */
  private readonly passTargetPool = new Map<string, GPUTexture[]>();
  /** Cibles prêtées à la frame en cours. Deux passes vivent simultanément (une
   *  lue, une écrite), donc le pool doit pouvoir en distribuer plusieurs de la
   *  MÊME taille sans jamais rendre deux fois la même — d'où une liste de
   *  prêts, et non un simple compteur. */
  private leasedPassTargets: GPUTexture[] = [];

  /** Chronomètre GPU par passe, ou null. Posé APRÈS construction par le
   *  `FramePipelineExecutor` plutôt que reçu au constructeur : le runner est
   *  reconstruit à chaque redimensionnement (voir `passTargetPool`), et un
   *  instrument de diagnostic n'a aucune raison de participer à ce cycle-là.
   *  Hors capture, `slotFor` rend `undefined` et les descripteurs de passe sont
   *  identiques à ce qu'ils étaient avant l'instrument. */
  timing: GpuTiming | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly width: number,
    private readonly height: number,
    private readonly sampler: GPUSampler,
    private readonly resolveMask: MaskResolver
  ) {}

  get pipelineCount(): number {
    return this.pipelineCache.size;
  }

  clearPipelines(): void {
    this.pipelineCache.clear();
    this.timeBuffer?.destroy();
    this.timeBuffer = null;
    // Le pool meurt AVEC le runner : c'est le seul endroit qui puisse le
    // libérer sans risquer de détruire une cible encore référencée par une
    // frame en vol.
    for (const textures of this.passTargetPool.values()) {
      for (const texture of textures) texture.destroy();
    }
    this.passTargetPool.clear();
    for (const texture of this.leasedPassTargets) texture.destroy();
    this.leasedPassTargets = [];
  }

  /** Rend au pool les cibles prêtées à la frame. À appeler APRÈS
   *  `queue.submit`, exactement là où les ressources jetables étaient
   *  détruites — la garantie est la même : les commandes déjà soumises tiennent
   *  la mémoire vivante côté pilote, et celles de la frame suivante sont
   *  ordonnancées après. */
  releaseFrameTargets(): void {
    for (const texture of this.leasedPassTargets) {
      const key = `${texture.width}x${texture.height}`;
      const libres = this.passTargetPool.get(key);
      if (libres) libres.push(texture);
      else this.passTargetPool.set(key, [texture]);
    }
    this.leasedPassTargets = [];
  }

  /** Emprunte une cible aux dimensions demandées, ou en crée une. */
  private acquirePassTarget(width: number, height: number): GPUTexture {
    const libres = this.passTargetPool.get(`${width}x${height}`);
    const recyclee = libres?.pop();
    const texture = recyclee ?? this.device.createTexture({
      size: [width, height],
      format: this.srgbFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.leasedPassTargets.push(texture);
    return texture;
  }

  runInternalPasses(
    encoder: GPUCommandEncoder,
    effect: EffectModule,
    layer: LayerState,
    sourceView: GPUTextureView,
    pendingDestroy: PendingDestroy,
    libraryTextureView: GPUTextureView | null = null
  ): { view: GPUTextureView; texture: GPUTexture | null; aux: GPUTextureView | null } {
    let passInputView = sourceView;
    let lastTexture: GPUTexture | null = null;
    // Sortie de la passe marquee `expose`, RETENUE pour la passe finale pendant
    // que la chaine continue par-dessus. Voir `EffectPass.expose`.
    let auxView: GPUTextureView | null = null;

    // PARAMÈTRES RÉSOLUS UNE FOIS pour tous les prédicats de la chaîne (défauts
    // appliqués), plutôt que par passe : `enabled` est appelé jusqu'à neuf fois
    // sur une pyramide, et une résolution par appel serait payée à chaque frame
    // pour un résultat identique.
    let resolved: Record<string, number> | null = null;
    const paramsFor = () => {
      if (!resolved) {
        resolved = {};
        for (const p of effect.params) resolved[p.name] = layer.params[p.name] ?? p.default;
      }
      return resolved;
    };

    for (const pass of effect.passes!) {
      // PASSE INUTILE AUX RÉGLAGES COURANTS : on la saute AVANT d'emprunter une
      // cible. L'ordre compte — une passe inutile n'est pas seulement lente,
      // elle ALLOUE, et c'est l'allocation qu'on vient éviter. Sauter laisse
      // `passInputView` inchangé, donc la passe suivante (ou la composite finale
      // via `prevPass`) lit ce que celle-ci aurait dû transformer. Voir
      // l'avertissement sur `EffectPass.enabled` : un mode dont TOUTES les
      // passes sautent reçoit la texture SOURCE en `prevPass`.
      if (pass.enabled && !pass.enabled(paramsFor())) continue;
      // EMPRUNTÉE au pool, plus créée : voir `passTargetPool`. Aucune cible
      // n'est plus poussée dans `pendingDestroy` — elles restent prêtées jusqu'à
      // `releaseFrameTargets()`, après la soumission. Détruire la précédente ici
      // la rendrait inutilisable par la passe suivante, qui la lit encore.
      const passTarget = this.acquirePassTarget(
        Math.max(1, Math.round(this.width * pass.scale)),
        Math.max(1, Math.round(this.height * pass.scale)),
      );
      const passTargetView = passTarget.createView();
      // `libraryTextureView` transmis à CHAQUE passe interne : le binding 7
      // existe dès que l'effet le déclare (voir `runEffectPass`), donc l'omettre
      // ne cassait pas la compilation — il servait silencieusement le repli 1×1.
      this.runEffectPass(encoder, { ...effect, wgsl: pass.wgsl }, layer, passInputView, passTargetView, { applyMask: false, libraryTextureView }, pendingDestroy);
      passInputView = passTargetView;
      lastTexture = passTarget;
      if (pass.expose) auxView = passTargetView;
    }
    // REPLI D'`auxPass`, exactement celui de `prevPass` et pour la même raison :
    // une passe exposée que `enabled` fait sauter n'expose rien, et le shader la
    // lit quand même. Sans ce repli, le binding 9 ne serait pas fourni alors que
    // le corps WGSL le cite — le shader ne compilerait plus du tout, au lieu de
    // lire une texture inerte comme il le fait pour `prevPass`. La vue SOURCE
    // tient ce rôle : les termes qui la liraient sont, eux aussi, à zéro.
    if (auxView === null && effect.passes!.some((p) => p.expose)) auxView = sourceView;
    // `lastTexture` reste NULL si toutes les passes ont été sautées : aucune
    // cible n'a été empruntée, et `passInputView` est restée la vue source.
    // Déclaré nullable plutôt que forcé par un `!` — l'appelant ne lit que
    // `view`, et il ne détruit jamais `texture` (elle appartient au pool).
    return { view: passInputView, texture: lastTexture, aux: auxView };
  }

  runOverlayPass(encoder: GPUCommandEncoder, src: GPUTexture, mask: GPUTexture, targetView: GPUTextureView, time: number): void {
    let cached = this.pipelineCache.get(MASK_OVERLAY_WGSL);
    if (!cached) {
      const module = this.device.createShaderModule({ code: MASK_OVERLAY_WGSL });
      const bindGroupLayout = this.device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ] });
      const pipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_overlay", targets: [{ format: this.srgbFormat }] },
      });
      cached = { pipeline, bindGroupLayout };
      this.pipelineCache.set(MASK_OVERLAY_WGSL, cached);
    }
    if (!this.timeBuffer) {
      this.timeBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this.timeBuffer, 0, new Float32Array([time, 0, 0, 0]));
    const bindGroup = this.device.createBindGroup({ layout: cached.bindGroupLayout, entries: [
      { binding: 0, resource: src.createView() },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: mask.createView() },
      { binding: 3, resource: { buffer: this.timeBuffer } },
    ] });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      ...(this.timing?.slotFor("overlay") ?? {}),
    });
    pass.setPipeline(cached.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private libraryPlaceholderView(): GPUTextureView {
    this.libraryPlaceholder ??= this.device.createTexture({
      size: [1, 1],
      format: this.srgbFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    return this.libraryPlaceholder.createView();
  }

  runEffectPass(
    encoder: GPUCommandEncoder,
    effect: EffectModule,
    layer: LayerState,
    sourceView: GPUTextureView,
    targetView: GPUTextureView,
    options: { applyMask?: boolean; prevPassView?: GPUTextureView | null; auxPassView?: GPUTextureView | null; guideEpoch?: number; imageSourceView?: GPUTextureView | null; libraryTextureView?: GPUTextureView | null } = {},
    pendingDestroy: PendingDestroy = []
  ): void {
    const { applyMask = true, prevPassView = null, auxPassView = null, guideEpoch = 0, imageSourceView = null, libraryTextureView = null } = options;
    const paramValues = new Float32Array(MAX_EFFECT_PARAMS);
    effect.params.forEach((p, idx) => { paramValues[idx] = layer.params[p.name] ?? p.default; });
    const paramBuffer = this.device.createBuffer({ size: paramValues.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(paramBuffer, 0, paramValues);
    pendingDestroy.push(paramBuffer);

    const blendMode = getBlendMode(layer.blendMode ?? "normal");
    const hasImageSource = imageSourceView !== null;
    // Binding 6 : la vue vient du calque lui-même, et de nulle part ailleurs.
    // Elle avait un SECOND fournisseur — la couverture de la base photo du
    // DESSOUS, pour un calque écrêté ; il est parti avec l'écrêtage (ADR-0020,
    // 2026-08-21).
    const coverageView = imageSourceView;
    // ⚠️ Suit la DÉCLARATION de l'effet, JAMAIS la présence d'une vue.
    //
    // Le corps WGSL d'un effet est une chaîne FIXE : s'il échantillonne
    // `libraryTexture`, le binding doit exister à CHAQUE compilation. Le faire
    // dépendre de la vue produisait `unresolved value 'libraryTexture'` dès
    // qu'aucun store n'était branché — attrapé par `test:gpu-shaders`, jamais
    // par le compilateur TypeScript.
    //
    // La contrepartie est ci-dessous : le runner garantit une vue, de repli si
    // l'appelant n'en fournit pas. Le shader distingue les deux cas par
    // `textureDimensions` (voir `EffectModule.libraryTexture`).
    const hasLibraryTexture = effect.libraryTexture !== undefined;
    const libraryView = hasLibraryTexture ? (libraryTextureView ?? this.libraryPlaceholderView()) : null;
    // ÉTIREMENT DU RENDU (ticket 24, voie B). Seulement sur la passe de
    // compositing (`applyMask`) — les passes internes restent au repère identité
    // (déformer les pyramides les effondre, mesuré par le prototype). Et
    // seulement NON identité : à l'identité, rien n'est émis et la chaîne
    // composée reste byte-identique — le gate discriminant du chemin identité.
    const et = layer.effectTransform;
    const hasEffectTransform =
      applyMask && et !== undefined && (et.scaleX !== 1 || et.scaleY !== 1);
    const shaderCode = composeShader(effect.wgsl, { applyMask, hasPrevPass: prevPassView !== null, hasAuxPass: auxPassView !== null, hasImageSource, hasLibraryTexture, hasEffectTransform, blendWgsl: applyMask ? blendMode.wgsl : undefined });
    let compositingBuffer: GPUBuffer | null = null;
    if (applyMask) {
      const compositing = new Float32Array([layer.opacity ?? 1, 0, 0, 0]);
      compositingBuffer = this.device.createBuffer({ size: compositing.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(compositingBuffer, 0, compositing);
      pendingDestroy.push(compositingBuffer);
    }
    // Binding 8 : `vec4(1/scaleX, 1/scaleY, ancreX, ancreY)`. L'échelle INVERSE
    // parce que le shader échantillonne `fs_main` au point d'où vient le pixel
    // (`uvT = (uv - ancre) * inv + ancre`) : étirer le champ ×2 comprime le
    // domaine d'échantillonnage ÷2. L'ancre est la position de l'effet (rôles
    // `x`/`y`), centre de toile pour un effet sans ancrage.
    let transformBuffer: GPUBuffer | null = null;
    if (hasEffectTransform) {
      const ancre = resolveEffectAnchor(effect, layer.params);
      const data = new Float32Array([1 / et!.scaleX, 1 / et!.scaleY, ancre.x, ancre.y]);
      transformBuffer = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(transformBuffer, 0, data);
      pendingDestroy.push(transformBuffer);
    }

    let cached = this.pipelineCache.get(shaderCode);
    if (!cached) {
      const module = this.device.createShaderModule({ code: shaderCode });
      const layoutEntries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ];
      if (applyMask) layoutEntries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      if (prevPassView) layoutEntries.push({ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      if (auxPassView) layoutEntries.push({ binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      if (applyMask) layoutEntries.push({ binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
      if (applyMask && coverageView) layoutEntries.push({ binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      if (hasLibraryTexture) layoutEntries.push({ binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      if (hasEffectTransform) layoutEntries.push({ binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
      const bindGroupLayout = this.device.createBindGroupLayout({ entries: layoutEntries });
      const pipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_wrapper", targets: [{ format: this.srgbFormat }] },
      });
      cached = { pipeline, bindGroupLayout };
      this.pipelineCache.set(shaderCode, cached);
    }

    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: sourceView },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: { buffer: paramBuffer } },
    ];
    // IMAGE DE GUIDE du masque (filtre edge-aware) — ce n'est PAS forcément
    // `sourceView`. La règle est : le guide est l'image que CE calque dessine.
    //  - calque ordinaire (effet) : il travaille le composite en dessous, donc
    //    `sourceView` — inchangé ;
    //  - calque photo : il dessine SA photo, résolue par la pré-passe
    //    (`imageSourceView`). Le composite en dessous ne serait pas seulement
    //    approximatif, il serait faux : ce sont exactement les pixels que la
    //    photo RECOUVRE. Et pour le calque le plus bas, c'est la toile — vide
    //    depuis la tranche T1 (allouée, effacée en alpha 0, jamais uploadée) :
    //    le filtre guidé n'avait plus AUCUNE arête à suivre, en silence.
    //    Mesuré sur GPU réel le 2026-07-29.
    // Position-indépendant par construction : aucun cas particulier sur
    // l'index, c'est précisément l'hypothèse que la tranche T1 a fait tomber.
    const maskGuideView = imageSourceView ?? sourceView;
    if (applyMask) entries.push({ binding: 3, resource: this.resolveMask(layer, encoder, maskGuideView, pendingDestroy, guideEpoch).createView() });
    if (prevPassView) entries.push({ binding: 4, resource: prevPassView });
    if (auxPassView) entries.push({ binding: 9, resource: auxPassView });
    if (applyMask && compositingBuffer) entries.push({ binding: 5, resource: { buffer: compositingBuffer } });
    if (applyMask && coverageView) entries.push({ binding: 6, resource: coverageView });
    if (libraryView) entries.push({ binding: 7, resource: libraryView });
    if (transformBuffer) entries.push({ binding: 8, resource: { buffer: transformBuffer } });
    const bindGroup = this.device.createBindGroup({ layout: cached.bindGroupLayout, entries });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      // Les passes INTERNES passent aussi par ici (`runInternalPasses` rappelle
      // cette méthode par passe), donc un effet à N passes rend N lignes du
      // même libellé, dans l'ordre d'encodage — c'est exactement la ventilation
      // cherchée sur `outlines` et ses neuf passes de pyramide.
      ...(this.timing?.slotFor(layer.effectId) ?? {}),
    });
    pass.setPipeline(cached.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
}
