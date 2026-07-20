# Calques & masquage — Tranche 3 : sources paramétriques + refine edge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer la Tranche 3 du système de masquage (`design.md` §3-4/§4bis, `prd.md` §Masques — sources / affinage) : refine edge forme-seule (feather/contracter-dilater/lisser) + edge-aware (guided filter GPU séparable) sur n'importe quel masque combiné, puis les 3 sources paramétriques (dégradé, luminosité, range couleur) comme `MaskSourceModule` — et l'UI minimale (dans le panneau Masque existant de `ParamPanel`, pas le panneau flottant qui est la Tranche 4) pour les exercer.

**Architecture:** Le fold GPU résident de la Tranche 2 (`renderer.ts: runFoldPipeline` → seed/combine/invert) gagne deux étapes supplémentaires après l'invert, dans l'ordre imposé par le design (§4 étape 4 puis 5) : **edge-aware** (guided filter séparable He et al., guide = luminance de l'image du calque) puis **refine edge forme-seule** (feather/contracter-dilater/lisser, indépendant de l'image). Les sources paramétriques suivent le pattern déjà en place pour les effets (`effects/registry.ts`) et les modes de fusion (`blend/registry.ts`) : un `MaskSourceModule { id, type, name, params, wgsl }` par fichier dans un `sources/registry.ts`, chacun produit sa contribution masque via une passe shader régénérée seulement au changement de `params` (budget ≤100 ms, pas 60fps) — jamais à la cadence du fold (qui reste à la cadence du pinceau). Toute la logique GPU-adjacente mais pure (bornes eps, lerp d'intensité, distance colorimétrique) est extraite en fonctions TS testables, suivant le pattern déjà établi par `computeR8UploadRegion`/`foldPlan.ts`.

**Tech Stack:** TypeScript, React 19, WebGPU/WGSL, Vitest (Node env, aucun rendu React/WebGPU en test).

## Global Constraints

- Compositing en **espace linéaire strict**. Textures couleur au **format sRGB préféré de la plateforme** (`${navigator.gpu.getPreferredCanvasFormat()}-srgb`, `gpuContext.ts:68-69`) — jamais `rgba8unorm-srgb` codé en dur. Les nouvelles textures de masque/guide de ce plan (r8unorm, rg8unorm, r16float, rg16float) sont HORS chaîne couleur (niveaux de gris/accumulateurs) — aucune conversion sRGB ne s'y applique, seul le guide `I` échantillonne la couleur du calque (déjà en espace linéaire, cohérent avec le reste du moteur).
- **Aucune passe de ce plan ne modifie le chemin d'upload dirty-rect du pinceau** (`MaskPainter`/`maskUpload.ts`, inchangés depuis la Tranche 2). Les gros buffers/textures de masque restent HORS du state React (règle héritée du fix crash 24MP `e3c7584` — voir CLAUDE.md).
- **Une entrée d'historique par interaction** (pattern `handleParamChange`/`handleParamCommit` déjà en place, `App.tsx`) — un drag de slider = une entrée au relâchement, pas une par frame.
- Validation du rendu GPU (fold multi-source, refine edge, edge-aware, sources paramétriques) = **checkpoint visuel humain CDP sur la vraie fenêtre WebView2** (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, voir `CLAUDE.md` § Méthode). **Playwright headless est INADAPTÉ** (canvas WebGPU rend noir en headless) — ne jamais l'utiliser comme preuve sur ce projet. Aucun sous-agent headless ne doit affirmer un rendu visuel sans ce checkpoint ; il doit le documenter comme EN ATTENTE.
- **Registry étendu = modules autonomes** (comme `effects/registry.ts`, `blend/registry.ts`) : ajouter une source de masque = un fichier, zéro modif moteur/UI. Validation fail-fast des ids en double.
- **Jamais de masque nul silencieux** : les invariants déjà posés par `foldPlan.planFold` (Tranche 2) restent — ce plan ne les modifie pas, il ajoute des étapes APRÈS un fold déjà valide.
- **VRAM/perf non budgétées a priori, mesurées à l'implémentation** — le design.md §4bis documente une estimation revue 3 fois (96-192 Mo → 240 Mo → 200-350 Mo) et conclut explicitement que seule la mesure réelle compte. La Task 1 de ce plan a une condition de sortie non négociable : mesure réelle à 24MP (temps de chaîne de passes + pic VRAM via les logs de diagnostic déjà en place, `residentMaskTextures`/`.dev-logs/gpu-diag.log`), pas seulement le budget théorique.
- **Seul le calque en cours d'édition garde ses textures de sources résidentes** (règle déjà en place depuis la Tranche 2, `sourceTextures`/`foldedMaskTextures` par layerId) — ce plan ajoute des textures de travail edge-aware/refine-edge qui suivent la même durée de vie (créées à la demande, détruites dans `dispose()`).

---

### Task 1 (risque le plus élevé — en premier) : Edge-aware — guided filter GPU séparable

**Contexte pour l'implémenteur :** `design.md` §4bis est le point le plus incertain de toute la tranche (estimation VRAM corrigée 3 fois en revue adverse, technique GPU nouvelle dans ce moteur bien que de la même famille que le dual-filter bloom de `glow.ts`). Cette tâche l'attaque en premier pour faire remonter le risque réel tôt, avant d'investir dans les 4 autres tâches plus mécaniques. `runFoldPipeline` (Tranche 2, `renderer.ts:868-889`) retourne déjà `acc` = texture masque foldée + invertie ; cette tâche ajoute une étape optionnelle après elle.

**Files:**
- Create: `src/mask/edgeAware.ts` (logique pure testable)
- Create: `src/mask/edgeAwareWgsl.ts` (générateurs WGSL des passes)
- Modify: `src/render/renderer.ts` (nouvelle méthode `runEdgeAwarePipeline`, appelée depuis `getMaskTexture` après `runFoldPipeline`)
- Test: `test/mask/edgeAware.test.ts`
- Test: `test/mask/edgeAwareWgsl.test.ts`

**Interfaces:**
- Consumes: `RefineEdgeParams` (`src/mask/types.ts`, déjà existant avec `edgeAware`/`edgeRadius`/`edgeStrength`, actuellement no-op), `LayerMask.refineEdge`, la texture couleur du calque (celle que `runEffectPass` produit avant compositing — voir Step 5).
- Produces:
  - `computeGuidedAB(meanI: number, meanP: number, corrI: number, corrIp: number, eps?: number): { a: number; b: number }` — cœur numérique de l'étape 2 du guided filter (design.md §4bis), `eps` par défaut `1e-4`.
  - `composeEdgeAware(p: number, q: number, edgeStrength: number): number` — lerp + clamp final (design.md §4bis étape 5).
  - `buildLuminanceWgsl(): string`, `buildPackWgsl(): string` (I,p → rg8), `buildSquareCorrWgsl(): string` (I,p → I², I·p en rg16float), `buildBoxFilterHWgsl(channels: 1 | 2): string` / `buildBoxFilterVWgsl(channels: 1 | 2): string` (radius en uniform), `buildComputeABWgsl(): string`, `buildCompositeWgsl(): string`.
  - `Renderer.getMaskTexture` retourne, quand `layer.mask.refineEdge.edgeAware && layer.mask.refineEdge.edgeStrength > 0` et qu'au moins une source est active, le résultat de `runEdgeAwarePipeline` au lieu du fold brut.

- [ ] **Step 1: Écrire les tests qui échouent (logique pure)**

Créer `test/mask/edgeAware.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { computeGuidedAB, composeEdgeAware } from "../../src/mask/edgeAware";

describe("computeGuidedAB", () => {
  it("var_I = 0 (image plate) ne produit ni NaN ni Infinity (eps protège)", () => {
    const { a, b } = computeGuidedAB(0.5, 0.5, 0.25, 0.25, 1e-4);
    expect(Number.isFinite(a)).toBe(true);
    expect(Number.isFinite(b)).toBe(true);
  });

  it("guide parfaitement corrélé au masque (I === p partout) => a=1, b=0", () => {
    // meanI=meanP=0.5, corrI = E[I*I] = 0.3 (variance non nulle), corrIp = E[I*p] = corrI car I===p
    const { a, b } = computeGuidedAB(0.5, 0.5, 0.3, 0.3, 1e-4);
    expect(a).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(0, 3);
  });

  it("a et b peuvent être négatifs ou > 1 (non bornés, cf. design.md §4bis)", () => {
    const { a } = computeGuidedAB(0.9, 0.1, 0.05, -0.02, 1e-4);
    expect(a).toBeLessThan(0);
  });
});

describe("composeEdgeAware", () => {
  it("edgeStrength = 0 => identique à p (pas de dérive numérique)", () => {
    expect(composeEdgeAware(0.42, 0.9, 0)).toBe(0.42);
  });

  it("edgeStrength = 1 => identique à q", () => {
    expect(composeEdgeAware(0.42, 0.9, 1)).toBe(0.9);
  });

  it("interpole linéairement entre p et q pour 0 < edgeStrength < 1", () => {
    expect(composeEdgeAware(0, 1, 0.3)).toBeCloseTo(0.3, 6);
  });

  it("résultat toujours borné dans [0,1] même si q sort de [0,1]", () => {
    expect(composeEdgeAware(0.5, 1.4, 1)).toBe(1);
    expect(composeEdgeAware(0.5, -0.3, 1)).toBe(0);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run test -- edgeAware`
Expected: FAIL (`src/mask/edgeAware.ts` introuvable).

- [ ] **Step 3: Implémenter la logique pure**

Créer `src/mask/edgeAware.ts` :

```ts
/**
 * Guided filter (He, Sun, Tang 2010) — étape 2 (design.md §4bis) : calcule
 * les coefficients linéaires locaux `a`/`b` tels que `q ≈ a*I + b` approxime
 * `p` localement, guidé par les statistiques de fenêtre de `I`. `eps` évite
 * la division par zéro quand la fenêtre de guide est plate (var_I = 0) —
 * PAS un paramètre exposé, une constante de stabilité numérique.
 *
 * `a`/`b` ne sont PAS bornés dans [0,1] (peuvent être négatifs ou > 1) — ne
 * jamais les stocker dans un format qui clampe (voir edgeAwareWgsl.ts,
 * format rg16float).
 */
export function computeGuidedAB(
  meanI: number,
  meanP: number,
  corrI: number,
  corrIp: number,
  eps = 1e-4
): { a: number; b: number } {
  const varI = corrI - meanI * meanI;
  const covIp = corrIp - meanI * meanP;
  const a = covIp / (varI + eps);
  const b = meanP - a * meanI;
  return { a, b };
}

/**
 * Composite final (design.md §4bis étape 5) : `lerp(p, q, edgeStrength)`,
 * borné [0,1]. `edgeStrength=0` doit retourner EXACTEMENT `p` (pas une
 * approximation flottante) — test explicite requis par le design (pas de
 * dérive numérique visible quand l'utilisateur désactive l'edge-aware
 * visuellement sans changer `edgeAware`).
 */
export function composeEdgeAware(p: number, q: number, edgeStrength: number): number {
  if (edgeStrength <= 0) return p;
  if (edgeStrength >= 1) return Math.max(0, Math.min(1, q));
  const blended = p + (q - p) * edgeStrength;
  return Math.max(0, Math.min(1, blended));
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npm run test -- edgeAware && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit (logique pure)**

```bash
git add src/mask/edgeAware.ts test/mask/edgeAware.test.ts
git commit -m "feat(mask): pure guided-filter math (computeGuidedAB, composeEdgeAware)"
```

- [ ] **Step 6: Écrire les tests structurels des passes WGSL (échouent)**

Créer `test/mask/edgeAwareWgsl.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import {
  buildLuminanceWgsl,
  buildPackWgsl,
  buildSquareCorrWgsl,
  buildBoxFilterHWgsl,
  buildBoxFilterVWgsl,
  buildComputeABWgsl,
  buildCompositeWgsl,
} from "../../src/mask/edgeAwareWgsl";

describe("edge-aware WGSL passes", () => {
  it("buildLuminanceWgsl échantillonne colorTexture et sort une luminance r8", () => {
    const wgsl = buildLuminanceWgsl();
    expect(wgsl).toContain("var colorTexture: texture_2d<f32>");
    expect(wgsl).toContain("fn fs_luminance(");
    // coefficients Rec. 709 (cohérent avec un pipeline linéaire strict).
    expect(wgsl).toMatch(/0\.2126/);
  });

  it("buildPackWgsl empaquette I (r) et p (g) dans une texture rg8", () => {
    const wgsl = buildPackWgsl();
    expect(wgsl).toContain("var srcI: texture_2d<f32>");
    expect(wgsl).toContain("var srcP: texture_2d<f32>");
    expect(wgsl).toContain("fn fs_pack(");
  });

  it("buildSquareCorrWgsl calcule I*I (r) et I*p (g)", () => {
    const wgsl = buildSquareCorrWgsl();
    expect(wgsl).toContain("fn fs_squareCorr(");
    expect(wgsl).toContain("i * i");
    expect(wgsl).toContain("i * p");
  });

  it("les box filters H/V acceptent 1 ou 2 canaux et exposent un radius uniform", () => {
    for (const channels of [1, 2] as const) {
      const h = buildBoxFilterHWgsl(channels);
      const v = buildBoxFilterVWgsl(channels);
      expect(h).toContain("var<uniform> radius: f32");
      expect(v).toContain("var<uniform> radius: f32");
      expect(h).toContain("fn fs_boxH(");
      expect(v).toContain("fn fs_boxV(");
    }
  });

  it("buildComputeABWgsl calcule a/b et sort en rg16float (pas de clamp)", () => {
    const wgsl = buildComputeABWgsl();
    expect(wgsl).toContain("fn fs_computeAB(");
    expect(wgsl).not.toContain("clamp(");
  });

  it("buildCompositeWgsl expose edgeStrength en uniform et clamp la sortie", () => {
    const wgsl = buildCompositeWgsl();
    expect(wgsl).toContain("var<uniform> edgeStrength: f32");
    expect(wgsl).toContain("fn fs_composite(");
    expect(wgsl).toContain("clamp(");
  });
});
```

- [ ] **Step 7: Lancer, vérifier l'échec**

Run: `npm run test -- edgeAwareWgsl`
Expected: FAIL (module introuvable).

- [ ] **Step 8: Implémenter les générateurs WGSL**

Créer `src/mask/edgeAwareWgsl.ts` :

```ts
import { FULLSCREEN_VERTEX_WGSL } from "../render/shaderCompose";

/** Guide `I` = luminance Rec. 709 de la couleur du calque (déjà linéaire —
 *  cohérent avec le pipeline sRGB strict du moteur, design.md §4bis). */
export function buildLuminanceWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;

@fragment
fn fs_luminance(in: VertexOut) -> @location(0) vec4<f32> {
  let c = textureSample(colorTexture, maskSampler, in.uv).rgb;
  let l = clamp(dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  return vec4<f32>(l, l, l, 1.0);
}
`;
}

/** Empaquette I (r8, canal r) et p (r8, canal g) dans une seule texture rg8
 *  — un box filter séparable unique produit ensuite mean_I ET mean_p (2
 *  passes H+V au lieu de 4). */
export function buildPackWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcI: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var srcP: texture_2d<f32>;

@fragment
fn fs_pack(in: VertexOut) -> @location(0) vec4<f32> {
  let i = textureSample(srcI, maskSampler, in.uv).r;
  let p = textureSample(srcP, maskSampler, in.uv).r;
  return vec4<f32>(i, p, 0.0, 1.0);
}
`;
}

/** À partir de la texture rg8 (I,p) empaquetée : sort I² (r) et I·p (g) en
 *  rg16float — un second box filter séparable produit corr_I ET corr_Ip. */
export function buildSquareCorrWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcIp: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;

@fragment
fn fs_squareCorr(in: VertexOut) -> @location(0) vec4<f32> {
  let ip = textureSample(srcIp, maskSampler, in.uv).rg;
  let i = ip.x;
  let p = ip.y;
  return vec4<f32>(i * i, i * p, 0.0, 1.0);
}
`;
}

/** Box-filter séparable (He et al. — réduit O(radius²) à O(radius) par
 *  passe, cf. design.md §4bis). `channels=1` lit/écrit rg8 en niveaux de
 *  gris répliqué (r seul utilisé) ; `channels=2` lit/écrit rg16float sur
 *  les deux canaux simultanément. Rayon en uniform, en TEXELS. */
function boxFilterWgsl(direction: "H" | "V", channels: 1 | 2): string {
  const offset = direction === "H" ? "vec2<f32>(texel.x, 0.0)" : "vec2<f32>(0.0, texel.y)";
  const entryPoint = direction === "H" ? "fs_boxH" : "fs_boxV";
  const sampleExpr = channels === 2 ? "textureSample(src, maskSampler, uv).rg" : "vec2<f32>(textureSample(src, maskSampler, uv).r, 0.0)";
  const outExpr = channels === 2 ? "vec4<f32>(sum, 0.0, 1.0)" : "vec4<f32>(sum.x, sum.x, sum.x, 1.0)";
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> radius: f32;

@fragment
fn ${entryPoint}(in: VertexOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src));
  let step = ${offset};
  let n = i32(radius);
  var sum = vec2<f32>(0.0, 0.0);
  var count = 0.0;
  for (var k = -n; k <= n; k = k + 1) {
    let uv = in.uv + step * f32(k);
    sum = sum + ${sampleExpr};
    count = count + 1.0;
  }
  sum = sum / max(count, 1.0);
  return ${outExpr};
}
`;
}

