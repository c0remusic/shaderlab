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
import { buildMorphologyWgsl } from "../mask/refineEdgeWgsl";
import { getMaskSourceModule } from "../mask/sources/registry";
import {
  buildLuminanceWgsl,
  buildPackWgsl,
  buildSquareCorrWgsl,
  buildBoxFilterHWgsl,
  buildBoxFilterVWgsl,
  buildComputeABWgsl,
  buildCompositeWgsl,
} from "../mask/edgeAwareWgsl";

const PARAM_COUNT_BY_TYPE: Record<Exclude<MaskSourceType, "brush">, number> = {
  gradient: 8,
  luminosity: 8,
  colorRange: 32,
};
type Entry = { texture: GPUTexture; syncedFrom: unknown };
type PipelineEntry = {
  pipeline: GPURenderPipeline;
  layout: GPUBindGroupLayout;
};
type EdgeWork = {
  luminance: GPUTexture;
  packedIp: GPUTexture;
  squareCorr: GPUTexture;
  meanIp: GPUTexture;
  meanIpTmp: GPUTexture;
  corr: GPUTexture;
  corrTmp: GPUTexture;
  ab: GPUTexture;
  meanAB: GPUTexture;
  meanABTmp: GPUTexture;
  result: GPUTexture;
  /** Dernières entrées ayant produit `result` — si `revision`/`edgeRadius`/
   *  `edgeStrength` sont identiques au prochain appel, `result` est renvoyé
   *  tel quel sans rejouer les 11 passes du filtre guidé (coûteux : constaté
   *  responsable d'un ralentissement global de l'app, ce filtre tournait à
   *  chaque frame même quand seul un AUTRE calque/réglage changeait).
   *  `revision` (pas l'identité de la texture d'entrée) : `resident()`/
   *  `parametric()` RÉUTILISENT le même objet GPUTexture et le re-rendent
   *  quand le contenu change (leur propre cache par `syncedFrom`) — comparer
   *  `input === lastInput` aurait donc raté un changement de contenu réel
   *  (bug trouvé par crosscheck avant la première version de ce cache). */
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
  /** Compteur incrémenté par calque à chaque fois que le CONTENU de son
   *  masque résident change réellement (recompute dans resident()/
   *  parametric(), cache-miss du fold, ou bascule de `layer.mask.invert`) —
   *  jamais sur un cache-hit. Sert de clé de cache à edge()/refine() à la
   *  place de l'identité de texture, qui ne suffit pas : `resident()`/
   *  `parametric()` réutilisent le même objet GPUTexture d'un appel à
   *  l'autre en le re-rendant. */
  private maskRevision = new Map<string, number>();
  private lastInvertByLayer = new Map<string, boolean>();
  private maskSourcePipelineCache = new Map<string, PipelineEntry>();
  private maskFoldPipelineCache = new Map<string, PipelineEntry>();
  private edgeAwarePipelineCache = new Map<string, PipelineEntry>();
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
    for (const id of this.lastInvertByLayer.keys())
      if (!layerIds.has(id)) this.lastInvertByLayer.delete(id);
    for (const id of this.refineCache.keys())
      if (!layerIds.has(id)) this.refineCache.delete(id);
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
  ): GPUTexture {
    if (this.livePreview?.layerId === layer.id)
      return this.getLiveMaskTexture(
        layer.id,
        this.livePreview.raster,
        this.livePreview.scope,
      );
    const plan = planFold(layer.mask);
    if (!plan.length) return this.getWhiteMask();
    // Bascule d'`invert` seule (sans qu'aucune source n'ait changé) : le
    // contenu résultant change quand même — resident()/parametric() ne le
    // détecteraient pas seuls puisqu'ils ne voient jamais `invert`.
    if (this.lastInvertByLayer.get(layer.id) !== layer.mask.invert) {
      this.bumpRevision(layer.id);
      this.lastInvertByLayer.set(layer.id, layer.mask.invert);
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
    const folded = cacheHit
      ? cached!.texture
      : this.fold(layer.id, plan, layer.mask.invert, encoder, pendingDestroy);
    if (!cacheHit) {
      // Couvre aussi les cas où le fold change sans que resident()/
      // parametric() n'aient eux-mêmes recalculé (combineMode, enabled,
      // ajout/suppression de source) — le contenu du masque final change
      // quand même.
      this.bumpRevision(layer.id);
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
      flat = this.flatten(source.params, module.defaultParams, count),
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
        ],
      });
      const code = this.wrap(module.wgsl, count);
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
    const bind = this.ctx.device.createBindGroup({
      layout: c.layout,
      entries: [
        { binding: 0, resource: this.sourceColor().createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer } },
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
    this.parametricSourceTextures.set(key, {
      texture,
      syncedFrom: source.params,
    });
    this.bumpRevision(id);
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
  private wrap(g: string, n: number) {
    return `${FULLSCREEN_VERTEX_WGSL}\n@group(0) @binding(0) var srcColor: texture_2d<f32>;\n@group(0) @binding(1) var maskSampler: sampler;\n@group(0) @binding(2) var<uniform> genParams: array<f32, ${n}>;\n${g}\n@fragment fn fs_wrapped(in: VertexOut) -> @location(0) vec4<f32> { let color=textureSample(srcColor,maskSampler,in.uv).rgb; let v=fs_generate(in.uv,color,genParams); return vec4<f32>(v,v,v,1.0); }`;
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
    if (!x.edgeAware || x.edgeStrength <= 0) return input;
    return this.edgePipeline(layer.id, input, color, x, e, p);
  }
  private edgePipeline(
    id: string,
    input: GPUTexture,
    color: GPUTextureView,
    x: RefineEdgeParams,
    e: GPUCommandEncoder,
    p: (GPUTexture | GPUBuffer)[],
  ) {
    let w = this.edgeAwareWorkTextures.get(id);
    if (!w) {
      const mk = (format: GPUTextureFormat, extraUsage = 0) =>
        this.ctx.device.createTexture({
          size: [this.width, this.height],
          format,
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.RENDER_ATTACHMENT |
            extraUsage,
        });
      w = {
        luminance: mk("r8unorm"),
        packedIp: mk("rg8unorm"),
        squareCorr: mk("rg16float"),
        meanIp: mk("rg16float"),
        meanIpTmp: mk("rg16float"),
        corr: mk("rg16float"),
        corrTmp: mk("rg16float"),
        ab: mk("rg16float"),
        meanAB: mk("rg16float"),
        meanABTmp: mk("rg16float"),
        // COPY_SRC : `refine()` copie ce texture comme source d'un
        // copyTextureToTexture juste après edgePipeline() (voir refine(),
        // ligne ~714) — sans ce flag, la validation WebGPU rejette la
        // commande et invalide tout le command buffer de la frame (canvas
        // noir). Seul `result` sort de cette fonction ; les 10 autres
        // textures restent des buffers de travail internes qui n'ont
        // jamais besoin d'être copiés.
        result: mk("r8unorm", GPUTextureUsage.COPY_SRC),
        lastRevision: NaN,
        lastRadius: NaN,
        lastStrength: NaN,
      };
      this.edgeAwareWorkTextures.set(id, w);
    }
    if (
      w.lastRevision === this.revision(id) &&
      w.lastRadius === x.edgeRadius &&
      w.lastStrength === x.edgeStrength
    )
      return w.result;
    // `refine()` reçoit `w.result` en `input` et met SON PROPRE résultat en
    // cache sur cette même révision — sans ce bump, un changement de
    // edgeRadius/edgeStrength seul (edgeAware actif) recalculerait bien ici
    // mais laisserait refine() servir un résultat périmé en aval (trouvé par
    // crosscheck).
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
        for (let i = 1; i < views.length; i++)
          entries.push({
            binding: 1 + i,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float" },
          });
        if (u)
          entries.push({
            binding: 1 + views.length,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          });
        const layout = this.ctx.device.createBindGroupLayout({ entries });
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
              targets: [{ format: target.format }],
            },
            primitive: { topology: "triangle-list" },
          }),
        };
        this.edgeAwarePipelineCache.set(key, c);
      }
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: views[0] },
        { binding: 1, resource: this.nearestSampler },
      ];
      for (let i = 1; i < views.length; i++)
        entries.push({ binding: 1 + i, resource: views[i] });
      if (u)
        entries.push({ binding: 1 + views.length, resource: { buffer: u } });
      const rp = e.beginRenderPass({
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
      rp.setBindGroup(
        0,
        this.ctx.device.createBindGroup({ layout: c.layout, entries }),
      );
      rp.draw(3);
      rp.end();
    };
    const uniform = (v: number) => {
        const b = this.ctx.device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.ctx.device.queue.writeBuffer(b, 0, new Float32Array([v, 0, 0, 0]));
        p.push(b);
        return b;
      },
      r = uniform(x.edgeRadius),
      s = uniform(x.edgeStrength),
      iv = input.createView();
    run(buildLuminanceWgsl(), "fs_luminance", w.luminance, [color]);
    run(buildPackWgsl(), "fs_pack", w.packedIp, [w.luminance.createView(), iv]);
    run(buildSquareCorrWgsl(), "fs_squareCorr", w.squareCorr, [
      w.packedIp.createView(),
    ]);
    run(
      buildBoxFilterHWgsl(2),
      "fs_boxH",
      w.meanIpTmp,
      [w.packedIp.createView()],
      r,
    );
    run(
      buildBoxFilterVWgsl(2),
      "fs_boxV",
      w.meanIp,
      [w.meanIpTmp.createView()],
      r,
    );
    run(
      buildBoxFilterHWgsl(2),
      "fs_boxH",
      w.corrTmp,
      [w.squareCorr.createView()],
      r,
    );
    run(buildBoxFilterVWgsl(2), "fs_boxV", w.corr, [w.corrTmp.createView()], r);
    run(buildComputeABWgsl(), "fs_computeAB", w.ab, [
      w.meanIp.createView(),
      w.corr.createView(),
    ]);
    run(buildBoxFilterHWgsl(2), "fs_boxH", w.meanABTmp, [w.ab.createView()], r);
    run(
      buildBoxFilterVWgsl(2),
      "fs_boxV",
      w.meanAB,
      [w.meanABTmp.createView()],
      r,
    );
    run(
      buildCompositeWgsl(),
      "fs_composite",
      w.result,
      [w.meanAB.createView(), w.luminance.createView(), iv],
      s,
    );
    w.lastRevision = this.revision(id);
    w.lastRadius = x.edgeRadius;
    w.lastStrength = x.edgeStrength;
    return w.result;
  }
  private refine(
    id: string,
    input: GPUTexture,
    x: RefineEdgeParams,
    e: GPUCommandEncoder,
    p: (GPUTexture | GPUBuffer)[],
  ) {
    if (x.feather <= 0 && x.contract === 0 && x.smooth <= 0) return input;
    const cached = this.refineCache.get(id);
    if (
      cached &&
      cached.lastRevision === this.revision(id) &&
      cached.lastFeather === x.feather &&
      cached.lastContract === x.contract &&
      cached.lastSmooth === x.smooth
    )
      return cached.texture;
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
    if (x.contract)
      run(
        buildMorphologyWgsl(x.contract < 0 ? "erode" : "dilate"),
        Math.abs(x.contract),
      );
    if (x.feather) {
      run(buildBoxFilterHWgsl(1), x.feather);
      run(buildBoxFilterVWgsl(1), x.feather);
    }
    for (let i = 0; i < x.smooth; i++) {
      run(buildBoxFilterHWgsl(1), 1);
      run(buildBoxFilterVWgsl(1), 1);
    }
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
    w.packedIp.destroy();
    w.squareCorr.destroy();
    w.meanIp.destroy();
    w.meanIpTmp.destroy();
    w.corr.destroy();
    w.corrTmp.destroy();
    w.ab.destroy();
    w.meanAB.destroy();
    w.meanABTmp.destroy();
    w.result.destroy();
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
    this.sourceTextures.clear();
    this.parametricSourceTextures.clear();
    this.foldedMaskTextures.clear();
    this.foldPingPongByLayer.clear();
    this.refineEdgePingPongByLayer.clear();
    this.edgeAwareWorkTextures.clear();
    this.refineCache.clear();
    this.maskRevision.clear();
    this.lastInvertByLayer.clear();
    this.maskSourcePipelineCache.clear();
    this.maskFoldPipelineCache.clear();
    this.edgeAwarePipelineCache.clear();
    this.whiteMask = null;
    this.liveMaskTexture = null;
    this.liveMaskLayerId = null;
    this.livePreview = null;
  }
}
