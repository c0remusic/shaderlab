import { describe, expect, it, vi } from "vitest";
import {
  FramePipelineExecutor,
  type EffectPassesPort,
  type MaskTexturesPort,
  type PhotoLayerInputPort,
} from "../../src/render/framePipelineExecutor";
import { defaultLayerMask } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

function texture() {
  return { createView: vi.fn(() => ({})), destroy: vi.fn(), width: 100, height: 100 };
}

function layer(overrides: Partial<LayerState> = {}): LayerState {
  return {
    id: "L1",
    effectId: "grain",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...overrides,
  };
}

function createExecutor(horloge?: () => number) {
  const source = texture();
  const firstTarget = texture();
  const secondTarget = texture();
  const finish = vi.fn(() => ({}));
  const submit = vi.fn();
  const device = {
    createCommandEncoder: vi.fn(() => ({ finish })),
    queue: { submit },
  } as unknown as GPUDevice;
  const transient = texture();
  const effects: EffectPassesPort = {
    runEffectPass: vi.fn((_encoder, _effect, _layer, _source, _target, _options, pending) => {
      pending.push(transient as unknown as GPUTexture);
    }),
    runInternalPasses: vi.fn(),
    runOverlayPass: vi.fn(),
    releaseFrameTargets: vi.fn(),
  };
  const masks: MaskTexturesPort = {
    sweep: vi.fn(),
    resolve: vi.fn(() => texture() as unknown as GPUTexture),
  };
  const photoInputs: PhotoLayerInputPort = {
    resolve: vi.fn(() => texture() as unknown as GPUTexture),
  };
  return {
    executor: new FramePipelineExecutor(
      device,
      // Dimensions du DOCUMENT portées par le port lui-même, jamais relues sur
      // la texture de toile (design 2026-07-28 §1.4) : elles sont ici
      // DIFFÉRENTES de `texture()` (100×100) pour qu'un retour à
      // `canvasTexture.width` retombe au rouge au lieu de passer par accident.
      {
        canvasTexture: source as unknown as GPUTexture,
        pingPong: [firstTarget, secondTarget] as unknown as [GPUTexture, GPUTexture],
        width: 640,
        height: 480,
      },
      effects,
      masks,
      photoInputs,
      null,
      horloge,
    ),
    effects,
    masks,
    photoInputs,
    submit,
    transient,
    firstTarget,
    secondTarget,
    source,
  };
}

