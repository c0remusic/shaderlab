# Panneaux contextuels (Réglages/Masque) + rail d'icônes + ColorPickerPanel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible Calques/Réglages/Masque dock panels with panels whose visibility is driven by an automatic condition (has a selected layer) that a user can manually override via a titlebar close (X) or a new icon rail — plus add an inline HSL color picker to the duotone `ColorGroupControl` swatch.

**Architecture:** A single generic hook `useContextualPanel(conditionMet, triggerKey)` owns one `{key, override}` pair of state and computes `visible`. `App.tsx` instantiates it 3 times (Calques/Réglages/Masque), filters the `panels` array passed to the existing `PanelColumn` before rendering, and renders a new `PanelRail` alongside the dock. `ColorPickerPanel` is a separate, simpler `useState` in `App.tsx` (single consumer, trivial condition — not routed through the generic hook). No existing docked-panel file (`PanelColumn.tsx`, `DockedPanelCard.tsx`, `dockLayout.ts`, `dockWidth.ts`) changes.

**Tech Stack:** React 19 + TypeScript, Vitest (Node environment, no test renders a React component — this project's fixed convention), lucide-react icons, `@base-ui/react` primitives (`Button`), Tailwind v4 utility classes + the project's CSS custom-property tokens.

## Global Constraints

- No test in this repo renders a React component (Node-environment Vitest only) — `contextualPanel.ts` must be a plain state-machine module (exported pure functions + a thin `useState` wrapper), testable by calling the pure functions directly, exactly like `src/ui/activeControl.ts`'s `getActiveControl`/`wheelTickValue`. Do NOT use `@testing-library/react`'s `renderHook` — it is not a project dependency.
- `useContextualPanel` state is ONE `{key, override}` pair, never a `Map<triggerKey, override>` — a stale override for a previously-visited `triggerKey` is intentionally forgotten once the `triggerKey` changes.
- `PanelColumn.tsx`, `DockedPanelCard.tsx`, `src/ui/dockLayout.ts`, `src/components/dockedPanel/dockWidth.ts` are NOT modified by this plan.
- No `dockLayout`/panel-visibility persistence beyond the current in-memory session (`useState`, no `localStorage`).
- Colors/spacing/radii: reuse existing tokens already used by sibling components in this diff's files (`--radius-control`, `--surface-selected`, `--surface-active`, `border-border`, `text-muted-foreground`, `bg-muted`) — no new hardcoded literal that duplicates an existing token family.
- Every interactive element ≥ existing `IconButton` `size="default"`/`"compact"` (`--control-height-md`/`--control-height-sm`) — reuse `IconButton`, do not invent a new button primitive.
- `ColorPickerPanel` guards against a stale `layerId` on every render (`colorPicker && selectedLayer?.id === colorPicker.layerId`), not just at open time.

---

### Task 1: `useContextualPanel` hook (pure state machine + tests)

**Files:**
- Create: `src/ui/contextualPanel.ts`
- Test: `test/ui/contextualPanel.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no other project code).
- Produces:
  ```ts
  export type PanelOverride = "open" | "closed";
  export interface ContextualPanelState {
    key: string | null;
    override: PanelOverride | null;
  }
  export function computeVisible(state: ContextualPanelState, conditionMet: boolean, triggerKey: string | null): boolean;
  export function dismiss(triggerKey: string | null): ContextualPanelState;
  export function toggleRail(state: ContextualPanelState, conditionMet: boolean, triggerKey: string | null): ContextualPanelState;
  export function useContextualPanel(conditionMet: boolean, triggerKey: string | null): { visible: boolean; dismiss: () => void; toggleRail: () => void };
  ```
  Later tasks (`App.tsx`, `PanelRail`) consume only `useContextualPanel`'s return shape: `{ visible: boolean; dismiss: () => void; toggleRail: () => void }`.

- [ ] **Step 1: Write the failing tests for the pure functions**

```ts
// test/ui/contextualPanel.test.ts
import { describe, expect, it } from "vitest";
import { computeVisible, dismiss, toggleRail, type ContextualPanelState } from "../../src/ui/contextualPanel";

const NO_OVERRIDE: ContextualPanelState = { key: null, override: null };

describe("computeVisible", () => {
  it("follows conditionMet when no override has been set for this triggerKey", () => {
    expect(computeVisible(NO_OVERRIDE, true, "layer-a")).toBe(true);
    expect(computeVisible(NO_OVERRIDE, false, "layer-a")).toBe(false);
  });

  it("an override for the current triggerKey wins over conditionMet", () => {
    const closed: ContextualPanelState = { key: "layer-a", override: "closed" };
    expect(computeVisible(closed, true, "layer-a")).toBe(false);
    const open: ContextualPanelState = { key: "layer-a", override: "open" };
    expect(computeVisible(open, false, "layer-a")).toBe(true);
  });

  it("an override for a DIFFERENT triggerKey is ignored — conditionMet decides again", () => {
    const closedForA: ContextualPanelState = { key: "layer-a", override: "closed" };
    expect(computeVisible(closedForA, true, "layer-b")).toBe(true);
    expect(computeVisible(closedForA, false, "layer-b")).toBe(false);
  });

  it("a null triggerKey with no prior override follows conditionMet", () => {
    expect(computeVisible(NO_OVERRIDE, true, null)).toBe(true);
  });
});

describe("dismiss", () => {
  it("sets override to closed for the given triggerKey", () => {
    expect(dismiss("layer-a")).toEqual({ key: "layer-a", override: "closed" });
  });

  it("works with a null triggerKey (Calques' constant trigger)", () => {
    expect(dismiss(null)).toEqual({ key: null, override: "closed" });
  });
});

describe("toggleRail", () => {
  it("forces the panel open when conditionMet is false (empty state shown on demand)", () => {
    const next = toggleRail(NO_OVERRIDE, false, "layer-a");
    expect(computeVisible(next, false, "layer-a")).toBe(true);
    expect(next).toEqual({ key: "layer-a", override: "open" });
  });

  it("closes a panel that is currently visible via conditionMet alone", () => {
    const next = toggleRail(NO_OVERRIDE, true, "layer-a");
    expect(computeVisible(next, true, "layer-a")).toBe(false);
    expect(next).toEqual({ key: "layer-a", override: "closed" });
  });

  it("closes a panel currently visible via a stale open override for a different triggerKey (falls back to conditionMet-for-current-key computation before toggling)", () => {
    const openForA: ContextualPanelState = { key: "layer-a", override: "open" };
    // Switched to layer-b; conditionMet true for layer-b too, so it's visible via conditionMet, not override.
    const next = toggleRail(openForA, true, "layer-b");
    expect(computeVisible(next, true, "layer-b")).toBe(false);
    expect(next).toEqual({ key: "layer-b", override: "closed" });
  });

  it("re-opens a panel it just closed (idempotent double toggle returns to visible)", () => {
    const closed = toggleRail(NO_OVERRIDE, true, "layer-a");
    const reopened = toggleRail(closed, true, "layer-a");
    expect(computeVisible(reopened, true, "layer-a")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- test/ui/contextualPanel.test.ts`
Expected: FAIL — `src/ui/contextualPanel.ts` does not exist yet (`Cannot find module`).

- [ ] **Step 3: Implement `src/ui/contextualPanel.ts`**

```ts
import { useCallback, useState } from "react";

export type PanelOverride = "open" | "closed";

/** One remembered manual preference, valid only while `triggerKey` matches —
 *  intentionally NOT a `Map<triggerKey, override>`: switching away from a
 *  triggerKey and back does not restore an earlier override for it. */
export interface ContextualPanelState {
  key: string | null;
  override: PanelOverride | null;
}

const NO_OVERRIDE: ContextualPanelState = { key: null, override: null };

/** `visible = override === "open" || (override === null && conditionMet)` —
 *  but the override only applies when it was recorded for the SAME
 *  triggerKey currently in effect; otherwise conditionMet decides alone. */
export function computeVisible(state: ContextualPanelState, conditionMet: boolean, triggerKey: string | null): boolean {
  const overrideApplies = state.override !== null && state.key === triggerKey;
  if (overrideApplies) return state.override === "open";
  return conditionMet;
}

/** Titlebar close (X) — always records "closed" for the given triggerKey. */
export function dismiss(triggerKey: string | null): ContextualPanelState {
  return { key: triggerKey, override: "closed" };
}

/** Rail icon click — flips the CURRENT visible state (as computed from
 *  `state`/`conditionMet`/`triggerKey`), not the raw override field. */
export function toggleRail(state: ContextualPanelState, conditionMet: boolean, triggerKey: string | null): ContextualPanelState {
  const currentlyVisible = computeVisible(state, conditionMet, triggerKey);
  return { key: triggerKey, override: currentlyVisible ? "closed" : "open" };
}

export function useContextualPanel(
  conditionMet: boolean,
  triggerKey: string | null
): { visible: boolean; dismiss: () => void; toggleRail: () => void } {
  const [state, setState] = useState<ContextualPanelState>(NO_OVERRIDE);
  const visible = computeVisible(state, conditionMet, triggerKey);

  const handleDismiss = useCallback(() => {
    setState(dismiss(triggerKey));
  }, [triggerKey]);

  const handleToggleRail = useCallback(() => {
    setState((current) => toggleRail(current, conditionMet, triggerKey));
  }, [conditionMet, triggerKey]);

  return { visible, dismiss: handleDismiss, toggleRail: handleToggleRail };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- test/ui/contextualPanel.test.ts`
Expected: PASS, all 10 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/ui/contextualPanel.ts test/ui/contextualPanel.test.ts
git commit -m "feat(ui): add useContextualPanel hook (auto condition + manual override state machine)"
```

---

### Task 2: `hexToHsl` conversion (inverse of existing `hslToHex`)

**Files:**
- Modify: `src/ui/hsl.ts`
- Test: `test/ui/hsl.test.ts` (create if it does not already exist — check first with `git ls-files test/ui/hsl.test.ts`; if it exists, extend it)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function hexToHsl(hex: string): { hue: number; saturation: number; lightness: number }` — later consumed by Task 5 (`ColorPickerPanel`'s hex input field).

- [ ] **Step 1: Write the failing tests**

```ts
// Add to test/ui/hsl.test.ts (create the file with this content if it doesn't exist yet)
import { describe, expect, it } from "vitest";
import { hslToHex, hexToHsl } from "../../src/ui/hsl";

describe("hexToHsl", () => {
  it("converts pure black", () => {
    expect(hexToHsl("#000000")).toEqual({ hue: 0, saturation: 0, lightness: 0 });
  });

  it("converts pure white", () => {
    expect(hexToHsl("#ffffff")).toEqual({ hue: 0, saturation: 0, lightness: 1 });
  });

  it("converts a pure gray (s=0, hue undefined -> 0)", () => {
    expect(hexToHsl("#808080")).toEqual({ hue: 0, saturation: 0, lightness: expect.closeTo(0.502, 2) });
  });

  it("converts pure red", () => {
    const { hue, saturation, lightness } = hexToHsl("#ff0000");
    expect(hue).toBeCloseTo(0, 0);
    expect(saturation).toBeCloseTo(1, 2);
    expect(lightness).toBeCloseTo(0.5, 2);
  });

  it("round-trips through hslToHex for a sample of colors", () => {
    const samples = ["#ff8800", "#00ff88", "#8800ff", "#336699", "#deadbe"];
    for (const hex of samples) {
      const { hue, saturation, lightness } = hexToHsl(hex);
      const roundTripped = hslToHex(hue, saturation, lightness);
      expect(roundTripped).toBe(hex);
    }
  });

  it("accepts hex without a leading #", () => {
    expect(hexToHsl("ff0000").hue).toBeCloseTo(0, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- test/ui/hsl.test.ts`
Expected: FAIL — `hexToHsl` is not exported from `src/ui/hsl.ts`.

- [ ] **Step 3: Implement `hexToHsl` in `src/ui/hsl.ts`**

Append to the existing file (keep `hslToHex` unchanged):

```ts
/** Converts a "#rrggbb" (or "rrggbb") hex string to HSL (hue in degrees,
 *  saturation/lightness in 0..1) — inverse of hslToHex, used by
 *  ColorPickerPanel's hex input field. */
export function hexToHsl(hex: string): { hue: number; saturation: number; lightness: number } {
  const clean = hex.replace(/^#/, "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness };
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue: number;
  switch (max) {
    case r:
      hue = ((g - b) / delta) % 6;
      break;
    case g:
      hue = (b - r) / delta + 2;
      break;
    default:
      hue = (r - g) / delta + 4;
      break;
  }
  hue *= 60;
  if (hue < 0) hue += 360;

  return { hue, saturation, lightness };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- test/ui/hsl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/hsl.ts test/ui/hsl.test.ts
git commit -m "feat(ui): add hexToHsl, inverse of hslToHex"
```

---

### Task 3: `PanelRail` component

**Files:**
- Create: `src/components/dockedPanel/PanelRail.tsx`
- Create: `src/components/dockedPanel/PanelRail.css`

**Interfaces:**
- Consumes: `IconButton` from `src/components/ui/icon-button.tsx` (existing, signature `{ label, tooltip?, size?, variant?, children, ...ButtonHTMLAttributes }`).
- Produces:
  ```ts
  export interface PanelRailItem {
    id: string;
    icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
    label: string;
    active: boolean;
    onClick: () => void;
  }
  export function PanelRail(props: { items: PanelRailItem[] }): JSX.Element;
  ```
  Consumed by Task 6 (`App.tsx`), which builds the 3-item array from the 3 `useContextualPanel` instances.

- [ ] **Step 1: Write the component**

No test file for this component (project convention: no test renders a React component; verified visually via CDP in Task 7). This is a pure presentational wrapper — no state, no logic worth unit-testing in isolation from React.

```tsx
// src/components/dockedPanel/PanelRail.tsx
import { IconButton } from "../ui/icon-button";
import "./PanelRail.css";

export interface PanelRailItem {
  id: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  active: boolean;
  onClick: () => void;
}

export interface PanelRailProps {
  items: PanelRailItem[];
}

/** Fixed column of toggle icons next to the dock (Photoshop-style rail) —
 *  every item stays clickable regardless of `active`/condition state; a
 *  disabled-looking rail item would contradict the "force the empty state
 *  open" behavior `useContextualPanel.toggleRail` provides. */
export function PanelRail({ items }: PanelRailProps) {
  return (
    <div className="panel-rail" role="toolbar" aria-orientation="vertical" aria-label="Panneaux">
      {items.map(({ id, icon: Icon, label, active, onClick }) => (
        <IconButton
          key={id}
          label={label}
          size="default"
          onClick={onClick}
          className={active ? "panel-rail__item panel-rail__item--active" : "panel-rail__item"}
          aria-pressed={active}
        >
          <Icon className="icon-sm icon-stroke" aria-hidden />
        </IconButton>
      ))}
    </div>
  );
}
```

```css
/* src/components/dockedPanel/PanelRail.css */
.panel-rail {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-1);
}

.panel-rail__item--active {
  background: var(--surface-selected);
  color: var(--foreground);
}
```

(Check `src/design/primitives.css`/`semantic.css` for the exact `--space-1`/`--surface-selected`/`--foreground` token names before writing the CSS file — copy the real token names verbatim, do not guess; `DockedPanelCard.css` and `PanelColumn.css` in the same directory are the closest reference for what's already available at this dock's z-index/spacing scale.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from `PanelRail.tsx`.

- [ ] **Step 3: Lint tokens**

Run: `npm run lint:tokens`
Expected: no new violations from `PanelRail.css` (only real tokens used, no hardcoded hex/px literal outside the declared spacing scale).

- [ ] **Step 4: Commit**

```bash
git add src/components/dockedPanel/PanelRail.tsx src/components/dockedPanel/PanelRail.css
git commit -m "feat(ui): add PanelRail icon-toggle component"
```

---

### Task 4: `color-group-control.tsx` swatch becomes a button with `onOpenPicker`

**Files:**
- Modify: `src/components/ui/color-group-control.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: new optional prop `onOpenPicker?: () => void` on `ColorGroupControlProps`, consumed by Task 6 (`ParamPanel.tsx` threading + `App.tsx` wiring).

- [ ] **Step 1: Modify the component**

Replace the swatch `<span>` with a `<button>` that calls `onOpenPicker` and stops propagation so it doesn't also trigger the `CollapsiblePrimitive.Trigger` disclosure it's nested inside:

```tsx
// src/components/ui/color-group-control.tsx — changes only, rest of file unchanged
export interface ColorGroupControlProps {
  label: string;
  hueParam: EffectParam;
  saturationParam: EffectParam;
  lightnessParam: EffectParam;
  hue: number;
  saturation: number;
  lightness: number;
  defaultOpen?: boolean;
  onChange: (paramName: string, value: number) => void;
  onCommit: () => void;
  onOpenPicker?: () => void;
}

export function ColorGroupControl({
  label,
  hueParam,
  saturationParam,
  lightnessParam,
  hue,
  saturation,
  lightness,
  defaultOpen = false,
  onChange,
  onCommit,
  onOpenPicker,
}: ColorGroupControlProps) {
  const hex = hslToHex(hue, saturation, lightness);

  return (
    <CollapsiblePrimitive.Root defaultOpen={defaultOpen}>
      <CollapsiblePrimitive.Trigger className="flex h-[var(--section-header-height)] w-full items-center gap-2 rounded-[var(--radius-control)] px-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-[var(--focus-width)] focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)]">
        <button
          type="button"
          className="h-5 w-5 shrink-0 rounded-[var(--radius-control)] border border-border focus-visible:outline-[var(--focus-width)] focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)]"
          style={{ background: hex }}
          aria-label={`Ouvrir le sélecteur de couleur pour ${label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenPicker?.();
          }}
        />
        <span className="flex-1 truncate text-sm text-foreground">{label}</span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{hex}</span>
        <ChevronRight className="icon-sm icon-stroke shrink-0 text-muted-foreground transition-transform data-panel-open:rotate-90" aria-hidden="true" />
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Panel className="flex flex-col gap-3 px-1.5 py-2">
        <LabeledSlider
          label="Teinte"
          value={hue}
          min={hueParam.min}
          max={hueParam.max}
          step={hueParam.step}
          displayValue={`${Math.round(hue)}°`}
          onChange={(v) => onChange(hueParam.name, v)}
          onCommit={onCommit}
        />
        <LabeledSlider
          label="Saturation"
          value={saturation}
          min={saturationParam.min}
          max={saturationParam.max}
          step={saturationParam.step}
          displayValue={`${Math.round(saturation * 100)} %`}
          onChange={(v) => onChange(saturationParam.name, v)}
          onCommit={onCommit}
        />
        <LabeledSlider
          label="Luminosité"
          value={lightness}
          min={lightnessParam.min}
          max={lightnessParam.max}
          step={lightnessParam.step}
          displayValue={`${Math.round(lightness * 100)} %`}
          onChange={(v) => onChange(lightnessParam.name, v)}
          onCommit={onCommit}
        />
      </CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  );
}
```

Note: `onPointerDown`/`onClick` both call `stopPropagation()` — matching the existing pattern in `DockedPanelCard.tsx`'s `IconButton` usage (`onPointerDown={(e) => e.stopPropagation()}`), which prevents the click from also bubbling into the disclosure trigger's own pointer/click handling.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. `ParamPanel.tsx` (not yet updated) still compiles because `onOpenPicker` is optional.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/color-group-control.tsx
git commit -m "feat(ui): turn ColorGroupControl swatch into a button, add onOpenPicker prop"
```

---

### Task 5: `ColorPickerPanel` component (SV square + hue band + hex field)

**Files:**
- Create: `src/components/ColorPickerPanel.tsx`
- Create: `src/components/ColorPickerPanel.css`

**Interfaces:**
- Consumes: `hslToHex`, `hexToHsl` from `src/ui/hsl.ts` (Task 2).
- Produces:
  ```ts
  export interface ColorPickerPanelProps {
    label: string;
    hue: number;         // 0..360
    saturation: number;  // 0..1
    lightness: number;   // 0..1
    onChange: (values: { hue?: number; saturation?: number; lightness?: number }) => void;
    onCommit: () => void;
    onClose: () => void;
    style?: React.CSSProperties; // caller positions it (absolute, anchored to dockWidth)
  }
  export function ColorPickerPanel(props: ColorPickerPanelProps): JSX.Element;
  ```
  Consumed by Task 6 (`App.tsx`), which supplies `hue`/`saturation`/`lightness` from the `colorPicker` state + the selected layer's live params, and wires `onChange`→`handleParamChange`, `onCommit`→`handleParamCommit`, `onClose`→clearing `colorPicker`.

- [ ] **Step 1: Implement the component**

No test file (canvas + pointer-drag UI, project convention: no React-render tests; verified visually in Task 7).

```tsx
// src/components/ColorPickerPanel.tsx
import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";
import { IconButton } from "./ui/icon-button";
import { hexToHsl, hslToHex } from "../ui/hsl";
import "./ColorPickerPanel.css";

export interface ColorPickerPanelProps {
  label: string;
  hue: number;
  saturation: number;
  lightness: number;
  onChange: (values: { hue?: number; saturation?: number; lightness?: number }) => void;
  onCommit: () => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

const SV_SIZE = 160;
const HUE_BAND_HEIGHT = 12;

/** Saturation/lightness square for a FIXED hue — HSL's "S" axis maps to
 *  the square's X, and "L" to Y inverted (top = light, bottom = dark),
 *  matching the common SV-picker convention users already expect. */
function drawSvSquare(canvas: HTMLCanvasElement, hue: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  const imageData = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const lightness = 1 - y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const saturation = x / (width - 1);
      const hex = hslToHex(hue, saturation, lightness);
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const i = (y * width + x) * 4;
      imageData.data[i] = r;
      imageData.data[i + 1] = g;
      imageData.data[i + 2] = b;
      imageData.data[i + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

export function ColorPickerPanel({ label, hue, saturation, lightness, onChange, onCommit, onClose, style }: ColorPickerPanelProps) {
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hexInput, setHexInput] = useState(() => hslToHex(hue, saturation, lightness));
  const lastDrawnHueRef = useRef<number | null>(null);

  // Redraw the SV square only when hue actually changed (not on every
  // saturation/lightness drag) — the grid's colors depend on hue alone.
  if (svCanvasRef.current && lastDrawnHueRef.current !== hue) {
    drawSvSquare(svCanvasRef.current, hue);
    lastDrawnHueRef.current = hue;
  }

  const handleSvPointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = svCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      onChange({ saturation: x, lightness: 1 - y });
    },
    [onChange]
  );

  const handleHuePointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      onChange({ hue: x * 360 });
    },
    [onChange]
  );

  const commitHexInput = useCallback(() => {
    const match = /^#?[0-9a-fA-F]{6}$/.test(hexInput);
    if (!match) {
      setHexInput(hslToHex(hue, saturation, lightness)); // revert invalid input
      return;
    }
    const parsed = hexToHsl(hexInput);
    onChange(parsed);
    onCommit();
  }, [hexInput, hue, saturation, lightness, onChange, onCommit]);

  const currentHex = hslToHex(hue, saturation, lightness);

  return (
    <div className="color-picker-panel" style={style} role="dialog" aria-label={`Sélecteur de couleur — ${label}`}>
      <div className="color-picker-panel__header">
        <span className="color-picker-panel__title">{label}</span>
        <IconButton label="Fermer le sélecteur de couleur" size="compact" onClick={onClose}>
          <X className="icon-sm icon-stroke" aria-hidden />
        </IconButton>
      </div>
      <canvas
        ref={svCanvasRef}
        width={SV_SIZE}
        height={SV_SIZE}
        className="color-picker-panel__sv"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          handleSvPointer(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && handleSvPointer(e)}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          onCommit();
        }}
      />
      <div
        className="color-picker-panel__hue-band"
        style={{ height: HUE_BAND_HEIGHT }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          handleHuePointer(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && handleHuePointer(e)}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          onCommit();
        }}
      >
        <div className="color-picker-panel__hue-thumb" style={{ left: `${(hue / 360) * 100}%` }} />
      </div>
      <label className="color-picker-panel__hex">
        <span>Hex</span>
        <input
          type="text"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={commitHexInput}
          onKeyDown={(e) => e.key === "Enter" && commitHexInput()}
          placeholder={currentHex}
        />
      </label>
    </div>
  );
}
```

```css
/* src/components/ColorPickerPanel.css */
.color-picker-panel {
  position: absolute;
  z-index: var(--z-popover, 50);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--surface-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel);
}

.color-picker-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.color-picker-panel__title {
  font-size: var(--text-sm);
  color: var(--foreground);
}

.color-picker-panel__sv {
  border-radius: var(--radius-control);
  cursor: crosshair;
  touch-action: none;
}

.color-picker-panel__hue-band {
  position: relative;
  border-radius: var(--radius-control);
  cursor: pointer;
  touch-action: none;
  background: linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000);
}

.color-picker-panel__hue-thumb {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 4px;
  transform: translateX(-2px);
  background: var(--foreground);
  border-radius: var(--radius-control);
  pointer-events: none;
}

.color-picker-panel__hex {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--muted-foreground);
}

.color-picker-panel__hex input {
  flex: 1;
  font-family: var(--font-mono);
  background: var(--input-background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-2);
  color: var(--foreground);
}
```

(Before writing the CSS, grep `src/design/*.css` for the exact token names — `--surface-panel`, `--shadow-panel`, `--radius-panel`, `--z-popover`, `--input-background`, `--text-sm`/`--text-xs`, `--font-mono` may be named differently in this project; copy real names, do not invent. `npm run lint:tokens` in Step 3 below catches any mismatch.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Lint tokens**

Run: `npm run lint:tokens`
Expected: no new violations — fix any token name mismatch found (rename to the project's actual token, do not add a hardcoded literal).

- [ ] **Step 4: Commit**

```bash
git add src/components/ColorPickerPanel.tsx src/components/ColorPickerPanel.css
git commit -m "feat(ui): add ColorPickerPanel (SV square + hue band + hex field)"
```

---

### Task 6: Thread `onOpenColorPicker` through `ParamPanel` and wire `App.tsx`

This task modifies `ParamPanel.tsx` and `App.tsx` together in one pass — splitting them into separate tasks would leave `tsc --noEmit` broken between them (the `ParamPanel` signature change and its only call site must land atomically for the deliverable to type-check).

**Files:**
- Modify: `src/components/ParamPanel.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `ColorGroupControl`'s `onOpenPicker` prop (Task 4), `useContextualPanel` (Task 1), `PanelRail`+`PanelRailItem` (Task 3), `ColorPickerPanel` (Task 5).
- Produces (on `ParamPanel`, consumed immediately by this same task's `App.tsx` change):
  ```ts
  interface Props {
    layer: LayerState | null;
    onParamChange: (id: string, params: Record<string, number>) => void;
    onParamCommit: () => void;
    onOpenColorPicker: (group: { layerId: string; key: string; label: string; hue: EffectParam; saturation: EffectParam; lightness: EffectParam }) => void;
  }
  ```
  Consumed later in this same task's `App.tsx` change, which passes a callback that sets the `colorPicker` state.

- [ ] **Step 1: Modify `ParamPanel.tsx`**

```tsx
// src/components/ParamPanel.tsx — full new content
import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";
import type { EffectParam } from "../render/effects/types";
import "./ParamPanel.css";
import { LabeledSlider } from "./ui/labeled-slider";
import { Disclosure } from "./ui/collapsible";
import { ColorGroupControl } from "./ui/color-group-control";
import { formatControlValue } from "../ui/formatValue";

type ParamRenderItem =
  | { kind: "single"; param: EffectParam }
  | { kind: "group"; key: string; label: string; hue: EffectParam; saturation: EffectParam; lightness: EffectParam; isFirst: boolean };

function groupEffectParams(params: EffectParam[]): ParamRenderItem[] {
  const firstIndexByKey = new Map<string, number>();
  const roleByKey = new Map<string, { label: string; hue?: EffectParam; saturation?: EffectParam; lightness?: EffectParam }>();

  params.forEach((p, index) => {
    if (!p.colorGroup) return;
    const { key, role, label } = p.colorGroup;
    if (!firstIndexByKey.has(key)) firstIndexByKey.set(key, index);
    const entry = roleByKey.get(key) ?? { label };
    entry[role] = p;
    roleByKey.set(key, entry);
  });

  let seenGroups = 0;
  const items: ParamRenderItem[] = [];
  params.forEach((p, index) => {
    if (!p.colorGroup) {
      items.push({ kind: "single", param: p });
      return;
    }
    if (firstIndexByKey.get(p.colorGroup.key) !== index) return;
    const entry = roleByKey.get(p.colorGroup.key)!;
    if (!entry.hue || !entry.saturation || !entry.lightness) {
      throw new Error(`Groupe de couleur "${p.colorGroup.key}" incomplet : hue/saturation/lightness requis.`);
    }
    items.push({ kind: "group", key: p.colorGroup.key, label: entry.label, hue: entry.hue, saturation: entry.saturation, lightness: entry.lightness, isFirst: seenGroups === 0 });
    seenGroups += 1;
  });
  return items;
}

interface Props {
  layer: LayerState | null;
  onParamChange: (id: string, params: Record<string, number>) => void;
  onParamCommit: () => void;
  onOpenColorPicker: (group: { layerId: string; key: string; label: string; hue: EffectParam; saturation: EffectParam; lightness: EffectParam }) => void;
}

function formatEffectParamValue(
  value: number,
  param: { unit?: "percent" | "pixels" | "degrees" | "none"; step: number },
): string {
  switch (param.unit) {
    case "percent":
      return `${Math.round(value * 100)} %`;
    case "pixels":
      return `${formatControlValue(value, param.step)} px`;
    case "degrees":
      return `${Math.round(value)}°`;
    case "none":
    default:
      return formatControlValue(value, param.step);
  }
}

export function ParamPanel({ layer, onParamChange, onParamCommit, onOpenColorPicker }: Props) {
  if (!layer) {
    return <p className="param-panel__empty">Sélectionne un calque.</p>;
  }
  const effect = getEffect(layer.effectId);

  return (
    <div className="param-panel">
      <Disclosure title="Effet" defaultOpen>
        <div className="param-panel__group">
          {groupEffectParams(effect.params).map((item) =>
            item.kind === "single" ? (
              <div key={item.param.name} title={item.param.hint}>
                <LabeledSlider
                  label={item.param.label}
                  value={layer.params[item.param.name] ?? item.param.default}
                  min={item.param.min}
                  max={item.param.max}
                  step={item.param.step}
                  displayValue={formatEffectParamValue(layer.params[item.param.name] ?? item.param.default, item.param)}
                  onChange={(v) => onParamChange(layer.id, { [item.param.name]: v })}
                  onCommit={onParamCommit}
                />
              </div>
            ) : (
              <ColorGroupControl
                key={item.key}
                label={item.label}
                hueParam={item.hue}
                saturationParam={item.saturation}
                lightnessParam={item.lightness}
                hue={layer.params[item.hue.name] ?? item.hue.default}
                saturation={layer.params[item.saturation.name] ?? item.saturation.default}
                lightness={layer.params[item.lightness.name] ?? item.lightness.default}
                defaultOpen={item.isFirst}
                onChange={(name, v) => onParamChange(layer.id, { [name]: v })}
                onCommit={onParamCommit}
                onOpenPicker={() =>
                  onOpenColorPicker({ layerId: layer.id, key: item.key, label: item.label, hue: item.hue, saturation: item.saturation, lightness: item.lightness })
                }
              />
            ),
          )}
        </div>
      </Disclosure>
    </div>
  );
}
```

- [ ] **Step 2: Wire `App.tsx` — add imports**

At the top of `src/App.tsx`, add:

```ts
import { Layers, SlidersHorizontal, Brush as BrushRailIcon } from "lucide-react";
import { useContextualPanel } from "./ui/contextualPanel";
import { PanelRail, type PanelRailItem } from "./components/dockedPanel/PanelRail";
import { ColorPickerPanel } from "./components/ColorPickerPanel";
import type { EffectParam } from "./render/effects/types";
```

(`Brush` is already imported for a different purpose in `BrushToolbar.tsx` — that's a separate file, no collision. If a name collision arises against something already imported in `App.tsx`, keep the `BrushRailIcon` alias.)

- [ ] **Step 3: Replace the 3 `useState` panel-collapse flags with 3 `useContextualPanel` calls**

Remove these 3 lines:

```ts
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const [paramsCollapsed, setParamsCollapsed] = useState(false);
  const [maskCollapsed, setMaskCollapsed] = useState(false);
```

Replace with (placed after `selectedLayer`/`selectedId` are known — move this block to right after the existing `const selectedLayer = layers.find(...)` line, since `Réglages`/`Masque` need `selectedId` as `triggerKey`):

```ts
  const layersPanel = useContextualPanel(true, "static");
  const paramsPanel = useContextualPanel(selectedId !== null, selectedId);
  const maskPanel = useContextualPanel(selectedId !== null, selectedId);
```

Note: `layers`/`paramsCollapsed`/`maskCollapsed` were consumed by `PanelColumn`'s `collapsed`/`onCollapsedChange` per-panel props (fold/unfold within a visible panel) — that mechanism is UNCHANGED and orthogonal to this task (visibility, not fold state). Keep 3 *new*, separately-named `useState` calls for that existing fold behavior under different names so nothing is lost:

```ts
  const [layersFolded, setLayersFolded] = useState(false);
  const [paramsFolded, setParamsFolded] = useState(false);
  const [maskFolded, setMaskFolded] = useState(false);
```

(All later references to `layersCollapsed`/`setLayersCollapsed` etc. in this file become `layersFolded`/`setLayersFolded` etc. — see the render-update step below.)

- [ ] **Step 4: Add `colorPicker` state**

Near the other `useState` declarations:

```ts
  const [colorPicker, setColorPicker] = useState<{
    layerId: string;
    key: string;
    label: string;
    hue: EffectParam;
    saturation: EffectParam;
    lightness: EffectParam;
  } | null>(null);
```

Note: `selectedLayer` (`const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;`, further down near `paramsPanelTitle`) does not need to move — Step 3's `useContextualPanel` calls only need `selectedId`, already declared earlier in the file.

- [ ] **Step 5: Update the `PanelColumn` render to filter by visibility and rename fold state**

Replace the existing `<PanelColumn panels={[...]} .../>` block (currently lines ~758-800) with:

```tsx
        <PanelColumn
          panels={[
            {
              id: "layers", title: "Calques", collapsed: layersFolded, onCollapsedChange: setLayersFolded,
              content: <LayerPanel
                  layers={layers}
                  selectedId={selectedId}
                  hasImage={imageSize.width > 0 && imageSize.height > 0}
                  onSelect={selectLayer}
                  onToggle={handleToggle}
                  onAdd={handleAdd}
                  onRemove={handleRemove}
                  onReorder={handleReorder}
                  onOpacityChange={handleOpacityChange}
                  onOpacityCommit={handleParamCommit}
                  onBlendModeChange={handleBlendModeChange}
                />
            },
            {
              id: "params", title: paramsPanelTitle, collapsed: paramsFolded, onCollapsedChange: setParamsFolded,
              content: <ParamPanel
                  layer={selectedLayer}
                  onParamChange={handleParamChange}
                  onParamCommit={handleParamCommit}
                  onOpenColorPicker={(group) => setColorPicker(group)}
                />
            },
            {
              id: "mask", title: "Masque", collapsed: maskFolded, onCollapsedChange: setMaskFolded,
              content: <MaskPanel
                  layer={selectedLayer}
                  maskPaintMode={maskPaintMode}
                  onToggleMaskPaint={() => setMaskPaintMode((v) => !v)}
                  overlayForceHidden={overlayForceHidden}
                  onToggleOverlayForceHidden={() => setOverlayForceHidden((v) => !v)}
                  onAddMaskSource={handleAddMaskSource}
                  onRemoveMaskSource={handleRemoveMaskSource}
                  onMaskSourceParamsChange={handleMaskSourceParamsChange}
                  onMaskSourceParamsCommit={handleParamCommit}
                  onMaskSourceCombineModeChange={handleMaskSourceCombineModeChange}
                  onMaskSourceEnabledChange={handleMaskSourceEnabledChange}
                  onMaskInvertChange={handleMaskInvertChange}
                  onMaskEnabledChange={handleMaskEnabledChange}
                  onRefineEdgeChange={handleRefineEdgeChange}
                  onRefineEdgeCommit={handleParamCommit}
                  onAddColorSample={handleAddColorSample}
                />
            },
          ].filter((panel) =>
            panel.id === "layers" ? layersPanel.visible : panel.id === "params" ? paramsPanel.visible : maskPanel.visible
          )}
          layout={dockLayout}
          onMove={handlePanelMove}
          width={dockWidth}
          onWidthChange={handleDockWidthChange}
        />
        <PanelRail
          items={[
            { id: "layers", icon: Layers, label: "Calques", active: layersPanel.visible, onClick: layersPanel.toggleRail },
            { id: "params", icon: SlidersHorizontal, label: "Réglages", active: paramsPanel.visible, onClick: paramsPanel.toggleRail },
            { id: "mask", icon: BrushRailIcon, label: "Masque", active: maskPanel.visible, onClick: maskPanel.toggleRail },
          ] satisfies PanelRailItem[]}
        />
        {colorPicker && selectedLayer?.id === colorPicker.layerId && (
          <ColorPickerPanel
            label={colorPicker.label}
            hue={layers.find((l) => l.id === colorPicker.layerId)?.params[colorPicker.hue.name] ?? colorPicker.hue.default}
            saturation={layers.find((l) => l.id === colorPicker.layerId)?.params[colorPicker.saturation.name] ?? colorPicker.saturation.default}
            lightness={layers.find((l) => l.id === colorPicker.layerId)?.params[colorPicker.lightness.name] ?? colorPicker.lightness.default}
            onChange={(values) => {
              const params: Record<string, number> = {};
              if (values.hue !== undefined) params[colorPicker.hue.name] = values.hue;
              if (values.saturation !== undefined) params[colorPicker.saturation.name] = values.saturation;
              if (values.lightness !== undefined) params[colorPicker.lightness.name] = values.lightness;
              handleParamChange(colorPicker.layerId, params);
            }}
            onCommit={handleParamCommit}
            onClose={() => setColorPicker(null)}
            style={{ left: dockWidth + 8 }}
          />
        )}
```

`ColorPickerPanel`'s `style={{ left: dockWidth + 8 }}` anchors it just left of the dock (`dockWidth` is already tracked in `App.tsx`) — per spec, `position: absolute` (already set inside `ColorPickerPanel.css`), no `dockLayout`/`PanelRail` slot. Its container needs `position: relative`; verify `.workspace`/`main` (the existing wrapping element, already `ref={workspaceRef}`) has `position: relative` in `App.css` — if not, add it there (do not add inline `position: relative` to the `<main>` JSX, keep the CSS file as the single source of layout rules for `.workspace`, consistent with the rest of this file's styling approach).

The `colorPicker.layerId === selectedLayer?.id` guard re-runs on every render (not just at open), so a layer removed mid-picker-session (deleted while its picker is open) causes the picker to disappear on the very next render — no `useEffect` needed, matching the spec.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS, 0 errors.

- [ ] **Step 7: Run the full test suite**

Run: `npm run test`
Expected: PASS, all existing tests plus Task 1/2's new tests green.

- [ ] **Step 8: Lint tokens**

Run: `npm run lint:tokens`
Expected: no violations.

- [ ] **Step 9: Commit**

```bash
git add src/components/ParamPanel.tsx src/App.tsx src/App.css
git commit -m "feat(app): wire contextual panels (rail + auto-hide) and color picker"
```

---

### Task 7: Visual checkpoint (CDP, human verdict — per project convention)

**Files:** none (verification only).

- [ ] **Step 1: Launch the dev build with CDP debugging**

Run: `npm run dev:debug` (kills any stray `shaderlab.exe` first — check `Get-Process -Name shaderlab` beforehand if another worktree/session might be running its own instance, per `CLAUDE.md` § Méthode).

- [ ] **Step 2: Monitor for build/runtime errors**

Run: `npm run dev:monitor` and confirm no Rust/Vite/console errors before proceeding.

- [ ] **Step 3: Exercise the full checklist via CDP (raw WebSocket to `ws://localhost:9222/devtools/page/<id>`, per the project's documented technique) or ask Antoine to drive it live**

Checklist (from the spec's confirmed behaviors):
1. Open an image with no layer selected → Réglages and Masque are hidden, Calques visible (auto).
2. Select a layer → Réglages and Masque appear automatically.
3. Click the Réglages titlebar X → Réglages closes; select a different layer → Réglages reopens automatically (override forgotten on `triggerKey` change); reselect the FIRST layer again → Réglages stays open (the closed-override for that first layer's `triggerKey` was not remembered, condition decides again).
4. With no layer selected, click "Réglages" on `PanelRail` → Réglages force-opens showing its empty state ("Sélectionne un calque.").
5. Click "Calques" on `PanelRail` to close it, then click it again → reopens (Calques' `triggerKey` is constant, so only the rail can reopen it, never automatically).
6. Open the duotone effect's Ombres/Ton moyen/Hautes lumières swatch button → `ColorPickerPanel` opens, anchored left of the dock; drag inside the SV square and the hue band → the swatch color and `ParamPanel` sliders update live; type a hex value and press Enter → sliders update to match.
7. Delete the layer whose color picker is open (or select a different layer) → `ColorPickerPanel` disappears.
8. No `GPUDevice.lost`, no new console errors/warnings across the whole sequence.

- [ ] **Step 4: Report the verdict to Antoine**

Per project rule ("le jugement visuel = humain"), this step's PASS/FAIL is Antoine's call, not the implementing agent's — the agent reports what it observed (screenshots/CDP evidence) and stops short of declaring the chantier done.

- [ ] **Step 5: Final commit (if Step 3 uncovered fixes)**

If any fix was needed during the checkpoint, commit it separately with a message describing exactly what visual/behavioral bug it fixes, then re-run Steps 1-3.
