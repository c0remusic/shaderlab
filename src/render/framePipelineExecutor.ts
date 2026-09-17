import type { LayerState } from "../layers/types";
import { guideChainKey, jetonApercuLive } from "../layers/contentKey";
import { MippedSourceCache } from "./mippedSource";
import type { GpuTiming } from "./gpuTiming";
import { photoGuideKey } from "../layers/photoLayer";
import { defaultLayerMask } from "../mask/types";
import { getEffect } from "./effects/registry";
import { PASSTHROUGH_EFFECT } from "./effectPassRunner";
import { developApplyOrder, isDevelopModuleAtDefault } from "./developRegistry";
import { isDevelopModuleEnabled, type DevelopSettings } from "../layers/developSettings";

type FrameResource = GPUTexture | GPUBuffer;

/** Descripteur de calque NEUTRE d'une passe qui doit se contenter de recopier
 *  son entrée : opacité pleine, fusion normale, masque par défaut, aucun
 *  paramètre. Sert au court-circuit « 0 calque activé » — couplé à
 *  `PASSTHROUGH_EFFECT`, dont le `fs_main` rend son entrée telle quelle : le
 *  mix de compositing ramène alors `color` quel que soit le masque résolu.
 *
 *  ⚠️ Il a eu un SECOND appelant jusqu'au 2026-08-21 : la neutralisation d'un
 *  calque écrêté dont la base photo n'était pas rendue. Il est parti avec
 *  l'écrêtage (ADR-0020) ; le court-circuit, lui, reste. */
function neutralPassLayer(): LayerState {
  return {
    id: "",
    effectId: "",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
  };
}

/** The persistent colour textures required to encode one frame.
 *
 *  `width`/`height` sont les dimensions du DOCUMENT, exposées explicitement
 *  plutôt que relues sur la texture de toile (design 2026-07-28 §1.4). La
 *  toile n'est plus la photo depuis la tranche T1 : lire sa taille pour
 *  dimensionner la pré-passe des calques photo ferait dépendre la géométrie du
 *  document d'une texture qui n'a plus de rapport avec elle, et bloquerait
 *  l'optimisation « toile 1×1 » (§8) comme une future toile de taille
 *  indépendante. */
export interface FrameResourcesPort {
  readonly canvasTexture: GPUTexture | null;
  readonly pingPong: [GPUTexture, GPUTexture] | null;
  readonly width: number;
  readonly height: number;
}

/** Stateless effect/overlay encoding. Frame submission remains outside this port. */
export interface EffectPassesPort {
  /** Chronomètre GPU par passe, ou absent. OPTIONNEL, et c'est le sujet : ce
   *  port est la frontière de test de la couche rendu, et tous ses doubles
   *  existants sont des objets littéraux. Le rendre requis les aurait tous fait
   *  rougir pour un instrument de diagnostic auquel ils n'ont rien à dire.
   *  L'exécuteur ne fait que relayer deux appels de cycle de vie
   *  (`endFrame`/`afterSubmit`) — il n'arme jamais rien lui-même. */
  timing?: GpuTiming | null;
  runEffectPass(
    encoder: GPUCommandEncoder,
    effect: ReturnType<typeof getEffect>,
    layer: LayerState,
    sourceView: GPUTextureView,
    targetView: GPUTextureView,
    options: { applyMask?: boolean; prevPassView?: GPUTextureView | null; auxPassView?: GPUTextureView | null; guideEpoch?: number; imageSourceView?: GPUTextureView | null; libraryTextureView?: GPUTextureView | null },
    pendingDestroy: FrameResource[],
  ): void;
  runInternalPasses(
    encoder: GPUCommandEncoder,
    effect: ReturnType<typeof getEffect>,
    layer: LayerState,
    sourceView: GPUTextureView,
    pendingDestroy: FrameResource[],
    // Texture de BIBLIOTHÈQUE, la même que reçoit la passe finale. Sans elle,
    // une passe interne d'un effet à `libraryTexture` échantillonnerait le repli
    // 1×1 : le shader compile, le binding existe, et l'image est fausse sans
    // qu'aucune erreur ne parte. `validateEffect` levait pour cette raison, et
    // interdisait la combinaison entière ; elle est maintenant servie.
    libraryTextureView?: GPUTextureView | null,
    // `texture` est NULL quand toutes les passes ont été sautées (voir
    // `EffectPass.enabled`) : il n'y a alors aucune cible empruntée au pool, et
    // `view` est la texture source elle-même. Ce port le déclare plutôt que de
    // mentir avec un `!` — l'appelant ne lit que `view`, et cette signature dit
    // pourquoi c'est suffisant.
  ): { view: GPUTextureView; texture: GPUTexture | null; aux: GPUTextureView | null };
  runOverlayPass(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    mask: GPUTexture,
    targetView: GPUTextureView,
    time: number,
  ): void;
  /** Rend au pool les cibles de passe interne prêtées à la frame. Appelée
   *  APRÈS la soumission, et aussi sur le chemin d'erreur — une frame qui lance
   *  en cours de route laisserait sinon ses cibles prêtées à jamais, donc hors
   *  du pool ET jamais détruites. */
  releaseFrameTargets(): void;
}

