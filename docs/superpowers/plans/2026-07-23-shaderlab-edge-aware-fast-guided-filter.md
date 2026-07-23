# Fast Guided Filter sous-échantillonné + SAT (edge-aware) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le drag du slider « Rayon des contours » (edge-aware, `refineEdge.edgeRadius`, 1..50) fluide même à rayon 50 sur une photo 24MP, en remplaçant la boucle WGSL O(radius) actuelle par un filtre guidé sous-échantillonné (Fast Guided Filter) + table de sommes intégrales (SAT) à lookup O(1).

**Architecture:** Le guide couleur et le masque d'entrée sont downscalés (plafond ~2048px de long côté) avant tout calcul de statistiques. Les moyennes de boîte (mean_I, mean_p, corr_I, corr_Ip, mean_a, mean_b) passent par une SAT (Hillis-Steele, ~log2(largeur)+log2(hauteur) passes) au lieu d'une boucle par pixel. Cache à trois paliers : construction SAT du guide (I/p, I²/Ip) — coûteuse, gelée tant que `guideRevision(id)` ne change pas ; lookup O(1) + calcul a/b — bon marché, rejoué à chaque changement de rayon/force ; composite final — inchangé, lit le guide en PLEINE résolution + les coefficients a/b upsamplés (bilinéaire, via `textureSample` normal sur une texture réduite — gratuit, aucune passe dédiée).

**Tech Stack:** TypeScript, WGSL brut, WebGPU (`@webgpu/types`), Vitest (Node, fake GPU device — aucun test ne rend réellement de pixels, voir `test/render/maskTextureResolver.test.ts` existant).

## Global Constraints

- Plafond de downscale : 2048px de long côté (`CAP = 2048`, constante — pas configurable, YAGNI). Une image dont le plus grand côté est ≤2048px n'est jamais downscalée (`scale = min(1, CAP / max(width, height))`).
- Format des SAT : `rg32float` (précision requise, voir spec § Format des SAT). Lu exclusivement via `textureLoad` (jamais `textureSample`) — `rg32float` est `unfilterable-float` en WebGPU.
- `refine()` (feather/contract/smooth, `maskTextureResolver.ts:830+`) et `boxFilterWgsl`/`buildBoxFilterHWgsl`/`buildBoxFilterVWgsl` (`edgeAwareWgsl.ts:64-99`) **ne sont pas touchés** — `refine()` les utilise toujours en `channels=1`.
- Rien en dehors de `src/mask/edgeAwareWgsl.ts` et de la section edge-aware de `src/render/maskTextureResolver.ts` (`edge()`/`edgePipeline()`, le type `EdgeWork`, `edgeAwareWorkTextures`) n'est modifié. Aucun changement à `MaskPanel.tsx`, `App.tsx`, `renderer.ts`.
- Spec de référence : [docs/superpowers/specs/2026-07-23-shaderlab-edge-aware-fast-guided-filter-design.md](../specs/2026-07-23-shaderlab-edge-aware-fast-guided-filter-design.md) — revue par l'agent `architect`, 2 corrections déjà intégrées (clé de cache `guideRevision` séparée, lookup SAT via `textureLoad`).

---

### Task 1: `guideRevision(id)` — compteur de révision du guide, séparé de `maskRevision`

**Files:**
- Modify: `src/render/maskTextureResolver.ts` (nouveau champ + méthodes privées, nouveaux appels de bump, `sweep()`)
- Test: `test/render/maskTextureResolver.test.ts`

**Interfaces:**
- Consumes: rien (nouveau compteur autonome, même pattern que `maskRevision`/`bumpRevision`/`revision` déjà existants aux lignes 102/124-129).
- Produces: `private guideRevisionByLayer: Map<string, number>`, `private bumpGuideRevision(id: string): void`, `private guideRevision(id: string): number` — consommés par Task 3.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `test/render/maskTextureResolver.test.ts`, dans un nouveau describe :

