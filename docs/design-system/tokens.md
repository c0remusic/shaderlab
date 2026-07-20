# Shaderlab Design System — Tokens

> Approved recipe: `darkroom-balanced`.
> Target representation: CSS custom properties split into primitive, semantic
> and component layers. Values below are the implementation contract.

## Architecture

```text
primitive value -> semantic role -> component token -> component
```

Components MUST NOT consume primitive colors directly. A future theme changes
semantic mappings, not component code.

## Primitive tokens

### Warm neutral palette

| Token | Value |
|---|---:|
| `--primitive-neutral-0` | `#fffdf9` |
| `--primitive-neutral-50` | `#f7f2ea` |
| `--primitive-neutral-100` | `#f0e8dc` |
| `--primitive-neutral-200` | `#d4cabc` |
| `--primitive-neutral-300` | `#b3aa9e` |
| `--primitive-neutral-400` | `#918980` |
| `--primitive-neutral-500` | `#6e6861` |
| `--primitive-neutral-600` | `#514c47` |
| `--primitive-neutral-700` | `#383431` |
| `--primitive-neutral-800` | `#292522` |
| `--primitive-neutral-850` | `#25211e` |
| `--primitive-neutral-900` | `#1d1b19` |
| `--primitive-neutral-925` | `#181614` |
| `--primitive-neutral-950` | `#151310` |
| `--primitive-neutral-1000` | `#100f0e` |

### Semantic color primitives

| Family | Base | Strong text | Subtle fill | Border |
|---|---:|---:|---:|---:|
| Safelight/mask | `#e63c46` | `#ff9298` | `rgba(230,60,70,.18)` | `rgba(255,92,101,.62)` |
| Danger | `#e65454` | `#ef8d8d` | `rgba(230,84,84,.12)` | `rgba(230,84,84,.45)` |
| Warning | `#d6a04e` | `#e7bd7b` | `rgba(214,160,78,.12)` | `rgba(214,160,78,.42)` |
| Success | `#69b579` | `#98d3a4` | `rgba(105,181,121,.12)` | `rgba(105,181,121,.40)` |

Mask and danger MUST remain different token families even if both appear red.

### Opacity

| Token | Value |
|---|---:|
| `--primitive-alpha-0` | `0` |
| `--primitive-alpha-4` | `.04` |
| `--primitive-alpha-7` | `.07` |
| `--primitive-alpha-10` | `.10` |
| `--primitive-alpha-11` | `.11` |
| `--primitive-alpha-18` | `.18` |
| `--primitive-alpha-28` | `.28` |
| `--primitive-alpha-48` | `.48` |
| `--primitive-alpha-68` | `.68` |
| `--primitive-alpha-94` | `.94` |

### Spacing

| Token | Value |
|---|---:|
| `--space-0` | `0` |
| `--space-1` | `2px` |
| `--space-2` | `4px` |
| `--space-3` | `6px` |
| `--space-4` | `8px` |
| `--space-5` | `12px` |
| `--space-6` | `16px` |
| `--space-7` | `20px` |
| `--space-8` | `24px` |
| `--space-9` | `32px` |
| `--space-10` | `40px` |
| `--space-11` | `48px` |

Use even tokens by default. Odd 2/6 px values are optical adjustments for dense
controls, not a second arbitrary spacing system.

### Typography

```css
--font-ui: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
--font-mono: "Cascadia Mono", "Consolas", monospace;

--font-size-2xs: 10px;
--font-size-xs: 11px;
--font-size-sm: 12px;
--font-size-md: 13px;
--font-size-lg: 14px;
--font-size-xl: 16px;
--font-size-2xl: 18px;
--font-size-3xl: 22px;

--font-weight-regular: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;

--line-height-tight: 1.2;
--line-height-control: 1.3;
--line-height-body: 1.5;

--tracking-tight: -0.01em;
--tracking-normal: 0;
--tracking-label: 0.07em;
```

### Geometry

```css
--radius-none: 0;
--radius-control: 5px;
--radius-group: 7px;
--radius-panel: 8px;
--radius-dialog: 10px;
--radius-round: 999px; /* circular indicators and intentional filter chips only */
```

### Motion

```css
--duration-none: 0ms;
--duration-feedback: 80ms;
--duration-fast: 120ms;
--duration-disclosure: 180ms;
--duration-dialog: 200ms;
--duration-slow: 240ms;

--ease-direct: linear;
--ease-standard: cubic-bezier(.2, 0, 0, 1);
--ease-enter: cubic-bezier(0, 0, .2, 1);
--ease-exit: cubic-bezier(.4, 0, 1, 1);
```

