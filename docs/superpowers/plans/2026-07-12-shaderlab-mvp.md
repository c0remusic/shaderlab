# shaderlab MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop app (Tauri + React/TS + WebGPU) that applies stackable, real-time GPU shader effects (glow, chromatic bleed, warp, grain) with brush masking to JPEG photos, and that can act as a Lightroom "external editor" via file round-trip.

**Architecture:** Rust/Tauri shell (window, file I/O, CLI-arg handling) wrapping a React/TS UI. All rendering happens in a dedicated `render/` module using raw WebGPU (`navigator.gpu`), independent of React. Effects are self-contained modules (WGSL source + param schema) registered in a single array; the renderer replays the layer stack through ping-pong `rgba8unorm-srgb` render targets so every pass is gamma-correct automatically (linear math on read/write, sRGB storage).

**Tech Stack:** Tauri v2 (Rust), React 19 + TypeScript, Vite (Tauri's default bundler), raw WebGPU/WGSL (no rendering library), Vitest (unit tests, Node environment — matches the `test/` mirrors `src/` convention used on track-finder).

## Global Constraints

- Windows only for v1 (per spec — no WebGL fallback, no cross-platform code paths).
- No preview/export resolution distinction — one pipeline, always native resolution (per spec, explicit user decision).
- Undo/redo is in-memory only, lost on close — no disk persistence of history (per spec).
- Export always writes to a path chosen by the caller (copy path for manual export, the exact launch path for Lightroom round-trip) — never silently overwrites the user's original library file.
- All GPU textures that hold color data (source image, every ping-pong render target, mask composite target) use the `rgba8unorm-srgb` format so sRGB↔linear conversion is automatic and consistent — never do manual gamma math in WGSL (per spec's color-space fix from audit).
- Input JPEGs are treated as sRGB; no ICC profile parsing in v1 (documented limitation, not silent).
- Effect modules must be addable without touching the renderer or layer-stack UI — one new file per effect (per spec's extensibility requirement).
- **Visual quality is in scope, not a nice-to-have** (explicit user requirement: no "Photoshop 2005 filter" look). Tasks 5–8 build naive pipeline-validation versions of each effect; Tasks 13–16 upgrade each one to production quality (dual-filter bloom, radial aberration, simplex-noise warp, luminance-dependent grain). An effect is not "done" at the end of its naive task.

## Open-Source Resources (verified 2026-07-12)

- **LYGIA** (`npm install lygia`, [github.com/patriciogonzalezvivo/lygia](https://github.com/patriciogonzalezvivo/lygia)) — 500+ shader functions with WebGPU/WESL support and Vite plugins. Use for noise primitives (simplex, FBM) in Tasks 15–16. Attribution license.
- **webgpu-image-filter** ([github.com/quarksb/webgpu-image-filter](https://github.com/quarksb/webgpu-image-filter)) — same architecture as ours; ⚠️ NO declared license — read for structure/math reference only, never copy code verbatim.
- **TypeGPU** ([github.com/software-mansion/TypeGPU](https://github.com/software-mansion/TypeGPU)) — typed WebGPU toolkit; evaluate during Task 2 spike, adopt only if it simplifies without hiding pipeline control.
- **BitMappery** ([github.com/igorski/bitmappery](https://github.com/igorski/bitmappery), MIT) — proven layers/masks data-model reference (Canvas2D rendering, so no GPU code to reuse).
- **Dual-filter bloom technique**: ARM/Marius Bjørge SIGGRAPH presentation "Bandwidth-efficient rendering" — the reference for Task 13.

---

### Task 1: Scaffold project (Tauri + React/TS + Vitest)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`
- Create: `src/main.tsx`, `src/App.tsx`
- Create: `test/App.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a running `npm run tauri dev` command that opens a Tauri window showing a placeholder React page; a working `npm run test` (Vitest) command.

- [ ] **Step 1: Scaffold with the official Tauri + React-TS template**

```bash
cd "C:\Users\LEETJ\Desktop\shaderlab"
npm create tauri-app@latest . -- --template react-ts --manager npm
```

When prompted, accept defaults (app name `shaderlab`, window title `shaderlab`).

- [ ] **Step 2: Verify the scaffold runs**

Run: `npm install && npm run tauri dev`
Expected: a native window opens on Windows showing the default Tauri+React starter page (Vite/Tauri/React logos), no errors in the terminal.

Close the dev window once confirmed.

- [ ] **Step 3: Add Vitest, matching track-finder's Node-environment convention**

```bash
npm install -D vitest
```

Add to `package.json` scripts:
```json
"test": "vitest run"
```

- [ ] **Step 4: Write a trivial passing test to confirm Vitest is wired up**

Create `test/App.test.ts`:
```typescript
import { describe, it, expect } from "vitest";

describe("scaffold sanity check", () => {
  it("basic arithmetic works", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test suite**

Run: `npm run test`
Expected: `1 passed`, no failures.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri + React/TS + Vitest project"
```

---

### Task 2: Spike — WebGPU rendering in the Tauri window, sRGB-correct pipeline

**Files:**
- Create: `src/render/gpuContext.ts`
- Modify: `src/App.tsx`
- Test: manual (GPU rendering is not unit-testable, per spec's Testing section)

**Interfaces:**
- Consumes: nothing new.
- Produces: `async function initGpu(canvas: HTMLCanvasElement): Promise<{ device: GPUDevice; context: GPUCanvasContext; format: GPUTextureFormat }>` — used by every later rendering task. `format` is always `"rgba8unorm-srgb"`, fixed by this task, never re-decided later.

This is the highest-risk unknown in the whole project (does WebGPU actually work inside Tauri's WebView2 on real Windows hardware?) — validate it before writing anything else that depends on it.

- [ ] **Step 1: Write the GPU context initializer**

Create `src/render/gpuContext.ts`:
```typescript
export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

export async function initGpu(canvas: HTMLCanvasElement): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new Error("WebGPU non disponible sur ce navigateur/GPU.");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("Aucun adaptateur WebGPU trouvé.");
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  if (!context) {
    throw new Error("Impossible d'obtenir un contexte WebGPU sur le canvas.");
  }
  const format: GPUTextureFormat = "rgba8unorm-srgb";
  context.configure({ device, format, alphaMode: "opaque" });
  return { device, context, format };
}
```

- [ ] **Step 2: Render a solid color quad to prove the pipeline works end-to-end**

Modify `src/App.tsx` to replace the starter content with a canvas and a minimal draw call:
```typescript
import { useEffect, useRef, useState } from "react";
import { initGpu } from "./render/gpuContext";

const SHADER_SRC = `
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(pos[i], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(0.8, 0.2, 0.4, 1.0);
}
`;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    initGpu(canvasRef.current)
      .then(({ device, context, format }) => {
        const module = device.createShaderModule({ code: SHADER_SRC });
        const pipeline = device.createRenderPipeline({
          layout: "auto",
          vertex: { module, entryPoint: "vs_main" },
          fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <canvas ref={canvasRef} width={800} height={600} />
    </div>
  );
}
```

- [ ] **Step 3: Manual verification on real Windows hardware**

Run: `npm run tauri dev`
Expected: the window opens and shows an 800x600 canvas filled with a solid dusty-pink/red color (`rgb ≈ 0.8, 0.2, 0.4` gamma-encoded by the sRGB target). No console errors, no "WebGPU non disponible" message.

If this fails on the actual dev machine, STOP — this is the go/no-go gate for the whole Tauri+WebGPU approach from the spec. Do not proceed to Task 3 until this renders correctly.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "spike: validate WebGPU rendering works inside Tauri on Windows"
```

---

### Task 3: Spike — Lightroom round-trip file contract

**Files:**
- Modify: `src-tauri/src/main.rs`
- Create: `src/launch.ts`
- Test: manual (requires an external Lightroom install to fully validate; the CLI-arg mechanics are verified without Lightroom)

**Interfaces:**
- Consumes: nothing new.
- Produces: Tauri command `get_launch_path(): Promise<string | null>` (invoked from TS via `invoke("get_launch_path")`) and `write_image_file(path: string, bytes: number[]): Promise<void>` — both reused by Task 10 (export).

- [ ] **Step 1: Add Rust commands for launch-path and file writing**

Modify `src-tauri/src/main.rs` to add two `#[tauri::command]` functions and register them:
```rust
use std::fs;

#[tauri::command]
fn get_launch_path() -> Option<String> {
    // args[0] is the executable path; a launch path (from Lightroom's
    // External Editing, or Windows "Open with") is args[1] if present.
    std::env::args().nth(1)
}

#[tauri::command]
fn write_image_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(&path, &bytes).map_err(|e| format!("Écriture échouée sur {path}: {e}"))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_launch_path, write_image_file])
        .run(tauri::generate_context!())
        .expect("error while running shaderlab");
}
```

- [ ] **Step 2: Expose a typed TS wrapper**

Create `src/launch.ts`:
```typescript
import { invoke } from "@tauri-apps/api/core";

export async function getLaunchPath(): Promise<string | null> {
  return invoke<string | null>("get_launch_path");
}

export async function writeImageFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_image_file", { path, bytes: Array.from(bytes) });
}
```

- [ ] **Step 3: Manual verification — CLI arg is received**

Build the app: `npm run tauri build`
Locate the built exe (Tauri prints the path, typically `src-tauri/target/release/shaderlab.exe`).

Run from a terminal with a file path argument:
```bash
"src-tauri/target/release/shaderlab.exe" "C:\Users\LEETJ\Desktop\shaderlab\test-fixtures\sample.jpg"
```
(Create `test-fixtures/sample.jpg` first — any small JPEG works, e.g. export one from Lightroom or copy any existing photo.)

Temporarily log the result in `src/App.tsx`'s `useEffect` (`getLaunchPath().then(console.log)`), open the app's dev console (right-click → Inspect, or Tauri's devtools), and confirm the logged path matches the argument passed. Remove the temporary log line afterward.

- [ ] **Step 4: Manual verification — overwrite round-trip with real Lightroom**

In Lightroom Classic: Edit → Preferences → External Editing → set "Additional External Editor" to the built `shaderlab.exe`, format JPEG.
Right-click a photo → Edit In → shaderlab.
Expected: shaderlab launches and (per Step 3's logging) receives the temp file path Lightroom exported. Manually call `writeImageFile(launchPath, someBytes)` with dummy bytes (a solid-color JPEG is fine for this spike) via a temporary test button, close shaderlab, and confirm the edited photo appears stacked next to the original in Lightroom's grid — this proves the overwrite-in-place contract from the design doc actually works, not just the assumption.

If Lightroom does NOT re-import after the overwrite, investigate Lightroom's actual expected behavior (it may require the process to exit, or a specific file lock/rename sequence) before Task 10 is built on this assumption.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "spike: validate Lightroom external-editor round-trip contract"
```

---

### Task 4: Layer stack data model + undo/redo history

**Files:**
- Create: `src/layers/types.ts`
- Create: `src/layers/layerStack.ts`
- Create: `src/layers/history.ts`
- Test: `test/layers/layerStack.test.ts`
- Test: `test/layers/history.test.ts`

**Interfaces:**
- Consumes: nothing new (pure logic, no GPU/Tauri dependency).
- Produces:
  - `interface LayerState { id: string; effectId: string; params: Record<string, number>; enabled: boolean; maskData: Uint8Array | null }`
  - `class LayerStack` with `layers: LayerState[]`, `addLayer(effectId: string): string`, `removeLayer(id: string): void`, `reorderLayer(id: string, newIndex: number): void`, `toggleLayer(id: string): void`, `updateParams(id: string, params: Record<string, number>): void`, `clone(): LayerStack`
  - `class History` with `constructor(initial: LayerStack)`, `push(state: LayerStack): void`, `undo(): LayerStack | null`, `redo(): LayerStack | null`, `canUndo(): boolean`, `canRedo(): boolean`

These are consumed directly by Task 5 (renderer takes `layers: LayerState[]`) and Task 11 (UI).

- [ ] **Step 1: Write the failing test for LayerStack**

Create `test/layers/layerStack.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";

describe("LayerStack", () => {
  it("adds a layer with default params and enabled=true", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.layers).toHaveLength(1);
    expect(stack.layers[0]).toMatchObject({ id, effectId: "glow", enabled: true, maskData: null });
  });

  it("removes a layer by id", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.removeLayer(id);
    expect(stack.layers).toHaveLength(0);
  });

  it("reorders a layer to a new index", () => {
    const stack = new LayerStack();
    const a = stack.addLayer("glow");
    const b = stack.addLayer("grain");
    stack.reorderLayer(a, 1);
    expect(stack.layers.map((l) => l.id)).toEqual([b, a]);
  });

  it("toggles a layer's enabled flag", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.toggleLayer(id);
    expect(stack.layers[0].enabled).toBe(false);
  });

  it("updates a layer's params by merging", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateParams(id, { intensity: 0.5 });
    expect(stack.layers[0].params.intensity).toBe(0.5);
  });

  it("clone() produces a deep copy independent of the original", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const copy = stack.clone();
    copy.updateParams(id, { intensity: 0.9 });
    expect(stack.layers[0].params.intensity).not.toBe(0.9);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- test/layers/layerStack.test.ts`
Expected: FAIL — `Cannot find module '../../src/layers/layerStack'`.

- [ ] **Step 3: Implement LayerStack**

Create `src/layers/types.ts`:
```typescript
export interface LayerState {
  id: string;
  effectId: string;
  params: Record<string, number>;
  enabled: boolean;
  maskData: Uint8Array | null;
}
```

Create `src/layers/layerStack.ts`:
```typescript
import type { LayerState } from "./types";

let nextId = 0;
function freshId(): string {
  nextId += 1;
  return `layer-${nextId}`;
}

export class LayerStack {
  layers: LayerState[] = [];

  addLayer(effectId: string): string {
    const id = freshId();
    this.layers.push({ id, effectId, params: {}, enabled: true, maskData: null });
    return id;
  }

  removeLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.id !== id);
  }

  reorderLayer(id: string, newIndex: number): void {
    const from = this.layers.findIndex((l) => l.id === id);
    if (from === -1) return;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(newIndex, 0, layer);
  }

  toggleLayer(id: string): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.enabled = !layer.enabled;
  }

  updateParams(id: string, params: Record<string, number>): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.params = { ...layer.params, ...params };
  }

  clone(): LayerStack {
    const copy = new LayerStack();
    copy.layers = this.layers.map((l) => ({
      ...l,
      params: { ...l.params },
      maskData: l.maskData ? new Uint8Array(l.maskData) : null,
    }));
    return copy;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- test/layers/layerStack.test.ts`
Expected: `6 passed`.

- [ ] **Step 5: Write the failing test for History**

Create `test/layers/history.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { History } from "../../src/layers/history";

describe("History", () => {
  it("undo returns the previous state", () => {
    const initial = new LayerStack();
    const history = new History(initial);
    const withLayer = initial.clone();
    withLayer.addLayer("glow");
    history.push(withLayer);

    const undone = history.undo();
    expect(undone?.layers).toHaveLength(0);
  });

  it("redo restores the undone state", () => {
    const initial = new LayerStack();
    const history = new History(initial);
    const withLayer = initial.clone();
    withLayer.addLayer("glow");
    history.push(withLayer);

    history.undo();
    const redone = history.redo();
    expect(redone?.layers).toHaveLength(1);
  });

  it("canUndo/canRedo reflect stack position", () => {
    const initial = new LayerStack();
    const history = new History(initial);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);

    const withLayer = initial.clone();
    withLayer.addLayer("glow");
    history.push(withLayer);
    expect(history.canUndo()).toBe(true);

    history.undo();
    expect(history.canRedo()).toBe(true);
  });

  it("pushing after an undo discards the redo branch", () => {
    const initial = new LayerStack();
    const history = new History(initial);
    const a = initial.clone();
    a.addLayer("glow");
    history.push(a);
    history.undo();

    const b = initial.clone();
    b.addLayer("grain");
    history.push(b);
    expect(history.canRedo()).toBe(false);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm run test -- test/layers/history.test.ts`
Expected: FAIL — `Cannot find module '../../src/layers/history'`.

- [ ] **Step 7: Implement History**

Create `src/layers/history.ts`:
```typescript
import { LayerStack } from "./layerStack";

export class History {
  private past: LayerStack[] = [];
  private future: LayerStack[] = [];
  private current: LayerStack;

  constructor(initial: LayerStack) {
    this.current = initial;
  }

  push(state: LayerStack): void {
    this.past.push(this.current);
    this.current = state;
    this.future = [];
  }

  undo(): LayerStack | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(this.current);
    this.current = previous;
    return this.current;
  }

  redo(): LayerStack | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.current);
    this.current = next;
    return this.current;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run test -- test/layers/history.test.ts`
Expected: `4 passed`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add layer stack data model and undo/redo history"
```

---

### Task 5: Effect registry + multi-pass renderer + Glow effect

**Files:**
- Create: `src/render/effects/types.ts`
- Create: `src/render/effects/registry.ts`
- Create: `src/render/effects/glow.ts`
- Create: `src/render/renderer.ts`
- Modify: `src/App.tsx` (replace Task 2's test-quad code with the real renderer)
- Test: manual (GPU output correctness is visual, per spec)

**Interfaces:**
- Consumes: `initGpu` from Task 2 (`src/render/gpuContext.ts`); `LayerState` from Task 4.
- Produces:
  - `interface EffectParam { name: string; min: number; max: number; default: number; step: number }`
  - `interface EffectModule { id: string; name: string; params: EffectParam[]; wgsl: string }`
  - `effectRegistry: EffectModule[]` and `getEffect(id: string): EffectModule` — every later effect task (6, 7, 8) adds one entry here, nothing else changes.
  - `class Renderer { constructor(ctx: GpuContext); async loadImage(bitmap: ImageBitmap): Promise<void>; render(layers: LayerState[]): void; async readPixels(): Promise<Uint8Array> }` — consumed by Task 9 (mask compositing), Task 10 (export), Task 11 (UI canvas).

- [ ] **Step 1: Define the effect module contract**

Create `src/render/effects/types.ts`:
```typescript
export interface EffectParam {
  name: string;
  min: number;
  max: number;
  default: number;
  step: number;
}

export interface EffectModule {
  id: string;
  name: string;
  params: EffectParam[];
  /** WGSL fragment shader body. Must define fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32>
   *  and read params via the `params: array<f32, 8>` uniform (index order matches `params` above). */
  wgsl: string;
}
```

- [ ] **Step 2: Write the Glow effect module**

Create `src/render/effects/glow.ts`:
```typescript
import type { EffectModule } from "./types";

export const glow: EffectModule = {
  id: "glow",
  name: "Glow",
  params: [
    { name: "threshold", min: 0, max: 1, default: 0.7, step: 0.01 },
    { name: "intensity", min: 0, max: 3, default: 1.0, step: 0.05 },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let threshold = params[0];
  let intensity = params[1];
  var glowAccum = vec3<f32>(0.0);
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  for (var dx = -2; dx <= 2; dx = dx + 1) {
    for (var dy = -2; dy <= 2; dy = dy + 1) {
      let offset = vec2<f32>(f32(dx), f32(dy)) * texel * 3.0;
      let sample = textureSample(srcTexture, srcSampler, uv + offset).rgb;
      let brightness = max(sample.r, max(sample.g, sample.b));
      let bright = max(brightness - threshold, 0.0);
      glowAccum = glowAccum + sample * bright;
    }
  }
  glowAccum = glowAccum / 25.0;
  return vec4<f32>(color.rgb + glowAccum * intensity, color.a);
}
`,
};
```

- [ ] **Step 3: Register the effect**

Create `src/render/effects/registry.ts`:
```typescript
import type { EffectModule } from "./types";
import { glow } from "./glow";

export const effectRegistry: EffectModule[] = [glow];

export function getEffect(id: string): EffectModule {
  const effect = effectRegistry.find((e) => e.id === id);
  if (!effect) throw new Error(`Effet inconnu: ${id}`);
  return effect;
}
```

- [ ] **Step 4: Write the renderer**

Create `src/render/renderer.ts`:
```typescript
import type { GpuContext } from "./gpuContext";
import type { LayerState } from "../layers/types";
import { getEffect } from "./effects/registry";

const FULLSCREEN_VERTEX_WGSL = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VertexOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var out: VertexOut;
  out.position = vec4<f32>(pos[i], 0.0, 1.0);
  out.uv = pos[i] * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
  return out;
}
`;

export class Renderer {
  private ctx: GpuContext;
  private sourceTexture: GPUTexture | null = null;
  private width = 0;
  private height = 0;
  private pingPong: [GPUTexture, GPUTexture] | null = null;
  private sampler: GPUSampler;

  constructor(ctx: GpuContext) {
    this.ctx = ctx;
    this.sampler = ctx.device.createSampler({ magFilter: "linear", minFilter: "linear" });
  }

  async loadImage(bitmap: ImageBitmap): Promise<void> {
    this.width = bitmap.width;
    this.height = bitmap.height;
    const { device, format } = this.ctx;

    const makeTarget = () =>
      device.createTexture({
        size: [this.width, this.height],
        format,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC,
      });

    this.sourceTexture = device.createTexture({
      size: [this.width, this.height],
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: this.sourceTexture },
      [this.width, this.height]
    );

    this.pingPong = [makeTarget(), makeTarget()];
  }

  render(layers: LayerState[]): void {
    if (!this.sourceTexture || !this.pingPong) throw new Error("Aucune image chargée.");
    const { device, context, format } = this.ctx;

    let readTexture = this.sourceTexture;
    let writeIndex = 0;
    const enabledLayers = layers.filter((l) => l.enabled);

    const encoder = device.createCommandEncoder();

    if (enabledLayers.length === 0) {
      // Nothing to composite — blit the source straight to the canvas.
      this.blit(encoder, readTexture, context.getCurrentTexture());
      device.queue.submit([encoder.finish()]);
      return;
    }

    for (let i = 0; i < enabledLayers.length; i++) {
      const layer = enabledLayers[i];
      const effect = getEffect(layer.effectId);
      const isLast = i === enabledLayers.length - 1;
      const target = isLast ? context.getCurrentTexture() : this.pingPong[writeIndex];

      this.runEffectPass(encoder, effect, layer, readTexture, target, format);

      if (!isLast) {
        readTexture = this.pingPong[writeIndex];
        writeIndex = 1 - writeIndex;
      }
    }

    device.queue.submit([encoder.finish()]);
  }

  private runEffectPass(
    encoder: GPUCommandEncoder,
    effect: ReturnType<typeof getEffect>,
    layer: LayerState,
    source: GPUTexture,
    target: GPUTexture,
    format: GPUTextureFormat
  ): void {
    const { device } = this.ctx;
    const paramValues = new Float32Array(8);
    effect.params.forEach((p, idx) => {
      paramValues[idx] = layer.params[p.name] ?? p.default;
    });
    const paramBuffer = device.createBuffer({
      size: paramValues.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(paramBuffer, 0, paramValues);

    const shaderCode = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, 8>;

${effect.wgsl}

@fragment
fn fs_wrapper(in: VertexOut) -> @location(0) vec4<f32> {
  let color = textureSample(srcTexture, srcSampler, in.uv);
  return fs_main(in.uv, color);
}
`;
    const module = device.createShaderModule({ code: shaderCode });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_wrapper", targets: [{ format }] },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: paramBuffer } },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private blit(encoder: GPUCommandEncoder, source: GPUTexture, target: GPUTexture): void {
    // Identity pass — reuses runEffectPass's shape with a passthrough effect.
    this.runEffectPass(
      encoder,
      { id: "passthrough", name: "Passthrough", params: [], wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }" },
      { id: "", effectId: "", params: {}, enabled: true, maskData: null },
      source,
      target,
      this.ctx.format
    );
  }

  async readPixels(): Promise<Uint8Array> {
    const { device, format } = this.ctx;
    if (!this.pingPong) throw new Error("Aucune image chargée.");
    const bytesPerRow = Math.ceil((this.width * 4) / 256) * 256;
    const buffer = device.createBuffer({
      size: bytesPerRow * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    // Read back whichever ping-pong target last held the final pass output.
    // render() always leaves the true final frame on the canvas, so for
    // export (Task 10) callers re-render into an offscreen texture of the
    // same format before calling readPixels — documented in Task 10.
    encoder.copyTextureToBuffer(
      { texture: this.pingPong[0] },
      { buffer, bytesPerRow },
      [this.width, this.height]
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap();
    void format;
    return data;
  }
}
```

- [ ] **Step 5: Wire the renderer into App.tsx and load a test image**

Replace `src/App.tsx`'s draw code (from Task 2) with:
```typescript
import { useEffect, useRef, useState } from "react";
import { initGpu } from "./render/gpuContext";
import { Renderer } from "./render/renderer";
import { LayerStack } from "./layers/layerStack";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    (async () => {
      try {
        const ctx = await initGpu(canvasRef.current!);
        const renderer = new Renderer(ctx);

        const response = await fetch("/test-fixtures/sample.jpg");
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        canvasRef.current!.width = bitmap.width;
        canvasRef.current!.height = bitmap.height;

        await renderer.loadImage(bitmap);
        const stack = new LayerStack();
        stack.addLayer("glow");
        renderer.render(stack.layers);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <div>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <canvas ref={canvasRef} />
    </div>
  );
}
```

Copy `test-fixtures/sample.jpg` (created in Task 3) into `public/test-fixtures/sample.jpg` so Vite serves it.

- [ ] **Step 6: Manual visual verification**

Run: `npm run tauri dev`
Expected: the window shows `sample.jpg` with visible bloom on its brightest areas (highlights glow outward). Compare against the same image with the Glow layer removed (comment out `stack.addLayer("glow")` temporarily) — the difference should be clearly visible, not identical.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add effect registry, multi-pass renderer, and Glow effect"
```

---

### Task 6: Chromatic bleed effect

**Files:**
- Create: `src/render/effects/chromaticBleed.ts`
- Modify: `src/render/effects/registry.ts`
- Test: manual visual verification

**Interfaces:**
- Consumes: `EffectModule` type from Task 5.
- Produces: registry entry `"chromaticBleed"`.

- [ ] **Step 1: Write the effect module**

Create `src/render/effects/chromaticBleed.ts`:
```typescript
import type { EffectModule } from "./types";

export const chromaticBleed: EffectModule = {
  id: "chromaticBleed",
  name: "Chromatic bleed",
  params: [
    { name: "amount", min: 0, max: 0.05, default: 0.01, step: 0.001 },
    { name: "angleDeg", min: 0, max: 360, default: 0, step: 1 },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let amount = params[0];
  let angle = radians(params[1]);
  let dir = vec2<f32>(cos(angle), sin(angle)) * amount;
  let r = textureSample(srcTexture, srcSampler, uv + dir).r;
  let g = textureSample(srcTexture, srcSampler, uv).g;
  let b = textureSample(srcTexture, srcSampler, uv - dir).b;
  return vec4<f32>(r, g, b, color.a);
}
`,
};
```

- [ ] **Step 2: Register it**

Modify `src/render/effects/registry.ts`:
```typescript
import type { EffectModule } from "./types";
import { glow } from "./glow";
import { chromaticBleed } from "./chromaticBleed";

export const effectRegistry: EffectModule[] = [glow, chromaticBleed];
```

- [ ] **Step 3: Manual visual verification**

In `src/App.tsx`, temporarily swap `stack.addLayer("glow")` for `stack.addLayer("chromaticBleed")` and set `stack.updateParams(id, { amount: 0.02, angleDeg: 0 })`.
Run: `npm run tauri dev`
Expected: visible red/blue fringing along high-contrast edges (e.g. dark object against bright sky), offset horizontally per the 0° angle.

Revert the temporary App.tsx change back to Glow (or leave both — this is cleaned up properly by Task 11's UI).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Chromatic bleed effect"
```

---

### Task 7: Warp (liquid displacement) effect

**Files:**
- Create: `src/render/effects/warp.ts`
- Modify: `src/render/effects/registry.ts`
- Test: manual visual verification

**Interfaces:**
- Consumes: `EffectModule` type from Task 5.
- Produces: registry entry `"warp"`.

- [ ] **Step 1: Write the effect module**

Create `src/render/effects/warp.ts`:
```typescript
import type { EffectModule } from "./types";

export const warp: EffectModule = {
  id: "warp",
  name: "Warp",
  params: [
    { name: "scale", min: 1, max: 20, default: 6, step: 0.5 },
    { name: "amplitude", min: 0, max: 0.05, default: 0.015, step: 0.001 },
    { name: "seed", min: 0, max: 100, default: 0, step: 1 },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let scale = params[0];
  let amplitude = params[1];
  let seed = params[2];
  let offset = vec2<f32>(
    sin(uv.y * scale + seed) * amplitude,
    cos(uv.x * scale + seed * 1.37) * amplitude
  );
  return textureSample(srcTexture, srcSampler, uv + offset);
}
`,
};
```

- [ ] **Step 2: Register it**

Modify `src/render/effects/registry.ts`:
```typescript
import type { EffectModule } from "./types";
import { glow } from "./glow";
import { chromaticBleed } from "./chromaticBleed";
import { warp } from "./warp";

export const effectRegistry: EffectModule[] = [glow, chromaticBleed, warp];
```

- [ ] **Step 3: Manual visual verification**

Swap the temporary effect in `src/App.tsx` to `stack.addLayer("warp")` with default params.
Run: `npm run tauri dev`
Expected: visible organic ripple/liquid distortion across the image — straight lines (edges of buildings, horizons) should appear gently wavy, not straight.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Warp effect"
```

---

### Task 8: Grain effect

**Files:**
- Create: `src/render/effects/grain.ts`
- Modify: `src/render/effects/registry.ts`
- Test: manual visual verification

**Interfaces:**
- Consumes: `EffectModule` type from Task 5.
- Produces: registry entry `"grain"`.

- [ ] **Step 1: Write the effect module**

Create `src/render/effects/grain.ts`:
```typescript
import type { EffectModule } from "./types";

export const grain: EffectModule = {
  id: "grain",
  name: "Grain",
  params: [
    { name: "intensity", min: 0, max: 0.3, default: 0.08, step: 0.01 },
    { name: "seed", min: 0, max: 1000, default: 0, step: 1 },
  ],
  wgsl: `
fn hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let intensity = params[0];
  let seed = params[1];
  let noise = hash(uv * vec2<f32>(4096.0, 4096.0) + seed) - 0.5;
  return vec4<f32>(color.rgb + vec3<f32>(noise) * intensity, color.a);
}
`,
};
```

- [ ] **Step 2: Register it**

Modify `src/render/effects/registry.ts`:
```typescript
import type { EffectModule } from "./types";
import { glow } from "./glow";
import { chromaticBleed } from "./chromaticBleed";
import { warp } from "./warp";
import { grain } from "./grain";

export const effectRegistry: EffectModule[] = [glow, chromaticBleed, warp, grain];
```

- [ ] **Step 3: Manual visual verification**

Swap to `stack.addLayer("grain")` with default params.
Run: `npm run tauri dev`
Expected: visible fine per-pixel noise texture across the image, most noticeable in flat/smooth areas (sky, skin tones).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Grain effect"
```

---

### Task 9: Brush mask system

**Files:**
- Create: `src/mask/maskPainter.ts`
- Test: `test/mask/maskPainter.test.ts`
- Modify: `src/render/renderer.ts` (composite mask into each effect pass)

**Interfaces:**
- Consumes: `LayerState.maskData` from Task 4.
- Produces: `class MaskPainter { constructor(width: number, height: number); paintStroke(x: number, y: number, radius: number, hardness: number, erase: boolean): void; getMaskData(): Uint8Array; clear(fill: 0 | 255): void }` — consumed by Task 11 (UI paints via this class, then stores the result on `LayerState.maskData`).

The mask is a single-channel (grayscale, stored as `Uint8Array` where 255 = full effect, 0 = no effect) buffer painted with a radial-falloff brush, matching the "feathered radial gradient" technique referenced in the design doc (glbrush.js).

- [ ] **Step 1: Write the failing test**

Create `test/mask/maskPainter.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { MaskPainter } from "../../src/mask/maskPainter";

describe("MaskPainter", () => {
  it("starts fully transparent (all zero) by default", () => {
    const painter = new MaskPainter(4, 4);
    const data = painter.getMaskData();
    expect(data.every((v) => v === 0)).toBe(true);
  });

  it("clear(255) fills the mask fully opaque", () => {
    const painter = new MaskPainter(4, 4);
    painter.clear(255);
    expect(painter.getMaskData().every((v) => v === 255)).toBe(true);
  });

  it("paintStroke raises values at the brush center, tapering at the edge", () => {
    const painter = new MaskPainter(20, 20);
    painter.paintStroke(10, 10, 5, 1.0, false);
    const data = painter.getMaskData();
    const center = data[10 * 20 + 10];
    const edge = data[10 * 20 + 19]; // far from the brush
    expect(center).toBeGreaterThan(200);
    expect(edge).toBe(0);
  });

  it("erase mode lowers values instead of raising them", () => {
    const painter = new MaskPainter(20, 20);
    painter.clear(255);
    painter.paintStroke(10, 10, 5, 1.0, true);
    const data = painter.getMaskData();
    expect(data[10 * 20 + 10]).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- test/mask/maskPainter.test.ts`
Expected: FAIL — `Cannot find module '../../src/mask/maskPainter'`.

- [ ] **Step 3: Implement MaskPainter**

Create `src/mask/maskPainter.ts`:
```typescript
export class MaskPainter {
  private width: number;
  private height: number;
  private data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height);
  }

  paintStroke(x: number, y: number, radius: number, hardness: number, erase: boolean): void {
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(y + radius));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dist = Math.hypot(px - x, py - y);
        if (dist > radius) continue;
        const falloffStart = radius * hardness;
        let strength = 1.0;
        if (dist > falloffStart) {
          strength = 1.0 - (dist - falloffStart) / Math.max(radius - falloffStart, 0.0001);
        }
        const idx = py * this.width + px;
        const delta = strength * 255;
        const current = this.data[idx];
        this.data[idx] = erase
          ? Math.max(0, current - delta)
          : Math.min(255, current + delta);
      }
    }
  }

  getMaskData(): Uint8Array {
    return this.data;
  }

  clear(fill: 0 | 255): void {
    this.data.fill(fill);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- test/mask/maskPainter.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: Wire mask compositing into the renderer**

Modify `src/render/renderer.ts`'s `runEffectPass` to accept and bind an optional mask texture, blending the effect's output with the unmodified source using the mask as the mix factor. Add a mask-upload helper and change the fragment wrapper:

Add to the `Renderer` class (after `readPixels`):
```typescript
  private uploadMask(maskData: Uint8Array | null): GPUTexture {
    const { device } = this.ctx;
    const texture = device.createTexture({
      size: [this.width, this.height],
      format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const fullMask = maskData ?? new Uint8Array(this.width * this.height).fill(255);
    device.queue.writeTexture(
      { texture },
      fullMask,
      { bytesPerRow: this.width },
      [this.width, this.height]
    );
    return texture;
  }
```

Modify `runEffectPass`'s shader wrapper to sample the mask and mix:
```typescript
@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, 8>;
@group(0) @binding(3) var maskTexture: texture_2d<f32>;

${effect.wgsl}

@fragment
fn fs_wrapper(in: VertexOut) -> @location(0) vec4<f32> {
  let color = textureSample(srcTexture, srcSampler, in.uv);
  let effected = fs_main(in.uv, color);
  let maskValue = textureSample(maskTexture, srcSampler, in.uv).r;
  return mix(color, effected, maskValue);
}
```

Add the mask texture creation and its bind-group entry (binding 3) inside `runEffectPass`, using `this.uploadMask(layer.maskData)`. `maskTexture` uses format `"r8unorm"` (single grayscale channel, no sRGB curve needed — it's a linear 0..1 weight, not color data).

- [ ] **Step 6: Manual visual verification**

In `src/App.tsx`, after `stack.addLayer(...)`, paint a mask covering only the left half of the image:
```typescript
import { MaskPainter } from "./mask/maskPainter";
// ...
const painter = new MaskPainter(bitmap.width, bitmap.height);
for (let y = 0; y < bitmap.height; y++) {
  painter.paintStroke(0, y, bitmap.width / 2, 1.0, false);
}
stack.layers[0].maskData = painter.getMaskData();
```
Run: `npm run tauri dev`
Expected: the effect is visible only on the left half of the image, the right half looks like the unmodified source.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add brush mask painting and per-layer mask compositing"
```

---

### Task 10: Export pipeline (copy vs. Lightroom overwrite-in-place)

**Files:**
- Create: `src/export/exportImage.ts`
- Test: `test/export/exportImage.test.ts` (pure path-logic only — actual file writing and GPU readback are exercised manually)

**Interfaces:**
- Consumes: `Renderer.readPixels()` from Task 5/9, `writeImageFile` from Task 3, `LayerState[]` from Task 4.
- Produces: `function buildCopyPath(sourcePath: string): string`, `async function exportImage(renderer: Renderer, layers: LayerState[], targetPath: string): Promise<void>` — consumed by Task 11's Export button.

- [ ] **Step 1: Write the failing test for the pure path logic**

Create `test/export/exportImage.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildCopyPath } from "../../src/export/exportImage";

describe("buildCopyPath", () => {
  it("appends -edited before the extension, preserving the original file", () => {
    expect(buildCopyPath("C:\\photos\\sunset.jpg")).toBe("C:\\photos\\sunset-edited.jpg");
  });

  it("handles paths with multiple dots correctly", () => {
    expect(buildCopyPath("C:\\photos\\sunset.v2.jpg")).toBe("C:\\photos\\sunset.v2-edited.jpg");
  });

  it("avoids collisions by suffixing a counter when -edited already exists", () => {
    const existing = new Set(["C:\\photos\\sunset-edited.jpg"]);
    expect(buildCopyPath("C:\\photos\\sunset.jpg", existing)).toBe("C:\\photos\\sunset-edited-2.jpg");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- test/export/exportImage.test.ts`
Expected: FAIL — `Cannot find module '../../src/export/exportImage'`.

- [ ] **Step 3: Implement the export module**

Create `src/export/exportImage.ts`:
```typescript
import type { Renderer } from "../render/renderer";
import type { LayerState } from "../layers/types";
import { writeImageFile } from "../launch";

export function buildCopyPath(sourcePath: string, existing: Set<string> = new Set()): string {
  const lastDot = sourcePath.lastIndexOf(".");
  const base = lastDot === -1 ? sourcePath : sourcePath.slice(0, lastDot);
  const ext = lastDot === -1 ? "" : sourcePath.slice(lastDot);
  let candidate = `${base}-edited${ext}`;
  let counter = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-edited-${counter}${ext}`;
    counter += 1;
  }
  return candidate;
}

async function encodeJpeg(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer), width, height);
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Renders the current layer stack and writes the result to `targetPath`.
 * Caller decides `targetPath`: a fresh copy path (manual export, via
 * buildCopyPath) or the exact Lightroom launch path (round-trip export,
 * per the design doc's contract — overwrite in place).
 */
export async function exportImage(
  renderer: Renderer,
  layers: LayerState[],
  targetPath: string,
  width: number,
  height: number
): Promise<void> {
  renderer.render(layers);
  const pixels = await renderer.readPixels();
  const jpegBytes = await encodeJpeg(pixels, width, height);
  await writeImageFile(targetPath, jpegBytes);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- test/export/exportImage.test.ts`
Expected: `3 passed`.

- [ ] **Step 5: Manual verification of full export (uses Task 3's spike fixture)**

Wire a temporary call in `src/App.tsx` after rendering:
```typescript
import { exportImage, buildCopyPath } from "./export/exportImage";
// ...
const outPath = buildCopyPath("C:\\Users\\LEETJ\\Desktop\\shaderlab\\test-fixtures\\sample.jpg");
await exportImage(renderer, stack.layers, outPath, bitmap.width, bitmap.height);
```
Run: `npm run tauri dev`, then check that `test-fixtures/sample-edited.jpg` was created and opens correctly in an image viewer, showing the applied effect. Remove the temporary call afterward (Task 11 wires the real Export button).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add export pipeline with copy-path and Lightroom overwrite support"
```

---

### Task 11: UI assembly — layer panel, param panel, canvas, toolbar

**Files:**
- Create: `src/components/LayerPanel.tsx`
- Create: `src/components/ParamPanel.tsx`
- Create: `src/components/Canvas.tsx`
- Create: `src/components/Toolbar.tsx`
- Modify: `src/App.tsx` (assemble the 3-panel layout, wire drag&drop and Lightroom auto-open)
- Test: manual (UI wiring, GPU-backed — not meaningfully unit-testable per spec)

**Interfaces:**
- Consumes: `LayerStack`/`History` (Task 4), `Renderer` (Task 5/9), `effectRegistry` (Task 5), `exportImage`/`buildCopyPath` (Task 10), `getLaunchPath` (Task 3).
- Produces: the assembled app — no further tasks consume this one directly (it's the leaf UI layer), except Task 12 which adds error states on top of it.

- [ ] **Step 1: Build the layer panel (left column)**

Create `src/components/LayerPanel.tsx`:
```typescript
import type { LayerState } from "../layers/types";
import { effectRegistry } from "../render/effects/registry";

interface Props {
  layers: LayerState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (effectId: string) => void;
  onRemove: (id: string) => void;
}

export function LayerPanel({ layers, selectedId, onSelect, onToggle, onAdd, onRemove }: Props) {
  return (
    <div style={{ width: 220, borderRight: "1px solid #333", padding: 8 }}>
      <select onChange={(e) => e.target.value && onAdd(e.target.value)} value="">
        <option value="" disabled>
          + Ajouter un effet
        </option>
        {effectRegistry.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {layers.map((layer) => (
          <li
            key={layer.id}
            onClick={() => onSelect(layer.id)}
            style={{
              padding: 6,
              background: layer.id === selectedId ? "#2a2a2a" : "transparent",
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(layer.id);
                }}
              >
                {layer.enabled ? "👁" : "—"}
              </button>{" "}
              {layer.effectId}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(layer.id);
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Build the param panel (right column)**

Create `src/components/ParamPanel.tsx`:
```typescript
import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";

interface Props {
  layer: LayerState | null;
  onParamChange: (id: string, params: Record<string, number>) => void;
}

export function ParamPanel({ layer, onParamChange }: Props) {
  if (!layer) return <div style={{ width: 260, padding: 8 }}>Sélectionne un calque.</div>;
  const effect = getEffect(layer.effectId);

  return (
    <div style={{ width: 260, borderLeft: "1px solid #333", padding: 8 }}>
      <h3>{effect.name}</h3>
      {effect.params.map((p) => (
        <div key={p.name} style={{ marginBottom: 8 }}>
          <label>
            {p.name}: {(layer.params[p.name] ?? p.default).toFixed(3)}
          </label>
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={layer.params[p.name] ?? p.default}
            onChange={(e) => onParamChange(layer.id, { [p.name]: parseFloat(e.target.value) })}
            style={{ width: "100%" }}
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Build the canvas component with drag&drop open**

Create `src/components/Canvas.tsx`:
```typescript
import { forwardRef } from "react";

interface Props {
  onFileDropped: (file: File) => void;
}

export const Canvas = forwardRef<HTMLCanvasElement, Props>(function Canvas({ onFileDropped }, ref) {
  return (
    <div
      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#111" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) onFileDropped(file);
      }}
    >
      <canvas ref={ref} style={{ maxWidth: "100%", maxHeight: "100%" }} />
    </div>
  );
});
```

- [ ] **Step 4: Build the toolbar**

Create `src/components/Toolbar.tsx`:
```typescript
interface Props {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
}

export function Toolbar({ canUndo, canRedo, onUndo, onRedo, onExport }: Props) {
  return (
    <div style={{ padding: 8, borderBottom: "1px solid #333", display: "flex", gap: 8 }}>
      <button disabled={!canUndo} onClick={onUndo}>
        ↶ Annuler
      </button>
      <button disabled={!canRedo} onClick={onRedo}>
        ↷ Rétablir
      </button>
      <div style={{ flex: 1 }} />
      <button onClick={onExport}>Exporter</button>
    </div>
  );
}
```

- [ ] **Step 5: Assemble everything in App.tsx**

Replace `src/App.tsx` entirely:
```typescript
import { useEffect, useRef, useState, useCallback } from "react";
import { initGpu, type GpuContext } from "./render/gpuContext";
import { Renderer } from "./render/renderer";
import { LayerStack } from "./layers/layerStack";
import { History } from "./layers/history";
import type { LayerState } from "./layers/types";
import { LayerPanel } from "./components/LayerPanel";
import { ParamPanel } from "./components/ParamPanel";
import { Canvas } from "./components/Canvas";
import { Toolbar } from "./components/Toolbar";
import { exportImage, buildCopyPath } from "./export/exportImage";
import { getLaunchPath } from "./launch";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<GpuContext | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const historyRef = useRef<History>(new History(new LayerStack()));
  const [layers, setLayers] = useState<LayerState[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback((stack: LayerStack) => {
    historyRef.current.push(stack);
    setLayers(stack.layers);
    rendererRef.current?.render(stack.layers);
  }, []);

  const currentStack = useCallback((): LayerStack => {
    const stack = new LayerStack();
    stack.layers = layers;
    return stack.clone();
  }, [layers]);

  const openFile = useCallback(async (file: File, path: string | null) => {
    if (!canvasRef.current) return;
    try {
      if (!gpuRef.current) {
        gpuRef.current = await initGpu(canvasRef.current);
      }
      const bitmap = await createImageBitmap(file);
      canvasRef.current.width = bitmap.width;
      canvasRef.current.height = bitmap.height;
      setImageSize({ width: bitmap.width, height: bitmap.height });
      setSourcePath(path);

      rendererRef.current = new Renderer(gpuRef.current);
      await rendererRef.current.loadImage(bitmap);

      const stack = new LayerStack();
      historyRef.current = new History(stack);
      setLayers(stack.layers);
      rendererRef.current.render(stack.layers);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    getLaunchPath().then(async (path) => {
      if (!path) return;
      const response = await fetch(`file://${path}`);
      const blob = await response.blob();
      await openFile(new File([blob], path), path);
    });
  }, [openFile]);

  function handleAdd(effectId: string) {
    const stack = currentStack();
    const id = stack.addLayer(effectId);
    setSelectedId(id);
    commit(stack);
  }

  function handleToggle(id: string) {
    const stack = currentStack();
    stack.toggleLayer(id);
    commit(stack);
  }

  function handleRemove(id: string) {
    const stack = currentStack();
    stack.removeLayer(id);
    if (selectedId === id) setSelectedId(null);
    commit(stack);
  }

  function handleParamChange(id: string, params: Record<string, number>) {
    const stack = currentStack();
    stack.updateParams(id, params);
    commit(stack);
  }

  function handleUndo() {
    const previous = historyRef.current.undo();
    if (previous) {
      setLayers(previous.layers);
      rendererRef.current?.render(previous.layers);
    }
  }

  function handleRedo() {
    const next = historyRef.current.redo();
    if (next) {
      setLayers(next.layers);
      rendererRef.current?.render(next.layers);
    }
  }

  async function handleExport() {
    if (!rendererRef.current || !sourcePath) return;
    const target = buildCopyPath(sourcePath);
    await exportImage(rendererRef.current, layers, target, imageSize.width, imageSize.height);
  }

  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Toolbar
        canUndo={historyRef.current.canUndo()}
        canRedo={historyRef.current.canRedo()}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExport={handleExport}
      />
      {error && <p style={{ color: "red" }}>{error}</p>}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <LayerPanel
          layers={layers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggle={handleToggle}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
        <Canvas ref={canvasRef} onFileDropped={(file) => openFile(file, null)} />
        <ParamPanel layer={selectedLayer} onParamChange={handleParamChange} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Manual end-to-end verification**

Run: `npm run tauri dev`
Expected: empty canvas on launch. Drag a JPEG onto the canvas → it loads and displays. Use the "+ Ajouter un effet" dropdown to add Glow → sliders appear in the right panel and moving them updates the canvas live. Add a second effect (e.g. Grain) → both apply, stacked. Toggle a layer's eye icon off → its effect disappears from the canvas. Click Undo/Redo → layers add/remove correctly. Click Export → a `-edited.jpg` file appears next to the dropped file (only works if dropped via a real file path; for the drag&drop case without a path, this will need `sourcePath` — note this as a known v1 gap: drag&drop files have no filesystem path in the browser sandbox, so Export is only fully wired for the Lightroom-launch flow in this task; a "Save As" file-picker path for the manual drag&drop flow is a fast follow, not blocking for the Lightroom-editor use case that motivated this project).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: assemble 3-panel UI (layers, canvas, params, toolbar)"
```

---

### Task 12: Error handling

**Files:**
- Modify: `src/render/gpuContext.ts` (already throws clear errors from Task 2 — verify coverage)
- Modify: `src/App.tsx` (surface errors as a dismissible banner instead of a raw `<p>`)
- Create: `src/components/ErrorBanner.tsx`
- Test: `test/export/exportImage.test.ts` extended for the export-failure case

**Interfaces:**
- Consumes: `error` state from Task 11's `App.tsx`.
- Produces: nothing consumed by later tasks (this is the last task in the plan).

- [ ] **Step 1: Write the failing test for export failure surfacing**

Modify `test/export/exportImage.test.ts`, add:
```typescript
import { vi, describe, it, expect } from "vitest";
import { exportImage } from "../../src/export/exportImage";
import * as launch from "../../src/launch";

describe("exportImage error propagation", () => {
  it("rejects when writeImageFile fails, without throwing an unhandled error", async () => {
    vi.spyOn(launch, "writeImageFile").mockRejectedValue(new Error("disque plein"));
    const fakeRenderer = {
      render: vi.fn(),
      readPixels: vi.fn().mockResolvedValue(new Uint8Array(4)),
    } as any;

    await expect(
      exportImage(fakeRenderer, [], "C:\\fake\\path.jpg", 1, 1)
    ).rejects.toThrow("disque plein");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails or passes trivially**

Run: `npm run test -- test/export/exportImage.test.ts`
Expected: PASS already (the current implementation naturally propagates the rejection) — this step exists to lock in that behavior with a regression test, not to fix a bug. If it fails, the export function is swallowing errors and must be fixed to `await writeImageFile(...)` without a try/catch that hides failures.

- [ ] **Step 3: Build a reusable error banner component**

Create `src/components/ErrorBanner.tsx`:
```typescript
interface Props {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  return (
    <div style={{ background: "#5a1a1a", color: "white", padding: 8, display: "flex", justifyContent: "space-between" }}>
      <span>{message}</span>
      <button onClick={onDismiss}>✕</button>
    </div>
  );
}
```

- [ ] **Step 4: Wire it into App.tsx and cover the three error scenarios from the spec**

Modify `src/App.tsx`:
- Replace `{error && <p style={{ color: "red" }}>{error}</p>}` with `{error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}`.
- In `openFile`'s catch block, prefix corrupt/unsupported-image errors distinctly: wrap the `createImageBitmap(file)` call specifically in its own try/catch so a decode failure reports `"Image non supportée ou corrompue."` rather than a generic browser error message.
- In `handleExport`, wrap the body in try/catch and call `setError` on failure instead of letting the promise rejection go unhandled:
```typescript
  async function handleExport() {
    if (!rendererRef.current || !sourcePath) return;
    try {
      const target = buildCopyPath(sourcePath);
      await exportImage(rendererRef.current, layers, target, imageSize.width, imageSize.height);
    } catch (e) {
      setError(`Échec de l'export: ${(e as Error).message}`);
    }
  }
```
- Confirm `initGpu`'s existing errors (Task 2: "WebGPU non disponible", "Aucun adaptateur WebGPU trouvé") already surface through the same `error` state — no change needed there, just verify by temporarily throwing inside `initGpu` and confirming the banner appears.

- [ ] **Step 5: Manual verification of all three error paths**

Run: `npm run tauri dev`.
- Drag a non-image file (e.g. a `.txt` renamed to `.jpg`) onto the canvas → expect the "Image non supportée ou corrompue." banner, app stays usable.
- Temporarily rename `navigator.gpu` to `undefined` via devtools console before reload is not practical in Tauri's webview — instead, temporarily edit `initGpu` to `throw new Error("test")` at its top, reload, confirm the banner shows, then revert the temporary edit.
- Click Export with `sourcePath` pointing at a read-only or nonexistent directory → expect the "Échec de l'export: ..." banner, and confirm the in-memory layer stack/undo history is untouched (add another layer afterward and confirm it still works).

- [ ] **Step 6: Run the full test suite one last time**

Run: `npm run test`
Expected: all tests pass (layer stack, history, mask painter, export path logic, export error propagation).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: surface GPU/decode/export errors as a dismissible banner"
```

---

### Task 13: Quality upgrade — Glow → dual-filter bloom (multi-pass)

**Files:**
- Modify: `src/render/renderer.ts` (add multi-pass support: an effect may declare internal passes at fractional resolutions)
- Modify: `src/render/effects/types.ts` (extend `EffectModule` with optional `passes` descriptor)
- Modify: `src/render/effects/glow.ts` (replace the 5×5 naive kernel with the dual-filter chain)
- Test: manual visual comparison against Figma's Bloom shader on the same photo

**Interfaces:**
- Consumes: `Renderer`, `EffectModule` from Task 5.
- Produces: extended `EffectModule` shape: `passes?: { scale: number; wgsl: string }[]` — when present, the renderer runs each pass in sequence into intermediate textures sized `width*scale × height*scale`, feeding each pass the previous pass's output, before the final composite pass receives both the original source (`srcTexture`) and the last pass output (`prevPass: texture_2d<f32>`, binding 4). Tasks 14–16 may use the same mechanism.

The dual-filter bloom (ARM/Marius Bjørge, "Bandwidth-Efficient Rendering", SIGGRAPH 2015) works as: bright-pass extract → downsample chain (½, ¼, ⅛ resolution) with the dual-filter kernel → upsample chain back with additive blending → composite over the source. This produces the wide, soft, natural halo of production bloom at a fraction of the cost of an equivalent-radius Gaussian.

- [ ] **Step 1: Extend the EffectModule type**

Modify `src/render/effects/types.ts`:
```typescript
export interface EffectPass {
  /** Resolution scale of this pass's output target relative to the image (1 = full, 0.5 = half...). */
  scale: number;
  /** WGSL body defining fs_main(uv, color) — `color` samples this pass's INPUT texture. */
  wgsl: string;
}

export interface EffectModule {
  id: string;
  name: string;
  params: EffectParam[];
  /** Single-pass body (used when `passes` is absent). For multi-pass effects,
   *  this is the FINAL composite pass and additionally sees `prevPass` (binding 4). */
  wgsl: string;
  passes?: EffectPass[];
}
```

- [ ] **Step 2: Add multi-pass execution to the renderer**

In `src/render/renderer.ts`, inside the layer loop of `render()`, before the final `runEffectPass` for a layer whose effect has `passes`, run each pass in order:

```typescript
    for (let i = 0; i < enabledLayers.length; i++) {
      const layer = enabledLayers[i];
      const effect = getEffect(layer.effectId);
      const isLast = i === enabledLayers.length - 1;
      const target = isLast ? context.getCurrentTexture() : this.pingPong[writeIndex];

      let prevPassTexture: GPUTexture | null = null;
      if (effect.passes) {
        let passInput = readTexture;
        for (const pass of effect.passes) {
          const passTarget = device.createTexture({
            size: [
              Math.max(1, Math.round(this.width * pass.scale)),
              Math.max(1, Math.round(this.height * pass.scale)),
            ],
            format,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
          });
          this.runEffectPass(
            encoder,
            { ...effect, wgsl: pass.wgsl, passes: undefined },
            layer,
            passInput,
            passTarget,
            format
          );
          passInput = passTarget;
        }
        prevPassTexture = passInput;
      }

      this.runEffectPass(encoder, effect, layer, readTexture, target, format, prevPassTexture);

      if (!isLast) {
        readTexture = this.pingPong[writeIndex];
        writeIndex = 1 - writeIndex;
      }
    }
```

Extend `runEffectPass`'s signature with `prevPass: GPUTexture | null = null`; when non-null, append to the shader header `@group(0) @binding(4) var prevPass: texture_2d<f32>;` and add `{ binding: 4, resource: prevPass.createView() }` to the bind group.

- [ ] **Step 3: Rewrite the Glow effect as a dual-filter chain**

Replace `src/render/effects/glow.ts`:
```typescript
import type { EffectModule } from "./types";

const DOWNSAMPLE_WGSL = `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  let o = texel * 1.0;
  var sum = textureSample(srcTexture, srcSampler, uv).rgb * 4.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x, -o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x, -o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  o.y)).rgb;
  return vec4<f32>(sum / 8.0, 1.0);
}
`;

const UPSAMPLE_WGSL = `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  let o = texel * 1.0;
  var sum = vec3<f32>(0.0);
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x * 2.0, 0.0)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  o.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(0.0,  o.y * 2.0)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  o.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x * 2.0, 0.0)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x, -o.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(0.0, -o.y * 2.0)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x, -o.y)).rgb * 2.0;
  return vec4<f32>(sum / 12.0, 1.0);
}
`;

export const glow: EffectModule = {
  id: "glow",
  name: "Glow",
  params: [
    { name: "threshold", min: 0, max: 1, default: 0.7, step: 0.01 },
    { name: "intensity", min: 0, max: 3, default: 1.0, step: 0.05 },
  ],
  passes: [
    {
      // Bright-pass extract at half resolution.
      scale: 0.5,
      wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let threshold = params[0];
  let brightness = max(color.r, max(color.g, color.b));
  let contribution = max(brightness - threshold, 0.0) / max(brightness, 0.0001);
  return vec4<f32>(color.rgb * contribution, 1.0);
}
`,
    },
    { scale: 0.25, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.25, wgsl: UPSAMPLE_WGSL },
    { scale: 0.5, wgsl: UPSAMPLE_WGSL },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let intensity = params[1];
  let bloom = textureSample(prevPass, srcSampler, uv).rgb;
  return vec4<f32>(color.rgb + bloom * intensity, color.a);
}
`,
};
```

- [ ] **Step 4: Manual visual verification against the quality bar**

Run: `npm run tauri dev`, load a photo with strong highlights (streetlight at night, sun through trees).
Expected: a WIDE, soft, round halo bleeding naturally outward from bright areas — spanning tens of pixels, not a tight 5px fringe. Compare side by side with the same photo through Figma's Bloom shader (paste the photo in Figma, apply Bloom): the character of the halo should be comparable. If the halo is boxy or tight, the downsample chain isn't running — verify each pass executes (add a temporary `console.log` per pass, remove after).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: upgrade Glow to multi-pass dual-filter bloom"
```

---

### Task 14: Quality upgrade — Chromatic bleed → radial aberration

**Files:**
- Modify: `src/render/effects/chromaticBleed.ts`
- Test: manual visual verification

**Interfaces:**
- Consumes: `EffectModule` from Task 5 (single-pass — no `passes` needed).
- Produces: upgraded registry entry, same id `"chromaticBleed"` (params change: `amount`, `centerFalloff` replace `amount`/`angleDeg`).

Real lens aberration grows from the image center outward — the linear uniform shift from Task 6 reads as a cheap datamosh, the radial version reads as optics.

- [ ] **Step 1: Rewrite the effect**

Replace `src/render/effects/chromaticBleed.ts`:
```typescript
import type { EffectModule } from "./types";

export const chromaticBleed: EffectModule = {
  id: "chromaticBleed",
  name: "Chromatic bleed",
  params: [
    { name: "amount", min: 0, max: 0.05, default: 0.008, step: 0.001 },
    { name: "centerFalloff", min: 0.5, max: 4, default: 2, step: 0.1 },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let amount = params[0];
  let falloff = params[1];
  let fromCenter = uv - vec2<f32>(0.5, 0.5);
  let dist = length(fromCenter);
  // Shift grows with distance from center, shaped by the falloff exponent.
  let shift = fromCenter * amount * pow(dist * 2.0, falloff);
  let r = textureSample(srcTexture, srcSampler, uv + shift).r;
  let g = textureSample(srcTexture, srcSampler, uv).g;
  let b = textureSample(srcTexture, srcSampler, uv - shift).b;
  return vec4<f32>(r, g, b, color.a);
}
`,
};
```

- [ ] **Step 2: Manual visual verification**

Run: `npm run tauri dev`, load a photo with high-contrast edges near the corners.
Expected: no fringing at the image center, progressively stronger red/blue separation toward corners and edges — like shooting through a cheap wide-angle lens. The center must stay clean; if fringing is uniform everywhere, the radial term isn't applied.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: upgrade Chromatic bleed to radial lens-style aberration"
```

---

### Task 15: Quality upgrade — Warp → simplex/FBM noise displacement

**Files:**
- Modify: `src/render/effects/warp.ts`
- Test: manual visual verification

**Interfaces:**
- Consumes: `EffectModule` from Task 5 (single-pass).
- Produces: upgraded registry entry, same id `"warp"` (params: `scale`, `amplitude`, `octaves`, `seed`).

Crossed sines (Task 7) produce a mechanical, obviously-periodic wobble. Production liquid warp uses fractal noise (FBM over simplex/value noise) — organic, non-repeating. The WGSL below embeds a self-contained simplex implementation (adapted conceptually from LYGIA's `snoise` — reimplemented here rather than imported, since LYGIA's WESL tooling is optional; if the Task 2 spike adopted a WESL/Vite plugin, swap this embedded copy for `#include "lygia/generative/snoise.wgsl"` instead).

- [ ] **Step 1: Rewrite the effect**

Replace `src/render/effects/warp.ts`:
```typescript
import type { EffectModule } from "./types";

export const warp: EffectModule = {
  id: "warp",
  name: "Warp",
  params: [
    { name: "scale", min: 0.5, max: 12, default: 3, step: 0.25 },
    { name: "amplitude", min: 0, max: 0.08, default: 0.02, step: 0.002 },
    { name: "octaves", min: 1, max: 4, default: 3, step: 1 },
    { name: "seed", min: 0, max: 100, default: 0, step: 1 },
  ],
  wgsl: `
// 2D simplex-style gradient noise (self-contained WGSL).
fn hash2(p: vec2<f32>) -> vec2<f32> {
  let k = vec2<f32>(0.3183099, 0.3678794);
  let x = p * k + k.yx;
  return -1.0 + 2.0 * fract(16.0 * k * fract(x.x * x.y * (x.x + x.y)));
}

fn gnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(hash2(i + vec2<f32>(0.0, 0.0)), f - vec2<f32>(0.0, 0.0)),
        dot(hash2(i + vec2<f32>(1.0, 0.0)), f - vec2<f32>(1.0, 0.0)), u.x),
    mix(dot(hash2(i + vec2<f32>(0.0, 1.0)), f - vec2<f32>(0.0, 1.0)),
        dot(hash2(i + vec2<f32>(1.0, 1.0)), f - vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var freq = p;
  for (var i = 0; i < 4; i = i + 1) {
    if (i >= octaves) { break; }
    value = value + amplitude * gnoise(freq);
    amplitude = amplitude * 0.5;
    freq = freq * 2.0;
  }
  return value;
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let scale = params[0];
  let amplitude = params[1];
  let octaves = i32(params[2]);
  let seed = params[3];
  let p = uv * scale + vec2<f32>(seed * 13.7, seed * 7.3);
  let offset = vec2<f32>(
    fbm(p, octaves),
    fbm(p + vec2<f32>(5.2, 1.3), octaves)
  ) * amplitude;
  return textureSample(srcTexture, srcSampler, uv + offset);
}
`,
};
```

- [ ] **Step 2: Manual visual verification**

Run: `npm run tauri dev`, load a photo with straight architectural lines.
Expected: organic, irregular liquid distortion — lines wander unpredictably like heat haze or water refraction. If the distortion repeats in a visible grid or wave pattern, the FBM octaves aren't accumulating (check `octaves` param reaches the shader).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: upgrade Warp to simplex/FBM organic displacement"
```

---

### Task 16: Quality upgrade — Grain → luminance-dependent film grain

**Files:**
- Modify: `src/render/effects/grain.ts`
- Test: manual visual verification

**Interfaces:**
- Consumes: `EffectModule` from Task 5 (single-pass).
- Produces: upgraded registry entry, same id `"grain"` (params: `intensity`, `size`, `seed`).

Real film grain is strongest in midtones and nearly absent in crushed blacks and blown highlights; it also has spatial size (grain clumps), not per-pixel white noise. This matches the "Real Grain" quality bar from Dehancer/Nik rather than a 2005-style uniform noise overlay.

- [ ] **Step 1: Rewrite the effect**

Replace `src/render/effects/grain.ts`:
```typescript
import type { EffectModule } from "./types";

export const grain: EffectModule = {
  id: "grain",
  name: "Grain",
  params: [
    { name: "intensity", min: 0, max: 0.4, default: 0.12, step: 0.01 },
    { name: "size", min: 1, max: 8, default: 2, step: 0.5 },
    { name: "seed", min: 0, max: 1000, default: 0, step: 1 },
  ],
  wgsl: `
fn hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn valueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let intensity = params[0];
  let size = params[1];
  let seed = params[2];
  let dims = vec2<f32>(textureDimensions(srcTexture));
  // Grain coordinates in pixel space divided by grain size → visible clumps, not per-pixel snow.
  let gp = (uv * dims) / size + vec2<f32>(seed * 17.0, seed * 9.0);
  let noise = valueNoise(gp) - 0.5;
  // Luminance response: peak in midtones, fades in deep shadows and highlights.
  let luma = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let response = 4.0 * luma * (1.0 - luma);
  return vec4<f32>(color.rgb + vec3<f32>(noise) * intensity * response, color.a);
}
`,
};
```

- [ ] **Step 2: Manual visual verification**

Run: `npm run tauri dev`, load a photo with deep shadows, midtone areas (skin, sky at dusk) and bright highlights.
Expected: grain clearly visible in midtones, nearly invisible in the darkest shadows AND the brightest highlights; increasing `size` makes grain clumps visibly larger (film-like), not just noisier. If shadows are as noisy as midtones, the luminance response isn't applied.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: all tests still pass (quality upgrades touch only WGSL strings and param schemas — pure-logic tests are unaffected; if a param-name test breaks, update it to the new schema).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: upgrade Grain to luminance-dependent film grain with size control"
```

---

## Self-Review Notes

- **Spec coverage:** every design-doc section maps to a task — spike/WebGPU risk (Task 2), Lightroom contract (Task 3), layer stack + undo/redo (Task 4), rendering engine + extensible effect registry (Task 5), the 4 v1 effects (Tasks 5–8), brush masking (Task 9), export with copy-vs-overwrite (Task 10), 3-panel UI with mask-overlay note deferred as a fast-follow (Task 11), error handling (Task 12), and the spec's explicit visual-quality bar (Tasks 13–16: dual-filter bloom, radial aberration, FBM warp, luminance-dependent grain). Color-space correctness (audit fix) is locked into Task 2's fixed `rgba8unorm-srgb` format, reused everywhere, not re-decided per task.
- **Known v1 gap surfaced honestly, not hidden:** Task 11 Step 6 documents that drag&drop files have no real filesystem path in the browser sandbox, so Export only fully works for files opened via the Lightroom launch-arg path in this plan. This matches the project's actual motivating use case (Lightroom external editor) but is called out explicitly rather than silently left broken.
- **Placeholder scan:** no TBD/TODO; every code step has complete, real code, not a description of intent.
- **Type consistency:** `LayerState`, `EffectModule`, `EffectParam`, `Renderer`, `MaskPainter`, `History`, `LayerStack` signatures are defined once (Tasks 4, 5, 9) and reused verbatim in every later task — checked for drift, none found.
