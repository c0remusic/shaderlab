# Shaderlab Design System — Components

## Layer model

```text
tokens -> primitives -> composed UI -> product UI
```

- `src/ui/*`: reusable visual and interaction primitives.
- composed UI: reusable assemblies with no domain or WebGPU dependency.
- product UI: binds domain state and commands to composed UI.

Product components MUST NOT recreate focus, menu, dialog, tooltip, slider or
button behavior.

## Primitive inventory

| Primitive | Required variants | Required behaviors |
|---|---|---|
| `Button` | primary, secondary, quiet, danger | loading, disabled, leading/trailing icon |
| `IconButton` | quiet, selected, danger | accessible name, tooltip, pressed state |
| `ToggleButton` | text, icon, text+icon | `aria-pressed`, selected state |
| `Slider` | single value | keyboard steps, Home/End, label/value/unit |
| `NumberField` | integer, decimal, unit | validation, commit/cancel, arrow steps |
| `Select` | single select | typeahead, arrows, Escape, focus return |
| `Checkbox` | checked, unchecked, mixed | Space toggle, full label target |
| `Menu` | action, check, radio, separator | roving focus, typeahead, Escape |
| `Tooltip` | label, label+shortcut | hover/focus, 500 ms delay, no critical info |
| `Popover` | anchored content | dismiss outside/Escape, focus policy |
| `Dialog` | modal, confirmation | focus trap, Escape policy, focus return |
| `Progress` | determinate, staged | accessible label and current stage |
| `Disclosure` | expanded, collapsed | `aria-expanded`, arrow keys where grouped |
| `ScrollArea` | vertical, horizontal | native wheel, visible focus, no scroll trap |
| `Divider` | horizontal, vertical | decorative only |
| `VisuallyHidden` | text | accessible off-screen text |

## State matrix

Every interactive primitive documents and implements applicable states:

| State | Visual contract | Interaction contract |
|---|---|---|
| Default | semantic surface/text/border | available |
| Hover | subtle surface increase | pointer only |
| Pressed | stronger surface, no movement | active until release |
| Selected | neutral fill + light edge or indicator | persistent state |
| Focus-visible | 2 px external ring | keyboard/programmatic focus |
| Disabled | disabled text and border | not focusable unless discoverability requires explanation |
| Loading | stable dimensions, progress indicator | duplicate action blocked |
| Error | danger border/text + message | error remains until resolved/dismissed |

Hover MUST NOT be the only indication of affordance. Selected and focus are
separate states and may appear simultaneously.

## Primitive specifications

### Button

- Height: 28/30/32 px; default 30 px.
- Radius: 5 px.
- Horizontal padding: 8 px compact, 12 px with long labels.
- Icon gap: 6 px.
- Primary is neutral paper fill, never a brand color.
- Danger uses danger semantic tokens and a text label for irreversible actions.
- Loading preserves width and label context.

### IconButton

- Hit area: 28–32 px even when glyph is 14–16 px.
- Tooltip contains action and shortcut when available.
- `aria-label` is mandatory.
- A selected tool uses `aria-pressed` and selected tokens.
- Standalone destructive icons require confirmation or immediate Undo.

### Slider and NumberField

- Slider track: 3 px; thumb: 12 px.
- Label left, tabular value right, unit always visible.
- Minimum and maximum are available to assistive technology.
- Arrow keys use the normal step; Shift uses a coarse step; Alt uses a fine
  step when the parameter schema provides them.
- Drag updates preview continuously but creates one history entry on commit.
- Number entry supports Enter to commit and Escape to restore the prior value.

### Select and Menu

- Custom primitives replace visually inconsistent native `<select>` controls.
- Trigger remains 30 px high.
- The popup uses raised surface, 7 px group radius and strong border.
- Current choice is indicated by text and checkmark, not color alone.
- Menus never contain sliders or complex editing workflows.

### Tooltip

- Appears on hover and keyboard focus after 500 ms.
- Uses 11 px text, max width 280 px.
- Shows shortcut on a separate aligned suffix.
- Never contains essential error, warning or workflow content.

### Dialog

- Radius: 10 px; no shadow; strong border over semantic scrim.
- Initial focus goes to the safest useful action.
- Escape closes non-destructive dialogs.
- Destructive confirmations default focus to Cancel.
- Closing returns focus to the invoking control.
- Dialogs are a last resort; editing controls belong in the inspector.

## Composed components

| Component | Composition | Responsibility |
|---|---|---|
| `ToolbarGroup` | buttons, dividers | logically grouped commands |
| `InspectorSection` | disclosure, heading, content | collapsible tool group |
| `PropertyRow` | label, control, value | calibrated parameter layout |
| `LayerRow` | visibility, label, opacity, menu | selected/reorderable layer summary |
| `FilmstripItem` | thumbnail, status, label | document selection and modified state |
| `MaskToolGroup` | toggles, sliders, menu | brush/gum/mask actions |
| `ExportProgressDialog` | stage progress, filename | export feedback and safe cancellation |
| `EmptyState` | title, guidance, action | next useful action |
| `ErrorState` | message, detail, recovery | persistent recoverable error |

## Product components

- `WorkspaceToolbar`
- `CanvasViewport`
- `Inspector`
- `LayerStack`
- `EffectParameters`
- `MaskControls`
- `Filmstrip`

They receive state and commands from the domain. They MUST NOT own token values,
global shortcuts or primitive interaction mechanics.

## Icons

- Lucide is the only icon family.
- Default glyph: 16 px, stroke 1.5 px.
- Dense row glyph: 14 px.
- High-emphasis toolbar glyph: 20 px maximum.
- Use outline icons; filled icons are reserved for a semantic state that cannot
  be expressed clearly by outline + label.
- Custom icons must match the 24 × 24 viewBox, round caps/joins and optical
  weight of Lucide.

## Component acceptance checklist

- All states are documented and visible in the specimen board.
- Keyboard interaction matches the control role.
- Accessible name, role, value and state are exposed.
- No hardcoded visual values.
- No layout shift between default/loading/error states.
- Works at 100%, 150% and 200% Windows scaling.
- Focus is never clipped by overflow containers.
- Reduced-motion behavior is defined.