export function buildBoxFilterHWgsl(channels: 1 | 2): string {
  return boxFilterWgsl("H", channels);
}
export function buildBoxFilterVWgsl(channels: 1 | 2): string {
  return boxFilterWgsl("V", channels);
}

/** À partir de mean_Ip (rg16float: mean_I, mean_p) et corr (rg16float:
 *  corr_I, corr_Ip) : calcule a/b (design.md §4bis étape 2), sortie
 *  rg16float SANS clamp (a/b non bornés par construction). */
export function buildComputeABWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var meanIp: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var corr: texture_2d<f32>;

@fragment
fn fs_computeAB(in: VertexOut) -> @location(0) vec4<f32> {
  let mi = textureSample(meanIp, maskSampler, in.uv).x;
  let mp = textureSample(meanIp, maskSampler, in.uv).y;
  let ci = textureSample(corr, maskSampler, in.uv).x;
  let cip = textureSample(corr, maskSampler, in.uv).y;
  let eps = 1e-4;
  let varI = ci - mi * mi;
  let covIp = cip - mi * mp;
  let a = covIp / (varI + eps);
  let b = mp - a * mi;
  return vec4<f32>(a, b, 0.0, 1.0);
}
`;
}

/** Composite final (design.md §4bis étape 4-5) : `q = mean_a*I + mean_b`,
 *  puis `lerp(p, q, edgeStrength)` borné [0,1]. Sortie r8unorm — c'est le
 *  résultat qui remplace la texture masque foldée. */
export function buildCompositeWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var meanAB: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var srcI: texture_2d<f32>;
@group(0) @binding(3) var srcP: texture_2d<f32>;
@group(0) @binding(4) var<uniform> edgeStrength: f32;

@fragment
fn fs_composite(in: VertexOut) -> @location(0) vec4<f32> {
  let ab = textureSample(meanAB, maskSampler, in.uv).xy;
  let i = textureSample(srcI, maskSampler, in.uv).r;
  let p = textureSample(srcP, maskSampler, in.uv).r;
  let q = clamp(ab.x * i + ab.y, 0.0, 1.0);
  let out = clamp(mix(p, q, edgeStrength), 0.0, 1.0);
  return vec4<f32>(out, out, out, 1.0);
}
`;
}
```

- [ ] **Step 9: Lancer les tests, vérifier le succès**

Run: `npm run test -- edgeAwareWgsl && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Commit (générateurs WGSL)**

```bash
git add src/mask/edgeAwareWgsl.ts test/mask/edgeAwareWgsl.test.ts
git commit -m "feat(mask): edge-aware guided-filter WGSL passes (luminance/pack/box/ab/composite)"
```

- [ ] **Step 11: Câbler le pipeline GPU dans `renderer.ts`**

Dans `src/render/renderer.ts` :

1. Importer les nouveaux modules :

```ts
import {
  buildLuminanceWgsl, buildPackWgsl, buildSquareCorrWgsl,
  buildBoxFilterHWgsl, buildBoxFilterVWgsl, buildComputeABWgsl, buildCompositeWgsl,
} from "../mask/edgeAwareWgsl";
```

2. Ajouter des maps de textures de travail scopées par calque (créées à la demande, mêmes règles de résidence que `foldedMaskTextures` — seul le calque en édition les garde) :

```ts
  private edgeAwareWorkTextures = new Map<string, {
    luminance: GPUTexture; packedIp: GPUTexture; squareCorr: GPUTexture;
    meanIp: GPUTexture; meanIpTmp: GPUTexture; corr: GPUTexture; corrTmp: GPUTexture;
    ab: GPUTexture; meanAB: GPUTexture; meanABTmp: GPUTexture; result: GPUTexture;
  }>();
  private edgeAwarePipelineCache = new Map<string, { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout }>();
```

3. Ajouter une méthode privée `runEdgeAwarePipeline` (après `runFoldPipeline`, avant `getLiveMaskTexture`) :

