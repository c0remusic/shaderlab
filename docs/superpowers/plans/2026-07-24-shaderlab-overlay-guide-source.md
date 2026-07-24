# Guide overlay = source (pas composite) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire pointer le guide edge-aware de l'overlay de contour sur l'image source (comme le rendu normal du premier calque) au lieu du composite, pour que les deux appels `masks.resolve()` du même calque partagent un guide de statut cohérent et arrêtent d'invalider en boucle le cache SAT du Fast Guided Filter.

**Architecture:** Changement d'un seul appel dans `FramePipelineExecutor.runFrame()` : `colorView` passe de `composedTexture.createView()` à `sourceTexture.createView()`, `guideEpoch` de `this.runGeneration` (variable) à `0` (constant, même statut que le cas "premier calque"). `composedTexture` reste la cible de compositing de `runOverlayPass()` — seul le guide interne au filtre change.

**Tech Stack:** TypeScript, Vitest (mocks de ports, aucun WebGPU réel dans ce test).

## Global Constraints

- Spec source : [docs/superpowers/specs/2026-07-24-shaderlab-overlay-guide-source-design.md](../specs/2026-07-24-shaderlab-overlay-guide-source-design.md)
- Aucun changement à `maskTextureResolver.ts` (le cache à deux paliers reste correct).
- Le doc `2026-07-23-shaderlab-mask-threshold-contour-design.md` n'est pas réécrit — seulement complété d'un renvoi.
- `npx tsc --noEmit` et `npm run test` doivent rester verts après chaque commit.

---

### Task 1: Guide overlay = source + test de garde

**Files:**
- Modify: `src/render/framePipelineExecutor.ts:230-250` (branche overlay de `runFrame`)
- Modify: `test/render/framePipelineExecutor.test.ts` (helper `createExecutor` + nouveau test)
- Modify: `docs/superpowers/specs/2026-07-23-shaderlab-mask-threshold-contour-design.md` (renvoi, pas de réécriture)