No bounce or spring token exists. Direct manipulation MUST use
`--ease-direct` or no transition.

### Z-index

```css
--z-canvas-overlay: 10;
--z-sticky: 20;
--z-popover: 40;
--z-dialog-backdrop: 60;
--z-dialog: 70;
--z-tooltip: 90;
```

## Semantic tokens: darkroom-balanced

### Surfaces

```css
--surface-window: var(--primitive-neutral-1000);
--surface-workspace: var(--primitive-neutral-950);
--surface-panel: var(--primitive-neutral-900);
--surface-raised: var(--primitive-neutral-850);
--surface-inset: #141210;
--surface-hover: rgba(236, 224, 207, .07);
--surface-active: rgba(236, 224, 207, .11);
--surface-selected: rgba(236, 224, 207, .075);
--surface-scrim: rgba(8, 7, 6, .76);
```

### Text

```css
--text-primary: rgba(240, 232, 220, .94);
--text-secondary: rgba(236, 224, 207, .68);
--text-tertiary: rgba(236, 224, 207, .53);
--text-disabled: rgba(236, 224, 207, .30);
--text-on-light: #211e1a;
--text-value: var(--primitive-neutral-100);
```

### Borders and focus

```css
--border-subtle: rgba(236, 224, 207, .07);
--border-default: rgba(236, 224, 207, .11);
--border-emphasis: rgba(236, 224, 207, .18);
--border-strong: rgba(236, 224, 207, .28);
--border-selection: var(--primitive-neutral-200);
--focus-color: var(--primitive-neutral-100);
--focus-width: 2px;
--focus-offset: 2px;
```

### Actions and statuses

```css
--action-primary-bg: var(--primitive-neutral-200);
--action-primary-text: var(--text-on-light);
--action-primary-hover: var(--primitive-neutral-100);
--action-secondary-bg: rgba(242, 242, 242, .08);
--action-secondary-hover: rgba(242, 242, 242, .12);
--action-pressed: rgba(242, 242, 242, .16);

--status-danger: #e65454;
--status-danger-text: #ef8d8d;
--status-danger-bg: rgba(230, 84, 84, .12);
--status-warning: #d6a04e;
--status-warning-text: #e7bd7b;
--status-warning-bg: rgba(214, 160, 78, .12);
--status-success: #69b579;
--status-success-text: #98d3a4;
--status-success-bg: rgba(105, 181, 121, .12);

--mask-overlay-color: #e63c46;
--mask-overlay-opacity: .28;
--mask-overlay-edge: rgba(255, 92, 101, .62);
```

## Structural tokens

```css
--control-height-sm: 28px;
--control-height-md: 30px;
--control-height-lg: 32px;
--toolbar-height: 36px;
--layer-row-height: 30px;
--section-header-height: 28px;

--icon-size-sm: 14px;
--icon-size-md: 16px;
--icon-size-lg: 20px;
--icon-stroke: 1.5px;

--inspector-width-min: 240px;
--inspector-width-default: 288px;
--inspector-width-max: 400px;
--filmstrip-height-collapsed: 28px;
--filmstrip-height-default: 104px;
--filmstrip-height-max: 180px;
--filmstrip-thumb-width: 68px;
--filmstrip-thumb-height: 50px;

--dialog-width-sm: 360px;
--dialog-width-md: 480px;
--dialog-width-lg: 640px;
--window-min-width: 900px;
--window-min-height: 600px;
--canvas-min-width: 480px;
--canvas-min-height: 320px;
```

## Component-token examples

```css
--button-height: var(--control-height-md);
--button-radius: var(--radius-control);
--button-padding-inline: var(--space-4);
--button-icon-gap: var(--space-3);

--slider-track-height: 3px;
--slider-thumb-size: 12px;
--slider-value-width: 7ch;

--panel-bg: var(--surface-panel);
--panel-border: var(--border-default);
--panel-radius: var(--radius-panel);

--tooltip-delay: 500ms;
--tooltip-max-width: 280px;
```

## Theme extension contract

V1 ships only `darkroom-balanced`. Components still use semantic tokens so a
future light theme can redefine semantics without changing component APIs.

Do not add an unused light palette now. A new theme must provide every semantic
token, pass contrast checks and be validated on all reference screens.
