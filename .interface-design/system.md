# shaderlab — operational design-system summary

Full source of truth: `docs/design-system/`.
Approved 2026-07-13. Theme: `darkroom-balanced`.

## Direction

- Windows desktop creative instrument; dark-only v1.
- Warm darkroom charcoal + paper-white text; image carries creative color.
- Color is semantic only: mask red, danger red, warning amber, success green.
- Compact density: 13px UI, 11–12px metadata, 28–32px controls, 36px toolbar.
- Technical-soft geometry: 5px controls, 7px groups, 8px panels, 10px dialogs.
- Sliders: compact dark track with a light thumb and a 30px editable monospace value field; typed values accept a comma decimal separator and retain the slider's range and step.
- Borders + surface shifts only; no shadows, SaaS cards or decorative accents.
- Segoe UI Variable for UI; Cascadia Mono/Consolas for values.
- Lucide only, 14/16/20px, 1.5px stroke.

## Token contract

Three layers: primitive -> semantic -> component. Components never consume raw
primitives or hardcoded visual values. Theme values live in CSS; docs explain
intent. V1 ships one theme but semantic mappings keep future themes possible.

## Layout

- Canvas dominant.
- Single adjustable/collapsible inspector on the right.
- Collapsible session filmstrip at bottom.
- Toolbar contains frequent commands only.

## Interaction

- Apple desktop HIG principles adapted to Windows conventions.
- WCAG 2.2 AA target, full keyboard access, 2px focus-visible ring.
- Feedback 80–120ms; disclosures 180ms; no bounce or decorative motion.
- `prefers-reduced-motion` supported.

## Required references before UI work

- `docs/design-system/foundations.md`
- `docs/design-system/tokens.md`
- `docs/design-system/components.md`
- `docs/design-system/patterns.md`
- `docs/design-system/content.md`
- `docs/design-system/governance.md`

Do not revive the old blue accent or legacy Vite/inline styles during migration.
