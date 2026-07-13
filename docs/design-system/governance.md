# Shaderlab Design System — Governance

## Scope and ownership

The design system governs visual tokens, primitive interactions, reusable
components, product patterns, content rules and accessibility behavior.

It does not own WebGPU rendering, effect parameter schemas or domain state. It
defines how those concepts are presented and manipulated.

## Repository contract

Target implementation structure:

```text
src/design/
  primitives.css
  semantic.css
  components.css
  motion.css
  reset.css

src/ui/
  Button/
  IconButton/
  Slider/
  NumberField/
  Select/
  Menu/
  Tooltip/
  Dialog/
  Progress/
  Disclosure/
  ScrollArea/
```

- CSS files are the executable token source of truth.
- Documentation explains intent and contracts.
- UI primitives own generic interaction behavior.
- Product components own domain binding only.
- Inline visual styles are prohibited after migration.

## Adding a token

A token may be added when:

1. no existing semantic role expresses the intent;
2. at least two real uses need it, except accessibility requirements;
3. its layer and naming are correct;
4. darkroom-balanced receives a value;
5. contrast and reference screens are revalidated.

Do not add tokens named after a page, component instance or literal visual
value, such as `--glow-panel-gray` or `--blue-500` in component code.

## Adding a component

A primitive requires:

- responsibility and non-responsibilities;
- variants and sizes;
- complete state matrix;
- keyboard behavior;
- accessible role/name/value/state;
- token mapping;
- reduced-motion behavior;
- specimen-board example;
- tests proportional to interaction complexity.

Create a product-specific component instead when the abstraction would have
only one use or leak domain behavior into the primitive API.

## Versioning

Architecture and theme recipe are versioned separately.

- Patch: documentation clarification or nonvisual correction.
- Minor: compatible token value, new variant or new component.
- Major: token removal/rename, behavior change or incompatible component API.

Deprecated tokens/components remain available for one migration cycle and are
documented with replacement and removal target.

## Theme iteration

Theme recipes may change without renaming semantic tokens.

Every iteration is compared on:

1. workspace with photo;
2. inspector with selected layer;
3. mask overlay active;
4. filmstrip with mixed modified states;
5. export progress;
6. empty state;
7. warning and error states.

Record the recipe name, rationale, screenshots and decision. Keep only the
approved executable recipe; archive rejected explorations outside production
CSS.

Current approved recipe: `darkroom-balanced`.

## Required validation

Before merging a design-system or UI change:

- build and type-check pass;
- no hardcoded visual values are introduced outside token definitions;
- component states are present on the specimen board;
- keyboard-only workflow is exercised;
- focus order and focus visibility are inspected;
- text and control contrast meet WCAG 2.2 AA targets;
- layouts are checked at minimum, standard and wide window sizes;
- Windows scaling is checked at 100%, 150% and 200%;
- reduced-motion behavior is checked;
- visual before/after evidence is captured for theme changes.

GPU-backed behavior still requires a human visual checkpoint, consistent with
the project’s existing verification rule.

## Automated guardrails to plan

- lint hardcoded colors, spacing, radii, motion durations and z-index values;
- disallow imports from primitive token files in product components;
- validate token reference cycles and undefined custom properties;
- test keyboard behavior of custom controls;
- run accessibility checks on non-GPU component specimens;
- keep a screenshot suite for reference states where practical.

These guardrails belong in the implementation plan; this document does not add
dependencies by itself.

## Review checklist

For each UI review, ask:

- Does the canvas remain dominant?
- Is color functional rather than decorative?
- Does the component use semantic/component tokens only?
- Are hover, pressed, selected, focus, disabled, loading and error distinct?
- Can the action be completed with keyboard?
- Is status understandable without color?
- Does text say what happened and what to do next?
- Does the interface remain usable at 200% scaling?
- Does the change preserve darkroom-balanced rather than drift toward a generic
  dashboard or another project’s identity?

## Known migration work

The current code predates this system. Implementation must explicitly address:

- legacy Vite styles in `src/App.css`;
- flat tokens in `src/index.css`;
- inline styles in React components;
- native select styling;
- incomplete state and keyboard behavior;
- current blue accent, which is superseded by the neutral darkroom recipe.

Do not mix this migration into unrelated rendering changes without a written
task boundary.