describe("FramePipelineExecutor", () => {
  it("sweeps masks, submits the empty-stack blit, then destroys frame resources", () => {
    const { executor, effects, masks, submit, transient, firstTarget } = createExecutor();

    const result = executor.run([], null);

    expect(masks.sweep).toHaveBeenCalledWith(new Set());
    expect(effects.runEffectPass).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(transient.destroy).toHaveBeenCalledOnce();
    expect(submit.mock.invocationCallOrder[0]).toBeLessThan(
      transient.destroy.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      enabledLayerCount: 0,
      churnedResourceCount: 1,
      composedTexture: null,
      overlayMaskTexture: null,
      presentTexture: firstTarget,
    });
  });

  /* POOL DES CIBLES DE PASSE (2026-08-02). Les cibles internes ne sont plus
   * détruites par frame mais RENDUES à un pool : à 26 Mpx, une cible en
   * demi-résolution pèse ~26 Mo, et `glow` en enchaîne onze. Ce qui pouvait
   * mal tourner tient en une phrase — une cible prêtée et jamais rendue est
   * perdue deux fois, hors du pool donc jamais réutilisée, hors de
   * `pendingDestroy` donc jamais détruite. Les deux chemins de sortie de la
   * frame doivent donc rendre. */
  it("rend les cibles de passe au pool APRÈS la soumission", () => {
    const { executor, effects, submit } = createExecutor();

    executor.run([layer()], null);

    expect(effects.releaseFrameTargets).toHaveBeenCalledOnce();
    // APRÈS la soumission, jamais avant : les commandes en vol tiennent la
    // mémoire côté pilote, et rendre trop tôt exposerait la cible à être
    // réécrite pendant que le GPU la lit encore.
    const rendu = (effects.releaseFrameTargets as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(rendu).toBeGreaterThan(submit.mock.invocationCallOrder[0]);
  });

  it("NE DÉTRUIT PAS la cible de la dernière passe interne — elle est prêtée", () => {
    /* CE TEST NAIT D UN BUG LIVRE, et de la façon dont il a échappé à tout.
     *
     * L'exécuteur poussait `previousPass.texture` dans `pendingDestroy`. C'était
     * juste tant que `runInternalPasses` créait ses cibles ; depuis qu'elles
     * viennent d'un POOL, ça les y remettait MORTES, et la frame suivante les
     * réutilisait : « Destroyed texture used in a submit ».
     *
     * Pourquoi rien ne l'a vu : une erreur de validation WebGPU est ASYNCHRONE.
     * Elle ne lève pas, elle n'échoue aucun test — le GPU jette simplement le
     * travail et le canvas reste figé sur l'image d'avant. Les 26 scénarios de
     * `npm run test:render` sont passés au vert pendant que l'app ne redessinait
     * plus, parce que le harnais rend chaque scénario sur un renderer NEUF : il
     * n'exerce jamais la réutilisation d'une frame à la suivante, la seule
     * situation où le bug existe.
     *
     * D'où un test sur la MÉCANIQUE (qui détruit quoi) et non sur le rendu. */
    const { executor, effects } = createExecutor();
    const interne = texture();
    effects.runInternalPasses = vi.fn(() => ({
      view: {} as GPUTextureView,
      texture: interne as unknown as GPUTexture,
    }));

    executor.run([layer({ effectId: "glow" })], null);

    expect(effects.runInternalPasses).toHaveBeenCalled();
    expect(interne.destroy).not.toHaveBeenCalled();
    // Et elle repart bien par le pool, pas dans le vide.
    expect(effects.releaseFrameTargets).toHaveBeenCalledOnce();
  });

  it("rend les cibles de passe MÊME si la frame lance", () => {
    const { executor, effects } = createExecutor();
    effects.runEffectPass = vi.fn(() => {
      throw new Error("passe en échec");
    });

    expect(() => executor.run([layer()], null)).toThrow("passe en échec");
    expect(effects.releaseFrameTargets).toHaveBeenCalledOnce();
  });

  it("returns null composedTexture/overlayMaskTexture when the overlay id matches no layer", () => {
    const { executor } = createExecutor();

    const result = executor.run([layer({ enabled: false })], "no-such-id");

    expect(result.composedTexture).toBeNull();
    expect(result.overlayMaskTexture).toBeNull();
  });

  it("captures composedTexture/overlayMaskTexture on the empty-stack path when the overlay layer is disabled", () => {
    const { executor, effects, masks, firstTarget } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    const result = executor.run([layer({ enabled: false })], "L1");

    expect(effects.runOverlayPass).toHaveBeenCalledOnce();
    expect(result.composedTexture).toBe(firstTarget);
    expect(result.overlayMaskTexture).toBe(resolved);
  });

  it("captures composedTexture/overlayMaskTexture from the ping-pong buffer when the overlay layer is enabled", () => {
    const { executor, effects, masks } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    const result = executor.run([layer({ enabled: true })], "L1");

    expect(effects.runOverlayPass).toHaveBeenCalledOnce();
    const [, overlaySource, overlayMask] = (effects.runOverlayPass as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(result.composedTexture).toBe(overlaySource);
    expect(result.overlayMaskTexture).toBe(overlayMask);
    expect(result.overlayMaskTexture).toBe(resolved);
  });

  // L'HORLOGE DE L'OVERLAY EST UN PORT, et c'est ce qui rend le safelight
  // verrouillable au pixel : son contour est POINTILLÉ et sa phase avance avec
  // le temps, donc à horloge libre deux rendus de la même pile ne donnent pas
  // les mêmes octets. Le harnais de rendu la fixe ; l'application garde
  // `performance.now`.
  it("passe l'horloge injectée à la passe d'overlay, convertie en SECONDES", () => {
    const { executor, effects } = createExecutor(() => 4000);

    executor.run([layer({ enabled: true })], "L1");

    const [, , , , temps] = (effects.runOverlayPass as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(temps).toBe(4);
  });

  it("rend deux frames IDENTIQUES sur le temps quand l'horloge est fixe", () => {
    const { executor, effects } = createExecutor(() => 1234);

    executor.run([layer({ enabled: true })], "L1");
    executor.run([layer({ enabled: true })], "L1");

    const appels = (effects.runOverlayPass as ReturnType<typeof vi.fn>).mock.calls;
    expect(appels).toHaveLength(2);
    expect(appels[0][4]).toBe(appels[1][4]);
  });

  it("uses the source texture and a STABLE epoch as the overlay's guide when the overlay layer is the bottom layer", () => {
    const { executor, masks, source } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);
    const bottom = layer({ id: "L1", enabled: true });

    executor.run([bottom], "L1");
    executor.run([bottom], "L1");

    const calls = (masks.resolve as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][2]).toBe(source.createView.mock.results.at(-1)!.value);
    // Le guide du calque du bas est la TOILE seule : rien ne peut le rendre
    // périmé tant que la toile est la même texture. La valeur numérique n'a
    // aucune importance, sa stabilité en a une (voir `computeGuideEpochs`).
    expect(calls[1][4]).toBe(calls[0][4]);
  });

  it("uses the source texture and the bottom-position epoch when the overlay layer is disabled (absent from enabledLayers)", () => {
    const { executor, masks, source } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);
    const enabled = layer({ id: "L1", enabled: true });
    const disabled = layer({ id: "L2", enabled: false });

    executor.run([enabled, disabled], "L2");
    executor.run([enabled, disabled], "L2");

    const calls = (masks.resolve as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][2]).toBe(source.createView.mock.results.at(-1)!.value);
    expect(calls[1][4]).toBe(calls[0][4]);
  });

  it("uses the composite and the same epoch as the layer's own render pass when the overlay layer is not the bottom layer", () => {
    const { executor, effects, masks, secondTarget } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    executor.run(
      [layer({ id: "L1", enabled: true }), layer({ id: "L2", enabled: true })],
      "L2",
    );

    expect(masks.resolve).toHaveBeenCalledOnce();
    const [, , overlayColorView, , overlayGuideEpoch] = (masks.resolve as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(overlayColorView).toBe(secondTarget.createView.mock.results.at(-1)!.value);

    // Le calque overlay (L2, index 1) est aussi rendu normalement par la
    // boucle principale — c'est son deuxième appel à runEffectPass (le
    // premier est pour L1). Les deux appels doivent porter le même
    // guideEpoch numérique, sans quoi ils s'invalident mutuellement dans
    // MaskTextureResolver (voir design doc, amendement 2026-07-24).
    const runEffectPassCalls = (effects.runEffectPass as ReturnType<typeof vi.fn>).mock.calls;
    expect(runEffectPassCalls).toHaveLength(2);
    const l2Options = runEffectPassCalls[1][5];
    expect(overlayGuideEpoch).toBe(l2Options.guideEpoch);
    expect(overlayGuideEpoch).not.toBe(0);
  });

  it("destroys already-created frame resources before rethrowing when a pass throws mid-frame", () => {
    // Deux calques activés : le premier pousse une texture transitoire dans
    // pendingDestroy (via runEffectPass) puis le SECOND lance — sans
    // try/finally, la texture transitoire du premier calque resterait
    // orpheline sur le GPU (jamais détruite, jamais soumise non plus).
    const { executor, effects, transient } = createExecutor();
    let call = 0;
    effects.runEffectPass = vi.fn((_encoder, _effect, _layer, _source, _target, _options, pending) => {
      call += 1;
      pending.push(transient as unknown as GPUTexture);
      if (call === 2) throw new Error("pass GPU failure");
    });

    expect(() => executor.run([layer({ id: "L1" }), layer({ id: "L2" })], null)).toThrow(
      "pass GPU failure",
    );
    // Le calque L1 (call 1) ET le calque L2 (call 2, avant qu'il ne lance)
    // ont chacun poussé `transient` dans pendingDestroy — les deux doivent
    // être détruits, aucun ne doit rester orphelin sur le GPU.
    expect(transient.destroy).toHaveBeenCalledTimes(2);
  });

  it("resolves a photo layer's input via PhotoLayerInputPort and passes it as runInternalPasses' sourceView", () => {
    const { executor, effects, photoInputs } = createExecutor();
    const resolvedTexture = texture() as unknown as GPUTexture;
    (photoInputs.resolve as ReturnType<typeof vi.fn>).mockReturnValue(resolvedTexture);
    const photoLayer = layer({
      id: "L1",
      effectId: "grain",
      imageSource: { sourceId: "photo-1" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });

    executor.run([photoLayer], null);

    expect(photoInputs.resolve).toHaveBeenCalledOnce();
    // §1.4 : la pré-passe est dimensionnée sur le DOCUMENT (640×480 ci-dessus),
    // jamais sur la texture de toile (100×100 dans ce banc). C'est ce qui
    // permettra la toile 1×1 (§8) et une toile indépendante de toute photo.
    const [, , resolveWidth, resolveHeight] = (photoInputs.resolve as ReturnType<typeof vi.fn>).mock.calls[0];
    expect([resolveWidth, resolveHeight]).toEqual([640, 480]);
    expect(effects.runEffectPass).toHaveBeenCalledOnce();
    const [, , , , , options] = (effects.runEffectPass as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.imageSourceView).toBe((resolvedTexture as unknown as { createView: ReturnType<typeof vi.fn> }).createView.mock.results.at(-1)!.value);
  });

  it("does not call PhotoLayerInputPort for a layer without imageSource", () => {
    const { executor, photoInputs } = createExecutor();

    executor.run([layer({ id: "L1" })], null);

    expect(photoInputs.resolve).not.toHaveBeenCalled();
  });

  // I4 — la cible de résolution de PhotoLayerInputResolver est UNE texture
  // persistante partagée par tous les calques photo. Ce qui rend ce partage
  // correct n'est plus « au plus un calque photo » (MAX_PHOTO_LAYERS vaut 5,
  // fond compris, depuis le 2026-07-28) mais l'ORDRE DES PASSES encodées ici : resolve(A) → passes(A)
  // → resolve(B) → passes(B). Les passes d'un même GPUCommandEncoder
  // s'exécutent dans l'ordre de soumission, donc A a fini de lire la cible
  // avant que le resolve de B ne la re-clear. Propriété structurelle, donc
  // assérable en Node — elle cesse d'être une promesse en commentaire.
  describe("I4 — deux calques photo partagent une seule cible de résolution", () => {
    function photoLayer(id: string, sourceId: string): LayerState {
      return layer({
        id,
        effectId: "glow", // effet réel à passes internes — voir registry
        imageSource: { sourceId },
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      });
    }

    it("encodes resolve(A) → passes(A) → resolve(B) → passes(B), never hoisting the resolves", () => {
      const { executor, effects, photoInputs } = createExecutor();
      // Un SEUL objet texture rendu aux deux appels : c'est exactement ce que
      // fait le vrai PhotoLayerInputResolver à taille de fond constante (voir
      // test/render/photoLayerInput.test.ts, « I4 — persistent target texture
      // cache »).
      const sharedTarget = texture() as unknown as GPUTexture;
      (photoInputs.resolve as ReturnType<typeof vi.fn>).mockReturnValue(sharedTarget);
      effects.runInternalPasses = vi.fn(() => ({ view: {} as GPUTextureView, texture: texture() as unknown as GPUTexture }));

      executor.run([photoLayer("L1", "photo-1"), photoLayer("L2", "photo-2")], null);

      const resolveOrder = (photoInputs.resolve as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
      const internalOrder = (effects.runInternalPasses as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
      const effectOrder = (effects.runEffectPass as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
      expect(resolveOrder).toHaveLength(2);
      expect(internalOrder).toHaveLength(2);
      expect(effectOrder).toHaveLength(2);
      // Toutes les passes de A précèdent le resolve de B — c'est l'invariant.
      expect(resolveOrder[0]).toBeLessThan(internalOrder[0]);
      expect(internalOrder[0]).toBeLessThan(effectOrder[0]);
      expect(effectOrder[0]).toBeLessThan(resolveOrder[1]);
      expect(resolveOrder[1]).toBeLessThan(internalOrder[1]);
      expect(internalOrder[1]).toBeLessThan(effectOrder[1]);
    });

    it("calls the port once per photo layer, with each layer's own imageSource", () => {
      const { executor, photoInputs } = createExecutor();
      const sharedTarget = texture() as unknown as GPUTexture;
      (photoInputs.resolve as ReturnType<typeof vi.fn>).mockReturnValue(sharedTarget);

      executor.run([photoLayer("L1", "photo-1"), photoLayer("L2", "photo-2")], null);

      const calls = (photoInputs.resolve as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      expect((calls[0][1] as LayerState).imageSource).toEqual({ sourceId: "photo-1" });
      expect((calls[1][1] as LayerState).imageSource).toEqual({ sourceId: "photo-2" });
      // Même encoder pour les deux : c'est ce qui garantit l'ordre
      // d'exécution sur lequel repose le partage de la cible.
      expect(calls[0][0]).toBe(calls[1][0]);
    });

    it("feeds every photo layer a view of the SAME shared target texture", () => {
      const { executor, effects, photoInputs } = createExecutor();
      const sharedTarget = texture();
      (photoInputs.resolve as ReturnType<typeof vi.fn>).mockReturnValue(sharedTarget as unknown as GPUTexture);

      executor.run([photoLayer("L1", "photo-1"), photoLayer("L2", "photo-2")], null);

      const effectCalls = (effects.runEffectPass as ReturnType<typeof vi.fn>).mock.calls;
      const sharedViews = sharedTarget.createView.mock.results.map((r) => r.value);
      expect(effectCalls[0][5].imageSourceView).not.toBeNull();
      expect(sharedViews).toContain(effectCalls[0][5].imageSourceView);
      expect(sharedViews).toContain(effectCalls[1][5].imageSourceView);
      // Vues distinctes (createView() par calque), même texture sous-jacente.
      expect(effectCalls[0][5].imageSourceView).not.toBe(effectCalls[1][5].imageSourceView);
    });

    it("mixes photo and non-photo layers without calling the port for the non-photo one", () => {
      const { executor, photoInputs } = createExecutor();
      (photoInputs.resolve as ReturnType<typeof vi.fn>).mockReturnValue(texture() as unknown as GPUTexture);

      executor.run(
        [photoLayer("L1", "photo-1"), layer({ id: "L2" }), photoLayer("L3", "photo-3")],
        null,
      );

      const calls = (photoInputs.resolve as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      expect((calls[1][1] as LayerState).imageSource).toEqual({ sourceId: "photo-3" });
    });
  });

  it("feeds runInternalPasses the resolved photo texture, not the composite-below, for a photo layer with a multi-pass effect", () => {
    const { executor, effects, photoInputs, source } = createExecutor();
    const resolvedTexture = texture() as unknown as GPUTexture;
    (photoInputs.resolve as ReturnType<typeof vi.fn>).mockReturnValue(resolvedTexture);
    effects.runInternalPasses = vi.fn(() => ({ view: {} as GPUTextureView, texture: texture() as unknown as GPUTexture }));
    const photoLayer = layer({
      id: "L1",
      effectId: "glow", // effet réel avec effect.passes — voir registry (Task 1)
      imageSource: { sourceId: "photo-1" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });

    executor.run([photoLayer], null);

    const [, , , internalSourceView] = (effects.runInternalPasses as ReturnType<typeof vi.fn>).mock.calls[0];
    // resolvedTexture.createView() est appelée deux fois (effectInputSourceView
    // ET imageSourceView, voir framePipelineExecutor.ts) — internalSourceView
    // porte le résultat du PREMIER appel (effectInputSourceView).
    const resolvedCreateView = (resolvedTexture as unknown as { createView: ReturnType<typeof vi.fn> }).createView;
    expect(internalSourceView).toBe(resolvedCreateView.mock.results[0]!.value);
    expect(internalSourceView).not.toBe(source.createView.mock.results[0]?.value);
  });
});

// T0 (design 2026-07-28) : l'exécuteur n'écrit plus jamais la surface visible.
// Il rend la texture à APLATIR, et `PresentPass` est le seul écrivain du canvas
// et de la cible d'export. Ce qui est verrouillé ici est la propriété dont tout
// le reste dépend : cette texture est toujours l'un des deux buffers de
// ping-pong (aucune VRAM supplémentaire) et n'est JAMAIS celle qu'une passe de
// la même frame lit en même temps qu'elle l'écrit.
describe("FramePipelineExecutor — texture à présenter", () => {
  it("rend le buffer de ping-pong écrit par la dernière passe (pile vide)", () => {
    const { executor, effects, firstTarget } = createExecutor();

    const result = executor.run([], null);

    const calls = (effects.runEffectPass as ReturnType<typeof vi.fn>).mock.calls;
    const firstTargetViews = firstTarget.createView.mock.results.map((r) => r.value);
    expect(calls[0][4]).toBe(firstTargetViews[0]);
    expect(result.presentTexture).toBe(firstTarget);
  });

  it("recopie la toile SANS masque sur la pile vide (copie stricte, alpha inclus)", () => {
    const { executor, effects } = createExecutor();

    executor.run([], null);

    const calls = (effects.runEffectPass as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].id).toBe("passthrough");
    expect(calls[0][5]).toEqual({ applyMask: false });
  });

  it("rend le buffer écrit par la dernière passe de la boucle (2 calques)", () => {
    const { executor, secondTarget } = createExecutor();

    const result = executor.run([layer({ id: "L1" }), layer({ id: "L2" })], null);

    expect(result.presentTexture).toBe(secondTarget);
  });

  it("avec overlay, rend la SORTIE de l'overlay, jamais le composite qu'il vient de lire", () => {
    const { executor, effects, masks, firstTarget, secondTarget } = createExecutor();
    masks.resolve = vi.fn(() => texture() as unknown as GPUTexture);

    const result = executor.run([layer({ id: "L1" })], "L1");

    // Un seul calque : sa passe écrit firstTarget, l'overlay le LIT et écrit
    // secondTarget. Lire et écrire la même texture dans une passe serait une
    // erreur de validation WebGPU — invisible en Node, fatale à l'écran.
    expect(result.composedTexture).toBe(firstTarget);
    expect(result.presentTexture).toBe(secondTarget);
    expect(result.presentTexture).not.toBe(result.composedTexture);
    const overlayCall = (effects.runOverlayPass as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(overlayCall[1]).toBe(firstTarget);
    expect(secondTarget.createView.mock.results.map((r) => r.value)).toContain(overlayCall[3]);
  });

  it("avec overlay sur pile vide, rend aussi la sortie de l'overlay", () => {
    const { executor, masks, firstTarget, secondTarget } = createExecutor();
    masks.resolve = vi.fn(() => texture() as unknown as GPUTexture);

    const result = executor.run([layer({ id: "L1", enabled: false })], "L1");

    expect(result.composedTexture).toBe(firstTarget);
    expect(result.presentTexture).toBe(secondTarget);
  });
});

/**
 * Fraîcheur du guide edge-aware (tranche T3 du design 2026-07-28 §2.6).
 *
 * Ce que ces tests MESURENT : le nombre de reconstructions de SAT de guide
 * qu'un `MaskTextureResolver` réel ferait à partir du flux d'epochs que
 * l'exécuteur produit. Le compteur reproduit littéralement la seule
 * comparaison qui les déclenche — `lastGuideEpochByLayer.get(id) !==
 * guideEpoch` (`src/render/maskTextureResolver.ts:259-263`), qui avance
 * `guideRevision`, elle-même la clé de cache de `needsGuide`
 * (`maskTextureResolver.ts:749-750`).
 *
 * Ce qu'ils NE mesurent PAS : le temps GPU réel, ni le contenu des textures.
 * Aucun device WebGPU n'est instancié ici. La non-régression des pixels est
 * du ressort de `scripts/render-check.mjs`.
 */
describe("FramePipelineExecutor — epochs de guide", () => {
  /** Branche un compteur de reconstructions sur les DEUX chemins par lesquels
   *  une epoch atteint `MaskTextureResolver.resolve` : les options de
   *  `runEffectPass` (rendu normal, via `effectPassRunner.resolveMask`) et
   *  l'appel direct de l'overlay. */
  function trackGuideRebuilds(effects: EffectPassesPort, masks: MaskTexturesPort) {
    const lastEpoch = new Map<string, number>();
    const rebuilds = new Map<string, number>();
    const feed = (id: string, epoch: number) => {
      if (lastEpoch.get(id) === epoch) return;
      lastEpoch.set(id, epoch);
      rebuilds.set(id, (rebuilds.get(id) ?? 0) + 1);
    };
    effects.runEffectPass = vi.fn((_e, _effect, l: LayerState, _s, _t, options) => {
      if (options?.applyMask) feed(l.id, options.guideEpoch as number);
    });
    masks.resolve = vi.fn((l: LayerState, _e, _v, _p, epoch: number) => {
      feed(l.id, epoch);
      return texture() as unknown as GPUTexture;
    });
    return (id: string) => rebuilds.get(id) ?? 0;
  }

  /** Le fond depuis T1 : un calque photo ordinaire, à l'index 0. */
  const background = layer({
    id: "BG",
    imageSource: { sourceId: "s1" },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  });
  const above = layer({ id: "ABOVE" });

  it("ne reconstruit le guide d'aucun calque quand la pile ne change pas d'une frame à l'autre", () => {
    const { executor, effects, masks } = createExecutor();
    const rebuilds = trackGuideRebuilds(effects, masks);

    executor.run([background, above], null);
    executor.run([background, above], null);
    executor.run([background, above], null);

    // 1 = la construction initiale, obligatoire. Le témoin de la régression
    // corrigée par T3 est le calque AU-DESSUS du fond : avec l'ancienne
    // formule (`index === 0 ? 0 : runGeneration`) il en comptait 3 sur 3
    // frames, une reconstruction complète de SAT par frame pour rien.
    expect(rebuilds("BG")).toBe(1);
    expect(rebuilds("ABOVE")).toBe(1);
  });

  it("reconstruit le guide du calque au-dessus quand le calque photo de fond change", () => {
    const { executor, effects, masks } = createExecutor();
    const rebuilds = trackGuideRebuilds(effects, masks);

    executor.run([background, above], null);
    // Un transform de photo modifié = un nouvel objet d'état (immuabilité
    // React), donc une entrée d'effet différente pour le fond, donc un
    // composite différent sous `above`.
    const moved = { ...background, params: { ...background.params, moved: 1 } };
    executor.run([moved, above], null);

    expect(rebuilds("ABOVE")).toBe(2);
    // Le guide du fond, lui, est SA PROPRE photo : un paramètre d'effet
    // modifié ne change ni sa source ni sa transformation, donc ne le périme
    // pas.
    expect(rebuilds("BG")).toBe(1);
  });

  it("reconstruit le guide d'un calque photo quand SA photo bouge", () => {
    // Le défaut symétrique de celui que la tranche T4 corrige : depuis que le
    // guide d'un calque photo est sa propre photo, une epoch qui ne suivrait
    // que la chaîne EN DESSOUS ne bougerait jamais quand on déplace la photo —
    // la SAT du guide resterait celle de l'ancienne position, servie en
    // silence. C'est exactement « un cache qui sert du périmé ».
    const { executor, effects, masks } = createExecutor();
    const rebuilds = trackGuideRebuilds(effects, masks);

    executor.run([background, above], null);
    const deplacee = { ...background, transform: { x: 40, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } };
    executor.run([deplacee, above], null);

    expect(rebuilds("BG")).toBe(2);
  });

  it("ne reconstruit PAS le guide d'un calque photo quand un calque EN DESSOUS change", () => {
    // L'autre moitié de la même décision : le guide d'un calque photo ne
    // dépend plus du composite en dessous, donc rien de ce qui s'y passe ne
    // doit déclencher la reconstruction (coûteuse) de sa SAT.
    const { executor, effects, masks } = createExecutor();
    const rebuilds = trackGuideRebuilds(effects, masks);
    const photoAuMilieu = layer({
      id: "MID",
      imageSource: { sourceId: "s2" },
      transform: { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0 },
    });

    executor.run([above, photoAuMilieu], null);
    executor.run([{ ...above, opacity: 0.4 }, photoAuMilieu], null);

    expect(rebuilds("MID")).toBe(1);
  });

  it("ne reconstruit rien quand seul le calque du DESSUS change", () => {
    const { executor, effects, masks } = createExecutor();
    const rebuilds = trackGuideRebuilds(effects, masks);

    executor.run([background, above], null);
    executor.run([background, { ...above, opacity: 0.5 }], null);

    expect(rebuilds("BG")).toBe(1);
    expect(rebuilds("ABOVE")).toBe(1);
  });

  it("reconstruit le guide quand l'ordre de la pile change", () => {
    const { executor, effects, masks } = createExecutor();
    const rebuilds = trackGuideRebuilds(effects, masks);

    executor.run([background, above], null);
    executor.run([above, background], null);

    // `above` passe en position 0 (guide = toile) et `background` en position
    // 1 (guide = above) : les deux guides changent d'identité.
    expect(rebuilds("ABOVE")).toBe(2);
    expect(rebuilds("BG")).toBe(2);
  });

  it("répute périmé le guide au-dessus d'un calque en aperçu live de pinceau", () => {
    const { executor, effects, masks } = createExecutor();
    const rebuilds = trackGuideRebuilds(effects, masks);

    // Pendant un trait, le masque du calque peint change à chaque échantillon
    // SANS nouveau `LayerState` : l'identité d'objet ne peut pas le voir.
    executor.run([background, above], null, "BG");
    executor.run([background, above], null, "BG");
    executor.run([background, above], null, "BG");

    expect(rebuilds("ABOVE")).toBe(3);
    expect(rebuilds("BG")).toBe(1);
  });

  it("sert la MÊME epoch aux deux appels d'un même calque dans une frame (ADR-0002)", () => {
    const { executor, effects, masks } = createExecutor();
    const epochs: Array<[string, number]> = [];
    effects.runEffectPass = vi.fn((_e, _effect, l: LayerState, _s, _t, options) => {
      if (options?.applyMask) epochs.push([`effect:${l.id}`, options.guideEpoch as number]);
    });
    masks.resolve = vi.fn((l: LayerState, _e, _v, _p, epoch: number) => {
      epochs.push([`overlay:${l.id}`, epoch]);
      return texture() as unknown as GPUTexture;
    });

    executor.run([background, above], "ABOVE");

    const effectEpoch = epochs.find(([k]) => k === "effect:ABOVE")![1];
    const overlayEpoch = epochs.find(([k]) => k === "overlay:ABOVE")![1];
    expect(overlayEpoch).toBe(effectEpoch);
  });
});