```ts
  /** Guided filter séparable (design.md §4bis) : le bord du masque foldé
   *  épouse les contours de contraste du calque. Suspendu pendant un stroke
   *  actif (voir getMaskTexture : le raccourci 1-source/pas-invert ne passe
   *  jamais ici) — s'applique au relâchement, même granularité que le
   *  commit d'historique (Task 11b). Guide `I` = luminance du calque
   *  (colorTexture = la texture couleur COURANTE de ce calque avant
   *  compositing, déjà résidente pour le rendu). */
  private runEdgeAwarePipeline(
    layerId: string,
    foldedMask: GPUTexture,
    colorTexture: GPUTexture,
    params: RefineEdgeParams,
    encoder: GPUCommandEncoder
  ): GPUTexture {
    const { device } = this.ctx;
    const size: [number, number] = [this.width, this.height];
    const w = this.edgeAwareWorkTextures.get(layerId) ?? (() => {
      const r8 = (usage: GPUTextureUsageFlags = 0) => device.createTexture({
        size, format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | usage,
      });
      const rg8 = () => device.createTexture({
        size, format: "rg8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const rg16f = () => device.createTexture({
        size, format: "rg16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const created = {
        luminance: r8(), packedIp: rg8(), squareCorr: rg16f(),
        meanIp: rg16f(), meanIpTmp: rg16f(), corr: rg16f(), corrTmp: rg16f(),
        ab: rg16f(), meanAB: rg16f(), meanABTmp: rg16f(), result: r8(),
      };
      this.edgeAwareWorkTextures.set(layerId, created);
      return created;
    })();

    const pass = (wgsl: string, entryPoint: string, target: GPUTexture, textures: GPUTexture[], uniformBuffer?: GPUBuffer) => {
      const cacheKey = `${wgsl}:${entryPoint}`;
      let cached = this.edgeAwarePipelineCache.get(cacheKey);
      if (!cached) {
        const entries: GPUBindGroupLayoutEntry[] = [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "non-filtering" } },
        ];
        for (let i = 1; i < textures.length; i++) {
          entries.push({ binding: 1 + i, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } });
        }
        if (uniformBuffer) entries.push({ binding: 1 + textures.length, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
        const layout = device.createBindGroupLayout({ entries });
        const pipeline = device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          vertex: { module: device.createShaderModule({ code: wgsl }), entryPoint: "vs_main" },
          fragment: { module: device.createShaderModule({ code: wgsl }), entryPoint, targets: [{ format: target.format }] },
          primitive: { topology: "triangle-list" },
        });
        cached = { pipeline, layout };
        this.edgeAwarePipelineCache.set(cacheKey, cached);
      }
      const bindEntries: GPUBindGroupEntry[] = [
        { binding: 0, resource: textures[0].createView() },
        { binding: 1, resource: this.nonFilteringSampler },
      ];
      for (let i = 1; i < textures.length; i++) bindEntries.push({ binding: 1 + i, resource: textures[i].createView() });
      if (uniformBuffer) bindEntries.push({ binding: 1 + textures.length, resource: { buffer: uniformBuffer } });
      const bindGroup = device.createBindGroup({ layout: cached.layout, entries: bindEntries });
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      renderPass.setPipeline(cached.pipeline);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(3);
      renderPass.end();
    };

    const radiusBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(radiusBuffer, 0, new Float32Array([params.edgeRadius, 0, 0, 0]));
    this.pendingDestroy.push(radiusBuffer);
    const strengthBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(strengthBuffer, 0, new Float32Array([params.edgeStrength, 0, 0, 0]));
    this.pendingDestroy.push(strengthBuffer);

    pass(buildLuminanceWgsl(), "fs_luminance", w.luminance, [colorTexture]);
    pass(buildPackWgsl(), "fs_pack", w.packedIp, [w.luminance, foldedMask]);
    pass(buildSquareCorrWgsl(), "fs_squareCorr", w.squareCorr, [w.packedIp]);
    pass(buildBoxFilterHWgsl(2), "fs_boxH", w.meanIpTmp, [w.packedIp], radiusBuffer);
    pass(buildBoxFilterVWgsl(2), "fs_boxV", w.meanIp, [w.meanIpTmp], radiusBuffer);
    pass(buildBoxFilterHWgsl(2), "fs_boxH", w.corrTmp, [w.squareCorr], radiusBuffer);
    pass(buildBoxFilterVWgsl(2), "fs_boxV", w.corr, [w.corrTmp], radiusBuffer);
    pass(buildComputeABWgsl(), "fs_computeAB", w.ab, [w.meanIp, w.corr]);
    pass(buildBoxFilterHWgsl(2), "fs_boxH", w.meanABTmp, [w.ab], radiusBuffer);
    pass(buildBoxFilterVWgsl(2), "fs_boxV", w.meanAB, [w.meanABTmp], radiusBuffer);
    pass(buildCompositeWgsl(), "fs_composite", w.result, [w.meanAB, w.luminance, foldedMask], strengthBuffer);

    return w.result;
  }
```

Note pour l'implémenteur : `pendingDestroy` et `nonFilteringSampler` doivent exister ou être ajoutés en suivant le pattern déjà utilisé ailleurs dans `renderer.ts` (chercher `pendingDestroy.push` pour le pattern de libération post-`submit()`, et `this.sampler` pour créer un sampler non filtrant équivalent si absent — un box filter n'a pas besoin d'interpolation bilinéaire, `nearest` suffit et évite un filtrage parasite sur les accumulateurs). Si `pendingDestroy` n'existe pas encore sous ce nom exact, chercher le mécanisme réel de libération différée déjà en place (voir Task 3 du plan Tranche 1, `compositingBuffer`) et l'utiliser à l'identique.

- [ ] **Step 12: Brancher l'appel dans `getMaskTexture`**

Dans `getMaskTexture` (après le calcul de `folded`/avant son retour, donc juste avant la ligne `return folded;` en fin de bloc, et aussi sur le chemin du raccourci 1-source de `getResidentSourceTexture` — l'edge-aware doit s'appliquer même si une seule source est active) :

```ts
    const folded = this.runFoldPipeline(layer.id, plan, layer.mask.invert, encoder);
    this.foldedMaskTextures.set(layer.id, { texture: folded, lastInputs: snapshot, lastInvert: layer.mask.invert });
    return this.maybeApplyEdgeAware(layer, folded, encoder);
```

Et remplacer le `return this.getResidentSourceTexture(layer.id, plan[0], encoder);` du raccourci 1-source par :

```ts
    if (plan.length === 1 && !layer.mask.invert) {
      const resident = this.getResidentSourceTexture(layer.id, plan[0], encoder);
      return this.maybeApplyEdgeAware(layer, resident, encoder);
    }
```

Ajouter le helper juste avant `getResidentSourceTexture` :

```ts
  /** Applique le guided filter edge-aware si activé et `edgeStrength > 0`,
   *  sinon retourne `folded` tel quel (aucun travail GPU supplémentaire —
   *  design.md §4bis, court-circuit explicite cohérent avec
   *  `composeEdgeAware(p, q, 0) === p`). Nécessite la texture couleur du
   *  calque comme guide : `getLayerColorTexture` doit exister ou être
   *  ajouté par l'implémenteur en suivant le point d'accès déjà utilisé par
   *  `runEffectPass` pour lire la texture couleur courante d'un calque
   *  pendant le rendu de la pile (le chemin exact dépend de l'état du
   *  ping-pong couleur au moment où `getMaskTexture` est appelée dans la
   *  boucle de rendu — vérifier sur place dans `render()`/`runEffectPass`
   *  quelle texture représente "le calque avant son propre effet" et
   *  documenter le choix si plusieurs candidates existent). */
  private maybeApplyEdgeAware(layer: LayerState, folded: GPUTexture, encoder: GPUCommandEncoder): GPUTexture {
    const params = layer.mask.refineEdge;
    if (!params.edgeAware || params.edgeStrength <= 0) return folded;
    const colorTexture = this.getLayerColorTextureForMaskGuide(layer.id, encoder);
    return this.runEdgeAwarePipeline(layer.id, folded, colorTexture, params, encoder);
  }
```

**Décision à documenter par l'implémenteur** : `getLayerColorTextureForMaskGuide` n'a pas d'équivalent direct dans le code actuel (le pipeline de rendu ne matérialise pas nécessairement "la couleur du calque avant son propre effet" comme une texture nommée et stable). Lire `render()`/`runEffectPass` en détail avant d'écrire cette méthode ; si aucune texture candidate évidente n'existe (ex. le ping-pong couleur est réutilisé en place), la solution la plus simple et conforme au design (« guide = luminance de l'image du calque ») est d'utiliser la texture d'ENTRÉE du calque (le composite accumulé sous lui, avant application de son propre effet) plutôt que sa sortie — documenter ce choix dans un commentaire au-dessus de la méthode, car le design.md ne tranche pas explicitement entre les deux et les deux sont défendables (une ambiguïté à signaler dans le rapport de tâche).

- [ ] **Step 13: Vérifier compilation**

Run: `npx tsc --noEmit && npm run test`
Expected: tsc OK ; tous les tests passent (aucun test ne rend de WebGPU réel — cette étape ne peut pas valider le pipeline GPU lui-même).

- [ ] **Step 14: Libérer les textures de travail dans `dispose()`**

Dans `dispose()` (`renderer.ts`, après le nettoyage de `foldPingPongByLayer`), ajouter :

```ts
    for (const w of this.edgeAwareWorkTextures.values()) {
      w.luminance.destroy(); w.packedIp.destroy(); w.squareCorr.destroy();
      w.meanIp.destroy(); w.meanIpTmp.destroy(); w.corr.destroy(); w.corrTmp.destroy();
      w.ab.destroy(); w.meanAB.destroy(); w.meanABTmp.destroy(); w.result.destroy();
    }
    this.edgeAwareWorkTextures.clear();
    this.edgeAwarePipelineCache.clear();
```

- [ ] **Step 15: Checkpoint visuel humain + mesure perf/VRAM (CONDITION DE SORTIE NON NÉGOCIABLE)**

