# Design QA — contrôle de rampe Gradient Map

> Le rapport précédent, « dock plat et plan de travail », est préservé dans
> `docs/design-qa/2026-08-04-dock-flat-workspace.md`.

## Artifacts

- Source visual truth: `C:\Users\LEETJ\.codex\generated_images\019fcaf3-ae9a-7600-9307-585df86de409\exec-0109bd78-6d98-4257-bb1d-13dcca82e8df.png`
- Rendered implementation: `C:\tmp\shaderlab-gradient-map-panel-final.png`
- Side-by-side comparison: `C:\tmp\shaderlab-gradient-map-comparison.png`
- State: dark theme, `sample.jpg`, `Gradient map` selected, middle stop selected, color picker closed.
- Viewport: native Tauri WebView2 window; Properties card measured at 320 × 745.375 CSS px.
- Source pixels: 868 × 1830. Implementation pixels: 640 × 1491 captured at scale 2.
- Density normalization: source scaled to 640 px wide (result 640 × 1349) and placed beside the 640 px-wide implementation capture. The extra implementation height is the real card content at 320 px; no horizontal scaling mismatch remains.

## Full-view comparison evidence

The implementation preserves the selected direction's hierarchy: two range markers above one gradient strip, three colored movable stop arrows below, selected middle stop inspector immediately after the ramp, one divider, then every generic Gradient Map control. All content fits the real Properties card with one owner of vertical scrolling; no persistent control is clipped.

## Focused-region comparison evidence

The focused 320 px Properties capture was compared beside the normalized source. This region is sufficient because the request changes only the controller and shared slider visibility; the canvas, pile, toolbar and other dock cards are explicitly outside scope.

## Comparison history

### Pass 1 — blocked

- [P2] Generic slider tracks disappeared into the panel surface.
  - Evidence: the implementation used `--surface-raised` over `--surface-panel`, two adjacent Spectrum dark grays; the user's live screenshot read them as absent.
  - Fix: shared slider track now uses `--border-emphasis`, and the filled range uses `--text-secondary`; dimensions and behavior are unchanged.
- [P2] The existing round color-stop buttons did not match the selected Photoshop-like arrow vocabulary.
  - Fix: distinct range markers above the strip and colored arrow/tab stops below; selected stop gets the light outline.
- [P2] No persistent active-stop inspector existed.
  - Fix: active swatch, semantic stop name, numeric position field and existing color-picker affordance added without changing the shader or parameter model.

### Pass 2 — blocked

- [P2] Range values `0` and `100` were absent because the ramp had no lateral gutter.
  - Fix: the editor now reserves tokenized side gutters and renders the values at the ramp ends.
- [P2] Range markers appeared solid instead of hollow.
  - Fix: layered token-colored marker fill creates a high-contrast hollow range marker while color stops remain filled.

### Pass 3 — passed

- The `0`/`100` labels are visible above the ramp through explicit stacking.
- Range markers, color stops and active stop are visually distinct.
- All four generic sliders are visible, and both select rows remain visible.
- Real WebView2 interaction check: selecting `Arrêt sombre` changes the active inspector and `aria-pressed`; its picker button opens `ColorPickerPanel`; four generic slider roots remain mounted.
- Follow-up WebView2 check: `ArrowRight` on the selected dark-stop arrow moves it from 0 to 1 %, updates the numeric inspector and enables Undo. The same pure non-crossing model covers the middle and light stops.
- No Tauri stderr error or visible application error banner occurred during loading, selection or picker interaction.

## Required fidelity surfaces

- Fonts and typography: project-native Segoe UI/monospace value fields retained; hierarchy matches the mock with a semibold active-stop label and secondary control labels.
- Spacing and layout rhythm: token-only spacing, compact 320 px layout, no nested card around the active stop, one divider before generic controls.
- Colors and visual tokens: canonical Spectrum surfaces, borders, text and focus tokens only; ramp colors remain derived from the live HSL stops.
- Image quality and assets: no raster asset is needed for this UI control. The picker affordance uses the installed Lucide icon library; the gradient itself is the live functional ramp, not a replacement image.
- Copy and content: French labels retained exactly for all existing generic controls; active stop uses the existing domain labels.

## Findings

No actionable P0, P1 or P2 mismatch remains.

## Follow-up polish

- [P3] The implementation is slightly taller than the generated mock because the shared `LabeledSlider` contract uses a label row above each track at a real 320 px width. This preserves readable labels and full-width hit targets; compressing to the mock's same-line rows would require a broader shared layout change.

## Final result

final result: passed
