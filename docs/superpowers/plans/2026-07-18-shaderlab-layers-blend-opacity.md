# Calques — Blend modes + opacité par calque (Tranche 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à chaque calque une opacité et un mode de fusion (~12 modes type Photoshop), en généralisant l'unique `mix()` du wrapper de passe, sans passe de compositing supplémentaire.

**Architecture:** Le compositing couleur par calque = généralisation de la ligne `mix(color, effected, maskValue)` (shaderCompose.ts) en `mix(color, blend(color, effected), opacity * maskValue)`. `blend` = fonction WGSL injectée selon le mode (compile-time, comme le corps d'effet) ; `opacity` = uniform runtime. Les modes de fusion sont des modules autonomes dans un registry calqué sur celui des effets. Rétro-compatible : mode `normal` + opacité 1 = comportement actuel au bit près.

**Tech Stack:** TypeScript, React 19, WebGPU/WGSL, Vitest (Node env, aucun rendu React/WebGPU en test).

## Global Constraints

- Compositing en **espace linéaire strict**. Textures couleur au **format sRGB préféré de la plateforme** (`${getPreferredCanvasFormat()}-srgb` — `bgra8unorm-srgb` sur Windows/D3D12). Pas de gamma manuel en WGSL **hors** des modules de blend définis-gamma, qui encodent/décodent LOCALEMENT.
- **Pas de distinction preview/export** : un seul pipeline, résolution native.
- Modes de fusion = modules autonomes : ajouter un mode = un nouveau fichier, zéro modif moteur/UI.
- **Une entrée d'historique par interaction** (un drag de slider = une entrée au commit, pas une par frame) — reprendre le pattern `handleParamChange`/`handleParamCommit` existant.
- Validation du rendu GPU (match visuel vs logiciel de référence) = **checkpoint visuel humain** dans la vraie fenêtre WebView2/CDP (Playwright headless rend noir sur canvas WebGPU). Aucun test unitaire ne rend de composant React ni de WebGPU réel.
- **Ne pas toucher le chemin de peinture masque** (crash 24MP résolu le 2026-07-18, `e3c7584` : `maskData` hors du state React via `toDisplayLayers`). La tranche 1 est indépendante du masque.
- Rétro-compatibilité : un calque sans `opacity`/`blendMode` (ancien état) prend `opacity=1`, `blendMode="normal"` → rendu identique à avant.

---

### Task 1: Modèle — `opacity` + `blendMode` sur `LayerState`

**Files:**
- Modify: `src/layers/types.ts:1-11`
- Modify: `src/layers/layerStack.ts:12-16` (`addLayer`)
- Test: `test/layers/layerStack.test.ts`

**Interfaces:**
- Produces: `LayerState` gagne `opacity: number` (0..1) et `blendMode: string`. `LayerStack.addLayer(effectId)` initialise `opacity: 1`, `blendMode: "normal"`.

- [ ] **Step 1: Écrire le test qui échoue** (défauts à l'ajout)

Ajouter dans `test/layers/layerStack.test.ts` :

```ts
it("addLayer initialise opacity=1 et blendMode='normal'", () => {
  const stack = new LayerStack();
  const id = stack.addLayer("grain");
  const layer = stack.layers.find((l) => l.id === id)!;
  expect(layer.opacity).toBe(1);
  expect(layer.blendMode).toBe("normal");
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npm run test -- layerStack`
Expected: FAIL (`opacity`/`blendMode` undefined, et erreur de type si tsc strict).

- [ ] **Step 3: Étendre le type `LayerState`**

Dans `src/layers/types.ts`, ajouter les deux champs à l'interface (après `enabled`) :

```ts
export interface LayerState {
  id: string;
  effectId: string;
  params: Record<string, number>;
  enabled: boolean;
  /** Opacité du calque (0..1). 1 = effet à pleine force. */
  opacity: number;
  /** Id du mode de fusion (registry blend). "normal" = remplacement (compat). */
  blendMode: string;
  /** Masque du calque (r8, 1 octet/pixel, taille de l'image), ou null.
   *  IMMUABLE par convention : toujours REMPLACÉ (updateMask stocke une
   *  copie fraîche), jamais muté en place — clone() et l'historique
   *  partagent ces références. */
  maskData: Uint8Array | null;
}
```

- [ ] **Step 4: Initialiser les défauts dans `addLayer`**

Dans `src/layers/layerStack.ts`, la méthode `addLayer` pousse aujourd'hui `{ id, effectId, params: {}, enabled: true, maskData: null }`. Ajouter les deux champs :

```ts
addLayer(effectId: string): string {
  const id = freshId();
  this.layers.push({ id, effectId, params: {}, enabled: true, opacity: 1, blendMode: "normal", maskData: null });
  return id;
}
```

- [ ] **Step 5: Lancer les tests, vérifier le succès**

Run: `npm run test -- layerStack && npx tsc --noEmit`
Expected: PASS ; tsc sans erreur (les autres constructions de `LayerState` dans les tests/fixtures peuvent nécessiter les champs — les compléter avec `opacity: 1, blendMode: "normal"` si tsc le signale).

- [ ] **Step 6: Commit**

```bash
git add src/layers/types.ts src/layers/layerStack.ts test/layers/layerStack.test.ts
git commit -m "feat(layers): add opacity and blendMode to LayerState with defaults"
```

---

### Task 2: Registry des modes de fusion (modules autonomes)

**Files:**
- Create: `src/render/blend/types.ts`
- Create: `src/render/blend/modes.ts` (les modules de mode)
- Create: `src/render/blend/registry.ts`
- Test: `test/render/blend/registry.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `interface BlendMode { id: string; name: string; wgsl: string }` où `wgsl` définit `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32>`. `getBlendMode(id: string): BlendMode` (jette `Mode de fusion inconnu: ${id}`). `blendRegistry: BlendMode[]`. Les modules gamma peuvent appeler `srgb2lin`/`lin2srgb` (helpers injectés par le shader, Task 3) — ils ne les redéfinissent pas.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `test/render/blend/registry.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { blendRegistry, getBlendMode } from "../../../src/render/blend/registry";

describe("blend registry", () => {
  it("contient le mode normal", () => {
    expect(blendRegistry.find((m) => m.id === "normal")).toBeDefined();
  });

  it("getBlendMode retourne le module par id", () => {
    expect(getBlendMode("multiply").id).toBe("multiply");
  });

  it("getBlendMode jette sur un id inconnu", () => {
    expect(() => getBlendMode("does-not-exist")).toThrow(/Mode de fusion inconnu/);
  });

  it("chaque module définit une fonction blend dans son wgsl", () => {
    for (const m of blendRegistry) {
      expect(m.wgsl).toMatch(/fn\s+blend\s*\(/);
    }
  });

  it("chaque module a un id et un name non vides et un id unique", () => {
    const ids = new Set<string>();
    for (const m of blendRegistry) {
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.name.length).toBeGreaterThan(0);
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
    }
  });

  it("le mode normal renvoie top (identité de compositing)", () => {
    expect(getBlendMode("normal").wgsl).toMatch(/return\s+top\s*;/);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run test -- blend/registry`
Expected: FAIL (modules introuvables).

- [ ] **Step 3: Écrire le type**

Créer `src/render/blend/types.ts` :

```ts
export interface BlendMode {
  id: string;
  name: string;
  /** WGSL définissant `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32>`.
   *  `base` = calque du dessous (input), `top` = sortie d'effet. Travaille en
   *  LINÉAIRE pour les modes séparables ; les modes définis-gamma décodent en
   *  sRGB via les helpers `srgb2lin`/`lin2srgb` injectés par le shader (voir
   *  shaderCompose.ts), appliquent la formule, puis ré-encodent — le pipeline
   *  reste linéaire strict. */
  wgsl: string;
}
```

- [ ] **Step 4: Écrire les modules de mode**

Créer `src/render/blend/modes.ts`. Modes **séparables** (linéaire direct) et modes **définis-gamma** (décodent/ré-encodent localement via les helpers injectés) :

```ts
import type { BlendMode } from "./types";

// Séparables — corrects en espace linéaire.
export const normal: BlendMode = {
  id: "normal", name: "Normal",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }`,
};
export const multiply: BlendMode = {
  id: "multiply", name: "Produit",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return base * top; }`,
};
export const screen: BlendMode = {
  id: "screen", name: "Écran",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return base + top - base * top; }`,
};
export const add: BlendMode = {
  id: "add", name: "Addition",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return min(base + top, vec3<f32>(1.0)); }`,
};
export const darken: BlendMode = {
  id: "darken", name: "Obscurcir",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return min(base, top); }`,
};
export const lighten: BlendMode = {
  id: "lighten", name: "Éclaircir",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return max(base, top); }`,
};

// Définis-gamma — décodent en sRGB, appliquent la formule Photoshop, ré-encodent.
// `srgb2lin`/`lin2srgb` sont injectés par shaderCompose.ts (helpers partagés).
export const overlay: BlendMode = {
  id: "overlay", name: "Incrustation",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> {
  let b = lin2srgb(base); let t = lin2srgb(top);
  let lo = 2.0 * b * t;
  let hi = vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - b) * (vec3<f32>(1.0) - t);
  let r = select(hi, lo, b <= vec3<f32>(0.5));
  return srgb2lin(r);
}`,
};
export const hardLight: BlendMode = {
  id: "hard-light", name: "Lumière crue",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> {
  let b = lin2srgb(base); let t = lin2srgb(top);
  let lo = 2.0 * b * t;
  let hi = vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - b) * (vec3<f32>(1.0) - t);
  let r = select(hi, lo, t <= vec3<f32>(0.5));
  return srgb2lin(r);
}`,
};
export const softLight: BlendMode = {
  id: "soft-light", name: "Lumière tamisée",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> {
  let b = lin2srgb(base); let t = lin2srgb(top);
  let d = select(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, b <= vec3<f32>(0.25));
  let lo = b - (vec3<f32>(1.0) - 2.0 * t) * b * (vec3<f32>(1.0) - b);
  let hi = b + (2.0 * t - vec3<f32>(1.0)) * (d - b);
  let r = select(hi, lo, t <= vec3<f32>(0.5));
  return srgb2lin(r);
}`,
};
export const colorBurn: BlendMode = {
  id: "color-burn", name: "Densité couleur -",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> {
  let b = lin2srgb(base); let t = lin2srgb(top);
  let r = vec3<f32>(1.0) - min(vec3<f32>(1.0), (vec3<f32>(1.0) - b) / max(t, vec3<f32>(1e-4)));
  return srgb2lin(r);
}`,
};
export const colorDodge: BlendMode = {
  id: "color-dodge", name: "Densité couleur +",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> {
  let b = lin2srgb(base); let t = lin2srgb(top);
  let r = min(vec3<f32>(1.0), b / max(vec3<f32>(1.0) - t, vec3<f32>(1e-4)));
  return srgb2lin(r);
}`,
};
```

- [ ] **Step 5: Écrire le registry**

Créer `src/render/blend/registry.ts` (calqué sur `effects/registry.ts`) :

```ts
import type { BlendMode } from "./types";
import {
  normal, multiply, screen, add, darken, lighten,
  overlay, hardLight, softLight, colorBurn, colorDodge,
} from "./modes";

export const blendRegistry: BlendMode[] = [
  normal, multiply, screen, add, darken, lighten,
  overlay, hardLight, softLight, colorBurn, colorDodge,
];

// Fail-fast : ids uniques (comme validateEffect côté effets).
const seen = new Set<string>();
for (const m of blendRegistry) {
  if (seen.has(m.id)) throw new Error(`Mode de fusion en double: ${m.id}`);
  seen.add(m.id);
}

export function getBlendMode(id: string): BlendMode {
  const mode = blendRegistry.find((m) => m.id === id);
  if (!mode) throw new Error(`Mode de fusion inconnu: ${id}`);
  return mode;
}
```

- [ ] **Step 6: Lancer les tests, vérifier le succès**

Run: `npm run test -- blend/registry && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/render/blend test/render/blend
git commit -m "feat(blend): add blend-mode registry (separable linear + gamma-defined modes)"
```

---

### Task 3: Compositing dans le shader — blend + opacité par passe

**Files:**
- Modify: `src/render/shaderCompose.ts:36-66`
- Modify: `src/render/renderer.ts:382-469` (`runEffectPass`)
- Test: `test/render/shaderCompose.test.ts`

**Interfaces:**
- Consumes: `getBlendMode` (Task 2), `LayerState.opacity`/`blendMode` (Task 1).
- Produces: `composeShader(effectWgsl, opts)` où `opts` gagne `blendWgsl?: string` (le corps `fn blend(...)`, seulement utilisé sur le chemin `applyMask`). Le wrapper `fs_wrapper` compose `mix(color, blend(color, effected), opacity * maskValue)` sur le chemin `applyMask`. Nouveau binding `@binding(5)` = uniform `compositing: vec4<f32>` (`.x` = opacité).

- [ ] **Step 1: Écrire le test qui échoue** (compat + variante blend)

Ajouter dans `test/render/shaderCompose.test.ts` :

```ts
it("chemin applyMask compose blend + opacité (binding 5)", () => {
  const code = composeShader("fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }", {
    applyMask: true,
    hasPrevPass: false,
    blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }",
  });
  expect(code).toContain("@group(0) @binding(5) var<uniform> compositing: vec4<f32>;");
  expect(code).toContain("fn blend(");
  expect(code).toContain("compositing.x");
  expect(code).toContain("srgb2lin");
  expect(code).toContain("lin2srgb");
});

it("chemin sans masque inchangé (return effected, ni blend ni compositing)", () => {
  const code = composeShader("fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }", {
    applyMask: false,
    hasPrevPass: false,
  });
  expect(code).toContain("return effected;");
  expect(code).not.toContain("binding(5)");
  expect(code).not.toContain("fn blend(");
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run test -- shaderCompose`
Expected: FAIL (`blendWgsl` inconnu, bindings absents).

- [ ] **Step 3: Généraliser `composeShader`**

Dans `src/render/shaderCompose.ts`, étendre `ComposeOptions` et le corps. Ajouter `blendWgsl?: string` à l'interface, injecter les helpers sRGB + la fn blend + l'uniform compositing, et généraliser le `mix` UNIQUEMENT sur le chemin `applyMask` (le chemin sans masque — passes internes — reste `return effected;`, byte-identique, cache stable) :

```ts
export interface ComposeOptions {
  applyMask: boolean;
  hasPrevPass: boolean;
  /** Corps `fn blend(base, top)` du mode de fusion du calque. Requis quand
   *  applyMask=true. Ignoré sinon (les passes internes ne compositent pas). */
  blendWgsl?: string;
}

const SRGB_HELPERS_WGSL = `
fn srgb2lin(c: vec3<f32>) -> vec3<f32> {
  let lo = c / 12.92;
  let hi = pow((c + vec3<f32>(0.055)) / vec3<f32>(1.055), vec3<f32>(2.4));
  return select(hi, lo, c <= vec3<f32>(0.04045));
}
fn lin2srgb(c: vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}
`;
```

Puis, dans `composeShader`, remplacer la construction des bindings et du `fsBody` :

```ts
export function composeShader(effectWgsl: string, opts: ComposeOptions): string {
  const maskBinding = opts.applyMask
    ? "@group(0) @binding(3) var maskTexture: texture_2d<f32>;"
    : "";
  const prevPassBinding = opts.hasPrevPass
    ? "@group(0) @binding(4) var prevPass: texture_2d<f32>;"
    : "";
  // blend + opacité + helpers sRGB seulement sur le chemin de compositing.
  const compositingBinding = opts.applyMask
    ? "@group(0) @binding(5) var<uniform> compositing: vec4<f32>;"
    : "";
  const blendBlock = opts.applyMask ? SRGB_HELPERS_WGSL + "\n" + (opts.blendWgsl ?? "") : "";
  const fsBody = opts.applyMask
    ? `let maskValue = textureSample(maskTexture, srcSampler, in.uv).r;
  let blended = blend(color.rgb, effected.rgb);
  return vec4<f32>(mix(color.rgb, blended, compositing.x * maskValue), color.a);`
    : "return effected;";

  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, ${MAX_EFFECT_PARAMS}>;
${maskBinding}
${prevPassBinding}
${compositingBinding}

${blendBlock}
${effectWgsl}

@fragment
fn fs_wrapper(in: VertexOut) -> @location(0) vec4<f32> {
  let color = textureSample(srcTexture, srcSampler, in.uv);
  let effected = fs_main(in.uv, color);
  ${fsBody}
}
`;
}
```

- [ ] **Step 4: Lancer les tests shaderCompose, vérifier le succès**

Run: `npm run test -- shaderCompose`
Expected: PASS (dont les tests existants — le chemin sans masque est inchangé).

- [ ] **Step 5: Câbler l'uniform opacité + le blend dans `runEffectPass`**

Dans `src/render/renderer.ts`, `runEffectPass` : (a) résoudre le mode de fusion du calque, (b) passer `blendWgsl` à `composeShader`, (c) créer un uniform buffer `compositing` (vec4, opacité en `.x`) sur le chemin `applyMask`, (d) l'ajouter au layout et au bind group en binding 5.

Ajouter l'import en tête de fichier :

```ts
import { getBlendMode } from "./blend/registry";
```

Dans `runEffectPass`, après la création de `paramBuffer` (~ligne 405), construire le shader avec le blend et préparer l'uniform compositing :

```ts
    const blendMode = getBlendMode(layer.blendMode ?? "normal");
    const shaderCode = composeShader(effect.wgsl, {
      applyMask,
      hasPrevPass: prevPassView !== null,
      blendWgsl: applyMask ? blendMode.wgsl : undefined,
    });

    // Uniform de compositing (opacité en .x), seulement quand on composite.
    let compositingBuffer: GPUBuffer | null = null;
    if (applyMask) {
      const compositing = new Float32Array([layer.opacity ?? 1, 0, 0, 0]);
      compositingBuffer = device.createBuffer({
        size: compositing.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(compositingBuffer, 0, compositing);
      pendingDestroy.push(compositingBuffer);
    }
```

Dans la construction du layout (bloc `if (!cached)`), ajouter l'entrée binding 5 quand `applyMask` (après le bloc `if (applyMask)` du binding 3) :

```ts
      if (applyMask) {
        layoutEntries.push({ binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
      }
```

Dans la construction du bind group `entries`, ajouter binding 5 quand `applyMask` :

```ts
    if (applyMask && compositingBuffer) {
      entries.push({ binding: 5, resource: { buffer: compositingBuffer } });
    }
```

Note : le shader étant la clé du cache de pipelines, un mode de fusion différent produit un `shaderCode` différent → pipeline distinct par mode, correct. Le layout inclut binding 5 dès que `applyMask` (indépendant du mode), cohérent entre modes.

- [ ] **Step 6: Vérifier compilation + non-régression logique**

Run: `npx tsc --noEmit && npm run test`
Expected: tsc OK ; tous les tests passent (aucun test ne rend de WebGPU ; on valide seulement que rien de pur n'a cassé).

- [ ] **Step 7: Checkpoint visuel humain (obligatoire, rendu GPU)**

Lancer l'app : `npm run dev:debug` puis vérifier dans la vraie fenêtre (Antoine) :
1. **Rétro-compat** : ouvrir une photo, ajouter un effet (ex. Glow) — le rendu doit être IDENTIQUE à avant (mode `normal`, opacité 1). Aucune dérive de couleur/luminosité.
2. Aucun canvas noir, aucune erreur console/WebView2 (surveiller `npm run dev:monitor`).

Ne pas cocher cette étape sans confirmation visuelle d'Antoine.

- [ ] **Step 8: Commit**

```bash
git add src/render/shaderCompose.ts src/render/renderer.ts test/render/shaderCompose.test.ts
git commit -m "feat(render): composite each layer with blend mode + opacity (generalized mix)"
```

---

### Task 4: UI — opacité + sélecteur de mode par calque

**Files:**
- Modify: `src/components/LayerPanel.tsx`
- Modify: `src/App.tsx` (handlers + props)
- Modify: `src/components/Inspector.tsx` (transit des props si nécessaire)

**Interfaces:**
- Consumes: `LayerState.opacity`/`blendMode` (Task 1), `blendRegistry` (Task 2), les composants `Slider` et `Select` existants (voir `ParamPanel.tsx`/`LayerPanel.tsx` pour leur API réelle).
- Produces: handlers `handleOpacityChange(id, opacity)` / `handleOpacityCommit()` (pattern drag → une entrée d'historique au commit) et `handleBlendModeChange(id, blendMode)` (commit immédiat) dans `App.tsx`, passés à `LayerPanel`.

- [ ] **Step 1: Ajouter les handlers dans `App.tsx`**

Reprendre le pattern `handleParamChange`/`handleParamCommit` (mise à jour vivante sans entrée d'historique pendant le drag, une entrée au commit). Ajouter :

```ts
  function handleOpacityChange(id: string, opacity: number) {
    paramDirtyRef.current = true;
    const stack = currentStack();
    const layer = stack.layers.find((l) => l.id === id);
    if (layer) layer.opacity = opacity;
    syncLayers(stack.layers);
    rendererRef.current?.requestRender(stack.layers);
  }

  function handleBlendModeChange(id: string, blendMode: string) {
    const stack = currentStack();
    const layer = stack.layers.find((l) => l.id === id);
    if (layer) layer.blendMode = blendMode;
    commit(stack); // changement discret → une entrée d'historique directe
  }
```

Note : `handleOpacityChange` réutilise `handleParamCommit` (déjà appelé au `onCommit` du slider) pour pousser l'entrée d'historique en fin de drag — ne pas créer un second chemin de commit.

- [ ] **Step 2: Passer les handlers à `LayerPanel`**

Dans le JSX `<Inspector ... />` de `App.tsx`, ajouter les props (et les faire transiter par `Inspector.tsx` jusqu'à `LayerPanel` si l'Inspector relaie déjà les props de calque) :

```tsx
  onOpacityChange={handleOpacityChange}
  onOpacityCommit={handleParamCommit}
  onBlendModeChange={handleBlendModeChange}
```

- [ ] **Step 3: Afficher opacité + mode sur chaque ligne de calque**

Dans `src/components/LayerPanel.tsx`, sous le nom de chaque calque, ajouter un `Slider` compact d'opacité (0..1, step 0.01) et un `Select` de mode alimenté par `blendRegistry`. Suivre l'API réelle des composants `Slider`/`Select` déjà utilisés (cf. `ParamPanel.tsx` pour `Slider` : `label`, `value`, `min`, `max`, `step`, `onChange`, `onCommit` ; cf. le `Select` d'ajout d'effet en tête de `LayerPanel` pour l'API `options`/`onChange`). Exemple de structure (adapter aux signatures exactes lues sur place) :

```tsx
<Slider
  label="Opacité"
  value={layer.opacity}
  min={0}
  max={1}
  step={0.01}
  onChange={(v) => onOpacityChange(layer.id, v)}
  onCommit={onOpacityCommit}
/>
<Select
  value={layer.blendMode}
  options={blendRegistry.map((m) => ({ value: m.id, label: m.name }))}
  onChange={(v) => onBlendModeChange(layer.id, v)}
/>
```

Importer `blendRegistry` : `import { blendRegistry } from "../render/blend/registry";`. Respecter les tokens du design system darkroom-balanced (espacements/tailles/couleurs sémantiques — pas de valeur arbitraire ; réutiliser les classes déjà présentes sur les lignes de calque).

- [ ] **Step 4: Vérifier compilation + tests**

Run: `npx tsc --noEmit && npm run test`
Expected: tsc OK, tests OK (aucun test de rendu React).

- [ ] **Step 5: Checkpoint visuel humain (obligatoire)**

`npm run dev:debug`, puis Antoine vérifie dans la vraie fenêtre :
1. Deux calques (ex. Glow puis Grain). Changer le mode du calque du dessus (multiply, screen, overlay…) → le mélange change de façon cohérente ; comparer visuellement à un logiciel de référence pour multiply/screen/overlay.
2. Glisser l'opacité d'un calque → l'effet s'atténue en temps réel (60fps ressenti), UNE entrée d'historique par drag (undo revient à l'état avant le drag).
3. `normal` + opacité 1 = rendu identique à sans blend.
4. Pas de dérive de couleur/luminosité due à l'empilement (bords sombres, halos, banding).

Ne pas cocher sans confirmation d'Antoine.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/LayerPanel.tsx src/components/Inspector.tsx
git commit -m "feat(ui): per-layer opacity slider and blend-mode selector"
```

---

## Notes de fin

- **Terminé (tranche 1) = démontrable** : opacité + ~11 modes sur une pile réelle, comparés visuellement à un logiciel de référence ; `normal`+opacité 1 identique à avant ; une entrée d'historique par ajustement (undo/redo corrects) — tout validé par checkpoint visuel humain.
- **Différé aux tranches suivantes** (hors de ce plan) : masque non-destructif multi-source (tranche 2), sources paramétriques + refine edge (3), panneau Masques flottant (4), groupes (5). Voir le design.
- **Modes non inclus volontairement** (YAGNI, à ajouter comme un fichier chacun si le besoin se confirme) : `difference`, `exclusion`, `hue`/`saturation`/`color`/`luminosity` (ces 4 derniers ne sont pas séparables — nécessitent un traitement HSL complet, à cadrer séparément).