/** Persistent mask residency; it encodes mask work but never submits it. */
export interface MaskTexturesPort {
  sweep(layerIds: ReadonlySet<string>): void;
  /** `guideEpoch` : identifie la "fraîcheur" de `colorView` (l'image de
   *  guide du filtre edge-aware). Ne change QUE lorsque le composite qui sert
   *  de guide change réellement — voir `computeGuideEpochs`. Sans ce signal,
   *  edge-aware resterait figé sur un ancien composite après modif d'un
   *  calque en dessous ; avec un signal trop grossier (une valeur par
   *  exécution du pipeline), il reconstruirait sa SAT à chaque frame. */
  resolve(
    layer: LayerState,
    encoder: GPUCommandEncoder,
    colorView: GPUTextureView,
    pendingDestroy: FrameResource[],
    guideEpoch: number,
  ): GPUTexture;
}

/** Résout l'entrée d'un calque de photo (double exposure, ARCHITECTURE.md
 *  §4.3) en une texture pleine taille, couverture dans le canal alpha —
 *  jamais appelé pour un calque sans `imageSource`. Lève si
 *  `layer.imageSource.sourceId` est introuvable dans `PhotoSourceStore`
 *  (fail-fast, pas de calque photo silencieusement vide). */
export interface PhotoLayerInputPort {
  resolve(
    encoder: GPUCommandEncoder,
    layer: LayerState,
    bgWidth: number,
    bgHeight: number,
    pendingDestroy: FrameResource[],
  ): GPUTexture;
}

/** Résout la texture de bibliothèque d'un effet qui en déclare une
 *  (`EffectModule.libraryTexture`). Rend TOUJOURS une vue — 1×1 de repli tant
 *  que le décodage n'est pas fini, pour que le corps WGSL de l'effet reste une
 *  chaîne fixe. Implémenté par `TextureLibraryStore`. */
export interface LibraryTexturePort {
  viewFor(index: number): GPUTextureView;
}

export type FramePipelineResult = {
  enabledLayerCount: number;
  churnedResourceCount: number;
  /** Texture composée AVANT overlay (le frame réel, sans le rouge/contour de
   *  masque) — null si aucun overlayLayer n'était actif ce rendu. Capturée
   *  ici plutôt que recalculée : c'est la seule source de vérité pour
   *  `Renderer.tickOverlayAnimation`, qui ne doit jamais deviner quel buffer
   *  ping-pong contient le bon frame. */
  composedTexture: GPUTexture | null;
  /** Texture de masque déjà résolue par `MaskTexturesPort.resolve()` pour
   *  l'overlay de ce rendu, ou null si aucun overlayLayer. `resolve()` n'est
   *  PAS un cache de résultat pour edge-aware/refine-edge (seul le fold est
   *  mis en cache, voir `maskTextureResolver.ts`) — la rappeler à chaque
   *  frame d'animation regénérerait ce travail coûteux. La capturer ici
   *  évite tout nouvel appel à `resolve()` hors d'un vrai rendu complet. */
  overlayMaskTexture: GPUTexture | null;
  /** Texture qui contient le résultat FINAL de cette frame, à alpha droit
   *  composé. L'exécuteur n'écrit plus jamais la surface visible (canvas ou
   *  cible d'export) : c'est `PresentPass` qui l'aplatit sur un fond opaque,
   *  en un seul point (voir `presentPass.ts`). Toujours l'un des deux buffers
   *  de ping-pong — aucune texture supplémentaire n'est allouée pour ça. */
  presentTexture: GPUTexture;
};

/**
 * Encodes and submits one complete image frame. This is the sole owner of
 * frame-scoped GPU destruction: resources are released only after submit.
 */
export class FramePipelineExecutor {
  /** Compteur monotone d'où sortent les `guideEpoch`. N'avance PAS à chaque
   *  frame : seulement quand `computeGuideEpochs` constate qu'un guide a
   *  réellement changé. */
  private guideGeneration = 0;
  /** `lastGuideKeys[i]` : l'identité qui, la frame précédente, occupait la
   *  position `i` de la chaîne dont dépend un guide — position 0 = la toile,
   *  position `i>0` = `enabledLayers[i-1]`. `lastGuideEpochs[i]` : l'epoch
   *  servie à cette position. Les deux tableaux sont indexés ensemble et
   *  tronqués à la taille de la pile activée courante. */
  private lastGuideKeys: unknown[] = [];
  private lastGuideEpochs: number[] = [];
  /** Clé de CONTENU du maillon `i`, servie d'autorité quand l'identité seule
   *  dit « différent ». Un appelant en amont recopie le calque du bas à chaque
   *  frame (même contenu, même id) : sans cette seconde comparaison, la chaîne
   *  se périmait à chaque image et la SAT edge-aware de chaque masque de la
   *  pile était reconstruite pour rien — 165 images par seconde tombant à ~14
   *  dès qu'un masque existait (mesuré le 2026-08-13, photo de 26 Mpx). Voir
   *  `layers/contentKey.ts` pour le sens de l'erreur à préserver. */
  private lastGuideContentKeys: (string | null)[] = [];
  /** Même mécanique, pour les positions dont le guide n'est PAS la chaîne en
   *  dessous mais la photo du calque lui-même (voir `computeGuideEpochs`).
   *  Tableau séparé parce que ces deux dépendances n'ont rien à voir : une
   *  seule case ne peut pas mémoriser les deux sans confondre leurs
   *  invalidations. */
  private lastOwnGuideKeys: (string | null)[] = [];
  private lastOwnGuideEpochs: number[] = [];
  /** Diagnostic : à QUELLE position la chaîne de guides devient périmée, par
   *  frame. Une divergence en position 0 (la toile) périme TOUTES les
   *  positions au-dessus, donc invalide le cache SAT de chaque masque de la
   *  pile — le cas le plus coûteux, et invisible autrement. Posé le
   *  2026-08-13, quand les compteurs du résolveur ont montré une SAT
   *  reconstruite à chaque image alors que le fold, lui, servait son cache. */
  private diagStale: Record<string, number> = { frames: 0, jamais: 0 };
  private diagDernierBas: LayerState | null = null;
  private diagDernierBasId: string | null = null;
  drainGuideDiagnostics(): Record<string, number> {
    const copie = { ...this.diagStale };
    this.diagStale = { frames: 0, jamais: 0 };
    return copie;
  }

