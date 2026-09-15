import type { GpuContext } from "./gpuContext";
import { FULLSCREEN_VERTEX_WGSL } from "./shaderCompose";
import type { LayerState } from "../layers/types";
import type { DirtyRect } from "../mask/maskPainter";
import { computeR8UploadRegion } from "./maskUpload";
import type { MaskPreviewOverride, MaskUploadScope } from "./renderer";
import {
  planFold,
  snapshotFoldInputs,
  foldInputsEqual,
  type FoldSourceSnapshot,
} from "../mask/foldPlan";
import type {
  MaskSource,
  ParametricMaskSource,
  MaskSourceType,
  RefineEdgeParams,
} from "../mask/types";
import { buildCombineWgsl, buildInvertWgsl } from "../mask/maskFoldWgsl";
import { buildMorphologyWgsl, buildFeatherLookupWgsl } from "../mask/refineEdgeWgsl";
import { planRefine } from "../mask/refinePlan";
import { getMaskSourceModule } from "../mask/sources/registry";
import {
  buildLuminanceWgsl,
  buildPackWgsl,
  buildSquareCorrWgsl,
  buildBoxFilterHWgsl,
  buildBoxFilterVWgsl,
  buildComputeABWgsl,
  buildCompositeWgsl,
  buildDownsampleWgsl,
  buildSatWidenWgsl,
  buildSatScanWgsl,
  buildSatLookupWgsl,
} from "../mask/edgeAwareWgsl";

/** Nombre de slots `array<f32, N>` alloués au contrat wgsl de chaque source
 *  paramétrique. Exporté pour que le harnais GPU (`scripts/gpu-shader-check.mjs`)
 *  compile EXACTEMENT la source que le resolver produit — un N différent
 *  produit un shader différent, donc une copie du chiffre dans le harnais
 *  dériverait en silence. */
export const PARAM_COUNT_BY_TYPE: Record<Exclude<MaskSourceType, "brush">, number> = {
  gradient: 8,
  luminosity: 8,
  colorRange: 32,
  shape: 8,
};

/** Enveloppe le fragment `fs_generate` d'un module de source paramétrique
 *  (`src/mask/sources/*.ts`) en source WGSL complète. Les modules exposent un
 *  FRAGMENT (comme les effets), pas un shader : sans ce wrapper, `vs_main`,
 *  `VertexOut`, les bindings et `fs_wrapped` manquent. Fonction de module (et
 *  non méthode privée) pour que `scripts/gpu-shader-check.mjs` compile la même
 *  source que le rendu. */
export function wrapMaskSourceWgsl(g: string, n: number): string {
  return `${FULLSCREEN_VERTEX_WGSL}\n@group(0) @binding(0) var srcColor: texture_2d<f32>;\n@group(0) @binding(1) var maskSampler: sampler;\n@group(0) @binding(2) var<uniform> genParams: array<f32, ${n}>;\n@group(0) @binding(3) var<uniform> maskDims: vec2<f32>;\n${g}\n@fragment fn fs_wrapped(in: VertexOut) -> @location(0) vec4<f32> { let color=textureSample(srcColor,maskSampler,in.uv).rgb; let v=fs_generate(in.uv,color,genParams); return vec4<f32>(v,v,v,1.0); }`;
}
type Entry = { texture: GPUTexture; syncedFrom: unknown };
type PipelineEntry = {
  pipeline: GPURenderPipeline;
  layout: GPUBindGroupLayout;
};
type EdgeWork = {
  // Pleine résolution (this.width x this.height) — inchangées dans leur
  // rôle : `luminance` sert de guide I au composite final, `result` est
  // la sortie retournée par edgePipeline().
  luminance: GPUTexture;
  result: GPUTexture;
  // Résolution réduite (smallW x smallH, plafonnée à ~2048px de long
  // côté — voir computeSmallDims()).
  luminanceSmall: GPUTexture;
  inputSmall: GPUTexture;
  packedIp: GPUTexture;
  squareCorr: GPUTexture;
  /** SAT persistante de packedIp (I,p) — reconstruite UNIQUEMENT quand
   *  guideRevision(id) avance (voir needsGuide dans edgePipeline()). */
  satIp: GPUTexture;
  /** SAT persistante de squareCorr (I²,Ip) — même règle que satIp. */
  satCorr: GPUTexture;
  /** Scratch partagé pour la construction Hillis-Steele — réutilisé
   *  séquentiellement pour satIp, satCorr (si needsGuide) puis pour la
   *  SAT transitoire de a/b (si needsAB) : ces trois constructions ne
   *  sont jamais nécessaires simultanément, partager ce ping-pong évite
   *  d'allouer 3 paires persistantes de rg32float (voir spec design §
   *  Budget VRAM chiffré). */
  satScratchA: GPUTexture;
  satScratchB: GPUTexture;
  /** Lookup O(1) bon marché, dépend du rayon — recalculé à chaque
   *  changement de edgeRadius même si satIp/satCorr restent en cache. */
  meanIp: GPUTexture;
  corr: GPUTexture;
  ab: GPUTexture;
  meanAB: GPUTexture;
  /** Palier 1 (coûteux) : guide-SAT (satIp/satCorr). */
  lastGuideRevision: number;
  /** Palier 2 (bon marché) : lookup + a/b + composite. Même contrat que
   *  l'ancien cache à un seul palier (revision/edgeRadius/edgeStrength). */
  lastRevision: number;
  lastRadius: number;
  lastStrength: number;
};
type RefineCacheEntry = {
  texture: GPUTexture;
  lastRevision: number;
  lastFeather: number;
  lastContract: number;
  lastSmooth: number;
};
/** SAT pleine résolution du feather, allouée PARESSEUSEMENT — créée au premier
 *  `feather > 0` sur ce calque, détruite dès qu'il retombe à 0. La paresse
 *  n'est pas une micro-optimisation : deux textures `r32float` pleine taille
 *  coûtent ~208 Mo à 26 Mpx, et le risque VRAM R1 d'`ARCHITECTURE.md` place
 *  déjà le pire cas à ~84 % de la mémoire.
 *
 *  Ce qu'elle achète : le coût du feather cesse de dépendre du RAYON. Les deux
 *  box filters séparables qu'elle remplace échantillonnent 2×(2r+1) fois par
 *  pixel ; le lookup en lit quatre, quel que soit r. Et surtout la SAT n'est
 *  reconstruite que si son ENTRÉE change (révision amont ou `contract`) —
 *  glisser le seul curseur de feather relit une SAT déjà là. */