```ts
describe("MaskTextureResolver — guideRevision (séparé de maskRevision)", () => {
  it("avance guideRevision quand le contenu résident d'une source change, pas quand seul edgeRadius change", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.addMaskSource(id, "luminosity");
    let layer = stack.layers.find((l) => l.id === id)!;
    layer = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeAware: true, edgeStrength: 1, edgeRadius: 5 } } };
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, [], 0);
    // @ts-expect-error accès direct pour le test — méthode privée
    const guideRevAfterFirst = resolver.guideRevision(id);

    // Changement de edgeRadius seul (même contenu) : guideRevision ne bouge pas.
    const radiusChanged = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeRadius: 40 } } };
    resolver.resolve(radiusChanged, createFakeEncoder(counts), {} as GPUTextureView, [], 0);
    // @ts-expect-error accès direct pour le test
    expect(resolver.guideRevision(id)).toBe(guideRevAfterFirst);

    // Changement de contenu réel (invert) : guideRevision avance.
    const invertChanged = { ...radiusChanged, mask: { ...radiusChanged.mask, invert: true } };
    resolver.resolve(invertChanged, createFakeEncoder(counts), {} as GPUTextureView, [], 0);
    // @ts-expect-error accès direct pour le test
    expect(resolver.guideRevision(id)).toBeGreaterThan(guideRevAfterFirst);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `npx vitest run test/render/maskTextureResolver.test.ts -t "guideRevision"`
Expected: FAIL — `resolver.guideRevision is not a function` (la méthode n'existe pas encore).

- [ ] **Step 3: Implémenter `guideRevisionByLayer`/`bumpGuideRevision`/`guideRevision`**

Dans `src/render/maskTextureResolver.ts`, juste après la déclaration de `maskRevision` (ligne 102) :

```ts
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
```

Puis, juste après `private revision(id: string): number { ... }` (ligne 127-129) :

```ts
  private bumpGuideRevision(id: string): void {
    this.guideRevisionByLayer.set(id, (this.guideRevisionByLayer.get(id) ?? 0) + 1);
  }
  private guideRevision(id: string): number {
    return this.guideRevisionByLayer.get(id) ?? 0;
  }
```

- [ ] **Step 4: Appeler `bumpGuideRevision` aux 5 sites où le contenu du guide change réellement**

Ces 5 sites bumpent déjà `bumpRevision` — ajouter `bumpGuideRevision` à côté, **jamais** aux 2 autres sites (`edge()` toggle ON/OFF ligne 624, self-bump interne d'`edgePipeline()` ligne 685 — ces deux-là restent `bumpRevision` seul).

Site 1 (`resolve()`, bascule `invert`, ~ligne 193-195) :
```ts
    if (this.lastInvertByLayer.get(layer.id) !== layer.mask.invert) {
      this.bumpRevision(layer.id);
      this.bumpGuideRevision(layer.id);
      this.lastInvertByLayer.set(layer.id, layer.mask.invert);
    }
```

Site 2 (`resolve()`, `guideEpoch`, ~ligne 207-209) :
```ts
    if (this.lastGuideEpochByLayer.get(layer.id) !== guideEpoch) {
      this.bumpRevision(layer.id);
      this.bumpGuideRevision(layer.id);
      this.lastGuideEpochByLayer.set(layer.id, guideEpoch);
    }
```

Site 3 (`resolve()`, cache-miss du fold, ~ligne 238-244) :
```ts
    if (!cacheHit) {
      this.bumpRevision(layer.id);
      this.bumpGuideRevision(layer.id);
      this.foldedMaskTextures.set(layer.id, {
        texture: folded,
        lastInputs: snapshot,
        lastInvert: layer.mask.invert,
      });
    }
```

Site 4 (`resident()`, recompute réel, ~ligne 332-333) :
```ts
    this.sourceTextures.set(key, { texture, syncedFrom: raster });
    this.bumpRevision(id);
    this.bumpGuideRevision(id);
```

Site 5 (`parametric()`, recompute réel, ~ligne 439-442) :
```ts
    this.parametricSourceTextures.set(key, {
      texture,
      syncedFrom: source.params,
    });
    this.bumpRevision(id);
    this.bumpGuideRevision(id);