`npm run dev:debug` puis `npm run dev:monitor`. Sur une image ~24MP (zone historiquement sensible au crash, cf. CLAUDE.md) :
1. Peindre un masque simple (1 source pinceau), activer `edgeAware` avec `edgeStrength=1`, `edgeRadius≈10` (pas encore d'UI à ce stade du plan — activer temporairement via un flag de debug ou attendre la Task 5 pour un test UI complet ; SI aucun accès sans UI n'est possible, documenter cette tâche comme "code complet, checkpoint reporté après Task 5" plutôt que d'inventer un accès non prévu).
2. Si accessible : observer que le bord du masque colle aux contours de contraste réels de la photo (pas juste la forme géométrique du trait de pinceau).
3. Mesurer via `.dev-logs/gpu-diag.log` (log de diagnostic déjà en place, cf. `residentMaskTextures` dans `renderer.ts:413`) le pic de textures résidentes et le temps de frame pendant/après un stroke avec edge-aware actif. **Noter le chiffre réel obtenu** (pas le budget théorique du design) dans le rapport de tâche — condition de sortie explicite du design.md §4bis.
4. Vérifier `edgeStrength=0` désactive visuellement l'effet sans erreur.
5. Aucune exception console/WebView2, aucun canvas noir.

Ne pas cocher cette étape sans confirmation visuelle d'Antoine ET sans le chiffre de mesure réel consigné.

- [ ] **Step 16: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat(render): wire edge-aware guided-filter pipeline into per-layer mask fold"
```

---

### Task 2: Refine edge forme-seule — feather / contracter-dilater / lisser

**Contexte pour l'implémenteur :** design.md §4 étape 5 place cette étape APRÈS l'edge-aware (Task 1) dans le pipeline. Ces trois opérations sont indépendantes de l'image (contrairement à Task 1), donc plus simples : feather = flou box, contracter/dilater = morphologie (érosion/dilatation par seuil de voisinage), lisser = box-blur léger répété.

**Files:**
- Create: `src/mask/refineEdgeWgsl.ts`
- Modify: `src/render/renderer.ts` (méthode `runRefineEdgePipeline`, appelée après `maybeApplyEdgeAware`)
- Test: `test/mask/refineEdgeWgsl.test.ts`

**Interfaces:**
- Consumes: `RefineEdgeParams.feather`/`contract`/`smooth` (px / px signé / itérations, déjà dans le modèle).
- Produces: `buildFeatherWgsl(): string`, `buildMorphologyWgsl(mode: "dilate" | "erode"): string`, `buildSmoothWgsl(): string` (radius en uniform, réutilise `buildBoxFilterHWgsl(1)`/`buildBoxFilterVWgsl(1)` de la Task 1 pour le flou de feather/smooth — pas de duplication). `Renderer.getMaskTexture` applique cette étape après edge-aware, avant de retourner la texture masque finale.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `test/mask/refineEdgeWgsl.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { buildMorphologyWgsl, buildSmoothWgsl } from "../../src/mask/refineEdgeWgsl";

describe("refine edge WGSL passes", () => {
  it("buildMorphologyWgsl('dilate') prend le max du voisinage", () => {
    const wgsl = buildMorphologyWgsl("dilate");
    expect(wgsl).toContain("fn fs_morphology(");
    expect(wgsl).toContain("max(");
  });

  it("buildMorphologyWgsl('erode') prend le min du voisinage", () => {
    const wgsl = buildMorphologyWgsl("erode");
    expect(wgsl).toContain("fn fs_morphology(");
    expect(wgsl).toContain("min(");
  });

  it("buildMorphologyWgsl expose un radius en uniform (px signé -> passes converties par l'appelant)", () => {
    expect(buildMorphologyWgsl("dilate")).toContain("var<uniform> radius: f32");
  });

  it("buildSmoothWgsl est un box-blur simple (réutilisable pour feather ET smooth)", () => {
    const wgsl = buildSmoothWgsl();
    expect(wgsl).toContain("fn fs_smooth(");
    expect(wgsl).toContain("var<uniform> radius: f32");
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run test -- refineEdgeWgsl`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter les générateurs WGSL**

Créer `src/mask/refineEdgeWgsl.ts` :

```ts
import { FULLSCREEN_VERTEX_WGSL } from "../render/shaderCompose";

/** Feather (adoucir le bord) ET smooth (lisser) sont le MÊME box-blur 1D
 *  appliqué en H puis V par l'appelant (design.md §4, "feather (flou),
 *  ... lisser") — un seul générateur, appelé deux fois avec des `radius`
 *  différents (feather = un seul passage au rayon `feather` ; smooth =
 *  `smooth` passages au rayon 1, pour un lissage progressif plutôt qu'un
 *  flou large d'un coup — ambiguïté du design tranchée ici : "itérations
 *  de lissage" (types.ts) se lit comme un COMPTE de passes, pas un rayon). */
export function buildSmoothWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> radius: f32;

@fragment
fn fs_smooth(in: VertexOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src));
  let n = i32(radius);
  var sum = 0.0;
  var count = 0.0;
  for (var kx = -n; kx <= n; kx = kx + 1) {
    for (var ky = -n; ky <= n; ky = ky + 1) {
      sum = sum + textureSample(src, maskSampler, in.uv + texel * vec2<f32>(f32(kx), f32(ky))).r;
      count = count + 1.0;
    }
  }
  let out = sum / max(count, 1.0);
  return vec4<f32>(out, out, out, 1.0);
}
`;
}

/** Morphologie (contracter/dilater, design.md §4) : `erode` = min du
 *  voisinage (contracte le bord vers l'intérieur), `dilate` = max (dilate
 *  vers l'extérieur). `contract` (px SIGNÉ dans RefineEdgeParams) : négatif
 *  -> erode, positif -> dilate — l'appelant choisit le mode et passe
 *  `abs(contract)` comme radius. */
export function buildMorphologyWgsl(mode: "dilate" | "erode"): string {
  const op = mode === "dilate" ? "max(acc, s)" : "min(acc, s)";
  const init = mode === "dilate" ? "0.0" : "1.0";
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> radius: f32;

@fragment
fn fs_morphology(in: VertexOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src));
  let n = i32(radius);
  var acc = ${init};
  for (var kx = -n; kx <= n; kx = kx + 1) {
    for (var ky = -n; ky <= n; ky = ky + 1) {
      let s = textureSample(src, maskSampler, in.uv + texel * vec2<f32>(f32(kx), f32(ky))).r;
      acc = ${op};
    }
  }
  return vec4<f32>(acc, acc, acc, 1.0);
}
`;
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npm run test -- refineEdgeWgsl && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mask/refineEdgeWgsl.ts test/mask/refineEdgeWgsl.test.ts
git commit -m "feat(mask): refine-edge WGSL passes (feather/smooth box-blur, dilate/erode morphology)"
```

- [ ] **Step 6: Câbler dans `renderer.ts`**

Importer :

```ts
import { buildSmoothWgsl, buildMorphologyWgsl } from "../mask/refineEdgeWgsl";
```

Ajouter une texture de travail ping-pong r8 par calque pour cette étape (réutiliser `foldPingPongByLayer` serait risqué — ces textures sont déjà utilisées PENDANT le fold ; créer une paire dédiée) :

```ts
  private refineEdgePingPongByLayer = new Map<string, [GPUTexture, GPUTexture]>();
```

Ajouter la méthode (après `runEdgeAwarePipeline`) :

```ts
  /** Refine edge forme-seule (design.md §4 étape 5) : feather -> contracter/
   *  dilater -> lisser, dans cet ordre (Photoshop Select and Mask : forme
   *  d'abord, lissage en dernier pour ne pas re-rugueuser un bord tout
   *  juste adouci). No-op si les 3 paramètres sont à leur défaut (0). */
  private runRefineEdgePipeline(
    layerId: string,
    input: GPUTexture,
    params: RefineEdgeParams,
    encoder: GPUCommandEncoder
  ): GPUTexture {
    if (params.feather <= 0 && params.contract === 0 && params.smooth <= 0) return input;
    let pair = this.refineEdgePingPongByLayer.get(layerId);
    if (!pair) {
      const make = () => this.ctx.device.createTexture({
        size: [this.width, this.height], format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
      pair = [make(), make()];
      this.refineEdgePingPongByLayer.set(layerId, pair);
    }
    let [acc, next] = pair;
    this.ctx.encoder && null; // no-op, keeps TS quiet about unused import pattern if any
    // encoder.copyTextureToTexture nécessaire pour amorcer `acc` avec `input`
    // (les passes suivantes lisent `acc`, jamais `input` directement).
    encoder.copyTextureToTexture({ texture: input }, { texture: acc }, [this.width, this.height]);

    const radiusBuffer = (value: number) => {
      const buf = this.ctx.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.ctx.device.queue.writeBuffer(buf, 0, new Float32Array([value, 0, 0, 0]));
      this.pendingDestroy.push(buf);
      return buf;
    };

    if (params.contract !== 0) {
      const mode = params.contract < 0 ? "erode" : "dilate";
      const buf = radiusBuffer(Math.abs(params.contract));
      this.runMaskPass(encoder, buildMorphologyWgsl(mode), acc, null, next, buf);
      [acc, next] = [next, acc];
    }
    if (params.feather > 0) {
      const buf = radiusBuffer(params.feather);
      this.runMaskPass(encoder, buildSmoothWgsl(), acc, null, next, buf);
      [acc, next] = [next, acc];
    }
    for (let i = 0; i < params.smooth; i++) {
      const buf = radiusBuffer(1);
      this.runMaskPass(encoder, buildSmoothWgsl(), acc, null, next, buf);
      [acc, next] = [next, acc];
    }
    return acc;
  }
```

**Note obligatoire pour l'implémenteur** : `runMaskPass` (Tranche 2, `renderer.ts:838-861`) ne prend actuellement PAS de paramètre uniform — sa signature devra être étendue avec un 5e paramètre optionnel `uniformBuffer?: GPUBuffer` (et `getMaskFoldPipeline` avec le binding uniform correspondant), OU une nouvelle méthode `runMaskPassWithUniform` dédiée doit être écrite pour ne pas risquer de régresser le fold de la Tranche 2 (`buildCombineWgsl`/`buildInvertWgsl` n'ont pas d'uniform). **Choix imposé par ce plan : étendre `runMaskPass` avec un paramètre optionnel** (rétro-compatible, `undefined` par défaut = comportement Tranche 2 inchangé), documenté ici pour éviter toute divergence entre l'implémenteur et le reviewer.

Brancher l'appel dans `maybeApplyEdgeAware`'s caller (chaîner après l'edge-aware, avant le `return` de `getMaskTexture`) :

```ts
    const folded = this.runFoldPipeline(layer.id, plan, layer.mask.invert, encoder);
    this.foldedMaskTextures.set(layer.id, { texture: folded, lastInputs: snapshot, lastInvert: layer.mask.invert });
    const afterEdgeAware = this.maybeApplyEdgeAware(layer, folded, encoder);
    return this.runRefineEdgePipeline(layer.id, afterEdgeAware, layer.mask.refineEdge, encoder);
```

(et de même sur le chemin du raccourci 1-source de l'étape précédente).

- [ ] **Step 7: Libérer dans `dispose()`**

```ts
    for (const [a, b] of this.refineEdgePingPongByLayer.values()) { a.destroy(); b.destroy(); }
    this.refineEdgePingPongByLayer.clear();
```

- [ ] **Step 8: Vérifier compilation**

Run: `npx tsc --noEmit && npm run test`
Expected: tsc OK, tous les tests passent.

- [ ] **Step 9: Checkpoint visuel humain**

`npm run dev:debug`. Peindre un masque, régler temporairement (mêmes réserves qu'à la Task 1 Step 15 si aucune UI n'existe encore) `feather`/`contract`/`smooth` et vérifier :
1. `feather > 0` adoucit visiblement le bord.
2. `contract < 0` réduit la zone masquée, `contract > 0` l'étend.
3. `smooth` lisse un bord irrégulier sans le déplacer globalement.
4. Tous les paramètres à 0 = rendu identique à la Task 1 (pas de régression).

Ne pas cocher sans confirmation d'Antoine.

- [ ] **Step 10: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat(render): wire shape-only refine edge (feather/contract-dilate/smooth) into mask fold"
```

---

### Task 3: Registry des sources de masque paramétriques + source Dégradé

**Files:**
- Create: `src/mask/sources/types.ts`
- Create: `src/mask/sources/gradient.ts`
- Create: `src/mask/sources/registry.ts`
- Modify: `src/mask/types.ts` (`createBrushSource` reste ; ajouter `createParametricSource`)
- Test: `test/mask/sources/registry.test.ts`
- Test: `test/mask/sources/gradient.test.ts`

**Interfaces:**
- Produces: `interface MaskSourceModule { id: MaskSourceType; name: string; defaultParams: Record<string, number | number[]>; wgsl: string }` où `wgsl` définit `fn fs_generate(uv: vec2<f32>, params: array<f32, N>) -> f32` (contribution masque 0..1, régénérée seulement au changement de `params`, PAS par frame — cf. Global Constraints). `getMaskSourceModule(type: MaskSourceType): MaskSourceModule`, `maskSourceRegistry: MaskSourceModule[]`. `createParametricSource(id: string, type: "gradient" | "luminosity" | "colorRange", params: Record<string, number | number[]>): MaskSource`.
- Consumes: `MaskSourceType`/`MaskSource` (`src/mask/types.ts`, déjà existants).

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `test/mask/sources/registry.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { maskSourceRegistry, getMaskSourceModule } from "../../../src/mask/sources/registry";

describe("mask source registry", () => {
  it("contient gradient/luminosity/colorRange, ids uniques", () => {
    const ids = maskSourceRegistry.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("gradient");
  });

  it("getMaskSourceModule jette sur un type inconnu", () => {
    // @ts-expect-error test volontaire d'un id invalide
    expect(() => getMaskSourceModule("does-not-exist")).toThrow(/Source de masque inconnue/);
  });

  it("chaque module définit fs_generate dans son wgsl", () => {
    for (const m of maskSourceRegistry) {
      expect(m.wgsl).toMatch(/fn\s+fs_generate\s*\(/);
    }
  });

  it("chaque module a des defaultParams non vides", () => {
    for (const m of maskSourceRegistry) {
      expect(Object.keys(m.defaultParams).length).toBeGreaterThan(0);
    }
  });
});
```

Créer `test/mask/sources/gradient.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { gradientSource } from "../../../src/mask/sources/gradient";

describe("gradient source module", () => {
  it("id = gradient, defaultParams inclut angle/startX/startY/endX/endY/feather/invert", () => {
    expect(gradientSource.id).toBe("gradient");
    for (const key of ["angle", "startX", "startY", "endX", "endY", "feather", "invert"]) {
      expect(gradientSource.defaultParams).toHaveProperty(key);
    }
  });

  it("le wgsl calcule une projection linéaire le long du gradient", () => {
    expect(gradientSource.wgsl).toContain("fn fs_generate(");
    expect(gradientSource.wgsl).toContain("dot(");
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run test -- mask/sources`
Expected: FAIL (modules introuvables).

- [ ] **Step 3: Écrire le type**

Créer `src/mask/sources/types.ts` :

```ts
export interface MaskSourceModule {
  id: "gradient" | "luminosity" | "colorRange";
  name: string;
  /** Valeurs par défaut de `MaskSource.params` pour ce type — jamais un
   *  objet vide (voir mask/types.ts, la règle "params reste null tant que
   *  non implémenté" ne s'applique plus à ces 3 types après cette tâche). */
  defaultParams: Record<string, number | number[]>;
  /** WGSL définissant `fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32`.
   *  `uv` = coordonnées image [0,1]. `colorLinear` = couleur de la photo
   *  ORIGINALE (pas le calque en cours d'édition — la génération est
   *  ancrée sur l'image source, indépendante de l'empilement d'effets,
   *  cohérent avec "les sources décrivent une région de la photo").
   *  `params` = tableau fixe de 8 floats (même contrat que
   *  effects/types.ts `MAX_EFFECT_PARAMS`) — l'appelant sérialise
   *  `MaskSource.params` dans cet ordre fixe par type, documenté dans
   *  chaque module. Retourne la contribution masque brute, 0..1. */
  wgsl: string;
}
```

- [ ] **Step 4: Écrire le module dégradé**

Créer `src/mask/sources/gradient.ts` :

```ts
import type { MaskSourceModule } from "./types";

/**
 * Dégradé linéaire (design.md §3, prd.md §Sources) : masque continu qui
 * varie de 0 à 1 entre un point de départ et un point de fin (coordonnées
 * image normalisées [0,1]), avec feather (adoucissement de la transition)
 * et invert. Paramètres sérialisés dans cet ORDRE FIXE (contrat wgsl) :
 * `params[0]=startX, [1]=startY, [2]=endX, [3]=endY, [4]=feather, [5]=invert (0/1)`.
 * `angle` fait partie de `defaultParams` pour l'UI (calcul du point de fin
 * par défaut à partir d'un angle) mais N'EST PAS un paramètre wgsl séparé —
 * le dégradé est entièrement décrit par ses deux points, l'angle n'est
 * qu'une commodité de saisie côté UI (Task 5).
 */
export const gradientSource: MaskSourceModule = {
  id: "gradient",
  name: "Dégradé",
  defaultParams: { angle: 0, startX: 0.3, startY: 0.5, endX: 0.7, endY: 0.5, feather: 0.1, invert: 0 },
  wgsl: `
fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32 {
  let start = vec2<f32>(params[0], params[1]);
  let end = vec2<f32>(params[2], params[3]);
  let feather = max(params[4], 0.0001);
  let invert = params[5];
  let axis = end - start;
  let len2 = max(dot(axis, axis), 0.0001);
  let t = dot(uv - start, axis) / len2;
  let eased = smoothstep(0.0 - feather, 1.0 + feather, clamp(t, -feather, 1.0 + feather));
  let value = clamp(eased, 0.0, 1.0);
  return select(value, 1.0 - value, invert > 0.5);
}
`,
};
```

- [ ] **Step 5: Écrire le registry**

Créer `src/mask/sources/registry.ts` :

```ts
import type { MaskSourceModule } from "./types";
import { gradientSource } from "./gradient";
import { luminositySource } from "./luminosity";
import { colorRangeSource } from "./colorRange";

export const maskSourceRegistry: MaskSourceModule[] = [gradientSource, luminositySource, colorRangeSource];

const seen = new Set<string>();
for (const m of maskSourceRegistry) {
  if (seen.has(m.id)) throw new Error(`Source de masque en double: ${m.id}`);
  seen.add(m.id);
}

export function getMaskSourceModule(type: MaskSourceModule["id"]): MaskSourceModule {
  const mod = maskSourceRegistry.find((m) => m.id === type);
  if (!mod) throw new Error(`Source de masque inconnue: ${type}`);
  return mod;
}
```

Note : cette étape référence `luminositySource`/`colorRangeSource` qui n'existent pas encore (Tasks 4-5) — c'est un import cassé TEMPORAIRE. Pour garder chaque tâche indépendamment verte (contrainte du plan), écrire à cette étape des **stubs minimaux** dans `luminosity.ts`/`colorRange.ts` (juste assez pour compiler et satisfaire `MaskSourceModule`), que les Tasks 4-5 remplaceront par l'implémentation réelle :

```ts
// src/mask/sources/luminosity.ts (stub, remplacé Task 4)
import type { MaskSourceModule } from "./types";
export const luminositySource: MaskSourceModule = {
  id: "luminosity", name: "Luminosité",
  defaultParams: { shadowsMin: 0, shadowsMax: 0.33, highlightsMin: 0.66, highlightsMax: 1, tolerance: 0.1, invert: 0 },
  wgsl: `fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32 { return 0.0; }`,
};
```

```ts
// src/mask/sources/colorRange.ts (stub, remplacé Task 5)
import type { MaskSourceModule } from "./types";
export const colorRangeSource: MaskSourceModule = {
  id: "colorRange", name: "Range couleur",
  defaultParams: { tolerance: 0.15, hardness: 0.5, invert: 0, samples: [] },
  wgsl: `fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32 { return 0.0; }`,
};
```

- [ ] **Step 6: Ajouter `createParametricSource` dans `mask/types.ts`**

Ajouter après `createBrushSource` (`src/mask/types.ts`) :

```ts
/** Source paramétrique (dégradé/luminosité/range couleur, design.md §3) —
 *  `raster: null` (contrairement au pinceau, sa contribution est calculée
 *  par une passe shader depuis `params`, jamais peinte). */
export function createParametricSource(
  id: string,
  type: Exclude<MaskSourceType, "brush">,
  params: Record<string, number | number[]>
): MaskSource {
  return { id, type, combineMode: "add", enabled: true, params, raster: null };
}
```

- [ ] **Step 7: Lancer les tests, vérifier le succès**

Run: `npm run test -- mask/sources && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/mask/sources src/mask/types.ts test/mask/sources
git commit -m "feat(mask): parametric mask-source registry + gradient source (luminosity/colorRange stubbed)"
```

---

### Task 4: Source Luminosité

**Files:**
- Modify: `src/mask/sources/luminosity.ts` (remplace le stub de la Task 3)
- Test: `test/mask/sources/luminosity.test.ts`

**Interfaces:**
- Consumes: `MaskSourceModule` (Task 3).
- Produces: `luminositySource: MaskSourceModule` avec une implémentation réelle — masque continu selon la plage tonale (ombres/tons moyens/hautes lumières) avec tolérance, prd.md §Masques-sources.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `test/mask/sources/luminosity.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { luminositySource } from "../../../src/mask/sources/luminosity";

describe("luminosity source module", () => {
  it("defaultParams couvre shadowsMin/shadowsMax/highlightsMin/highlightsMax/tolerance/invert", () => {
    for (const key of ["shadowsMin", "shadowsMax", "highlightsMin", "highlightsMax", "tolerance", "invert"]) {
      expect(luminositySource.defaultParams).toHaveProperty(key);
    }
  });

  it("le wgsl calcule une luminance Rec.709 en espace linéaire", () => {
    expect(luminositySource.wgsl).toContain("fn fs_generate(");
    expect(luminositySource.wgsl).toMatch(/0\.2126/);
  });

  it("le wgsl utilise smoothstep pour un masque continu (pas un seuil binaire)", () => {
    expect(luminositySource.wgsl).toContain("smoothstep(");
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec (le stub Task 3 ne satisfait pas ces assertions)**

Run: `npm run test -- luminosity`
Expected: FAIL (`toHaveProperty` OK sur le stub, mais `toMatch(/0\.2126/)` et `smoothstep` échouent contre `return 0.0;`).

- [ ] **Step 3: Implémenter**

Remplacer le contenu de `src/mask/sources/luminosity.ts` :

```ts
import type { MaskSourceModule } from "./types";

/**
 * Masque par plage tonale (prd.md §Masques-sources : "masquer selon les
 * tons de la photo — ombres/tons moyens/hautes lumières, avec courbe de
 * tolérance"). Continu (jamais binaire, contrainte inacceptable du PRD) :
 * deux rampes `smoothstep` (montante pour la borne basse, descendante pour
 * la haute) sur la luminance Rec.709 CALCULÉE EN LINÉAIRE (cohérent
 * "linéaire strict"). `tolerance` élargit la largeur de chaque rampe.
 * Paramètres sérialisés : `params[0]=shadowsMin, [1]=shadowsMax,
 * [2]=highlightsMin, [3]=highlightsMax, [4]=tolerance, [5]=invert`.
 * Une plage `[shadowsMin,shadowsMax]` = "ombres", `[highlightsMin,
 * highlightsMax]` = "hautes lumières" ; le masque est la RÉUNION (max) des
 * deux rampes — sélectionner les deux extrêmes en même temps est un usage
 * valide (ex. masquer tout sauf les tons moyens via invert).
 */
export const luminositySource: MaskSourceModule = {
  id: "luminosity", name: "Luminosité",
  defaultParams: { shadowsMin: 0, shadowsMax: 0.33, highlightsMin: 0.66, highlightsMax: 1, tolerance: 0.1, invert: 0 },
  wgsl: `
fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32 {
  let luminance = clamp(dot(colorLinear, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  let shadowsMin = params[0];
  let shadowsMax = params[1];
  let highlightsMin = params[2];
  let highlightsMax = params[3];
  let tolerance = max(params[4], 0.001);
  let invert = params[5];

  let shadowMask = smoothstep(shadowsMin - tolerance, shadowsMin + tolerance, luminance)
    * (1.0 - smoothstep(shadowsMax - tolerance, shadowsMax + tolerance, luminance));
  let highlightMask = smoothstep(highlightsMin - tolerance, highlightsMin + tolerance, luminance)
    * (1.0 - smoothstep(highlightsMax - tolerance, highlightsMax + tolerance, luminance));
  let value = clamp(max(shadowMask, highlightMask), 0.0, 1.0);
  return select(value, 1.0 - value, invert > 0.5);
}
`,
};
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npm run test -- luminosity mask/sources && npx tsc --noEmit`
Expected: PASS (dont les tests de registry Task 3, toujours verts).

- [ ] **Step 5: Commit**

```bash
git add src/mask/sources/luminosity.ts test/mask/sources/luminosity.test.ts
git commit -m "feat(mask): implement luminosity mask source (continuous tonal-range mask)"
```

---

### Task 5: Source Range couleur (échantillons cumulés)

**Files:**
- Modify: `src/mask/sources/colorRange.ts` (remplace le stub de la Task 3)
- Modify: `src/mask/sources/types.ts` (le contrat 8 floats ne suffit pas pour une liste de couleurs — voir Step 1)
- Test: `test/mask/sources/colorRange.test.ts`

**Interfaces:**
- Produces: `colorRangeSource: MaskSourceModule`. `MaskSource.params.samples: number[]` porte les échantillons couleur CUMULÉS dans la même source, sérialisés comme un tableau plat `[r0,g0,b0, r1,g1,b1, ...]` en linéaire (prd.md : "plusieurs prélèvements dans la MÊME source couleur"). Le contrat `array<f32,8>` de `MaskSourceModule.wgsl` (Task 3) est **insuffisant** pour un nombre variable d'échantillons — cette tâche introduit un binding de storage buffer dédié pour cette source uniquement (voir Step 3), documenté comme extension du contrat.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `test/mask/sources/colorRange.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { colorRangeSource, MAX_COLOR_RANGE_SAMPLES } from "../../../src/mask/sources/colorRange";

describe("colorRange source module", () => {
  it("defaultParams inclut tolerance/hardness/invert/samples (samples = [] par défaut)", () => {
    expect(colorRangeSource.defaultParams.tolerance).toBeTypeOf("number");
    expect(colorRangeSource.defaultParams.hardness).toBeTypeOf("number");
    expect(colorRangeSource.defaultParams.samples).toEqual([]);
  });

  it("MAX_COLOR_RANGE_SAMPLES borne le nombre d'échantillons cumulables (tableau uniform fixe, pas de storage buffer)", () => {
    expect(MAX_COLOR_RANGE_SAMPLES).toBeGreaterThan(0);
  });

  it("le wgsl calcule une distance colorimétrique minimale aux échantillons", () => {
    expect(colorRangeSource.wgsl).toContain("fn fs_generate(");
    expect(colorRangeSource.wgsl).toContain("distance(");
    expect(colorRangeSource.wgsl).toContain("smoothstep(");
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run test -- colorRange`
Expected: FAIL (`MAX_COLOR_RANGE_SAMPLES` introuvable, wgsl du stub ne contient ni `distance(` ni `smoothstep(`).

- [ ] **Step 3: Implémenter**

**Décision tranchée pour l'implémenteur (contrat révisé, à documenter dans le rapport de tâche comme point non explicitement précisé par design.md)** : plutôt qu'un storage buffer dynamique (complexité de binding supplémentaire, cycle de vie séparé du reste des sources paramétriques qui utilisent toutes le tableau fixe `params: array<f32,8>`), ce plan borne le nombre d'échantillons cumulables à une constante `MAX_COLOR_RANGE_SAMPLES = 6` (6 couleurs × 3 floats RGB = 18 floats, dépasse le tableau `array<f32,8>` du contrat générique de la Task 3 — cette source a donc SON PROPRE tableau `array<f32,32>` : `params[0]=tolerance, [1]=hardness, [2]=invert, [3]=sampleCount, [4..21]=jusqu'à 6 échantillons RGB, [22..31]=réservé`). C'est une extension du contrat `MaskSourceModule.wgsl` documentée ici : le renderer devra détecter (par `module.id === "colorRange"`) qu'il doit allouer un buffer `array<f32,32>` au lieu de `array<f32,8>` pour cette source spécifique (Task 6 s'en charge lors du branchement renderer). Un utilisateur qui dépasse 6 échantillons voit les suivants ignorés silencieusement — **limitation à signaler dans le rapport**, pas un manque de robustesse caché (le PRD ne borne pas explicitement le nombre d'échantillons).

Remplacer `src/mask/sources/colorRange.ts` :

```ts
import type { MaskSourceModule } from "./types";

/** Nombre max d'échantillons couleur cumulables dans UNE source colorRange
 *  (contrainte de taille de tableau uniform fixe — voir note d'implémentation
 *  du plan Tranche 3, Task 5). Au-delà, les échantillons supplémentaires
 *  sont ignorés silencieusement côté UI (Task 6 doit désactiver l'ajout). */
export const MAX_COLOR_RANGE_SAMPLES = 6;

/**
 * Range couleur (prd.md §Masques-sources) : masque continu qui suit une ou
 * plusieurs couleurs de référence échantillonnées dans la photo (cumulées
 * dans la MÊME source, une tolérance/dureté globale). Distance colorimétrique
 * euclidienne en espace linéaire (cohérent "linéaire strict") à
 * l'échantillon le PLUS PROCHE parmi ceux fournis. Paramètres sérialisés
 * dans un tableau ÉTENDU `array<f32,32>` (PAS le contrat générique 8 floats
 * des autres sources — voir note d'implémentation) :
 * `params[0]=tolerance, [1]=hardness, [2]=invert, [3]=sampleCount,
 * [4..21]=jusqu'à 6 échantillons RGB (r,g,b consécutifs)`.
 */
export const colorRangeSource: MaskSourceModule = {
  id: "colorRange", name: "Range couleur",
  defaultParams: { tolerance: 0.15, hardness: 0.5, invert: 0, samples: [] },
  wgsl: `
fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 32>) -> f32 {
  let tolerance = max(params[0], 0.001);
  let hardness = clamp(params[1], 0.0, 1.0);
  let invert = params[2];
  let sampleCount = i32(params[3]);

  var minDist = 999.0;
  for (var i = 0; i < ${MAX_COLOR_RANGE_SAMPLES}; i = i + 1) {
    if (i >= sampleCount) { continue; }
    let base = 4 + i * 3;
    let sample = vec3<f32>(params[base], params[base + 1], params[base + 2]);
    minDist = min(minDist, distance(colorLinear, sample));
  }
  if (sampleCount == 0) { return 0.0; }

  // hardness=0 -> transition douce sur toute la tolérance ; hardness=1 -> bord net.
  let softness = mix(tolerance, tolerance * 0.05, hardness);
  let value = 1.0 - smoothstep(tolerance - softness, tolerance, minDist);
  let clamped = clamp(value, 0.0, 1.0);
  return select(clamped, 1.0 - clamped, invert > 0.5);
}
`,
};
```

**Note** : le générateur ci-dessus utilise `array<f32, 32>` alors que `MaskSourceModule.wgsl` (Task 3) documente `array<f32, 8>` pour le contrat générique — cette signature DIFFÉRENTE pour `colorRange` est intentionnelle (voir décision ci-dessus) mais casse l'homogénéité de signature entre modules. Documenter ce choix au reviewer de cette tâche ; si jugé trop divergent, l'alternative de repli est un unique tableau `array<f32,32>` UNIFORME pour TOUTES les sources (gradient/luminosity gaspillent alors 24 floats non utilisés, mais la signature `fs_generate` reste identique partout) — **arbitrage laissé au reviewer de la Task 6** (qui câble le renderer et voit le coût réel des deux options), pas figé ici.

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npm run test -- colorRange mask/sources && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mask/sources/colorRange.ts test/mask/sources/colorRange.test.ts
git commit -m "feat(mask): implement colorRange mask source (cumulative samples, bounded array)"
```

---

### Task 6: Câblage renderer (génération GPU des sources paramétriques) + UI minimale + checkpoint final de tranche

**Contexte pour l'implémenteur :** cette tâche traverse toutes les couches restantes : GPU (génération de la texture résidente d'une source paramétrique depuis ses `params`, régénérée seulement au changement — pas par frame), modèle (`LayerStack` : ajouter/retirer une source, changer son `combineMode`/ses `params`), et UI (dans le panneau Masque EXISTANT de `ParamPanel.tsx` — PAS le panneau flottant, qui est hors scope, Tranche 4). C'est la tâche qui rend les Tasks 1-5 démontrables par un humain.

**Files:**
- Modify: `src/render/renderer.ts` (génération de texture pour une source paramétrique)
- Modify: `src/layers/layerStack.ts` (méthodes d'édition du masque : ajouter/retirer/modifier une source, régler `invert`/`enabled`/`refineEdge`)
- Modify: `src/components/ParamPanel.tsx` (UI du bloc "Masque")
- Modify: `src/App.tsx` (handlers, pattern `handleParamChange`/`handleParamCommit`)
- Test: `test/layers/layerStack.test.ts` (nouvelles méthodes)

**Interfaces:**
- Consumes: `maskSourceRegistry`/`getMaskSourceModule` (Task 3), `createParametricSource` (Task 3), `RefineEdgeParams` (déjà dans `mask/types.ts`).
- Produces (`LayerStack`) : `addMaskSource(layerId: string, type: "gradient" | "luminosity" | "colorRange"): string` (retourne l'id créé, `params` = `defaultParams` du module), `removeMaskSource(layerId: string, sourceId: string): void`, `updateMaskSourceParams(layerId: string, sourceId: string, params: Record<string, number | number[]>): void`, `setMaskSourceCombineMode(layerId: string, sourceId: string, mode: CombineMode): void`, `setMaskInvert(layerId: string, invert: boolean): void`, `setMaskEnabled(layerId: string, enabled: boolean): void`, `updateRefineEdge(layerId: string, refineEdge: Partial<RefineEdgeParams>): void`.

- [ ] **Step 1: Écrire les tests qui échouent (`LayerStack`)**

Ajouter dans `test/layers/layerStack.test.ts` :

```ts
import { getMaskSourceModule } from "../../src/mask/sources/registry";

describe("LayerStack — sources de masque paramétriques", () => {
  it("addMaskSource crée une source avec les defaultParams du module, combineMode=add, enabled=true", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    const layer = stack.layers.find((l) => l.id === layerId)!;
    const source = layer.mask.sources.find((s) => s.id === sourceId)!;
    expect(source.type).toBe("gradient");
    expect(source.combineMode).toBe("add");
    expect(source.enabled).toBe(true);
    expect(source.params).toEqual(getMaskSourceModule("gradient").defaultParams);
  });

  it("removeMaskSource retire uniquement la source visée", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const a = stack.addMaskSource(layerId, "gradient");
    const b = stack.addMaskSource(layerId, "luminosity");
    stack.removeMaskSource(layerId, a);
    const layer = stack.layers.find((l) => l.id === layerId)!;
    expect(layer.mask.sources.map((s) => s.id)).toEqual([b]);
  });

  it("updateMaskSourceParams remplace params sans muter l'ancienne référence (immutabilité)", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    const layer = stack.layers.find((l) => l.id === layerId)!;
    const before = layer.mask.sources.find((s) => s.id === sourceId)!.params;
    stack.updateMaskSourceParams(layerId, sourceId, { ...before!, feather: 0.5 });
    const after = layer.mask.sources.find((s) => s.id === sourceId)!.params;
    expect(after).not.toBe(before);
    expect(after!.feather).toBe(0.5);
  });

  it("setMaskSourceCombineMode change le mode d'UNE source", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    stack.setMaskSourceCombineMode(layerId, sourceId, "subtract");
    const layer = stack.layers.find((l) => l.id === layerId)!;
    expect(layer.mask.sources.find((s) => s.id === sourceId)!.combineMode).toBe("subtract");
  });

  it("setMaskInvert / setMaskEnabled changent le conteneur mask, pas une source", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    stack.setMaskInvert(layerId, true);
    stack.setMaskEnabled(layerId, false);
    const layer = stack.layers.find((l) => l.id === layerId)!;
    expect(layer.mask.invert).toBe(true);
    expect(layer.mask.enabled).toBe(false);
  });

  it("updateRefineEdge merge partiellement sans écraser les autres champs", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    stack.updateRefineEdge(layerId, { feather: 3 });
    stack.updateRefineEdge(layerId, { edgeAware: true });
    const layer = stack.layers.find((l) => l.id === layerId)!;
    expect(layer.mask.refineEdge.feather).toBe(3);
    expect(layer.mask.refineEdge.edgeAware).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run test -- layerStack`
Expected: FAIL (méthodes inexistantes).

- [ ] **Step 3: Implémenter dans `LayerStack`**

Dans `src/layers/layerStack.ts`, importer `getMaskSourceModule`/`createParametricSource`, puis ajouter les méthodes (suivre le pattern immutable déjà utilisé par `updateBrushMask` — `layer.mask = { ...layer.mask, sources: [...] }`, jamais de mutation en place) :

```ts
  addMaskSource(layerId: string, type: "gradient" | "luminosity" | "colorRange"): string {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    const module = getMaskSourceModule(type);
    const id = freshId();
    const source = createParametricSource(id, type, { ...module.defaultParams });
    layer.mask = { ...layer.mask, sources: [...layer.mask.sources, source] };
    return id;
  }

  removeMaskSource(layerId: string, sourceId: string): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    layer.mask = { ...layer.mask, sources: layer.mask.sources.filter((s) => s.id !== sourceId) };
  }

  updateMaskSourceParams(layerId: string, sourceId: string, params: Record<string, number | number[]>): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    layer.mask = {
      ...layer.mask,
      sources: layer.mask.sources.map((s) => (s.id === sourceId ? { ...s, params } : s)),
    };
  }

  setMaskSourceCombineMode(layerId: string, sourceId: string, mode: MaskSource["combineMode"]): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    layer.mask = {
      ...layer.mask,
      sources: layer.mask.sources.map((s) => (s.id === sourceId ? { ...s, combineMode: mode } : s)),
    };
  }

  setMaskInvert(layerId: string, invert: boolean): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    layer.mask = { ...layer.mask, invert };
  }

  setMaskEnabled(layerId: string, enabled: boolean): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    layer.mask = { ...layer.mask, enabled };
  }

  updateRefineEdge(layerId: string, refineEdge: Partial<RefineEdgeParams>): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    layer.mask = { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, ...refineEdge } };
  }
```

Ajouter les imports nécessaires en tête de fichier (`getMaskSourceModule` depuis `../mask/sources/registry`, `createParametricSource`/`MaskSource`/`RefineEdgeParams` depuis `../mask/types`).

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npm run test -- layerStack && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit (modèle)**

```bash
git add src/layers/layerStack.ts test/layers/layerStack.test.ts
git commit -m "feat(layers): LayerStack methods to edit non-destructive mask sources and refine edge"
```

- [ ] **Step 6: Générer la texture GPU résidente d'une source paramétrique**

Dans `src/render/renderer.ts`, `getResidentSourceTexture` (Tranche 2) suppose aujourd'hui `source.raster!` non-null — les sources paramétriques ont `raster: null`. Étendre cette méthode :

```ts
  private getResidentSourceTexture(layerId: string, source: MaskSource, encoder: GPUCommandEncoder): GPUTexture {
    if (source.type !== "brush") return this.getParametricSourceTexture(layerId, source, encoder);
    // ... (code brush existant inchangé)
  }

  /** Texture résidente d'une source PARAMÉTRIQUE (design.md §3) : régénérée
   *  seulement quand `source.params` change (comparaison par référence —
   *  updateMaskSourceParams remplace toujours l'objet, jamais ne le mute),
   *  PAS à la cadence du fold/pinceau (budget ≤100ms visé, pas 60fps —
   *  Global Constraints). */
  private getParametricSourceTexture(layerId: string, source: MaskSource, encoder: GPUCommandEncoder): GPUTexture {
    const key = `${layerId}:${source.id}`;
    const entry = this.parametricSourceTextures.get(key);
    if (entry && entry.syncedFrom === source.params) return entry.texture;
    const texture =
      entry?.texture ??
      this.ctx.device.createTexture({
        size: [this.width, this.height], format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    const module = getMaskSourceModule(source.type as "gradient" | "luminosity" | "colorRange");
    const paramCount = source.type === "colorRange" ? 32 : 8;
    const flatParams = this.flattenMaskSourceParams(source.params, module.defaultParams, paramCount);
    const paramsBuffer = this.ctx.device.createBuffer({
      size: flatParams.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.ctx.device.queue.writeBuffer(paramsBuffer, 0, flatParams);
    this.pendingDestroy.push(paramsBuffer);

    const wgsl = this.wrapMaskSourceGenerateWgsl(module.wgsl, paramCount);
    const cacheKey = `${wgsl}`;
    let cached = this.maskSourcePipelineCache.get(cacheKey);
    if (!cached) {
      const layout = this.ctx.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        ],
      });
      const pipeline = this.ctx.device.createRenderPipeline({
        layout: this.ctx.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module: this.ctx.device.createShaderModule({ code: wgsl }), entryPoint: "vs_main" },
        fragment: { module: this.ctx.device.createShaderModule({ code: wgsl }), entryPoint: "fs_wrapped", targets: [{ format: "r8unorm" }] },
        primitive: { topology: "triangle-list" },
      });
      cached = { pipeline, layout };
      this.maskSourcePipelineCache.set(cacheKey, cached);
    }
    const bindGroup = this.ctx.device.createBindGroup({
      layout: cached.layout,
      entries: [
        { binding: 0, resource: this.sourceTexture!.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: paramsBuffer } },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: texture.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(cached.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();

    this.parametricSourceTextures.set(key, { texture, syncedFrom: source.params });
    return texture;
  }
```

Ajouter les déclarations de state associées (près de `sourceTextures`) :

```ts
  private parametricSourceTextures = new Map<string, { texture: GPUTexture; syncedFrom: unknown }>();
  private maskSourcePipelineCache = new Map<string, { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout }>();
```

Et les deux helpers privés référencés ci-dessus :

```ts
  /** `source.params` est un `Record<string, number|number[]>` (noms), le
   *  wgsl attend un tableau POSITIONNEL fixe — cette fonction sérialise
   *  dans l'ordre des CLÉS de `defaultParams` (ordre d'insertion garanti en
   *  JS pour les clés string), avec un cas spécial pour `colorRange` qui
   *  déplie `samples: number[]` (RGB plats) après les scalaires. */
  private flattenMaskSourceParams(
    params: Record<string, number | number[]> | null,
    defaults: Record<string, number | number[]>,
    count: number
  ): Float32Array {
    const out = new Float32Array(count);
    const p = params ?? defaults;
    if ("samples" in defaults) {
      // colorRange : [tolerance, hardness, invert, sampleCount, r0,g0,b0, ...]
      const samples = (p.samples as number[] | undefined) ?? [];
      out[0] = (p.tolerance as number) ?? 0.15;
      out[1] = (p.hardness as number) ?? 0.5;
      out[2] = (p.invert as number) ?? 0;
      out[3] = Math.min(samples.length / 3, 6);
      for (let i = 0; i < Math.min(samples.length, 18); i++) out[4 + i] = samples[i];
      return out;
    }
    let i = 0;
    for (const key of Object.keys(defaults)) {
      if (i >= count) break;
      out[i] = (p[key] as number) ?? (defaults[key] as number);
      i++;
    }
    return out;
  }

  /** Enveloppe `fs_generate` (module de source) dans un fragment shader
   *  complet : lit la couleur SOURCE (photo originale, `this.sourceTexture`
   *  — voir mask/sources/types.ts, "ancré sur l'image source") et écrit sa
   *  contribution masque en r8. */
  private wrapMaskSourceGenerateWgsl(generateWgsl: string, paramCount: number): string {
    return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcColor: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> genParams: array<f32, ${paramCount}>;

${generateWgsl}

@fragment
fn fs_wrapped(in: VertexOut) -> @location(0) vec4<f32> {
  let color = textureSample(srcColor, maskSampler, in.uv).rgb;
  let v = fs_generate(in.uv, color, genParams);
  return vec4<f32>(v, v, v, 1.0);
}
`;
  }
```

Ajouter l'import : `import { getMaskSourceModule } from "../mask/sources/registry";`.

**Point d'attention pour l'implémenteur** : vérifier le nom réel du champ qui porte la texture GPU de la photo source dans `Renderer` (`this.sourceTexture` est une supposition basée sur son usage ailleurs dans ce fichier — confirmer par lecture directe avant d'écrire cette méthode ; s'il diffère, adapter partout dans ce Step).

- [ ] **Step 7: Libérer dans `dispose()`**

```ts
    for (const { texture } of this.parametricSourceTextures.values()) texture.destroy();
    this.parametricSourceTextures.clear();
    this.maskSourcePipelineCache.clear();
```

- [ ] **Step 8: Vérifier compilation**

Run: `npx tsc --noEmit && npm run test`
Expected: tsc OK, tous les tests passent.

- [ ] **Step 9: Commit (câblage GPU)**

```bash
git add src/render/renderer.ts
git commit -m "feat(render): generate GPU-resident textures for parametric mask sources"
```

- [ ] **Step 10: UI minimale — bloc Masque de `ParamPanel.tsx`**

Étendre `ParamPanel.tsx` (le bloc `<Disclosure title="Masque" ...>` existant, lignes 46-61) pour exposer, quand `layer.mask.sources.length > 0` ou en permanence sous le bouton pinceau existant :

1. Un bouton « Ajouter une source » ouvrant un petit menu des 3 types (`maskSourceRegistry.map((m) => m.name)`).
2. Une liste compacte des sources existantes (nom du type, sélecteur de `combineMode` + / − ∩, checkbox `enabled`, bouton supprimer).
3. Pour la source SÉLECTIONNÉE (état local `selectedSourceId` dans `ParamPanel`, ou premier élément par défaut) : ses sliders de `params` (utiliser `Object.entries(source.params)` pour un rendu générique — un `Slider` par clé numérique, ignorer `samples` qui a son propre UI simplifié : un bouton "Ajouter un échantillon" qui, pour cette tranche, prend la couleur du CENTRE du canvas comme valeur de test minimale — un vrai picker au clic sur le canvas est HORS SCOPE de cette tâche, la Tranche 4/panneau flottant est le bon endroit pour un picker interactif complet ; documenter cette limitation explicitement dans le rapport de tâche).
4. Toggle `invert` (`mask.invert`) et `enabled` (`mask.enabled`) au niveau du masque entier (pas d'une source).
5. Bloc « Affiner le bord » : sliders `feather`/`contract`/`smooth`, toggle `edgeAware`, sliders `edgeRadius`/`edgeStrength` (visibles seulement si `edgeAware`).

Étendre les `Props` de `ParamPanel` :

```ts
interface Props {
  layer: LayerState | null;
  onParamChange: (id: string, params: Record<string, number>) => void;
  onParamCommit: () => void;
  maskPaintMode: boolean;
  onToggleMaskPaint: () => void;
  onAddMaskSource: (layerId: string, type: "gradient" | "luminosity" | "colorRange") => void;
  onRemoveMaskSource: (layerId: string, sourceId: string) => void;
  onMaskSourceParamsChange: (layerId: string, sourceId: string, params: Record<string, number | number[]>) => void;
  onMaskSourceParamsCommit: () => void;
  onMaskSourceCombineModeChange: (layerId: string, sourceId: string, mode: "add" | "subtract" | "intersect") => void;
  onMaskInvertChange: (layerId: string, invert: boolean) => void;
  onMaskEnabledChange: (layerId: string, enabled: boolean) => void;
  onRefineEdgeChange: (layerId: string, refineEdge: Partial<RefineEdgeParams>) => void;
  onRefineEdgeCommit: () => void;
}
```

Importer `maskSourceRegistry` (`../mask/sources/registry`) et `RefineEdgeParams` (`../mask/types`). Suivre les tokens `darkroom-balanced` existants (pas de valeur arbitraire — réutiliser les classes déjà présentes sur `.param-panel__group`/`.param-panel__hint`).

**Note pour l'implémenteur** : le JSX exact (structure, classes CSS) doit suivre l'API réelle des composants `Slider`/`Button`/`Disclosure`/`Select` déjà lus dans le Tranche 1 plan (`src/ui/Slider.tsx` etc.) — adapter aux signatures exactes présentes sur le disque, comme fait au Task 4 du plan Tranche 1 (même convention, pas une régression de rigueur).

- [ ] **Step 11: Handlers dans `App.tsx`**

Suivre le pattern `handleParamChange`/`handleParamCommit` (mise à jour vivante sans entrée d'historique, une entrée au commit). Ajouter dans `App.tsx` :

```ts
  function handleAddMaskSource(layerId: string, type: "gradient" | "luminosity" | "colorRange") {
    const stack = currentStack();
    stack.addMaskSource(layerId, type);
    commit(stack); // ajout d'une source = action discrète, une entrée directe
  }

  function handleRemoveMaskSource(layerId: string, sourceId: string) {
    const stack = currentStack();
    stack.removeMaskSource(layerId, sourceId);
    commit(stack);
  }

  function handleMaskSourceParamsChange(layerId: string, sourceId: string, params: Record<string, number | number[]>) {
    paramDirtyRef.current = true;
    const stack = currentStack();
    stack.updateMaskSourceParams(layerId, sourceId, params);
    syncLayers(stack.layers);
    rendererRef.current?.requestRender(stack.layers);
  }

  function handleMaskSourceCombineModeChange(layerId: string, sourceId: string, mode: "add" | "subtract" | "intersect") {
    const stack = currentStack();
    stack.setMaskSourceCombineMode(layerId, sourceId, mode);
    commit(stack);
  }

  function handleMaskInvertChange(layerId: string, invert: boolean) {
    const stack = currentStack();
    stack.setMaskInvert(layerId, invert);
    commit(stack);
  }

  function handleMaskEnabledChange(layerId: string, enabled: boolean) {
    const stack = currentStack();
    stack.setMaskEnabled(layerId, enabled);
    commit(stack);
  }

  function handleRefineEdgeChange(layerId: string, refineEdge: Partial<RefineEdgeParams>) {
    paramDirtyRef.current = true;
    const stack = currentStack();
    stack.updateRefineEdge(layerId, refineEdge);
    syncLayers(stack.layers);
    rendererRef.current?.requestRender(stack.layers);
  }
```

Passer ces handlers + `handleParamCommit` (réutilisé pour `onMaskSourceParamsCommit`/`onRefineEdgeCommit`, même pattern qu'`onOpacityCommit` dans la Tranche 1) au `<ParamPanel ... />` du JSX.

Vérifier que `RefineEdgeParams` est importé dans `App.tsx` (`../mask/types`).

- [ ] **Step 12: Vérifier compilation**

Run: `npx tsc --noEmit && npm run test`
Expected: tsc OK, tous les tests passent (aucun test de rendu React).

- [ ] **Step 13: Checkpoint visuel humain FINAL DE TRANCHE (obligatoire, couvre Tasks 1-6)**

`npm run dev:debug` puis `npm run dev:monitor`. Sur la vraie fenêtre WebView2 (CDP), avec Antoine :

1. **Masque combiné multi-sources** (prd.md Terminé#3) : sur un calque, peindre un trait pinceau PUIS ajouter une source Dégradé PUIS une source Range couleur, régler leurs `combineMode` (add/subtract/intersect), observer le résultat combiné cohérent (comparer au comportement attendu, pas de masque nul inattendu).
2. **Range couleur continu** (prd.md Terminé#4) : ajouter 2-3 échantillons dans la même source colorRange, régler tolérance/dureté, vérifier un masque continu (dégradé de valeurs, jamais un bord dur binaire) qui suit la couleur dans la photo.
3. **Luminosité** : régler les plages ombres/hautes lumières, tolérance, vérifier un masque continu cohérent avec les tons de la photo.
4. **Refine edge sur n'importe quel masque** (prd.md Terminé#5) : appliquer feather + contracter/dilater + lisser sur le masque combiné de l'étape 1, vérifier que le bord se transforme correctement.
5. **Edge-aware** : activer, vérifier le collage aux contours de contraste réels (comparer visuellement à une approximation Photoshop Select and Mask si une référence est ouverte à côté).
6. **Fluidité pinceau** : peindre un nouveau trait sur un calque qui a déjà edge-aware/refine-edge actifs — le trait doit rester visible et interactif PENDANT le stroke (le fold brut, pas l'edge-aware qui se réapplique au relâchement — comportement attendu du design, PAS un bug si un léger décalage d'une frame est visible au lâcher du bouton).
7. **Régression** : un calque SANS aucune source paramétrique ni refine edge actif doit rendre EXACTEMENT comme avant cette tranche (Tranche 2).
8. **Perf/VRAM à 24MP** : reconfirmer via `.dev-diag` que rien ne régresse vers le comportement du crash historique (`residentMaskTextures` stable, pas de hang) avec 2+ sources actives sur un calque.

Ne pas cocher cette étape ni clore la tranche sans confirmation explicite d'Antoine pour CHACUN des 8 points — les documenter individuellement dans le rapport de tâche (accepté/refusé/reporté), pas un seul "OK global".

- [ ] **Step 14: Commit (UI)**

```bash
git add src/App.tsx src/components/ParamPanel.tsx
git commit -m "feat(ui): expose mask sources, combine modes, and refine edge in the layer mask panel"
```

---

## Notes de fin

- **Terminé (Tranche 3) = démontrable** : les 8 points du Step 13 de la Task 6, tous confirmés visuellement par Antoine dans la vraie fenêtre WebView2 (CDP) — jamais affirmé depuis un log ou l'absence d'erreur seule.
- **Hors scope de ce plan** (Tranche 4) : panneau Masques FLOTTANT (déplaçable, magnétisme, escamotable), badge masque sur les lignes de `LayerPanel`, aperçu au survol (overlay par source vs composite), overlay safelight rouge en mode peinture, curseur pinceau custom, picker de couleur interactif au clic sur le canvas pour `colorRange` (Step 10 de la Task 6 documente une limitation temporaire — échantillon fixe au centre du canvas). Voir `design.md` §6.
- **Hors scope de ce plan** (Tranche 5) : groupes (compositing imbriqué).
- **Différés PRD, non concernés par ce plan** : depth mask, pen/path Bézier, sélection géométrique, lasso, détection sémantique — chacun listé dans `prd.md` §Différé avec son trigger de réouverture, aucun n'est réintroduit ici.
- **Ambiguïtés du design tranchées par ce plan** (à vérifier a posteriori) :
  1. Guide `I` de l'edge-aware = luminance de quelle texture exactement (couleur d'ENTRÉE du calque vs sa sortie après son propre effet) — Task 1 Step 12 documente la question et impose de trancher au moment de la lecture du code réel de `render()`, pas ici.
  2. `RefineEdgeParams.smooth` interprété comme un COMPTE d'itérations de box-blur au rayon 1 (pas un rayon unique) — Task 2 Step 3.
  3. Signature `fs_generate` : contrat générique `array<f32,8>` pour gradient/luminosity, mais `array<f32,32>` dédié pour colorRange (asymétrie de signature entre modules) — Task 5 Step 3, arbitrage explicitement délégué au reviewer de la Task 6.
  4. `runMaskPass` étendu avec un paramètre `uniformBuffer?` optionnel plutôt qu'une nouvelle méthode dédiée — Task 2 Step 6.
  5. Picker de couleur pour `colorRange` simplifié à un échantillon fixe (centre du canvas) faute de panneau flottant/interaction canvas dédiée avant la Tranche 4 — Task 6 Step 10.