type RefineSatWork = {
  scratchA: GPUTexture;
  scratchB: GPUTexture;
  result: GPUTexture;
  lastRevision: number;
  lastContract: number;
};

/** Owns every persistent mask resource. It only encodes work: Renderer owns submit and frame-scoped destruction. */
export class MaskTextureResolver {
  private sourceTextures = new Map<string, Entry>();
  private parametricSourceTextures = new Map<string, Entry>();
  private foldedMaskTextures = new Map<
    string,
    {
      texture: GPUTexture;
      lastInputs: FoldSourceSnapshot[];
      lastInvert: boolean;
    }
  >();
  private foldPingPongByLayer = new Map<string, [GPUTexture, GPUTexture]>();
  private refineEdgePingPongByLayer = new Map<
    string,
    [GPUTexture, GPUTexture]
  >();
  private edgeAwareWorkTextures = new Map<string, EdgeWork>();
  private refineCache = new Map<string, RefineCacheEntry>();
  private refineSatByLayer = new Map<string, RefineSatWork>();
  /** Compteur incrémenté par calque à chaque fois que le CONTENU de son
   *  masque résident change réellement (recompute dans resident()/
   *  parametric(), cache-miss du fold, ou bascule de `layer.mask.invert`) —
   *  jamais sur un cache-hit. Sert de clé de cache à edge()/refine() à la
   *  place de l'identité de texture, qui ne suffit pas : `resident()`/
   *  `parametric()` réutilisent le même objet GPUTexture d'un appel à
   *  l'autre en le re-rendant. */
  private maskRevision = new Map<string, number>();
  /** Sous-ensemble de `maskRevision` : n'avance QUE quand le contenu du
   *  GUIDE (image source + statistiques amont du filtre edge-aware)
   *  change réellement — jamais sur un simple changement d'`edgeRadius`/
   *  `edgeStrength` (qui, lui, avance `maskRevision` via le self-bump de
   *  `edgePipeline()`). Sert de clé de cache à la construction SAT du
   *  guide (coûteuse, ~log2(largeur)+log2(hauteur) passes) — sans cette
   *  séparation, un drag de rayon la reconstruirait à chaque frame (voir
   *  spec design § Cache à deux niveaux). */
  private guideRevisionByLayer = new Map<string, number>();
  private lastInvertByLayer = new Map<string, boolean>();
  private lastEdgeAwareActiveByLayer = new Map<string, boolean>();
  private lastGuideEpochByLayer = new Map<string, number>();
  private maskSourcePipelineCache = new Map<string, PipelineEntry>();
  private maskFoldPipelineCache = new Map<string, PipelineEntry>();
  private edgeAwarePipelineCache = new Map<string, PipelineEntry>();
  /** Compteurs de RECALCUL, par étage du résolveur. Ils répondent à une
   *  question que les temps ne savent pas trancher : quand un masque existe,
   *  QUELS étages retravaillent à chaque frame, et lesquels servent leur
   *  cache. Des COMPTES, pas des durées — donc valides en build de
   *  développement, où les durées ne le sont pas (le plancher React y est
   *  2,6× celui de la production, mesuré le 2026-08-13).
   *
   *  Posés parce que la cadence tombe de 165 à ~14 images par seconde dès
   *  qu'un masque à source paramétrique existe dans le document, y compris
   *  en éditant un AUTRE calque — et que les caches de chaque étage
   *  (`foldedMaskTextures`, `edgeAwareWorkTextures`, `refineCache`) existent
   *  pourtant déjà. Un cache qui existe et un cache qui SERT sont deux
   *  choses distinctes ; seuls ces compteurs les séparent. */
  private diag = {
    resolve: 0,
    livePreview: 0,
    planVide: 0,
    foldHit: 0,
    foldMiss: 0,
    residentRecompute: 0,
    parametricRecompute: 0,
    edgeInactif: 0,
    edgeHit: 0,
    satGuide: 0,
    lookupAB: 0,
    refinePlanVide: 0,
    refineHit: 0,
    refineMiss: 0,
  };
  /** Rend les compteurs accumulés depuis le dernier appel, puis les remet à
   *  zéro — l'appelant mesure donc toujours une FENÊTRE, jamais un cumul
   *  depuis le chargement. */
  drainDiagnostics(): Record<string, number> {
    const copie = { ...this.diag };
    for (const cle of Object.keys(this.diag) as (keyof typeof this.diag)[])
      this.diag[cle] = 0;
    return copie;
  }
  private whiteMask: GPUTexture | null = null;
  private liveMaskTexture: GPUTexture | null = null;
  private liveMaskLayerId: string | null = null;
  private livePreview: MaskPreviewOverride | null = null;
  constructor(
    private readonly ctx: GpuContext,
    private readonly width: number,
    private readonly height: number,
    private readonly sampler: GPUSampler,
    private readonly nearestSampler: GPUSampler,
    private readonly sourceColor: () => GPUTexture,
  ) {}
  setLivePreview(preview: MaskPreviewOverride | null): void {
    this.livePreview = preview;
  }
  private bumpRevision(id: string): void {
    this.maskRevision.set(id, (this.maskRevision.get(id) ?? 0) + 1);
  }
  private revision(id: string): number {
    return this.maskRevision.get(id) ?? 0;
  }
  private bumpGuideRevision(id: string): void {
    this.guideRevisionByLayer.set(id, (this.guideRevisionByLayer.get(id) ?? 0) + 1);
  }
  /** Directive `@ts-ignore 6133` retiree le 2026-07-31 : elle etait PERIMEE.
   *  `guideRevision` est bel et bien consommee dans ce fichier (`edgePipeline`,
   *  `const guideRev = this.guideRevision(id)`), donc TS6133 ne se leve plus et
   *  la directive ne supprimait plus rien. La convertir en `@ts-expect-error`
   *  (ce que demande `@typescript-eslint/ban-ts-comment`) aurait au contraire
   *  FAIT echouer `tsc` — « Unused '@ts-expect-error' directive ». */
  private guideRevision(id: string): number {
    return this.guideRevisionByLayer.get(id) ?? 0;
  }
  sweep(layerIds: ReadonlySet<string>): void {
    this.sweepMap(this.sourceTextures, layerIds);
    this.sweepMap(this.parametricSourceTextures, layerIds);
    this.sweepMap(this.foldedMaskTextures, layerIds);
    this.sweepPairs(this.foldPingPongByLayer, layerIds);
    this.sweepPairs(this.refineEdgePingPongByLayer, layerIds);
    for (const [id, w] of this.edgeAwareWorkTextures)
      if (!layerIds.has(id)) {
        this.destroyWork(w);
        this.edgeAwareWorkTextures.delete(id);
      }
    // Métadonnées pures (aucune texture propre à détruire ici — refineCache
    // ne fait que référencer une texture de refineEdgePingPongByLayer, déjà
    // détruite ci-dessus) : purger quand même pour ne pas garder de
    // référence vers un GPUTexture détruit, jamais servie mais périmée.
    for (const id of this.maskRevision.keys())
      if (!layerIds.has(id)) this.maskRevision.delete(id);
    for (const id of this.guideRevisionByLayer.keys())
      if (!layerIds.has(id)) this.guideRevisionByLayer.delete(id);
    for (const id of this.lastInvertByLayer.keys())
      if (!layerIds.has(id)) this.lastInvertByLayer.delete(id);
    for (const id of this.lastEdgeAwareActiveByLayer.keys())
      if (!layerIds.has(id)) this.lastEdgeAwareActiveByLayer.delete(id);
    for (const id of this.refineCache.keys())
      if (!layerIds.has(id)) this.refineCache.delete(id);
    // Celle-ci possede ses textures (contrairement a refineCache, qui ne fait
    // que referencer le ping-pong) : elles se detruisent ici, sinon 208 Mo par
    // calque disparu resteraient sur le GPU.
    for (const id of this.refineSatByLayer.keys())
      if (!layerIds.has(id)) this.destroyRefineSat(id);
  }