**Interfaces:**
- Consumes: `MaskTexturesPort.resolve(layer, encoder, colorView, pendingDestroy, guideEpoch)` — signature inchangée ([framePipelineExecutor.ts:50-56](../../../src/render/framePipelineExecutor.ts#L50)).
- Produces: aucune nouvelle interface — comportement interne de `runFrame()` uniquement, `FramePipelineResult` inchangé.

- [ ] **Step 1: Exposer `source` dans le helper de test `createExecutor`**

Dans `test/render/framePipelineExecutor.test.ts`, la fonction `createExecutor()` (lignes 27-63) construit déjà `source = texture()` mais ne le retourne pas. Ajouter `source` à l'objet retourné :

```ts
  return {
    executor: new FramePipelineExecutor(
      device,
      { sourceTexture: source as unknown as GPUTexture, pingPong: [firstTarget, secondTarget] as unknown as [GPUTexture, GPUTexture] },
      effects,
      masks,
    ),
    effects,
    masks,
    submit,
    transient,
    firstTarget,
    secondTarget,
    source,
  };
```

- [ ] **Step 2: Écrire le test qui échoue**

Ajouter ce test dans `describe("FramePipelineExecutor", ...)`, après le test existant "captures composedTexture/overlayMaskTexture from the ping-pong buffer when the overlay layer is enabled" (après la ligne 119) :

```ts
  it("uses the source texture (not the composite) as the overlay's edge-aware guide, with the stable epoch", () => {
    const { executor, masks, source } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    executor.run([layer({ enabled: true })], {} as GPUTextureView, "L1");

    expect(masks.resolve).toHaveBeenCalledOnce();
    const [, , colorView, , guideEpoch] = (masks.resolve as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(colorView).toBe(source.createView.mock.results.at(-1)!.value);
    expect(guideEpoch).toBe(0);
  });
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run test/render/framePipelineExecutor.test.ts -t "uses the source texture"`
Expected: FAIL — `colorView` pointe vers la vue du composite (`pingPong[writeIndex]`), pas vers `source.createView()`, et/ou `guideEpoch` vaut `1` (premier `runGeneration`) au lieu de `0`.

- [ ] **Step 4: Corriger `framePipelineExecutor.ts`**

Remplacer le bloc overlay (lignes 230-250 actuelles) :

```ts
    let overlayMaskTexture: GPUTexture | null = null;
    let composedTexture: GPUTexture | null = null;
    if (overlayLayer) {
      composedTexture = pingPong[writeIndex];
      overlayMaskTexture = this.masks.resolve(
        overlayLayer,
        encoder,
        composedTexture.createView(),
        pendingDestroy,
        // Guide = composite de tous les calques activés, toujours ré-encodé
        // à chaque run() — jamais le cas stable "premier calque".
        this.runGeneration,
      );
      this.effects.runOverlayPass(
        encoder,
        composedTexture,
        overlayMaskTexture,
        finalTargetView,
        overlayTimeSeconds,
      );
    }
```

par :

```ts
    let overlayMaskTexture: GPUTexture | null = null;
    let composedTexture: GPUTexture | null = null;
    if (overlayLayer) {
      composedTexture = pingPong[writeIndex];
      overlayMaskTexture = this.masks.resolve(
        overlayLayer,
        encoder,
        // Guide = image source stable, même statut que le rendu normal du
        // premier calque de la pile — pas le composite. Les deux appels
        // masks.resolve() pour ce calque (rendu normal + overlay) partagent
        // ainsi un guide de statut cohérent : sans ça, ils écrivaient chacun
        // dans le même slot lastGuideEpochByLayer avec des guides
        // différents, invalidant en continu le cache SAT du filtre
        // edge-aware dès que l'overlay est actif pendant l'édition d'un
        // calque (voir docs/superpowers/specs/2026-07-24-shaderlab-overlay-guide-source-design.md).
        // Le compositing visuel de l'overlay, lui, reste sur composedTexture
        // ci-dessous — seul le guide interne au filtre change.
        sourceTexture.createView(),
        pendingDestroy,
        0,
      );
      this.effects.runOverlayPass(
        encoder,
        composedTexture,
        overlayMaskTexture,
        finalTargetView,
        overlayTimeSeconds,
      );
    }
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run test/render/framePipelineExecutor.test.ts -t "uses the source texture"`
Expected: PASS

- [ ] **Step 6: Lancer la suite complète + type-check**

Run: `npm run test`
Expected: tous les tests verts (aucune régression sur les tests existants du fichier — ils n'assertaient pas `colorView`/`guideEpoch` sur cet appel).

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7: Ajouter le renvoi dans le doc historique**

Dans `docs/superpowers/specs/2026-07-23-shaderlab-mask-threshold-contour-design.md`, sous le titre `# Contour de seuil animé sur l'overlay de masque` (ligne 1), ajouter juste après (ligne 2) :

```markdown

> **Mise à jour 2026-07-24** : le guide du filtre edge-aware pour ce contour
> n'est plus `composedTexture` mais `sourceTexture` — voir
> [2026-07-24-shaderlab-overlay-guide-source-design.md](2026-07-24-shaderlab-overlay-guide-source-design.md).
> Ce document garde son texte d'origine pour l'historique de la décision
> initiale, périmée sur ce point précis.
```

- [ ] **Step 8: Commit**

```bash
git add src/render/framePipelineExecutor.ts test/render/framePipelineExecutor.test.ts docs/superpowers/specs/2026-07-23-shaderlab-mask-threshold-contour-design.md
git commit -m "$(cat <<'EOF'
fix(mask): guide overlay contour sur sourceTexture, pas composedTexture

Les deux appels masks.resolve() pour un calque en édition (rendu normal +
overlay) écrivaient dans le même slot lastGuideEpochByLayer avec des guides
différents (composite pour l'overlay, source/composite partiel pour le
rendu normal), invalidant en continu le cache SAT du Fast Guided Filter dès
que l'overlay est actif. Aligne l'overlay sur le même guide/epoch que le
premier calque de la pile — voir design doc pour la preuve visuelle
(spike CDP glow+warp) qui écarte un cache double par calque.
EOF
)"
```

---

### Task 2: Guide overlay mirroré sur l'index réel du calque (amendement)

> Amendement post-revue finale : Task 1 ne couvrait que le calque du bas
> (`index === 0`). Pour un calque non-premier, l'overlay doit désormais
> mirroriser exactement la formule `index === 0 ? 0 : this.runGeneration`
> déjà utilisée par la boucle de rendu principale — voir
> [2026-07-24-shaderlab-overlay-guide-source-design.md](../specs/2026-07-24-shaderlab-overlay-guide-source-design.md)
> section "Décision (amendée)".

**Files:**
- Modify: `src/render/framePipelineExecutor.ts:230-250` (branche overlay de `runFrame`, code posé par Task 1)
- Modify: `test/render/framePipelineExecutor.test.ts` (remplace le test ajouté par Task 1, ajoute deux cas)

**Interfaces:**
- Consumes: `MaskTexturesPort.resolve(layer, encoder, colorView, pendingDestroy, guideEpoch)` — signature inchangée.
- Produces: aucune nouvelle interface.

- [ ] **Step 1: Remplacer le test de Task 1 par trois cas couvrant les trois positions d'index**

Dans `test/render/framePipelineExecutor.test.ts`, supprimer le test ajouté par Task 1 (`"uses the source texture (not the composite) as the overlay's edge-aware guide, with the stable epoch"`, lignes 122-133) et le remplacer par ces trois tests, insérés au même endroit :

```ts
  it("uses the source texture and epoch 0 as the overlay's guide when the overlay layer is the bottom layer", () => {
    const { executor, masks, source } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    executor.run([layer({ id: "L1", enabled: true })], {} as GPUTextureView, "L1");

    expect(masks.resolve).toHaveBeenCalledOnce();
    const [, , colorView, , guideEpoch] = (masks.resolve as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(colorView).toBe(source.createView.mock.results.at(-1)!.value);
    expect(guideEpoch).toBe(0);
  });

  it("uses the source texture and epoch 0 as the overlay's guide when the overlay layer is disabled (absent from enabledLayers)", () => {
    const { executor, masks, source } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    executor.run(
      [layer({ id: "L1", enabled: true }), layer({ id: "L2", enabled: false })],
      {} as GPUTextureView,
      "L2",
    );

    expect(masks.resolve).toHaveBeenCalledOnce();
    const [, , colorView, , guideEpoch] = (masks.resolve as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(colorView).toBe(source.createView.mock.results.at(-1)!.value);
    expect(guideEpoch).toBe(0);
  });

  it("uses the composite and the same epoch as the layer's own render pass when the overlay layer is not the bottom layer", () => {
    const { executor, effects, masks, secondTarget } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    executor.run(
      [layer({ id: "L1", enabled: true }), layer({ id: "L2", enabled: true })],
      {} as GPUTextureView,
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
```

- [ ] **Step 2: Lancer les trois nouveaux tests pour vérifier qu'ils échouent**

Run: `npx vitest run test/render/framePipelineExecutor.test.ts -t "overlay's guide"`
Expected: le premier test ("bottom layer") PASSE déjà (comportement de Task 1 inchangé pour ce cas). Le deuxième ("disabled") et le troisième ("not the bottom layer") ÉCHOUENT — le code actuel de Task 1 utilise toujours `sourceTexture`/`0` sans regarder l'index réel du calque overlay, donc le troisième test en particulier doit échouer sur `overlayColorView` (reçoit la vue source, pas celle de `secondTarget`) et/ou `overlayGuideEpoch` (reçoit `0` au lieu de `this.runGeneration`).

- [ ] **Step 3: Corriger `framePipelineExecutor.ts`**

Remplacer le bloc overlay actuel (posé par Task 1) :

```ts
    let overlayMaskTexture: GPUTexture | null = null;
    let composedTexture: GPUTexture | null = null;
    if (overlayLayer) {
      composedTexture = pingPong[writeIndex];
      overlayMaskTexture = this.masks.resolve(
        overlayLayer,
        encoder,
        // Guide = image source stable, même statut que le rendu normal du
        // premier calque de la pile — pas le composite. Les deux appels
        // masks.resolve() pour ce calque (rendu normal + overlay) partagent
        // ainsi un guide de statut cohérent : sans ça, ils écrivaient chacun
        // dans le même slot lastGuideEpochByLayer avec des guides
        // différents, invalidant en continu le cache SAT du filtre
        // edge-aware dès que l'overlay est actif pendant l'édition d'un
        // calque (voir docs/superpowers/specs/2026-07-24-shaderlab-overlay-guide-source-design.md).
        // Le compositing visuel de l'overlay, lui, reste sur composedTexture
        // ci-dessous — seul le guide interne au filtre change.
        sourceTexture.createView(),
        pendingDestroy,
        0,
      );
      this.effects.runOverlayPass(
        encoder,
        composedTexture,
        overlayMaskTexture,
        finalTargetView,
        overlayTimeSeconds,
      );
    }
```

par :

```ts
    let overlayMaskTexture: GPUTexture | null = null;
    let composedTexture: GPUTexture | null = null;
    if (overlayLayer) {
      composedTexture = pingPong[writeIndex];
      // L'invariant qui compte n'est PAS "l'overlay utilise tel guide
      // fixe" mais "les deux appels masks.resolve() d'un même calque, dans
      // la même frame, portent le même guideEpoch numérique" — c'est la
      // seule chose que MaskTextureResolver compare pour décider
      // d'invalider (maskTextureResolver.ts:243-247), pas l'identité de
      // texture. On mirrorise donc exactement la formule déjà utilisée par
      // la boucle principale (index === 0 ? 0 : this.runGeneration) sur
      // l'index réel du calque overlay, plutôt qu'une valeur fixe — sans
      // ça, un calque non-premier édité avec overlay actif invaliderait
      // son cache SAT à CHAQUE appel au lieu d'aucun (voir
      // docs/superpowers/specs/2026-07-24-shaderlab-overlay-guide-source-design.md,
      // amendement).
      const overlayIndex = enabledLayers.findIndex((l) => l.id === overlayLayer.id);
      overlayMaskTexture = this.masks.resolve(
        overlayLayer,
        encoder,
        overlayIndex <= 0 ? sourceTexture.createView() : composedTexture.createView(),
        pendingDestroy,
        overlayIndex <= 0 ? 0 : this.runGeneration,
      );
      this.effects.runOverlayPass(
        encoder,
        composedTexture,
        overlayMaskTexture,
        finalTargetView,
        overlayTimeSeconds,
      );
    }
```

- [ ] **Step 4: Lancer les trois tests pour vérifier qu'ils passent**

Run: `npx vitest run test/render/framePipelineExecutor.test.ts -t "overlay's guide"`
Expected: PASS (les trois cas)

- [ ] **Step 5: Lancer la suite complète + type-check**

Run: `npm run test`
Expected: tous les tests verts.

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add src/render/framePipelineExecutor.ts test/render/framePipelineExecutor.test.ts
git commit -m "$(cat <<'EOF'
fix(mask): mirroriser le guide overlay sur l'index réel du calque édité

Task 1 ne couvrait que le calque du bas (index 0). Pour un calque
non-premier, l'overlay portait un guideEpoch fixe (0) qui ne coïncidait
plus jamais avec le guideEpoch (this.runGeneration) du rendu normal de ce
même calque — invalidant le cache SAT à chaque appel au lieu d'aucun.
Mirrorise désormais la formule index===0?0:runGeneration déjà utilisée par
la boucle de rendu principale, appliquée à l'index réel du calque overlay.
EOF
)"
```

---

## Self-Review

**Spec coverage** : le seul changement de comportement de la spec (`framePipelineExecutor.ts:237`, guide=source + epoch=0) est couvert Task 1 Step 4 ; le test de garde demandé par la spec est couvert Task 1 Step 2 ; le renvoi dans le doc historique (section "Hors scope" de la spec) est couvert Task 1 Step 7. L'amendement (guide mirroré sur l'index réel, Task 2) couvre les trois cas de la section Testing amendée de la spec : calque du bas, calque désactivé, calque non-premier. Le cache double par calque et la réécriture de `maskTextureResolver.ts` sont explicitement hors scope de la spec — aucune tâche ne les couvre, c'est voulu.

**Placeholder scan** : aucun "TBD"/"handle edge cases" — chaque step contient le code exact à écrire.

**Type consistency** : `MaskTexturesPort.resolve` garde sa signature `(layer, encoder, colorView, pendingDestroy, guideEpoch)` dans le test comme dans l'implémentation — aucun renommage introduit. `enabledLayers` (variable déjà en scope dans `runFrame`, définie ligne 142) est réutilisée telle quelle par `overlayIndex`, pas redéfinie.