```

- [ ] **Step 5: Purger `guideRevisionByLayer` dans `sweep()`**

Dans `sweep()`, juste après la purge de `maskRevision` (~ligne 145-146) :

```ts
    for (const id of this.maskRevision.keys())
      if (!layerIds.has(id)) this.maskRevision.delete(id);
    for (const id of this.guideRevisionByLayer.keys())
      if (!layerIds.has(id)) this.guideRevisionByLayer.delete(id);
```

- [ ] **Step 6: Lancer le test, vérifier qu'il passe**

Run: `npx vitest run test/render/maskTextureResolver.test.ts -t "guideRevision"`
Expected: PASS

- [ ] **Step 7: `tsc` + suite complète**

Run: `npx tsc --noEmit && npx vitest run test/render/maskTextureResolver.test.ts`
Expected: 0 erreur TypeScript, tous les tests existants + le nouveau verts.

- [ ] **Step 8: Commit**

```bash
git add src/render/maskTextureResolver.ts test/render/maskTextureResolver.test.ts
git commit -m "feat(mask): ajouter guideRevision, compteur séparé de maskRevision

Prépare le cache à deux niveaux du filtre edge-aware (Task suivante) —
guideRevision n'avance que sur un changement de CONTENU du guide, jamais
sur un changement de edgeRadius/edgeStrength seul."
```

---

### Task 2: Nouveaux générateurs WGSL — downsample, SAT (widen/scan/lookup)

**Files:**
- Modify: `src/mask/edgeAwareWgsl.ts` (4 nouvelles fonctions exportées)
- Test: `test/mask/edgeAwareWgsl.test.ts`

**Interfaces:**
- Consumes: `FULLSCREEN_VERTEX_WGSL` (déjà importé dans le fichier).
- Produces: `buildDownsampleWgsl(): string`, `buildSatWidenWgsl(): string`, `buildSatScanWgsl(direction: "H" | "V"): string`, `buildSatLookupWgsl(): string` — consommés par Task 3.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `test/mask/edgeAwareWgsl.test.ts`, avant la fermeture du `describe` existant (après le test `buildCompositeWgsl`, avant la ligne `});` finale) :

```ts
  it("buildDownsampleWgsl fait une moyenne de boîte 2x2 en niveaux de gris", () => {
    const wgsl = buildDownsampleWgsl();
    expect(wgsl).toContain("fn fs_downsample(");
    expect(wgsl).toContain("var srcSampler: sampler");
    expect(wgsl).toContain("* 0.25");
  });

  it("buildSatWidenWgsl convertit une source rg8/rg16 en rg32float via textureLoad, sans sampler", () => {
    const wgsl = buildSatWidenWgsl();
    expect(wgsl).toContain("fn fs_satWiden(");
    expect(wgsl).toContain("textureLoad(src, coord, 0)");
    expect(wgsl).not.toContain("sampler");
  });

  it("buildSatScanWgsl fait un pas Hillis-Steele H ou V via textureLoad, offset en uniform", () => {
    const h = buildSatScanWgsl("H");
    const v = buildSatScanWgsl("V");
    expect(h).toContain("fn fs_satScanH(");
    expect(v).toContain("fn fs_satScanV(");
    expect(h).toContain("var<uniform> offset: f32");
    expect(h).toContain("coord.x - off");
    expect(v).toContain("coord.y - off");
    expect(h).not.toContain("sampler");
  });

  it("buildSatLookupWgsl calcule une moyenne de boîte O(1) via 4 échantillons coin", () => {
    const wgsl = buildSatLookupWgsl();
    expect(wgsl).toContain("fn fs_satLookup(");
    expect(wgsl).toContain("var<uniform> radius: f32");
    expect(wgsl).toContain("fn satAt(");
    expect(wgsl).not.toContain("sampler");
  });
```

Et ajouter les imports correspondants en haut du fichier :

```ts
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
} from "../../src/mask/edgeAwareWgsl";
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `npx vitest run test/mask/edgeAwareWgsl.test.ts`
Expected: FAIL — `buildDownsampleWgsl is not a function` (et les 3 autres).