  /** Libère la SAT de feather d'un calque. Appelée quand le calque disparaît
   *  ET quand `feather` retombe à 0 — c'est ce second appel qui rend
   *  l'allocation réellement paresseuse plutôt que simplement différée. */
  private destroyRefineSat(id: string): void {
    const w = this.refineSatByLayer.get(id);
    if (!w) return;
    w.scratchA.destroy();
    w.scratchB.destroy();
    this.refineSatByLayer.delete(id);
  }
  private sweepMap<T extends { texture: GPUTexture }>(
    map: Map<string, T>,
    ids: ReadonlySet<string>,
  ) {
    for (const [key, entry] of map)
      if (!ids.has(key.split(":")[0])) {
        entry.texture.destroy();
        map.delete(key);
      }
  }
  private sweepPairs(
    map: Map<string, [GPUTexture, GPUTexture]>,
    ids: ReadonlySet<string>,
  ) {
    for (const [id, [a, b]] of map)
      if (!ids.has(id)) {
        a.destroy();
        b.destroy();
        map.delete(id);
      }
  }
  resolve(
    layer: LayerState,
    encoder: GPUCommandEncoder,
    colorView: GPUTextureView,
    pendingDestroy: (GPUTexture | GPUBuffer)[],
    guideEpoch: number,
  ): GPUTexture {
    this.diag.resolve++;
    if (this.livePreview?.layerId === layer.id) {
      this.diag.livePreview++;
      return this.getLiveMaskTexture(
        layer.id,
        this.livePreview.raster,
        this.livePreview.scope,
      );
    }
    const plan = planFold(layer.mask);
    if (!plan.length) {
      this.diag.planVide++;
      return this.getWhiteMask();
    }
    // Bascule d'`invert` seule (sans qu'aucune source n'ait changé) : le
    // contenu résultant change quand même — resident()/parametric() ne le
    // détecteraient pas seuls puisqu'ils ne voient jamais `invert`.
    if (this.lastInvertByLayer.get(layer.id) !== layer.mask.invert) {
      this.bumpRevision(layer.id);
      this.bumpGuideRevision(layer.id);
      this.lastInvertByLayer.set(layer.id, layer.mask.invert);
    }
    // `edge()` (filtre guidé) lit `colorView` comme image de guide — pour
    // tout calque qui n'est pas le tout premier de la pile, ce guide EST le
    // composite des calques en dessous, ré-encodé à chaque exécution réelle
    // du pipeline (aucune mémoïsation par calque en amont). `guideEpoch`
    // (fourni par l'appelant : constant pour le premier calque dont le
    // guide est l'image source stable, changeant sinon) permet de détecter
    // ce cas — sans lui, edge-aware pouvait rester figé sur un ANCIEN
    // composite après modif d'un calque en dessous (trouvé par audit,
    // absent du diff seul : la provenance de colorView vit dans
    // framePipelineExecutor.ts/effectPassRunner.ts).
    if (this.lastGuideEpochByLayer.get(layer.id) !== guideEpoch) {
      this.bumpRevision(layer.id);
      this.bumpGuideRevision(layer.id);
      this.lastGuideEpochByLayer.set(layer.id, guideEpoch);
    }
    if (plan.length === 1 && !layer.mask.invert)
      return this.refine(
        layer.id,
        this.edge(
          layer,
          this.resident(layer.id, plan[0], encoder, pendingDestroy),
          colorView,
          encoder,
          pendingDestroy,
        ),
        layer.mask.refineEdge,
        encoder,
        pendingDestroy,
      );
    const snapshot = snapshotFoldInputs(layer.mask),
      cached = this.foldedMaskTextures.get(layer.id);
    const cacheHit =
      !!cached &&
      foldInputsEqual(cached.lastInputs, snapshot) &&
      cached.lastInvert === layer.mask.invert;
    if (cacheHit) this.diag.foldHit++;
    else this.diag.foldMiss++;
    const folded = cacheHit
      ? cached!.texture
      : this.fold(layer.id, plan, layer.mask.invert, encoder, pendingDestroy);
    if (!cacheHit) {
      // Couvre aussi les cas où le fold change sans que resident()/
      // parametric() n'aient eux-mêmes recalculé (combineMode, enabled,
      // ajout/suppression de source) — le contenu du masque final change
      // quand même.
      this.bumpRevision(layer.id);
      this.bumpGuideRevision(layer.id);
      this.foldedMaskTextures.set(layer.id, {
        texture: folded,
        lastInputs: snapshot,
        lastInvert: layer.mask.invert,
      });
    }
    return this.refine(
      layer.id,
      this.edge(layer, folded, colorView, encoder, pendingDestroy),
      layer.mask.refineEdge,
      encoder,
      pendingDestroy,
    );
  }
  private upload(
    texture: GPUTexture,
    data: Uint8Array,
    w: number,
    h: number,
    rect?: DirtyRect,
  ) {
    const r = computeR8UploadRegion(w, h, rect);
    this.ctx.device.queue.writeTexture(
      { texture, origin: r.origin },
      data as BufferSource,
      r.dataLayout,
      [r.size.width, r.size.height],
    );
  }
  private getWhiteMask() {
    if (!this.whiteMask) {
      this.whiteMask = this.ctx.device.createTexture({
        size: [1, 1],
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.upload(this.whiteMask, new Uint8Array([255]), 1, 1);
    }
    return this.whiteMask;
  }
  private getLiveMaskTexture(
    id: string,
    raster: Uint8Array,
    scope: MaskUploadScope,
  ) {
    if (!this.liveMaskTexture)
      this.liveMaskTexture = this.ctx.device.createTexture({
        size: [this.width, this.height],
        format: "r8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.COPY_SRC,
      });
    const rect =
      scope.kind === "partial" && this.liveMaskLayerId === id
        ? scope.rect
        : undefined;
    this.upload(this.liveMaskTexture, raster, this.width, this.height, rect);
    if (!rect) this.liveMaskLayerId = id;
    return this.liveMaskTexture;
  }
  private resident(
    id: string,
    source: MaskSource,
    encoder: GPUCommandEncoder,
    pending: (GPUTexture | GPUBuffer)[],
  ): GPUTexture {
    if (source.type !== "brush")
      return this.parametric(id, source, encoder, pending);
    const key = `${id}:${source.id}`,
      raster = source.raster,
      old = this.sourceTextures.get(key);
    if (old?.syncedFrom === raster) return old.texture;
    this.diag.residentRecompute++;
    const texture =
      old?.texture ??
      this.ctx.device.createTexture({
        size: [this.width, this.height],
        format: "r8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.COPY_SRC,
      });
    if (this.liveMaskLayerId === id && this.liveMaskTexture) {
      encoder.copyTextureToTexture(
        { texture: this.liveMaskTexture },
        { texture },
        [this.width, this.height],
      );
      this.liveMaskLayerId = null;
    } else this.upload(texture, raster, this.width, this.height);
    this.sourceTextures.set(key, { texture, syncedFrom: raster });
    this.bumpRevision(id);
    this.bumpGuideRevision(id);
    return texture;
  }
  private parametric(
    id: string,
    source: ParametricMaskSource,
    encoder: GPUCommandEncoder,
    pending: (GPUTexture | GPUBuffer)[],
  ): GPUTexture {
    const key = `${id}:${source.id}`,
      old = this.parametricSourceTextures.get(key);
    if (old?.syncedFrom === source.params) return old.texture;
    this.diag.parametricRecompute++;
    const texture =
      old?.texture ??
      this.ctx.device.createTexture({
        size: [this.width, this.height],
        format: "r8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC,
      });
    const module = getMaskSourceModule(source.type),
      count = PARAM_COUNT_BY_TYPE[source.type],
      // `angle` (source gradient) est une commodité de saisie UI — le
      // contrat wgsl documenté par chaque module (mask/sources/*.ts) ne le
      // liste jamais parmi ses slots. flatten() sérialise Object.keys(defaults)
      // dans l'ordre : le laisser passer décale tous les params suivants d'un
      // cran (ex. `feather` recevait la valeur d'`endY`). Voir gradient.ts.
      wgslDefaults =
        "angle" in module.defaultParams
          ? Object.fromEntries(Object.entries(module.defaultParams).filter(([k]) => k !== "angle"))
          : module.defaultParams,
      flat = this.flatten(source.params, wgslDefaults, count),
      buffer = this.ctx.device.createBuffer({
        size: flat.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    this.ctx.device.queue.writeBuffer(buffer, 0, flat as BufferSource);
    const key2 = `parametric:${source.type}:${count}`;
    let c = this.maskSourcePipelineCache.get(key2);
    if (!c) {
      const layout = this.ctx.device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: "filtering" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          },
          // DIMENSIONS DU MASQUE (= celles du DOCUMENT), et non celles de la
          // photo. Une source qui a besoin d'un espace ISOTROPE — le dégradé
          // radial, qui doit rendre un cercle et pas une ellipse — ne peut pas
          // les prendre sur `srcColor` : le résolveur y sert la photo la plus
          // BASSE de la pile, dont l'aspect n'est pas celui de la toile
          // (ADR-0007 : le format de toile se choisit à la création). Les lire
          // là aurait donné un masque juste tant que toile == photo, et faux
          // dès qu'elles divergent — le genre de défaut qui dort.
          {
            binding: 3,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          },
        ],
      });
      const code = wrapMaskSourceWgsl(module.wgsl, count);
      c = {
        layout,
        pipeline: this.ctx.device.createRenderPipeline({
          layout: this.ctx.device.createPipelineLayout({
            bindGroupLayouts: [layout],
          }),
          vertex: {
            module: this.ctx.device.createShaderModule({ code }),
            entryPoint: "vs_main",
          },
          fragment: {
            module: this.ctx.device.createShaderModule({ code }),
            entryPoint: "fs_wrapped",
            targets: [{ format: "r8unorm" }],
          },
          primitive: { topology: "triangle-list" },
        }),
      };
      this.maskSourcePipelineCache.set(key2, c);
    }
    // 16 octets pour deux flottants : la taille d'un binding uniform doit être
    // un multiple de 16 (règle d'alignement WebGPU), pas seulement des 8 que
    // pèse un `vec2<f32>`.
    const dimsBuffer = this.ctx.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.ctx.device.queue.writeBuffer(
      dimsBuffer,
      0,
      new Float32Array([this.width, this.height, 0, 0]) as BufferSource,
    );
    const bind = this.ctx.device.createBindGroup({
      layout: c.layout,
      entries: [
        { binding: 0, resource: this.sourceColor().createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer } },
        { binding: 3, resource: { buffer: dimsBuffer } },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(c.pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    pending.push(buffer);
    // Même cycle de vie que le buffer de paramètres : détruit APRÈS la
    // soumission de la frame, jamais avant. Un buffer oublié ici fuirait à
    // chaque régénération de masque.
    pending.push(dimsBuffer);
    this.parametricSourceTextures.set(key, {
      texture,
      syncedFrom: source.params,
    });
    this.bumpRevision(id);
    this.bumpGuideRevision(id);
    return texture;
  }
  private flatten(
    params: Record<string, number | number[]> | null,
    defaults: Record<string, number | number[]>,
    count: number,
  ) {
    const out = new Float32Array(count),
      p = params ?? defaults;
    if ("samples" in defaults) {
      const s = (p.samples as number[] | undefined) ?? [];
      out[0] = (p.tolerance as number) ?? 0.15;
      out[1] = (p.hardness as number) ?? 0.5;
      out[2] = (p.invert as number) ?? 0;
      out[3] = Math.min(s.length / 3, 6);
      for (let i = 0; i < Math.min(s.length, 18); i++) out[4 + i] = s[i];
      return out;
    }
    let i = 0;
    for (const k of Object.keys(defaults)) {
      if (i >= count) break;
      out[i++] = (p[k] as number) ?? (defaults[k] as number);
    }
    return out;
  }
  private pair(map: Map<string, [GPUTexture, GPUTexture]>, id: string) {
    let p = map.get(id);
    if (!p) {
      const make = () =>
        this.ctx.device.createTexture({
          size: [this.width, this.height],
          format: "r8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.COPY_SRC,
        });
      p = [make(), make()];
      map.set(id, p);
    }
    return p;
  }
  private maskPipeline(
    wgsl: string,
    b: "none" | "texture" | "uniform",
    entry: string,
  ) {
    let c = this.maskFoldPipelineCache.get(wgsl);
    if (c) return c;
    const e: GPUBindGroupLayoutEntry[] = [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
    ];
    if (b === "texture")
      e.push({
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      });
    if (b === "uniform")
      e.push({
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      });
    const layout = this.ctx.device.createBindGroupLayout({ entries: e });
    c = {
      layout,
      pipeline: this.ctx.device.createRenderPipeline({
        layout: this.ctx.device.createPipelineLayout({
          bindGroupLayouts: [layout],
        }),
        vertex: {
          module: this.ctx.device.createShaderModule({ code: wgsl }),
          entryPoint: "vs_main",
        },
        fragment: {
          module: this.ctx.device.createShaderModule({ code: wgsl }),
          entryPoint: entry,
          targets: [{ format: "r8unorm" }],
        },
        primitive: { topology: "triangle-list" },
      }),
    };
    this.maskFoldPipelineCache.set(wgsl, c);
    return c;
  }
  private pass(
    encoder: GPUCommandEncoder,
    w: string,
    a: GPUTexture,
    b: GPUTexture | null,
    target: GPUTexture,
    u?: GPUBuffer,
  ) {
    const entry = w.match(/\bfn (fs_\w+)\s*\(/)?.[1];
    if (!entry) throw new Error("runMaskPass: no fs entry point");
    const c = this.maskPipeline(
        w,
        b ? "texture" : u ? "uniform" : "none",
        entry,
      ),
      entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: a.createView() },
        { binding: 1, resource: this.sampler },
      ];
    if (b) entries.push({ binding: 2, resource: b.createView() });
    else if (u) entries.push({ binding: 2, resource: { buffer: u } });
    const bg = this.ctx.device.createBindGroup({ layout: c.layout, entries }),
      rp = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: target.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      });
    rp.setPipeline(c.pipeline);
    rp.setBindGroup(0, bg);
    rp.draw(3);
    rp.end();
  }
  private fold(
    id: string,
    plan: MaskSource[],
    invert: boolean,
    e: GPUCommandEncoder,
    p: (GPUTexture | GPUBuffer)[],
  ) {
    const [a, b] = this.pair(this.foldPingPongByLayer, id);
    e.copyTextureToTexture(
      { texture: this.resident(id, plan[0], e, p) },
      { texture: a },
      [this.width, this.height],
    );
    let acc = a,
      next = b;
    for (let i = 1; i < plan.length; i++) {
      this.pass(
        e,
        buildCombineWgsl(plan[i].combineMode),
        acc,
        this.resident(id, plan[i], e, p),
        next,
      );
      [acc, next] = [next, acc];
    }
    if (invert) {
      this.pass(e, buildInvertWgsl(), acc, null, next);
      [acc, next] = [next, acc];
    }
    return acc;
  }
  private edge(
    layer: LayerState,
    input: GPUTexture,
    color: GPUTextureView,
    e: GPUCommandEncoder,
    p: (GPUTexture | GPUBuffer)[],
  ) {
    const x = layer.mask.refineEdge;
    const active = x.edgeAware && x.edgeStrength > 0;
    // Bascule ON<->OFF : `input` (côté refine() en aval) passe de la sortie
    // filtrée du filtre guidé au masque brut, ou inversement — un contenu
    // différent même si aucune passe GPU ne s'exécute ici dans le cas OFF
    // (retour direct de `input`, sans bump interne à edgePipeline).
    if (this.lastEdgeAwareActiveByLayer.get(layer.id) !== active) {
      this.bumpRevision(layer.id);
      this.lastEdgeAwareActiveByLayer.set(layer.id, active);
    }
    if (!active) {
      this.diag.edgeInactif++;
      return input;
    }
    return this.edgePipeline(layer.id, input, color, x, e, p);
  }
  private computeSmallDims(): { smallW: number; smallH: number; scale: number } {
    const CAP = 2048;
    const scale = Math.min(1, CAP / Math.max(this.width, this.height));
    return {
      smallW: Math.max(1, Math.round(this.width * scale)),
      smallH: Math.max(1, Math.round(this.height * scale)),
      scale,
    };
  }
  private edgePipeline(
    id: string,
    input: GPUTexture,
    color: GPUTextureView,
    x: RefineEdgeParams,
    e: GPUCommandEncoder,
    p: (GPUTexture | GPUBuffer)[],
  ) {
    const { smallW, smallH, scale } = this.computeSmallDims();
    let w = this.edgeAwareWorkTextures.get(id);
    if (!w) {
      const mkFull = (format: GPUTextureFormat, extraUsage = 0) =>
        this.ctx.device.createTexture({
          size: [this.width, this.height],
          format,
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.RENDER_ATTACHMENT |
            extraUsage,
        });
      const mkSmall = (format: GPUTextureFormat, extraUsage = 0) =>
        this.ctx.device.createTexture({
          size: [smallW, smallH],
          format,
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.RENDER_ATTACHMENT |
            extraUsage,
        });
      w = {
        luminance: mkFull("r8unorm"),
        // COPY_SRC : refine() copie ce texture juste après edgePipeline()
        // (voir refine(), commentaire d'origine conservé).
        result: mkFull("r8unorm", GPUTextureUsage.COPY_SRC),
        luminanceSmall: mkSmall("r8unorm"),
        inputSmall: mkSmall("r8unorm"),
        packedIp: mkSmall("rg8unorm"),
        squareCorr: mkSmall("rg16float"),
        // COPY_DST : cible de copyTextureToTexture depuis satScratchA/B
        // (résultat de buildSat()) — voir needsGuide ci-dessous.
        satIp: mkSmall("rg32float", GPUTextureUsage.COPY_DST),
        satCorr: mkSmall("rg32float", GPUTextureUsage.COPY_DST),
        // COPY_SRC : source du copyTextureToTexture vers satIp/satCorr —
        // buildSat() retourne toujours l'une de ces deux textures.
        satScratchA: mkSmall("rg32float", GPUTextureUsage.COPY_SRC),
        satScratchB: mkSmall("rg32float", GPUTextureUsage.COPY_SRC),
        meanIp: mkSmall("rg16float"),
        corr: mkSmall("rg16float"),
        ab: mkSmall("rg16float"),
        meanAB: mkSmall("rg16float"),
        lastGuideRevision: NaN,
        lastRevision: NaN,
        lastRadius: NaN,
        lastStrength: NaN,
      };
      this.edgeAwareWorkTextures.set(id, w);
    }
    const guideRev = this.guideRevision(id);
    const needsGuide = w.lastGuideRevision !== guideRev;
    const maskRev = this.revision(id);
    const needsAB =
      needsGuide ||
      w.lastRevision !== maskRev ||
      w.lastRadius !== x.edgeRadius ||
      w.lastStrength !== x.edgeStrength;
    if (!needsGuide && !needsAB) {
      this.diag.edgeHit++;
      return w.result;
    }
    if (needsGuide) this.diag.satGuide++;
    if (needsAB) this.diag.lookupAB++;
    // Même contrat que l'ancien cache à un seul palier : refine() (en
    // aval) sert un résultat périmé si ce bump n'a pas lieu quand le
    // contenu de `result` change réellement (voir commentaire d'origine).
    this.bumpRevision(id);
    const run = (
      wgsl: string,
      entry: string,
      target: GPUTexture,
      views: GPUTextureView[],
      u?: GPUBuffer,
    ) => {
      const key = `${entry}:${wgsl.length}`;
      let c = this.edgeAwarePipelineCache.get(key);
      if (!c) {
        const entries: GPUBindGroupLayoutEntry[] = [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        ];
        for (let i = 1; i < views.length; i++)
          entries.push({ binding: 1 + i, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
        if (u) entries.push({ binding: 1 + views.length, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
        const layout = this.ctx.device.createBindGroupLayout({ entries });
        c = {
          layout,
          pipeline: this.ctx.device.createRenderPipeline({
            layout: this.ctx.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
            vertex: { module: this.ctx.device.createShaderModule({ code: wgsl }), entryPoint: "vs_main" },
            fragment: { module: this.ctx.device.createShaderModule({ code: wgsl }), entryPoint: entry, targets: [{ format: target.format }] },
            primitive: { topology: "triangle-list" },
          }),
        };
        this.edgeAwarePipelineCache.set(key, c);
      }
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: views[0] },
        { binding: 1, resource: this.nearestSampler },
      ];
      for (let i = 1; i < views.length; i++) entries.push({ binding: 1 + i, resource: views[i] });
      if (u) entries.push({ binding: 1 + views.length, resource: { buffer: u } });
      const rp = e.beginRenderPass({
        colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      rp.setPipeline(c.pipeline);
      rp.setBindGroup(0, this.ctx.device.createBindGroup({ layout: c.layout, entries }));
      rp.draw(3);
      rp.end();
    };
    // `runLoad` et `uniform` sont devenus des METHODES le 2026-08-13 : le
    // feather en a besoin lui aussi (voir `buildRefineSat`), et les recopier
    // aurait fait deux implementations d'un meme encodage de passe SAT, libres
    // de deriver. Ces deux lignes ne font que leur redonner leur nom local.
    const runLoad = (
      wgsl: string,
      entry: string,
      target: GPUTexture,
      views: GPUTextureView[],
      u?: GPUBuffer,
    ) => this.runLoadPass(e, wgsl, entry, target, views, u);
    const uniform = (v: number) => this.uniformBuffer(v, p);
    /** Construit la SAT complète (widen + scan H + scan V) à partir d'une
     *  vue source, en réutilisant `satScratchA`/`satScratchB` comme
     *  ping-pong. Retourne la texture (A ou B) qui porte le résultat
     *  final — le choix dépend de la parité du nombre total de passes. */
    const buildSat = (seedView: GPUTextureView): GPUTexture => {
      runLoad(buildSatWidenWgsl(), "fs_satWiden", w!.satScratchA, [seedView]);
      let src = w!.satScratchA, dst = w!.satScratchB;
      const stepsH = Math.max(1, Math.ceil(Math.log2(smallW)));
      for (let k = 0; k < stepsH; k++) {
        runLoad(buildSatScanWgsl("H"), "fs_satScanH", dst, [src.createView()], uniform(2 ** k));
        [src, dst] = [dst, src];
      }
      const stepsV = Math.max(1, Math.ceil(Math.log2(smallH)));
      for (let k = 0; k < stepsV; k++) {
        runLoad(buildSatScanWgsl("V"), "fs_satScanV", dst, [src.createView()], uniform(2 ** k));
        [src, dst] = [dst, src];
      }
      return src;
    };
    const scaledRadius = Math.max(x.edgeRadius * scale, 1.0);
    const iv = input.createView();
    if (needsGuide) {
      run(buildLuminanceWgsl(), "fs_luminance", w.luminance, [color]);
      run(buildDownsampleWgsl(), "fs_downsample", w.luminanceSmall, [w.luminance.createView()]);
      run(buildDownsampleWgsl(), "fs_downsample", w.inputSmall, [iv]);
      run(buildPackWgsl(), "fs_pack", w.packedIp, [w.luminanceSmall.createView(), w.inputSmall.createView()]);
      run(buildSquareCorrWgsl(), "fs_squareCorr", w.squareCorr, [w.packedIp.createView()]);
      const ip = buildSat(w.packedIp.createView());
      if (ip !== w.satIp) {
        e.copyTextureToTexture({ texture: ip }, { texture: w.satIp }, [smallW, smallH]);
      }
      const corrSat = buildSat(w.squareCorr.createView());
      if (corrSat !== w.satCorr) {
        e.copyTextureToTexture({ texture: corrSat }, { texture: w.satCorr }, [smallW, smallH]);
      }
      w.lastGuideRevision = guideRev;
    }
    if (needsAB) {
      const rUniform = uniform(scaledRadius);
      runLoad(buildSatLookupWgsl(), "fs_satLookup", w.meanIp, [w.satIp.createView()], rUniform);
      runLoad(buildSatLookupWgsl(), "fs_satLookup", w.corr, [w.satCorr.createView()], uniform(scaledRadius));
      run(buildComputeABWgsl(), "fs_computeAB", w.ab, [w.meanIp.createView(), w.corr.createView()]);
      const abSat = buildSat(w.ab.createView());
      runLoad(buildSatLookupWgsl(), "fs_satLookup", w.meanAB, [abSat.createView()], uniform(scaledRadius));
      const s = uniform(x.edgeStrength);
      run(buildCompositeWgsl(), "fs_composite", w.result, [w.meanAB.createView(), w.luminance.createView(), iv], s);
      // Relire this.revision(id) plutôt que réutiliser `maskRev` (capturé
      // AVANT this.bumpRevision(id) ci-dessus) : le self-bump inconditionnel
      // avance déjà la révision une fois par appel — stocker la valeur
      // pré-bump ferait que la comparaison `w.lastRevision !== this.revision(id)`
      // échoue à CHAQUE appel suivant (chemin bon marché rejoué à l'infini
      // même sans changement réel). Écart au brief détecté aux tests, voir
      // task-3-report.md.
      w.lastRevision = this.revision(id);
      w.lastRadius = x.edgeRadius;
      w.lastStrength = x.edgeStrength;
    }
    return w.result;
  }
  /** Encode une passe fullscreen qui LIT ses entrées par `textureLoad` (donc
   *  sans échantillonneur) vers `target`. Extraite d'`edgePipeline` le
   *  2026-08-13 pour que le feather puisse construire sa SAT avec le même
   *  encodage — deux copies auraient pu diverger sur le format de binding ou
   *  la clé de cache de pipeline. */
  private runLoadPass(
    e: GPUCommandEncoder,
    wgsl: string,
    entry: string,
    target: GPUTexture,
    views: GPUTextureView[],
    u?: GPUBuffer,
  ): void {
    // ⚠️ LE FORMAT DE LA CIBLE FAIT PARTIE DE LA CLE. Un pipeline est compile
    // pour UN format de cible (`targets: [{ format: target.format }]`) ; deux
    // appels au meme shader vers des formats differents doivent donc obtenir
    // deux pipelines. Sans ce fragment, le feather (cible r8unorm) et le filtre
    // guide (cibles rg16float/rg32float) partageaient le meme `fs_satLookup` :
    // le premier arrive fixait le format, le second recuperait un pipeline
    // incompatible.
    //
    // Le defaut ne LEVE pas — la validation WebGPU est asynchrone ici. Il rend
    // le pipeline NON REPRODUCTIBLE : `test:render` a refuse de comparer quoi
    // que ce soit en constatant que deux executions du meme code ne rendaient
    // pas la meme image (196118 canaux sur 196118). C'est le garde de
    // reproductibilite qui l'a trouve, pas une comparaison de reference.
    const key = `${entry}:${wgsl.length}:${target.format}:load`;
    let c = this.edgeAwarePipelineCache.get(key);
    if (!c) {
      const entries: GPUBindGroupLayoutEntry[] = [];
      for (let i = 0; i < views.length; i++)
        entries.push({ binding: i, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } });
      if (u) entries.push({ binding: views.length, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
      const layout = this.ctx.device.createBindGroupLayout({ entries });
      c = {
        layout,
        pipeline: this.ctx.device.createRenderPipeline({
          layout: this.ctx.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          vertex: { module: this.ctx.device.createShaderModule({ code: wgsl }), entryPoint: "vs_main" },
          fragment: { module: this.ctx.device.createShaderModule({ code: wgsl }), entryPoint: entry, targets: [{ format: target.format }] },
          primitive: { topology: "triangle-list" },
        }),
      };
      this.edgeAwarePipelineCache.set(key, c);
    }
    const entries: GPUBindGroupEntry[] = [];
    for (let i = 0; i < views.length; i++) entries.push({ binding: i, resource: views[i] });
    if (u) entries.push({ binding: views.length, resource: { buffer: u } });
    const rp = e.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    rp.setPipeline(c.pipeline);
    rp.setBindGroup(0, this.ctx.device.createBindGroup({ layout: c.layout, entries }));
    rp.draw(3);
    rp.end();
  }

  /** Construit (ou réutilise) la SAT pleine résolution du feather de ce calque.
   *
   *  Reconstruite UNIQUEMENT si la révision amont ou `contract` diffèrent de la
   *  dernière construction — c'est-à-dire si ce que la SAT résume a changé.
   *  Bouger le seul curseur de feather relit donc une SAT déjà construite, et
   *  c'est là qu'est tout le gain : le geste qu'Antoine a signalé deux fois.
   *
   *  Pas de sous-échantillonnage, contrairement au filtre guidé d'`edgePipeline`
   *  qui plafonne son travail à ~2048 px : un lookup SAT est EXACT, et réduire
   *  l'entrée d'un feather déplacerait son bord. */
  private buildRefineSat(
    id: string,
    input: GPUTexture,
    contract: number,
    revision: number,
    e: GPUCommandEncoder,
    p: (GPUTexture | GPUBuffer)[],
  ): GPUTexture {
    let w = this.refineSatByLayer.get(id);
    if (!w) {
      const mk = () =>
        this.ctx.device.createTexture({
          size: [this.width, this.height],
          format: "r32float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        });
      const scratchA = mk(),
        scratchB = mk();
      w = { scratchA, scratchB, result: scratchA, lastRevision: NaN, lastContract: NaN };
      this.refineSatByLayer.set(id, w);
    }
    if (w.lastRevision === revision && w.lastContract === contract) return w.result;

    this.runLoadPass(e, buildSatWidenWgsl(), "fs_satWiden", w.scratchA, [input.createView()]);
    let src = w.scratchA,
      dst = w.scratchB;
    const scan = (direction: "H" | "V", etendue: number) => {
      const etapes = Math.max(1, Math.ceil(Math.log2(etendue)));
      for (let k = 0; k < etapes; k++) {
        this.runLoadPass(
          e,
          buildSatScanWgsl(direction),
          direction === "H" ? "fs_satScanH" : "fs_satScanV",
          dst,
          [src.createView()],
          this.uniformBuffer(2 ** k, p),
        );
        [src, dst] = [dst, src];
      }
    };
    scan("H", this.width);
    scan("V", this.height);
    w.result = src;
    w.lastRevision = revision;
    w.lastContract = contract;
    return src;
  }

  /** Buffer d'uniform jetable (un flottant), détruit après la soumission. */
  private uniformBuffer(v: number, p: (GPUTexture | GPUBuffer)[]): GPUBuffer {
    const b = this.ctx.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.ctx.device.queue.writeBuffer(b, 0, new Float32Array([v, 0, 0, 0]));
    p.push(b);
    return b;
  }

  private refine(
    id: string,
    input: GPUTexture,
    x: RefineEdgeParams,
    e: GPUCommandEncoder,
    p: (GPUTexture | GPUBuffer)[],
  ) {
    // Le PLAN (quelles passes, dans quel ordre) est une fonction pure testée
    // en env Node — `planRefine`, src/mask/refinePlan.ts. Cette méthode-ci ne
    // fait plus que le CONSOMMER : elle mappe chaque passe vers sa source WGSL
    // et l'encode sur le ping-pong. Plan vide == rien à faire (contrat de
    // planRefine), on rend l'entrée telle quelle sans même la copier.
    const plan = planRefine(x);
    if (plan.length === 0) {
      this.diag.refinePlanVide++;
      return input;
    }
    const cached = this.refineCache.get(id);
    if (
      cached &&
      cached.lastRevision === this.revision(id) &&
      cached.lastFeather === x.feather &&
      cached.lastContract === x.contract &&
      cached.lastSmooth === x.smooth
    ) {
      this.diag.refineHit++;
      return cached.texture;
    }
    this.diag.refineMiss++;
    let [acc, next] = this.pair(this.refineEdgePingPongByLayer, id);
    e.copyTextureToTexture({ texture: input }, { texture: acc }, [
      this.width,
      this.height,
    ]);
    const u = (v: number) => {
      const b = this.ctx.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.ctx.device.queue.writeBuffer(b, 0, new Float32Array([v, 0, 0, 0]));
      p.push(b);
      return b;
    };
    const run = (w: string, v: number) => {
      this.pass(e, w, acc, null, next, u(v));
      [acc, next] = [next, acc];
    };
    // Toutes les passes réutilisent le MÊME ping-pong via `run` : aucune
    // texture intermédiaire nouvelle, et rien ne survit à l'appel — chaque
    // passe repart d'un loadOp clear. La morphologie y est SÉPARÉE en deux
    // passes 1D (H puis V), exactement équivalente à l'ancienne fenêtre carrée
    // (2r+1)² pour 2*(2r+1) échantillons par pixel : facteur 50 à r=50
    // (équivalence prouvée dans test/mask/morphologySeparable.test.ts, compte
    // de passes prouvé dans test/mask/refinePlan.test.ts).
    let featherEncode = false;
    for (const passe of plan) {
      if (passe.kind === "morphology") {
        run(buildMorphologyWgsl(passe.mode, passe.axis), passe.radius);
      } else if (passe.kind === "featherSat") {
        // La SAT resume l'etat COURANT du ping-pong, donc apres la morphologie
        // — d'ou sa dependance a `contract` et non au seul contenu du masque.
        const sat = this.buildRefineSat(id, acc, x.contract, this.revision(id), e, p);
        // Lookup dedie au feather (profil en S, quatre fenetres) — PAS le
        // `fs_satLookup` d'edgeAwareWgsl, qui reste un box pur pour le guided
        // filter. Meme table, meme cache, meme cout plat au rayon.
        this.runLoadPass(e, buildFeatherLookupWgsl(), "fs_featherLookup", next, [sat.createView()], u(passe.radius));
        [acc, next] = [next, acc];
        featherEncode = true;
      } else {
        run(
          passe.axis === "H" ? buildBoxFilterHWgsl(1) : buildBoxFilterVWgsl(1),
          passe.radius,
        );
      }
    }
    // Rendre les ~208 Mo des que le feather cesse d'etre demande, sans attendre
    // la disparition du calque : c'est ce qui distingue une allocation
    // paresseuse d'une allocation simplement differee.
    if (!featherEncode) this.destroyRefineSat(id);
    this.refineCache.set(id, {
      texture: acc,
      lastRevision: this.revision(id),
      lastFeather: x.feather,
      lastContract: x.contract,
      lastSmooth: x.smooth,
    });
    return acc;
  }
  private destroyWork(w: EdgeWork) {
    w.luminance.destroy();
    w.result.destroy();
    w.luminanceSmall.destroy();
    w.inputSmall.destroy();
    w.packedIp.destroy();
    w.squareCorr.destroy();
    w.satIp.destroy();
    w.satCorr.destroy();
    w.satScratchA.destroy();
    w.satScratchB.destroy();
    w.meanIp.destroy();
    w.corr.destroy();
    w.ab.destroy();
    w.meanAB.destroy();
  }
  dispose() {
    this.whiteMask?.destroy();
    this.liveMaskTexture?.destroy();
    for (const e of this.sourceTextures.values()) e.texture.destroy();
    for (const e of this.parametricSourceTextures.values()) e.texture.destroy();
    for (const e of this.foldedMaskTextures.values()) e.texture.destroy();
    for (const [a, b] of this.foldPingPongByLayer.values()) {
      a.destroy();
      b.destroy();
    }
    for (const [a, b] of this.refineEdgePingPongByLayer.values()) {
      a.destroy();
      b.destroy();
    }
    for (const w of this.edgeAwareWorkTextures.values()) this.destroyWork(w);
    // Les SAT de feather POSSÈDENT leurs textures, comme le dit `sweep` —
    // deux `r32float` pleine taille, ~208 Mo à 26 Mpx. Elles manquaient ici :
    // `sweep` les libérait quand un calque disparaissait, `destroyRefineSat`
    // quand le feather retombait à 0, et le démontage du résolveur lui-même
    // les laissait sur le GPU. Le geste qui compte est l'ouverture d'un
    // fichier, qui passe par `dispose()` et non par `sweep`.
    for (const id of [...this.refineSatByLayer.keys()]) this.destroyRefineSat(id);
    this.sourceTextures.clear();
    this.parametricSourceTextures.clear();
    this.foldedMaskTextures.clear();
    this.foldPingPongByLayer.clear();
    this.refineEdgePingPongByLayer.clear();
    this.edgeAwareWorkTextures.clear();
    this.refineCache.clear();
    this.maskRevision.clear();
    // Métadonnées pures, mais purgées pour la même raison que dans `sweep` :
    // une révision ou une epoch survivante ferait servir un cache dont les
    // textures viennent d'être détruites. `guideRevisionByLayer` était balayée
    // sans être vidée ici, et `lastGuideEpochByLayer` ne l'était nulle part.
    this.guideRevisionByLayer.clear();
    this.lastGuideEpochByLayer.clear();
    this.lastInvertByLayer.clear();
    this.lastEdgeAwareActiveByLayer.clear();
    this.maskSourcePipelineCache.clear();
    this.maskFoldPipelineCache.clear();
    this.edgeAwarePipelineCache.clear();
    this.whiteMask = null;
    this.liveMaskTexture = null;
    this.liveMaskLayerId = null;
    this.livePreview = null;
  }
}