  /** Copie à pyramide de la source, pour les effets qui déclarent
   *  `EffectModule.sourceMipmaps`. Créée à la PREMIÈRE demande : un document
   *  qui n'en contient aucun ne l'alloue jamais, et c'est tout l'intérêt du
   *  drapeau déclaratif (voir `mippedSource.ts`). */
  private mippedSources: MippedSourceCache | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly resources: FrameResourcesPort,
    private readonly effects: EffectPassesPort,
    private readonly masks: MaskTexturesPort,
    private readonly photoInputs: PhotoLayerInputPort,
    /** Optionnel : un banc de test qui n'exerce aucun effet à texture n'a pas
     *  à en fournir un. Absent, un effet qui en déclare une composera son
     *  shader SANS le binding — cohérent avec le bind group, donc pas de
     *  plantage, seulement un effet inerte. */
    private readonly libraryTextures: LibraryTexturePort | null = null,
    /**
     * HORLOGE DE L'OVERLAY, injectable — et c'est le seul endroit du pipeline
     * où le temps entre.
     *
     * Elle existe pour que le safelight de masque (voile rouge + contour
     * POINTILLÉ dont la phase avance avec le temps) soit VERROUILLABLE au
     * pixel. Sans elle, deux rendus consécutifs de la même pile diffèrent sur
     * les pointillés, et le harnais de rendu ne peut ni écrire une référence
     * ni la comparer — c'est pourquoi l'overlay n'en a jamais eu, alors qu'il
     * est du rendu comme le reste (constat `docs/ROADMAP.md`, 2026-08-13 :
     * « le contour pointillé, le voile et leur anticrénelage ne sont tenus par
     * rien »).
     *
     * L'application garde le défaut. `tickOverlayAnimation`, l'AUTRE chemin qui
     * anime le contour, reçoit déjà son temps en paramètre (timestamp rAF) :
     * les deux chemins sont donc injectables, par des moyens différents mais
     * pour la même raison.
     */
    private readonly maintenantMs: () => number = () => performance.now(),
  ) {}

  /** Rend au GPU ce que l'exécuteur POSSÈDE en propre, c'est-à-dire la seule
   *  `MippedSourceCache` — les cinq ports, eux, appartiennent à `Renderer` et
   *  se démontent chez lui.
   *
   *  ⚠️ Elle n'existait pas, et `MippedSourceCache.dispose()` n'avait donc
   *  AUCUN appelant dans le dépôt alors que l'exécuteur est reconstruit à
   *  chaque `allocateDocument` : sa pyramide (+33 % de la taille d'une cible,
   *  voir `effects/types.ts`) fuyait à chaque ouverture de fichier. Le
   *  `GPUDevice`, lui, ne meurt jamais — `initGpu` n'est appelé qu'une fois —
   *  donc rien ne rattrapait l'oubli en aval. Aucun gate ne pouvait le voir :
   *  une fuite VRAM ne change aucun pixel, les 143 références de rendu
   *  restaient vertes et le compilateur ne compte pas les textures. */
  dispose(): void {
    this.mippedSources?.dispose();
    this.mippedSources = null;
  }

  /** `livePreviewLayerId` : calque dont le masque est servi par l'APERÇU live
   *  du pinceau (`MaskTexturesPort` court-circuite alors sa résolution). Son
   *  contenu change d'une frame à l'autre SANS que son `LayerState` change —
   *  c'est le seul cas où l'identité d'objet ne suffit pas à détecter qu'un
   *  guide au-dessus de lui est périmé, d'où ce paramètre explicite plutôt
   *  qu'une invalidation permanente « au cas où ». */
  run(
    layers: LayerState[],
    maskOverlayLayerId: string | null,
    livePreviewLayerId: string | null = null,
    /** ÉTAGE DE DÉVELOPPEMENT (ticket 03) : réglages du document appliqués au
     *  composite de TOUTE la pile, en fin de chaîne, avant la présentation.
     *  Défaut `{}` = aucun module réglé, donc aucune passe émise et rendu
     *  inchangé au bit près (le gate discriminant, `test:render` à zéro écart). */
    develop: DevelopSettings = {},
  ): FramePipelineResult {
    const canvasTexture = this.resources.canvasTexture;
    const pingPong = this.resources.pingPong;
    if (!canvasTexture || !pingPong) throw new Error("Aucune image chargée.");

    this.masks.sweep(new Set(layers.map((layer) => layer.id)));
    const encoder = this.device.createCommandEncoder();
    const overlayTimeSeconds = this.maintenantMs() / 1000;
    const pendingDestroy: FrameResource[] = [];

    // Une passe (effet interne, resolve de masque...) peut lancer en cours
    // de frame — sans ce garde, toute texture/buffer transitoire déjà
    // poussée dans pendingDestroy PAR UN CALQUE PRÉCÉDENT resterait
    // orpheline sur le GPU (jamais soumise, jamais détruite). Le catch
    // détruit ce qui a déjà été créé puis relance — aucun fallback silencieux,
    // l'appelant voit toujours l'erreur d'origine.
    try {
      return this.runFrame(
        layers,
        maskOverlayLayerId,
        livePreviewLayerId,
        develop,
        canvasTexture,
        pingPong,
        encoder,
        overlayTimeSeconds,
        pendingDestroy,
      );
    } catch (error) {
      for (const resource of pendingDestroy) resource.destroy();
      // Sans ceci, une frame qui lance en cours de route laisserait ses cibles
      // PRÊTÉES pour toujours : hors du pool, donc jamais réutilisées, et hors
      // de `pendingDestroy`, donc jamais détruites. Exactement l'orphelinat que
      // le garde ci-dessus existe pour empêcher.
      this.effects.releaseFrameTargets();
      throw error;
    }
  }

  /** Epochs de guide de la frame, indexées par POSITION dans la chaîne de
   *  composition : `epochs[i]` identifie la fraîcheur du guide edge-aware
   *  servi au calque `enabledLayers[i]` — c'est-à-dire de la toile composée
   *  des calques `0..i-1`. `epochs[0]` (la toile seule) existe toujours, même
   *  pile vide : c'est l'epoch du guide « aucun calque en dessous ».
   *
   *  La granularité n'est PLUS une position dans la pile (« index 0 = guide
   *  stable ») ni l'exécution du pipeline (« une frame = une epoch »), mais ce
   *  dont le guide dépend réellement : l'identité de la toile, puis celle de
   *  chaque `LayerState` en dessous. Les états de calque sont immuables (une
   *  modification produit un nouvel objet — c'est déjà la monnaie de change de
   *  `MaskTextureResolver.resident`, qui compare `syncedFrom === raster`), donc
   *  une chaîne d'identités inchangée signifie un guide inchangé. Dès qu'une
   *  position diverge, toutes les positions AU-DESSUS reçoivent une epoch
   *  neuve : un guide dépend de tout son préfixe, pas seulement du calque qui
   *  le précède.
   *
   *  EXCEPTION, et elle est structurelle : un calque PHOTO ne prend pas la
   *  chaîne pour guide, mais sa propre photo résolue
   *  (`effectPassRunner.ts`, `maskGuideView`). Son epoch doit donc suivre
   *  CETTE dépendance-là — sinon deux défauts symétriques : déplacer la photo
   *  ne rebâtirait pas la SAT du guide (cache périmé servi en silence, le
   *  défaut le plus grave), et modifier un calque en dessous la rebâtirait
   *  pour rien. La clé est la description exacte de ce que la pré-passe rend :
   *  source + transformation. */
  private computeGuideEpochs(
    canvasTexture: GPUTexture,
    enabledLayers: LayerState[],
    livePreviewLayerId: string | null,
  ): number[] {
    const epochs: number[] = [];
    let stale = false;
    this.diagStale.frames++;
    let premierStale = -1;
    for (let i = 0; i < Math.max(enabledLayers.length, 1); i++) {
      const below = i === 0 ? null : enabledLayers[i - 1];
      const key =
        below === null
          ? canvasTexture
          : below.id === livePreviewLayerId
            ? // Aperçu live : le masque servi change à chaque échantillon de
              // pinceau sans nouveau `LayerState`. Une clé neuve à chaque
              // frame est la seule façon honnête de le dire — sinon le guide
              // d'un calque au-dessus resterait figé pendant tout le trait.
              // ⚠️ Un jeton `{}` ne suffit PLUS depuis que la comparaison
              // retombe sur le CONTENU : deux littéraux vides ont la même clé.
              jetonApercuLive()
            : below;
      // Deux comparaisons, dans cet ordre : l'IDENTITÉ (gratuite, et vraie
      // dans le cas courant où rien n'a bougé), puis le CONTENU (le calque du
      // bas est recopié à chaque frame par un appelant en amont, donc son
      // identité ment). Ne périmer que si les deux disent « différent ».
      if (!stale && this.lastGuideKeys[i] !== key) {
        const contenu = guideChainKey(key);
        if (this.lastGuideContentKeys[i] !== contenu) {
          stale = true;
          premierStale = i;
        }
        this.lastGuideContentKeys[i] = contenu;
      } else if (stale) {
        // Position AU-DESSUS d'une divergence : son epoch est renouvelée sans
        // qu'on ait lu son contenu. Oublier la clé mémorisée force un vrai
        // recalcul au prochain tour plutôt que de comparer à une valeur dont
        // on ne sait plus si elle décrit la frame courante — sens sûr, comme
        // partout ici.
        this.lastGuideContentKeys[i] = null;
      }
      if (stale) this.lastGuideEpochs[i] = ++this.guideGeneration;
      this.lastGuideKeys[i] = key;

      // La chaîne continue d'être suivie pour TOUTE position (les calques
      // au-dessus en dépendent, photo ou pas) ; seule l'epoch SERVIE change.
      const ownKey = photoGuideKey(enabledLayers[i]);
      if (ownKey === null) {
        this.lastOwnGuideKeys[i] = null;
        epochs.push(this.lastGuideEpochs[i]);
      } else {
        if (this.lastOwnGuideKeys[i] !== ownKey)
          this.lastOwnGuideEpochs[i] = ++this.guideGeneration;
        this.lastOwnGuideKeys[i] = ownKey;
        epochs.push(this.lastOwnGuideEpochs[i]);
      }
    }
    // Pile raccourcie : les positions disparues sont oubliées. Si elles
    // reviennent, leur clé mémorisée sera `undefined` — donc divergente, donc
    // epoch neuve. Conservateur dans le bon sens (jamais un guide périmé).
    this.lastGuideKeys.length = epochs.length;
    this.lastGuideEpochs.length = epochs.length;
    this.lastGuideContentKeys.length = epochs.length;
    this.lastOwnGuideKeys.length = epochs.length;
    this.lastOwnGuideEpochs.length = epochs.length;
    if (premierStale < 0) this.diagStale.jamais++;
    else {
      const cle = `stale_position_${premierStale}`;
      this.diagStale[cle] = (this.diagStale[cle] ?? 0) + 1;
    }
    // Qu'est-ce qui change exactement en position 0 : l'OBJET du calque du bas,
    // ou seulement son contenu ? Un id stable avec un objet neuf désigne une
    // recopie par un appelant en amont ; un id qui change désigne un
    // réordonnancement de la pile.
    const bas = enabledLayers[0] ?? null;
    if (bas) {
      if (this.diagDernierBas !== null) {
        if (this.diagDernierBas === bas) this.diagStale.bas_meme_objet = (this.diagStale.bas_meme_objet ?? 0) + 1;
        else if (this.diagDernierBasId === bas.id) this.diagStale.bas_objet_neuf_meme_id = (this.diagStale.bas_objet_neuf_meme_id ?? 0) + 1;
        else this.diagStale.bas_id_different = (this.diagStale.bas_id_different ?? 0) + 1;
      }
      this.diagDernierBas = bas;
      this.diagDernierBasId = bas.id;
    }
    return epochs;
  }

  /**
   * ÉTAGE DE DÉVELOPPEMENT — exécuté APRÈS la boucle des calques et AVANT la
   * présentation/l'overlay (ticket 03). Chaque module de `developApplyOrder`
   * dont les valeurs ne sont PAS au défaut transforme le composite par le même
   * chemin qu'une couche d'effet : `runEffectPass` en `applyMask: false` (une
   * COPIE transformée, pas un compositing — opacité 1, fusion normale implicite,
   * aucun masque), en espace d'ORIGINE plein cadre. Le ping-pong est celui de la
   * boucle : `compositeIndex` désigne le buffer qui porte le composite, l'autre
   * est libre.
   *
   * UN MODULE AU DÉFAUT EST SAUTÉ AVANT TOUTE PASSE — pas seulement neutre au
   * rendu : aucune passe n'est émise, donc l'état du ping-pong est byte-identique
   * à ce qu'il était sans étage. C'est ce qui garde `test:render` à zéro écart
   * sur toutes les références tant qu'aucun réglage n'est posé.
   *
   * Retourne l'index du buffer qui porte le composite DÉVELOPPÉ (inchangé si tous
   * les modules sont au défaut).
   */
  private runDevelopStage(
    encoder: GPUCommandEncoder,
    develop: DevelopSettings,
    pingPong: [GPUTexture, GPUTexture],
    compositeIndex: number,
    pendingDestroy: FrameResource[],
  ): number {
    let ci = compositeIndex;
    for (const module of developApplyOrder) {
      const values = develop[module.id];
      // Un module DÉSACTIVÉ (œil éteint, ticket 07) est sauté comme un module au
      // défaut : aucune passe émise, composite byte-identique. Ses valeurs sont
      // conservées dans `develop` (l'œil ne les efface pas), il ne les applique
      // simplement pas tant qu'il est éteint.
      if (!isDevelopModuleEnabled(develop, module.id) || isDevelopModuleAtDefault(module, values)) continue;
      const wi = 1 - ci;
      // Calque SYNTHÉTIQUE : le module lit ses paramètres par NOM
      // (`layer.params[p.name] ?? p.default`), donc un `params` partiel suffit —
      // les paramètres non réglés retombent sur leur défaut. Opacité/fusion sont
      // ignorées en `applyMask: false`.
      const layer: LayerState = {
        id: "",
        effectId: module.id,
        params: values ?? {},
        enabled: true,
        opacity: 1,
        blendMode: "normal",
        mask: defaultLayerMask(),
      };
      // PASSES INTERNES (la pyramide de `reglagesDeBase`) : mêmes règles qu'un
      // calque d'effet multi-passes — chaque passe lit la sortie de la
      // précédente, la première lit le composite. `prevPass` porte la dernière.
      // Un module SANS passe (`etalonnage`) n'en émet aucune ; toutes sautées
      // (curseurs à 0) → `prevPass` = source, cohérent avec le contrat du runner.
      const previousPass = module.passes?.length
        ? this.effects.runInternalPasses(encoder, module, layer, pingPong[ci].createView(), pendingDestroy)
        : null;
      this.effects.runEffectPass(
        encoder,
        module,
        layer,
        pingPong[ci].createView(),
        pingPong[wi].createView(),
        { applyMask: false, prevPassView: previousPass?.view ?? null, auxPassView: previousPass?.aux ?? null },
        pendingDestroy,
      );
      ci = wi;
    }
    return ci;
  }

  private runFrame(
    layers: LayerState[],
    maskOverlayLayerId: string | null,
    livePreviewLayerId: string | null,
    develop: DevelopSettings,
    canvasTexture: GPUTexture,
    pingPong: [GPUTexture, GPUTexture],
    encoder: GPUCommandEncoder,
    overlayTimeSeconds: number,
    pendingDestroy: FrameResource[],
  ): FramePipelineResult {
    const enabledLayers = layers.filter((layer) => layer.enabled);
    const guideEpochs = this.computeGuideEpochs(
      canvasTexture,
      enabledLayers,
      livePreviewLayerId,
    );
    const overlayLayer = maskOverlayLayerId
      ? (layers.find((layer) => layer.id === maskOverlayLayerId) ?? null)
      : null;

    if (enabledLayers.length === 0) {
      this.effects.runEffectPass(
        encoder,
        PASSTHROUGH_EFFECT,
        neutralPassLayer(),
        canvasTexture.createView(),
        pingPong[0].createView(),
        // `applyMask: false` — c'est une COPIE, pas un compositing. Depuis que
        // l'alpha est réellement composé (shaderCompose.ts), passer cette
        // passe par le chemin de compositing forcerait `outAlpha` à 1 (poids =
        // opacité 1 × masque par défaut 1) et écraserait l'alpha de l'entrée
        // qu'elle est censée recopier — une toile transparente ressortirait
        // opaque. Le chemin sans masque rend `effected` tel quel, alpha inclus,
        // et évite au passage un `masks.resolve` inutile.
        { applyMask: false },
        pendingDestroy,
      );
      // ÉTAGE : le composite (la copie de la toile) est en pingPong[0], l'autre
      // buffer est libre. À l'étage au défaut, `composite` reste 0 et rien n'est
      // émis — byte-identique à avant l'étage.
      const composite = this.runDevelopStage(encoder, develop, pingPong, 0, pendingDestroy);
      const compositeTex = pingPong[composite];
      let overlayMaskTexture: GPUTexture | null = null;
      let presentTexture: GPUTexture = compositeTex;
      if (overlayLayer) {
        overlayMaskTexture = this.masks.resolve(
          overlayLayer,
          encoder,
          canvasTexture.createView(),
          pendingDestroy,
          // Guide = la toile seule (aucun calque composité) — exactement le
          // guide de la position 0, donc son epoch. L'étage ne change pas le
          // GUIDE du masque (espace d'origine, plein cadre) ; il ne fait que
          // développer le composite présenté.
          guideEpochs[0],
        );
        // L'overlay LIT le composite développé et ÉCRIT l'autre buffer : jamais
        // la même texture en lecture et en écriture.
        presentTexture = pingPong[1 - composite];
        this.effects.runOverlayPass(
          encoder,
          compositeTex,
          overlayMaskTexture,
          presentTexture.createView(),
          overlayTimeSeconds,
        );
      }
      return this.submitAndDestroy(
        encoder,
        pendingDestroy,
        0,
        overlayLayer ? compositeTex : null,
        overlayMaskTexture,
        presentTexture,
      );
    }

    let readTexture = canvasTexture;
    let writeIndex = 0;
    for (let index = 0; index < enabledLayers.length; index++) {
      const layer = enabledLayers[index];
      const effect = getEffect(layer.effectId);
      const isLast = index === enabledLayers.length - 1;
      // Toujours un buffer de ping-pong, y compris pour la DERNIÈRE passe : la
      // surface visible n'est plus écrite ici mais par `PresentPass`, qui
      // aplatit l'alpha composé sur un fond opaque (presentPass.ts). Retirer
      // cette destination externe supprime aussi un cas particulier de la
      // boucle la plus sensible du projet.
      const targetView = pingPong[writeIndex].createView();

      // Double exposure (ARCHITECTURE.md §4.3, approche C2) : un calque
      // portant `imageSource` ne doit JAMAIS voir le composite-en-dessous
      // comme son entrée d'effet/passes internes — sans ça, un effet
      // multi-passe (glow) échantillonnerait le fond au lieu de la
      // silhouette (défaut (a) du design doc). La pré-passe rend la photo
      // transformée dans une texture pleine taille (couverture en alpha),
      // consommée ensuite par la chaîne EXISTANTE sans cas particulier.
      let effectInputSourceView = readTexture.createView();
      let imageSourceView: GPUTextureView | null = null;
      if (layer.imageSource) {
        // I4 : `resolved` est la texture cible PERSISTANTE et PARTAGÉE
        // possédée par PhotoLayerInputResolver (voir photoLayerInput.ts) —
        // jamais poussée dans pendingDestroy ici, elle survit à la frame et
        // n'est détruite que par PhotoLayerInputResolver.dispose() (au
        // changement de document, cf. renderer.ts).
        //
        // ⚠️ Avec N calques photo (MAX_PHOTO_LAYERS, le calque de FOND
        // compris depuis la tranche T1), TOUS reçoivent la MÊME texture. Ce qui
        // rend ça correct est l'ordre d'encodage ici :
        // resolve(A) puis les passes de A, ENSUITE resolve(B) puis les
        // passes de B — les passes d'un même encoder s'exécutent dans
        // l'ordre de soumission, donc A a fini de lire la cible avant que B
        // ne la re-clear. Ne jamais hisser ces resolve() hors de la boucle,
        // ni les regrouper en tête de frame : le premier calque photo
        // verrait les pixels du dernier.

        const resolved = this.photoInputs.resolve(encoder, layer, this.resources.width, this.resources.height, pendingDestroy);
        effectInputSourceView = resolved.createView();
        imageSourceView = resolved.createView();
      }

      // `texture` nullable : quand toutes les passes internes d'un effet sont
      // sautées (voir `EffectPass.enabled`), aucune cible n'est empruntée au
      // pool et `view` est la source elle-même. Seul `view` est lu ici.
      // Texture de bibliothèque : le paramètre déclaré porte un RANG dans le
      // catalogue, le store rend les pixels. `Math.round` parce que `params` est
      // un `Record<string, number>` — un index y transite en flottant, comme
      // tous les choix à liste du dépôt. Résolue AVANT les passes internes, qui
      // la reçoivent comme la passe finale.
      const libraryTextureView =
        effect.libraryTexture && this.libraryTextures
          ? this.libraryTextures.viewFor(Math.round(layer.params[effect.libraryTexture.indexParam] ?? 0))
          : null;
      let previousPass: { view: GPUTextureView; texture: GPUTexture | null; aux: GPUTextureView | null } | null = null;
      if (effect.passes?.length) {
        previousPass = this.effects.runInternalPasses(
          encoder,
          effect,
          layer,
          effectInputSourceView,
          pendingDestroy,
          libraryTextureView,
        );
      }
      // SOURCE À PYRAMIDE pour les effets qui le déclarent (ticket 19). Une
      // COPIE de `readTexture`, jamais `readTexture` elle-même : une cible de
      // ping-pong à pyramide casse toutes les vues qui en font une cible de
      // rendu, et la frame sort noire sans que `tsc` en dise rien — voir
      // `mippedSource.ts` pour les deux raisons et leur mesure.
      //
      // Encodée ICI, juste avant la passe qui la lit : les passes d'un même
      // encodeur s'exécutent dans l'ordre de soumission, donc deux calques
      // déclarants partagent la même texture sans se marcher dessus.
      let effectSourceView = readTexture.createView();
      if (effect.sourceMipmaps) {
        this.mippedSources ??= new MippedSourceCache(this.device, readTexture.format);
        effectSourceView = this.mippedSources.viewFor(encoder, readTexture);
      }
      this.effects.runEffectPass(
        encoder,
        effect,
        layer,
        // `sourceView` (le `color`/base du mix) reste TOUJOURS le
        // composite-en-dessous, jamais la photo — c'est ce qui laisse
        // apparaître le fond hors des bornes de la silhouette (défaut (b),
        // couverture injectée séparément via `imageSourceView`).
        effectSourceView,
        targetView,
        {
          applyMask: true,
          prevPassView: previousPass?.view,
          auxPassView: previousPass?.aux ?? null,
          imageSourceView,
          // Fraîcheur du guide edge-aware de CE calque : chaîne toile +
          // calques en dessous pour un calque ordinaire, sa propre photo pour
          // un calque photo (voir `computeGuideEpochs` — l'epoch suit ce dont
          // le guide dépend, pas la position). Une position dans la pile ne
          // dit plus rien à elle seule : depuis la tranche T1, l'index 0 est
          // le calque photo de fond.
          guideEpoch: guideEpochs[index],
          libraryTextureView,
        },
        pendingDestroy,
      );
      // ⚠️ NE PAS DÉTRUIRE `previousPass.texture` ICI. Elle est PRÊTÉE par le
      // pool de `EffectPassRunner` depuis le 2026-08-02, et `releaseFrameTargets()`
      // la rendra après la soumission. La détruire la remettait au pool morte,
      // et la frame suivante la réutilisait : « Destroyed texture used in a
      // submit », une erreur de validation ASYNCHRONE — donc qui ne lève pas, et
      // qui laisse simplement le canvas figé sur l'image précédente.
      //
      // Ce défaut a échappé aux 26 scénarios de `npm run test:render`, et c'est
      // instructif : le harnais rend chaque scénario sur un renderer NEUF, donc
      // il n'exerce jamais la réutilisation d'une trame à la suivante — la seule
      // situation où le bug existe. Un verrou de pixels ne voit que ce que son
      // protocole rejoue.
      if (!isLast) {
        readTexture = pingPong[writeIndex];
        writeIndex = 1 - writeIndex;
      }
    }

    // ÉTAGE DE DÉVELOPPEMENT (ticket 03) : APRÈS la pile, AVANT la présentation.
    // La boucle n'avance pas le ping-pong après sa dernière passe, donc le
    // composite est dans `pingPong[writeIndex]`. On le développe, puis on remappe
    // `writeIndex` sur le buffer qui porte le résultat — tout le bloc de
    // présentation ci-dessous reste alors inchangé. À l'étage au défaut, aucune
    // passe n'est émise et `writeIndex` ne bouge pas (byte-identique).
    writeIndex = this.runDevelopStage(encoder, develop, pingPong, writeIndex, pendingDestroy);

    let overlayMaskTexture: GPUTexture | null = null;
    let composedTexture: GPUTexture | null = null;
    // Le composite (développé) est dans `pingPong[writeIndex]`.
    let presentTexture: GPUTexture = pingPong[writeIndex];
    if (overlayLayer) {
      composedTexture = pingPong[writeIndex];
      // L'invariant qui compte n'est PAS "l'overlay utilise tel guide
      // fixe" mais "les deux appels masks.resolve() d'un même calque, dans
      // la même frame, portent le même guideEpoch numérique" — c'est la
      // seule chose que MaskTextureResolver compare pour décider
      // d'invalider (maskTextureResolver.ts:259-263), pas l'identité de
      // texture. On ne mirrorise plus une FORMULE (risque de dérive entre
      // deux sites) : on relit la MÊME case du tableau d'epochs de la frame
      // que la boucle principale a servie à ce calque. Un calque overlay
      // absent d'`enabledLayers` (désactivé) a pour guide la toile seule,
      // donc la position 0. Sans cette égalité, un calque édité avec
      // overlay actif invaliderait son cache SAT à CHAQUE appel au lieu
      // d'aucun (voir docs/adr/0002-overlay-guide-epoch-invariant.md).
      //
      // Corollaire, depuis que le guide d'un calque PHOTO est sa propre photo
      // et non le composite : la vue passée ici n'est pas celle-là, et n'a
      // pas à l'être. L'égalité d'epoch garantit que cet appel est un
      // cache-hit — le CONTENU du guide vient de l'appel de la boucle
      // principale, le seul à disposer de la cible photo avant qu'un calque
      // photo suivant ne la re-`clear` (cible partagée, invariant d'ordre des
      // passes). Passer une vue qui pourrait porter les pixels d'une AUTRE
      // photo serait le vrai danger ; ne pas la passer du tout n'en est pas un.
      const overlayIndex = enabledLayers.findIndex((l) => l.id === overlayLayer.id);
      overlayMaskTexture = this.masks.resolve(
        overlayLayer,
        encoder,
        overlayIndex <= 0 ? canvasTexture.createView() : composedTexture.createView(),
        pendingDestroy,
        guideEpochs[Math.max(overlayIndex, 0)],
      );
      // L'overlay LIT `composedTexture` (pingPong[writeIndex]) et ÉCRIT
      // l'autre buffer. Sûr : ce buffer-là a servi de `readTexture` à la
      // dernière passe de la boucle, donc plus tôt dans le MÊME encoder — les
      // passes s'exécutent dans l'ordre de soumission (même raisonnement que
      // le partage de la cible photo, plus haut).
      presentTexture = pingPong[1 - writeIndex];
      this.effects.runOverlayPass(
        encoder,
        composedTexture,
        overlayMaskTexture,
        presentTexture.createView(),
        overlayTimeSeconds,
      );
    }
    return this.submitAndDestroy(
      encoder,
      pendingDestroy,
      enabledLayers.length,
      composedTexture,
      overlayMaskTexture,
      presentTexture,
    );
  }

  private submitAndDestroy(
    encoder: GPUCommandEncoder,
    pendingDestroy: FrameResource[],
    enabledLayerCount: number,
    composedTexture: GPUTexture | null,
    overlayMaskTexture: GPUTexture | null,
    presentTexture: GPUTexture,
  ): FramePipelineResult {
    // AVANT `finish()` : `resolveQuerySet` et la recopie doivent vivre dans le
    // MÊME encodeur que les passes mesurées. No-op hors capture.
    this.effects.timing?.endFrame(encoder);
    this.device.queue.submit([encoder.finish()]);
    for (const resource of pendingDestroy) resource.destroy();
    // Les cibles de passe interne ne sont PAS détruites : elles retournent au
    // pool pour la frame suivante. Même point du cycle que la destruction —
    // après la soumission, donc les commandes en vol tiennent la mémoire.
    this.effects.releaseFrameTargets();
    // Même point du cycle, même raison : la relecture des timestamps est
    // asynchrone et ne peut démarrer qu'une fois les commandes soumises.
    this.effects.timing?.afterSubmit();
    return {
      enabledLayerCount,
      churnedResourceCount: pendingDestroy.length,
      composedTexture,
      overlayMaskTexture,
      presentTexture,
    };
  }
}