- [ ] **Step 3: Implémenter les 4 fonctions dans `src/mask/edgeAwareWgsl.ts`**

Ajouter à la fin du fichier (après `buildCompositeWgsl`) :

```ts
/** Downscale du guide (I ou p, r8unorm) avant le filtre guidé — moyenne de
 *  boîte 2x2 (4 échantillons bilinéaires) plutôt qu'un simple resize
 *  1-tap, pour limiter l'aliasing au facteur de réduction typique (~3x sur
 *  une photo 24MP downscalée au plafond de 2048px, cf. spec design). */
export function buildDownsampleWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

@fragment
fn fs_downsample(in: VertexOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src));
  let o = texel * 0.5;
  let a = textureSample(src, srcSampler, in.uv + vec2<f32>(-o.x, -o.y)).r;
  let b = textureSample(src, srcSampler, in.uv + vec2<f32>(o.x, -o.y)).r;
  let c = textureSample(src, srcSampler, in.uv + vec2<f32>(-o.x, o.y)).r;
  let d = textureSample(src, srcSampler, in.uv + vec2<f32>(o.x, o.y)).r;
  let v = (a + b + c + d) * 0.25;
  return vec4<f32>(v, v, v, 1.0);
}
`;
}

/** Première étape d'une SAT (image intégrale) : convertit une source rg8/
 *  rg16 (packedIp, squareCorr, ab) en rg32float via `textureLoad` (jamais
 *  `textureSample` — `rg32float` est `unfilterable-float` en WebGPU, voir
 *  spec design § Lookup SAT via textureLoad). Passthrough identité, aucune
 *  somme — la construction Hillis-Steele proprement dite commence à la
 *  passe suivante (`buildSatScanWgsl`). */
export function buildSatWidenWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;

@fragment
fn fs_satWiden(in: VertexOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(in.position.xy);
  let c = textureLoad(src, coord, 0).rg;
  return vec4<f32>(c, 0.0, 1.0);
}
`;
}

/** Un pas de scan Hillis-Steele (prefix-sum inclusif) le long d'un axe —
 *  appelé ceil(log2(largeur)) fois en H puis ceil(log2(hauteur)) fois en V
 *  (offset = 2^k à chaque appel) pour obtenir la SAT 2D complète (technique
 *  séparable standard). `radius` (l'utilisateur) n'intervient JAMAIS ici —
 *  c'est ce qui rend la construction de la SAT indépendante du rayon
 *  choisi (voir spec design § Cache à deux niveaux) ; le rayon n'entre en
 *  jeu qu'au lookup (`buildSatLookupWgsl`). */
export function buildSatScanWgsl(direction: "H" | "V"): string {
  const entryPoint = direction === "H" ? "fs_satScanH" : "fs_satScanV";
  const prevCoordExpr =
    direction === "H"
      ? "vec2<i32>(coord.x - off, coord.y)"
      : "vec2<i32>(coord.x, coord.y - off)";
  const boundsCheck = direction === "H" ? "prevCoord.x >= 0" : "prevCoord.y >= 0";
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> offset: f32;

@fragment
fn ${entryPoint}(in: VertexOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(in.position.xy);
  let off = i32(offset);
  var sum = textureLoad(src, coord, 0).rg;
  let prevCoord = ${prevCoordExpr};
  if (${boundsCheck}) {
    sum = sum + textureLoad(src, prevCoord, 0).rg;
  }
  return vec4<f32>(sum, 0.0, 1.0);
}
`;
}

/** Lookup O(1) d'une moyenne de boîte de rayon quelconque à partir d'une
 *  SAT complète (4 échantillons coin, différence d'aires — technique
 *  standard des images intégrales). `radius` est déjà mis à l'échelle du
 *  guide réduit par l'appelant (`edgeRadius * scale`, voir spec design §
 *  Mise à l'échelle du rayon) — cette fonction ne connaît que des texels
 *  du guide réduit, jamais la résolution de la photo source. */
