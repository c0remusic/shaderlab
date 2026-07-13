# Shaderlab Design System — Product Patterns

## Workspace layout

```text
┌──────────────────────── toolbar 36px ────────────────────────┐
│                                                              │
│                    canvas viewport              inspector     │
│                    flexible                     240–400px     │
│                                                              │
├──────────────────── filmstrip 28–180px ──────────────────────┤
└──────────────────────────────────────────────────────────────┘
```

- The canvas consumes remaining space.
- The inspector is on the right and contains collapsible Layers, Parameters and
  Mask sections.
- The filmstrip is at the bottom and can collapse to a 28 px status bar.
- Inspector and filmstrip sizes persist for the current session.
- At constrained width, the filmstrip collapses first, then the inspector can
  hide behind a toolbar command. Critical canvas actions remain available.
- Minimum supported window: 900 × 600 px.

## Toolbar

- Height: 36 px.
- Leading: Open, document/session navigation and panel visibility.
- Center: direct canvas tools when useful; otherwise left empty.
- Trailing: Undo/Redo, Export and overflow.
- Commands are grouped with subtle dividers.
- Only frequent actions appear. Every toolbar command remains discoverable via
  menu, shortcut or labeled inspector action.
- Icon-only buttons use tooltips with shortcuts.

## Inspector

- Default width: 288 px; min 240; max 400.
- Sections: Layers, selected effect parameters, Mask.
- Section header: 28 px, uppercase 10 px label, 0.07 em tracking.
- One vertical scroll container for the inspector body. Nested scrolling is
  prohibited except a long layer list with an explicit max height.
- Selected layer context remains visible while parameters are edited.
- Advanced parameters use disclosures inside the effect section, not dialogs.

## Layer stack

- Rows are 30 px high and reorderable by drag-and-drop plus keyboard commands.
- Order index, visibility, effect name, opacity and overflow remain readable.
- Selected state uses neutral fill and a light leading edge.
- Disabled state uses icon + lower contrast, not contrast alone.
- Reorder preserves selection and mask attachment and is one undoable action.
- Drop target is a line between rows, never a vague row highlight.
- Blend mode and full parameters live in the selected layer inspector, not in
  every row.

## Calibrated property row

- Label left, value right in mono type.
- Slider occupies the next line when width is insufficient.
- Units are visible and included in accessible output.
- Values can be dragged, typed or changed with keyboard steps.
- Continuous interaction previews immediately and commits one history action.
- Reset is available per effect section, not repeated on every row.

## Canvas viewport

- The image is centered on `surface-workspace`, never on a colored surround.
- Zoom and pan are always available, including during mask editing.
- Cursor changes communicate active tool and operation.
- Canvas overlays use a dedicated z-index layer and do not steal focus unless
  interactive.
- Loading, GPU error and no-document states replace the canvas content with a
  structured state; they are not floating toasts.

## Mask editing

- Activating Brush or Eraser is a persistent toggle state.
- Brush size, hardness, opacity and flow use calibrated property rows.
- Overlay is a separate toggle with safelight tokens.
- Mask red and danger red have separate semantic roles.
- Fill, clear, invert and remove live in an explicit mask action menu.
- Remove mask is destructive but undoable; it does not require a modal.
- Overlay never obscures selection handles or cursor feedback.

## Filmstrip

- Default height: 104 px; collapsed: 28 px; max: 180 px.
- Filters: All, Modified, Unmodified.
- Filter pills are the one approved use of fully rounded geometry.
- Modified status uses marker + accessible label, not amber alone.
- Selected thumbnail uses neutral border and high-contrast label.
- Opening files appends items without replacing current unsaved documents.
- Session-only behavior is stated in the empty/first-run guidance.

## Export

- `Save as…` always invokes a native Windows dialog.
- Export progress is always visible and uses stages: Render, Encode, Write,
  Complete.
- Do not fabricate a continuous percentage when only stage boundaries exist.
- Filename remains visible throughout.
- Safe cancellation is offered only while it cannot corrupt the destination.
- Success closes automatically only after a perceivable confirmation; errors
  remain until dismissed or retried.

## Empty states

An empty state contains:

1. a concrete title;
2. one sentence explaining what is missing;
3. the primary next action;
4. an optional secondary gesture hint.

Example: `No photo open` / `Open a JPEG or drop it onto the workspace.` /
`Open…` / `You can keep several photos in the session filmstrip.`

## Errors

- Errors appear near the failed workflow or replace its content.
- Critical errors never auto-dismiss.
- Message structure: what failed, why when known, what the user can do.
- Technical details are expandable and copyable.
- A failed export preserves document state and modified status.
- Device loss replaces the canvas with a recovery action and preserves CPU-side
  document state where possible.

## Window adaptation

| Width | Behavior |
|---|---|
| `900–1099px` | filmstrip collapsed by default; inspector may overlay/hide |
| `1100–1439px` | standard inspector and collapsible filmstrip |
| `>=1440px` | inspector and filmstrip may remain expanded |

These are desktop adaptation thresholds, not mobile breakpoints. User choices
override automatic defaults during the session.

## Keyboard baseline

| Action | Shortcut |
|---|---|
| Open | `Ctrl+O` |
| Save as/export | `Ctrl+Shift+S` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Y` and `Ctrl+Shift+Z` |
| Delete selected layer | `Delete` |
| Cancel transient action | `Escape` |
| Move focus | `Tab` / `Shift+Tab` |

Tool shortcuts, brush-size keys and mask-overlay keys belong in a centralized
command registry and must be shown in menus/tooltips before implementation.
