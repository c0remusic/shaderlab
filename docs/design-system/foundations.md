# Shaderlab Design System — Foundations

> Status: approved for implementation, 2026-07-13.
> Theme recipe: `darkroom-balanced`.
> Platform: Windows desktop, dark-only in v1.

## Purpose

Shaderlab is a focused creative instrument for applying GPU shader effects to
photographs. The interface must support long, precise editing sessions while
remaining visually subordinate to the image.

The system is designed for one person working locally on Windows with mouse,
keyboard and high-resolution displays. It targets professional control for the
specialized shader workflow, not general Photoshop parity.

## Design intent

- **Domain:** darkroom, optical bench, light table, contact sheet, film grain,
  spectral separation and ordered effect passes.
- **Color world:** warm graphite, matte black, silvered paper, baryta white,
  safelight red, warning amber and confirmation green.
- **Signature:** calibrated parameter rails, tabular readouts and an ordered
  effect path that reads like an optical instrument.
- **Reject:** SaaS cards, decorative brand accents, large pills, floating
  shadows, colorful chrome and generic dashboard composition.

The image carries creative color. Interface color always communicates state.

## Core principles

1. **Content first.** The canvas receives all space not required by controls.
2. **Direct manipulation.** Painting, zooming and parameter changes respond
   immediately and track the pointer without decorative easing.
3. **Progressive disclosure.** Frequent controls remain visible; advanced
   controls live in collapsible inspector sections, not nested modal flows.
4. **Calibrated precision.** Values expose units, ranges and tabular numbers.
5. **Recoverability.** Destructive editing actions are undoable; irreversible
   file operations require confirmation.
6. **Chromatic restraint.** Warm neutrals structure the UI. Red, amber and green
   are semantic only. Mask red is a separate semantic role from danger red.
7. **Quiet hierarchy.** Surface shifts and low-opacity borders establish depth;
   shadows do not.
8. **Platform respect.** Apple desktop HIG principles guide quality, while
   Windows conventions control shortcuts, dialogs, window chrome and behavior.

## Apple HIG adapted to Windows

Shaderlab follows applicable Apple desktop guidance:

- use large displays to expose content with fewer nested levels;
- allow windows and work areas to resize, hide and reveal;
- support precision pointer input and full keyboard workflows;
- place only frequent commands in the toolbar;
- keep all important commands discoverable outside icon-only controls;
- provide clear hierarchy, consistency, feedback and recoverability;
- never rely on color alone;
- support reduced motion and text scaling.

Windows conventions take precedence when platform behaviors differ:

- `Ctrl`, not `Command`, for shortcuts;
- native Windows file dialogs and window management;
- Windows terminology and focus behavior;
- no Liquid Glass imitation and no SF Symbols.

References:

- [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/)
- [Apple HIG accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/)
- [Apple HIG toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars/)

## Theme direction: darkroom-balanced

The v1 theme is dark-only. It uses warm charcoal surfaces and broken-white text
to evoke photographic materials without tinting the canvas itself.

- Canvas surround: near-black warm charcoal.
- Panels: subtle warm elevation steps.
- Text: paper-white at controlled opacity.
- Selection: neutral light fill and edge, not a brand hue.
- Mask: safelight red.
- Danger: distinct red role with text/icon reinforcement.
- Warning: amber.
- Success: restrained green.

Theme values may iterate independently from token names and component APIs.
Every iteration must be compared on the same reference screens.

## Density and geometry

- Base spacing unit: 4 px, with 2 px available for optical adjustments.
- Primary UI text: 13 px.
- Metadata and values: 11–12 px. Informational tertiary text keeps at least
  4.5:1 contrast; lower-contrast disabled text does not carry information.
- Common controls: 28–32 px high.
- Toolbar: 36 px high.
- Geometry: technically softened, not pill-shaped.
- Radius scale: 5 px controls, 7 px groups, 8 px panels, 10 px dialogs.

## Depth

Depth uses surface color shifts and borders only.

- Inputs are darker than their container to read as inset.
- Raised surfaces are slightly lighter than panels.
- Popovers and dialogs use stronger borders and scrims, not drop shadows.
- Borders must be visible when sought, not the first element perceived.

## Typography and icons

- UI: `Segoe UI Variable`, then `Segoe UI`, then system sans-serif.
- Numeric readouts: `Cascadia Mono`, then `Consolas`, then monospace.
- Icons: Lucide only, optical stroke 1.5 px, sizes 14/16/20 px.
- Icon-only actions require an accessible name and tooltip.
- Icons clarify actions; they are not decoration.

## Accessibility baseline

- Target WCAG 2.2 AA contrast for text and controls.
- Full keyboard access for every function except the physical paint gesture.
- Visible 2 px focus indicator independent from selection color.
- DOM and tab order match visual order.
- Controls expose accessible label, role, value, unit and state.
- UI remains functional at 200% Windows text scaling.
- Status is conveyed through text/icon/shape in addition to color.
- Critical messages never disappear on a timer.
- `prefers-reduced-motion` removes spatial and decorative motion.

## Source-of-truth model

1. This suite documents intent and contracts.
2. `src/design/*.css` will contain executable token values.
3. `src/ui/*` will contain primitive interaction behavior.
4. Product components consume primitives and semantic tokens.
5. `.interface-design/system.md` is a short operational index, not a competing
   source of truth.