export function buildSatLookupWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var sat: texture_2d<f32>;
@group(0) @binding(1) var<uniform> radius: f32;

fn satAt(coord: vec2<i32>, dims: vec2<i32>) -> vec2<f32> {
  if (coord.x < 0 || coord.y < 0) {
    return vec2<f32>(0.0, 0.0);
  }
  let clamped = vec2<i32>(min(coord.x, dims.x - 1), min(coord.y, dims.y - 1));
  return textureLoad(sat, clamped, 0).rg;
}

@fragment
fn fs_satLookup(in: VertexOut) -> @location(0) vec4<f32> {
  let dims = vec2<i32>(textureDimensions(sat));
  let coord = vec2<i32>(in.position.xy);
  let r = max(i32(radius), 0);
  let x1 = max(coord.x - r, 0);
  let x2 = min(coord.x + r, dims.x - 1);
  let y1 = max(coord.y - r, 0);
  let y2 = min(coord.y + r, dims.y - 1);
  let a = satAt(vec2<i32>(x2, y2), dims);
  let b = satAt(vec2<i32>(x1 - 1, y2), dims);
  let c = satAt(vec2<i32>(x2, y1 - 1), dims);
  let d = satAt(vec2<i32>(x1 - 1, y1 - 1), dims);
  let sum = a - b - c + d;
  let count = f32((x2 - x1 + 1) * (y2 - y1 + 1));
  let mean = sum / max(count, 1.0);
  return vec4<f32>(mean, 0.0, 1.0);
}
`;
}
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `npx vitest run test/mask/edgeAwareWgsl.test.ts`
Expected: PASS (tous, y compris les tests existants inchangés)

- [ ] **Step 5: `tsc`**

Run: `npx tsc --noEmit`
Expected: 0 erreur

- [ ] **Step 6: Commit**

```bash
git add src/mask/edgeAwareWgsl.ts test/mask/edgeAwareWgsl.test.ts
git commit -m "feat(mask): générateurs WGSL downsample + SAT (widen/scan/lookup)

Briques du Fast Guided Filter sous-échantillonné (Task suivante les
câble dans edgePipeline). Purs générateurs de string, testés par
assertions de contenu comme les builders edge-aware existants."
```

---

### Task 3: Réécriture d'`edgePipeline()` — pipeline sous-échantillonné + SAT, cache à deux niveaux

**Files:**
- Modify: `src/render/maskTextureResolver.ts` (`EdgeWork`, `edgePipeline()`, imports)
- Test: `test/render/maskTextureResolver.test.ts`

**Interfaces:**
- Consumes: `guideRevision(id)`/`bumpGuideRevision` (Task 1), `buildDownsampleWgsl`/`buildSatWidenWgsl`/`buildSatScanWgsl`/`buildSatLookupWgsl` (Task 2).
- Produces: `edgePipeline()` garde exactement la même signature et le même contrat de retour (`GPUTexture` réutilisable, `COPY_SRC`) — `edge()`/`refine()` ne changent pas.

- [ ] **Step 1: Écrire les tests qui échouent (comportement de cache à deux niveaux)**

Ajouter à `test/render/maskTextureResolver.test.ts`, dans le describe `"MaskTextureResolver — edge-aware/refine result cache"` existant (après le dernier test de ce describe, avant sa fermeture) :

```ts
  it("un changement d'edgeRadius seul (guide inchangé) NE relance PAS la construction SAT du guide (downsample+pack+squareCorr+scan), seulement les passes de lookup/composite bon marché (regression : la clé de cache de la SAT du guide doit être guideRevision, pas maskRevision+edgeRadius)", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    const radiusChanged = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeRadius: 45 } } };
    resolver.resolve(radiusChanged, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const delta = counts.passes - afterFirst.passes;
    // Le pipeline COMPLET (downsample x2 + pack + squareCorr + 2 SAT de
    // guide construites de zéro + leurs lookups + computeAB + SAT a/b +
    // son lookup + composite) coûte largement plus de 30 passes à une
    // résolution de test — un delta sous ce seuil prouve que la
    // construction SAT du guide N'A PAS été rejouée, seulement le chemin
    // bon marché (2 lookups guide + computeAB + SAT a/b + son lookup +
    // composite).
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(30);
  });

  it("un changement de contenu réel (invert) relance toute la construction SAT (guide ET a/b) — coût nettement supérieur à un simple changement de rayon", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    const radiusChanged = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeRadius: 45 } } };
    resolver.resolve(radiusChanged, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterRadius = { ...counts };
    const cheapDelta = afterRadius.passes - afterFirst.passes;

    const inverted = { ...radiusChanged, mask: { ...radiusChanged.mask, invert: true } };
    resolver.resolve(inverted, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const fullDelta = counts.passes - afterRadius.passes;

    expect(fullDelta).toBeGreaterThan(cheapDelta);
  });
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `npx vitest run test/render/maskTextureResolver.test.ts -t "edgeRadius seul"`
Expected: FAIL — avec l'implémentation actuelle (boucle O(radius), cache à un seul palier), un changement de `edgeRadius` relance TOUTES les passes (11, le pipeline entier), pas seulement le chemin bon marché — le test `toBeLessThan(30)` passe par accident aujourd'hui (11 < 30) mais le premier test de ce fichier (`re-encodes the edge-aware guided-filter when its inputs are unchanged` etc.) sert de garde-fou de non-régression une fois Task 3 terminée. Le signal réel de cette étape est le test suivant : lancer aussi

