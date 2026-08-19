import { FULLSCREEN_VERTEX_WGSL } from "./shaderCompose";
import type { LayerTransform } from "../layers/types";
import { clampTransformScale } from "../ui/transform";

/**
 * WGSL de la pré-passe de résolution d'entrée d'un calque de photo
 * (ARCHITECTURE.md §4.3, approche C2). Rend photo A transformée dans une
 * texture pleine taille alignée sur le fond : RGB = échantillon de photo A
 * à l'UV inverse-transformée, alpha = couverture (1 dans les bornes de la
 * photo avec un feather ~1px en espace photo, 0 hors bornes — jamais de
 * répétition/clamp de bord visible, barre de qualité : pas de cutoff
 * jaggy). La chaîne existante (passes internes, composite, masque, blend)
 * consomme le résultat comme n'importe quelle texture d'entrée normale, via
 * le binding conditionnel `hasImageSource` de `shaderCompose.ts`.
 */
export const PHOTO_LAYER_INPUT_WGSL = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var photoTexture: texture_2d<f32>;
@group(0) @binding(1) var photoSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, 10>;

@fragment
fn fs_photo_input(in: VertexOut) -> @location(0) vec4<f32> {
  let x = params[0];
  let y = params[1];
  let scaleX = params[2];
  let rotation = params[3];
  let bgWidth = params[4];
  let bgHeight = params[5];
  let photoWidth = params[6];
  let photoHeight = params[7];
  // Ajouté en 9e slot plutôt qu'en remplaçant un existant : les huit premiers
  // sont tous lus ci-dessous. Le 10e est un remplissage — garder un compte pair
  // évite d'avoir à raisonner sur l'alignement du uniform à chaque ajout.
  let scaleY = params[8];

  let px = in.uv.x * bgWidth;
  let py = in.uv.y * bgHeight;
  let dx = px - x;
  let dy = py - y;
  let c = cos(-rotation);
  let s = sin(-rotation);
  let rx = dx * c - dy * s;
  let ry = dx * s + dy * c;
  let lx = rx / scaleX;
  let ly = ry / scaleY;
  let photoPx = lx + photoWidth * 0.5;
  let photoPy = ly + photoHeight * 0.5;
  let photoUv = vec2<f32>(photoPx / photoWidth, photoPy / photoHeight);

  // I2 : edgeDistPx est mesuré en pixels PHOTO (avant application de
  // scale) - un feather de 1 pixel PHOTO ne fait qu'une fraction de pixel
  // ECRAN a scale<1 (bord crenele) et plusieurs pixels ECRAN a scale>1
  // (bord flou). On multiplie par scale pour ramener le feather en espace
  // ecran (1px ecran quel que soit le zoom de la photo).
  //
  // I5 : le + 0.5 CENTRE la rampe sur le bord, il ne la supprime pas.
  // in.uv echantillonne au CENTRE d'un texel : le texel i est lu en
  // (i + 0.5) / bgWidth, donc edgeDistPx * scale est la distance du
  // CENTRE du pixel au bord de la photo, pas sa couverture. Un pixel
  // entierement a l'interieur de la photo (le premier rang, centre a 0,5 px
  // du bord) sortait a 0,5 : d'ou le lisere sombre d'un pixel sur toute
  // photo ouverte, a l'ecran comme a l'export (mesure 2026-07-29 : 4x256-4
  // pixels du contour, rapport 0,73 en sRGB = 0,5 en lineaire).
  // La couverture analytique d'un pixel de 1px d'empreinte dont le centre
  // est a la distance signee d du bord vaut clamp(d + 0.5, 0, 1) : 1 quand
  // le pixel est entierement dedans (d = +0,5), 0,5 quand le bord passe
  // exactement par son centre (d = 0), 0 quand il est entierement dehors
  // (d = -0,5). La couverture PARTIELLE reste donc pleinement en vigueur —
  // une photo reduite ou deplacee dont le bord tombe au milieu d'un pixel
  // rend toujours une valeur intermediaire, c'est ce qui lui donne un bord
  // propre. Seul le cas « la photo couvre exactement la toile » redevient 1.
  // PAR AXE depuis que l'échelle en a deux. Une distance horizontale au bord
  // se ramène en pixels écran par scaleX, une verticale par scaleY : prendre le
  // minimum des distances PUIS multiplier par une échelle unique donnerait, sur
  // une photo étirée, un bord antialiasé correctement sur un axe et faux sur
  // l'autre — trop dur d'un côté, flou de l'autre. On ramène donc chaque
  // distance en espace écran AVANT de prendre le minimum.
  // MAGNITUDE de l'échelle, jamais son signe. Une échelle NÉGATIVE miroite le
  // calque (la division lignes 46-47 la veut signée) ; ici on ramène une
  // DISTANCE au bord en espace écran, et une distance n'a pas de signe. Sans
  // abs(), une échelle négative retourne la couverture : trou à la place de
  // l'image, bande opaque à côté, borné à l'axe miroité (ticket 05 §5). Ça
  // compile et valide sous naga — seule une référence de pixels qui miroite
  // l'attrape.
  let edgeDistScreen = min(
    min(photoPx, photoWidth - photoPx) * abs(scaleX),
    min(photoPy, photoHeight - photoPy) * abs(scaleY)
  );
  let coverage = clamp(edgeDistScreen + 0.5, 0.0, 1.0);

  let sample = textureSample(photoTexture, photoSampler, photoUv);
  return vec4<f32>(sample.rgb, coverage);
}
`;

export class PhotoLayerInputResolver {
  private pipeline: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  /** I4 : le resolver possède UNE texture cible persistante, PARTAGÉE par
   *  tous les calques photo de la frame, recréée seulement quand la taille
   *  du fond change — au lieu d'une texture bgWidth×bgHeight
   *  allouée+détruite à chaque frame (~96 Mo de churn/frame à 24MP), et au
   *  lieu d'une cible par calque photo (+96 Mo par calque à 24MP). N'est PAS
   *  poussée dans `pendingDestroy` (elle survit à la frame) — détruite
   *  uniquement par `dispose()` ou par un changement de taille de fond.
   *
   *  ⚠️ INVARIANT QUI REND LE PARTAGE CORRECT — c'est l'ORDRE DES PASSES,
   *  PAS « au plus un calque photo ». `MAX_PHOTO_LAYERS` vaut 5 (fond compris,
   *  valeur confirmée par la mesure VRAM du 2026-07-29, T4) :
   *  la justification historique par l'unicité est FAUSSE, ne pas la
   *  rétablir. Ce qui tient : les passes enregistrées dans un même
   *  `GPUCommandEncoder` s'exécutent dans l'ordre de soumission, et
   *  `FramePipelineExecutor` encode, calque par calque,
   *  `resolve(A) → passes(A) → resolve(B) → passes(B)`
   *  (`framePipelineExecutor.ts`, boucle sur `enabledLayers`). Les passes de
   *  A lisent donc la cible AVANT que le `resolve` de B ne la re-`clear`.
   *
   *  INTERDIT, en conséquence directe : mettre en cache un résultat de
   *  `resolve()` entre deux calques, ou différer/réordonner les passes d'un
   *  calque après le `resolve` d'un suivant. Le premier calque photo verrait
   *  alors les pixels du dernier. L'ordre est assuré en Node par
   *  `test/render/framePipelineExecutor.test.ts`, pas seulement par ce
   *  commentaire — trois tests, à ne pas chercher sous un nom unique :
   *  « calls the port once per photo layer… » (qui assère surtout que les deux
   *  calques partagent LE MÊME encoder), « feeds every photo layer a view of
   *  the SAME shared target texture », et « (e) l'ordre resolve(A) → passes(A)
   *  → passes(écrêtés de A) → resolve(B) est préservé ». */
  private cachedTarget: GPUTexture | null = null;
  private cachedWidth = 0;
  private cachedHeight = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly sampler: GPUSampler,
  ) {}

  private ensurePipeline(): { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout } {
    if (this.pipeline && this.bindGroupLayout) return { pipeline: this.pipeline, bindGroupLayout: this.bindGroupLayout };
    const module = this.device.createShaderModule({ code: PHOTO_LAYER_INPUT_WGSL });
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_photo_input", targets: [{ format: this.srgbFormat }] },
    });
    this.pipeline = pipeline;
    this.bindGroupLayout = bindGroupLayout;
    return { pipeline, bindGroupLayout };
  }

  /** Rend photo A transformée dans la texture cible persistante
   *  bgWidth×bgHeight (voir `cachedTarget`) — recréée seulement si la
   *  taille demandée diffère du cache actuel, sinon réutilisée telle
   *  quelle (elle est réécrite en entier par cette passe, `loadOp:
   *  "clear"`, donc aucune fuite de contenu d'une frame à l'autre). La
   *  texture cible N'EST PAS poussée dans `pendingDestroy` par cette
   *  méthode NI par l'appelant — elle survit à la frame, propriété du
   *  resolver, détruite seulement par `dispose()` ou un changement de
   *  taille. Seul le buffer d'uniform transitoire de CETTE passe est
   *  poussé ici. */
  resolve(
    encoder: GPUCommandEncoder,
    photoTexture: GPUTexture,
    photoWidth: number,
    photoHeight: number,
    bgWidth: number,
    bgHeight: number,
    transform: LayerTransform,
    pendingDestroy: (GPUTexture | GPUBuffer)[],
  ): GPUTexture {
    const { pipeline, bindGroupLayout } = this.ensurePipeline();
    if (!this.cachedTarget || this.cachedWidth !== bgWidth || this.cachedHeight !== bgHeight) {
      this.cachedTarget?.destroy();
      this.cachedTarget = this.device.createTexture({
        size: [bgWidth, bgHeight],
        format: this.srgbFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.cachedWidth = bgWidth;
      this.cachedHeight = bgHeight;
    }
    const target = this.cachedTarget;
    // I1 : clampTransformScale/MIN_TRANSFORM_SCALE (src/ui/transform.ts) est
    // la source unique de vérité pour le plancher d'échelle - jamais un
    // clamp dupliqué en WGSL. Sans ce clamp, un scale=0 (atteignable via un
    // futur import de preset, ARCHITECTURE.md R8) produirait `lx = rx /
    // scale` = division par zéro -> UV NaN côté GPU.
    const safeScaleX = clampTransformScale(transform.scaleX);
    const safeScaleY = clampTransformScale(transform.scaleY);
    // 10 valeurs pour `array<f32, 10>` : le 10e est un remplissage explicite,
    // pas un oubli. Écrire moins que ce que le shader déclare laisserait le
    // dernier slot indéterminé.
    const paramValues = new Float32Array([
      transform.x, transform.y, safeScaleX, transform.rotation,
      bgWidth, bgHeight, photoWidth, photoHeight,
      safeScaleY, 0,
    ]);
    const paramBuffer = this.device.createBuffer({ size: paramValues.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(paramBuffer, 0, paramValues);
    pendingDestroy.push(paramBuffer);

    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: photoTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: paramBuffer } },
      ],
    });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    return target;
  }

  dispose(): void {
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.cachedTarget?.destroy();
    this.cachedTarget = null;
    this.cachedWidth = 0;
    this.cachedHeight = 0;
  }
}