Run: `npx vitest run test/render/maskTextureResolver.test.ts -t "contenu réel"`
Expected: FAIL tant que Task 3 n'est pas implémentée (le delta "cheap" et le delta "full" sont identiques aujourd'hui, car les deux relancent tout `edgePipeline` au complet).

- [ ] **Step 3: Étendre (pas remplacer) les imports WGSL dans `maskTextureResolver.ts`**

`buildBoxFilterHWgsl`/`buildBoxFilterVWgsl` restent nécessaires — `refine()` les appelle en `channels=1` (lignes 871-872 et 875-876, vérifié sur pièce). Remplacer le bloc d'import existant (lignes 22-30) par :

```ts
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
```

Seuls les APPELS à `buildBoxFilterHWgsl(2)`/`buildBoxFilterVWgsl(2)` dans l'ancien corps d'`edgePipeline()` (lignes 785-812, channels=2) disparaissent avec la réécriture de Step 5 — les appels en `channels=1` dans `refine()` ne changent pas.

- [ ] **Step 4: Réécrire le type `EdgeWork`**

Remplacer le type `EdgeWork` (lignes 42-67) :

```ts
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
```

- [ ] **Step 5: Réécrire `edgePipeline()`**

Remplacer la méthode complète `private edgePipeline(...)` (le bloc allant de sa déclaration jusqu'à son `}` fermant, juste avant `private refine(`) par :

```ts
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
      const mkSmall = (format: GPUTextureFormat) =>
        this.ctx.device.createTexture({
          size: [smallW, smallH],
          format,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
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
        satIp: mkSmall("rg32float"),
        satCorr: mkSmall("rg32float"),
        satScratchA: mkSmall("rg32float"),
        satScratchB: mkSmall("rg32float"),
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
    if (!needsGuide && !needsAB) return w.result;
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
    const runLoad = (
      wgsl: string,
      entry: string,
      target: GPUTexture,
      views: GPUTextureView[],
      u?: GPUBuffer,
    ) => {
      const key = `${entry}:${wgsl.length}:load`;
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
    };
    const uniform = (v: number) => {
      const b = this.ctx.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.ctx.device.queue.writeBuffer(b, 0, new Float32Array([v, 0, 0, 0]));
      p.push(b);
      return b;
    };
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
      w.lastRevision = maskRev;
      w.lastRadius = x.edgeRadius;
      w.lastStrength = x.edgeStrength;
    }
    return w.result;
  }
```

> Note pour l'implémenteur : `buildSat` retourne `satScratchA` ou
> `satScratchB` selon la parité du nombre de passes — jamais directement
> `w.satIp`/`w.satCorr` (qui sont des textures PERSISTANTES séparées). Le
> `copyTextureToTexture` après `buildSat(packedIp)`/`buildSat(squareCorr)`
> matérialise le résultat dans la texture persistante correspondante.
> `copyTextureToTexture` exige `COPY_SRC` sur la source et `COPY_DST` sur
> la destination — ajouter ces flags à `satScratchA`/`satScratchB` (source)
> et `satIp`/`satCorr` (destination) dans `mkSmall`, ou dupliquer `mkSmall`
> avec un paramètre `extraUsage` comme `mkFull` le fait déjà. Vérifier avec
> `npx tsc --noEmit` — WebGPU ne valide ces flags qu'à l'exécution
> (checkpoint visuel Task 5), pas de garde-fou statique ici.

- [ ] **Step 6: Lancer les tests de Task 3, vérifier qu'ils passent**

Run: `npx vitest run test/render/maskTextureResolver.test.ts`
Expected: PASS — tous les tests du fichier, y compris les deux nouveaux et l'ensemble des tests de cache existants (fold, refine, edge-aware ON/OFF, guideEpoch).

- [ ] **Step 7: `tsc` + suite complète du projet**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 erreur TypeScript. Les échecs Storybook préexistants et sans rapport (voir session — `*.stories.tsx`, interaction tests) restent la seule tolérance ; aucun nouvel échec dans `test/render/` ou `test/mask/`.

- [ ] **Step 8: Commit**

```bash
git add src/render/maskTextureResolver.ts test/render/maskTextureResolver.test.ts
git commit -m "feat(mask): edgePipeline sous-échantillonné + SAT, cache à deux paliers

Remplace la boucle O(radius) (jusqu'à 101 échantillons/pixel à rayon 50)
par un Fast Guided Filter : guide downscalé (plafond ~2048px), SAT
(Hillis-Steele) pour les moyennes de boîte, lookup O(1). Cache à deux
paliers : construction SAT du guide gelée tant que guideRevision(id) ne
change pas (Task 1), lookup+a/b+composite rejoués à chaque changement de
rayon/force mais à coût fixe indépendant de la valeur du rayon.

Corrige le lag/GPUDevice.lost observé en session sur le slider
"Rayon des contours" à rayon élevé sur une grande image."
```

---

### Task 4: Vérification qualité (comparaison à rayon fixe) + suite complète

**Files:**
- Test: `test/render/maskTextureResolver.test.ts` (lecture seule à cette étape — vérification, pas de nouveau test)

- [ ] **Step 1: Lancer toute la suite de tests du projet**

Run: `npx vitest run`
Expected: Même compte d'échecs QUE la baseline établie en session avant ce chantier (29 échecs Storybook préexistants, sans rapport, `*.stories.tsx`) — 0 échec supplémentaire dans `test/render/` ou `test/mask/`.

- [ ] **Step 2: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: 0 erreur

- [ ] **Step 3: `npm run lint:tokens`**

Run: `npm run lint:tokens`
Expected: 0 nouvelle violation (ce chantier ne touche aucun fichier CSS/composant UI)

- [ ] **Step 4: Commit de clôture (si des ajustements ont eu lieu en Step 1-3)**

```bash
git add -A
git commit -m "test(mask): vérification suite complète post-refactor edge-aware"
```

(Sauter ce commit si Steps 1-3 sont déjà verts sans modification.)

---

### Task 5: Checkpoint visuel humain (WebView2/CDP) — qualité + fluidité + absence de crash

**Files:** aucun — vérification manuelle, moyen de preuve déclaré du projet (`CLAUDE.md` § Moyen de preuve UI). Aucun test automatisé ne peut valider un rendu WebGPU réel.

- [ ] **Step 1: Lancer l'app en mode dev avec CDP**

Run: `npm run dev:debug` puis surveiller avec `npm run dev:monitor` (voir `CLAUDE.md` § Méthode) jusqu'à confirmation que `shaderlab.exe` tourne et que le port CDP 9222 répond.

- [ ] **Step 2: Charger une image de test grande (~24MP si disponible, sinon la plus grande accessible) et créer un calque avec un masque + edge-aware activé**

Ajouter un calque (n'importe quel effet), une source de masque (Luminosité suffit), cocher « Accroché aux contours (edge-aware) ».

- [ ] **Step 3: Comparer la qualité visuelle à rayon fixe (ex. 15) avant/après**

Si possible, comparer avec un screenshot pris avant ce chantier (sinon juger au jugé : le résultat doit être un lissage guidé par les contours de l'image, sans artefact de blocs/bandes visibles — léger flou de sous-échantillonnage acceptable, pas de différence perceptible à l'œil).

- [ ] **Step 4: Draguer le slider « Rayon des contours » de 1 à 50**

Observer : pas de lag perceptible, pas de gel de l'UI, pas de bandeau d'erreur "Le GPU a redémarré ou a manqué de mémoire".

- [ ] **Step 5: Vérifier l'absence de `GPUDevice.lost` dans les logs**

Consulter `.dev-logs/browser-console.error.log` et `.dev-logs/gpu-diag.log` après le test — aucune nouvelle entrée `device lost`/`GPU device lost` pendant la session de test.

- [ ] **Step 6: Si un problème visuel ou une régression est trouvé — ne pas corriger silencieusement**

Revenir en `superpowers:systematic-debugging` (Phase 1, root cause) avant tout fix — ce chantier touche des calculs GPU délicats (précision SAT, mise à l'échelle du rayon, ordre des passes) où un fix à l'aveugle risque d'en masquer un autre.

- [ ] **Step 7: Rapport final**

Une fois validé, rapporter à l'utilisateur : qualité équivalente confirmée, fluidité confirmée à rayon 50 sur l'image de test, aucun device-lost observé.

---

## Self-Review (fait par l'auteur du plan, avant remise à l'utilisateur)

**Couverture de la spec :**
- Downscale plafonné ~2048px → Task 3 (`computeSmallDims`).
- SAT (Hillis-Steele) → Task 2 (générateurs) + Task 3 (câblage).
- Cache à deux niveaux (guideRevision vs maskRevision+edgeRadius+edgeStrength) → Task 1 + Task 3.
- Upsample des coefficients (pas du résultat) → Task 3, `buildCompositeWgsl` INCHANGÉE, lit `meanAB` (réduit) via `textureSample` bilinéaire normal — pas de passe dédiée, déjà couvert par le composite existant.
- `rg32float` + lookup via `textureLoad` → Task 2 (`buildSatWidenWgsl`/`buildSatScanWgsl`/`buildSatLookupWgsl` n'utilisent jamais `textureSample`).
- Cas limite rayon→0 après mise à l'échelle → Task 3, `Math.max(x.edgeRadius * scale, 1.0)`.
- `boxFilterWgsl`/`refine()` non touchés → Global Constraints + Task 3 Step 3 (garde explicite avant de retirer l'import).
- Checkpoint visuel (qualité + fluidité + absence de device-lost) → Task 5.

**Balayage placeholders :** aucun "TBD"/"TODO" — la seule zone volontairement laissée à l'implémenteur (flags `COPY_SRC`/`COPY_DST` exacts sur `mkSmall`) est signalée explicitement comme telle avec la raison (WebGPU ne valide qu'à l'exécution) plutôt que masquée.

**Cohérence des types :** `EdgeWork` (Task 3) référence exactement les noms utilisés dans `edgePipeline()` réécrite (`satIp`, `satCorr`, `satScratchA/B`, `meanIp`, `corr`, `ab`, `meanAB`, `lastGuideRevision`) — vérifié champ par champ contre le corps de la méthode.

**Portée :** un seul sous-système (edge-aware), fortement séquentiel (Task 2 dépend de rien, Task 3 dépend de Task 1+2, Task 4-5 dépendent de Task 3) — plan séquentiel adapté, pas de DAG nécessaire (règle CLAUDE.md § Tranches verticales : ≤2-3 tranches réellement indépendantes ici, largement en dessous du seuil DAG).
