# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Layout: **single-context** — one glossary at the root, no `CONTEXT-MAP.md`, no
per-package contexts (no workspaces, no `packages/`).

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain glossary. Maintained by the
  `interview` skill; `CLAUDE.md` requires reading it before any work that
  manipulates domain vocabulary.
- **`.claude/decisions/`** — the **canonical** decision record (18 ADRs at the
  time of writing). Enter through `.claude/decisions/INDEX.md`: one line per
  ADR, each carrying its `[statut]`. An ADR marked `superseded` is **not** an
  active constraint (ADR-0003 was reversed by ADR-0004 the next day).
- **`docs/adr/`** — a second, older set of four implementation ADRs (guided
  filter uniform buffers, overlay guide epoch, master tracks design system,
  edge-aware mask guide image). Still valid, still worth reading when you touch
  the mask/overlay code. Not indexed.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

⚠️ **The two ADR folders have separate numbering spaces, and they collide.**
`ADR-0004` is `.claude/decisions/ADR-0004-sens-causal-pile-calques.md`; `0004`
is also `docs/adr/0004-image-de-guide-du-masque-edge-aware.md`. Always cite the
folder, never a bare number.

## File structure

```
/
├── CONTEXT.md                     ← domain glossary (interview skill)
├── CLAUDE.md · AGENTS.md · ARCHITECTURE.md
├── .claude/decisions/             ← canonical ADRs, entered via INDEX.md
│   ├── INDEX.md
│   ├── ADR-0001-densite-ui-controles-repetes.md
│   └── …
├── docs/
│   ├── adr/                       ← 4 older implementation ADRs, unindexed
│   ├── ROADMAP.md                 ← what remains
│   └── INDEX.json                 ← per-chantier status
└── src/
```

A multi-context split (root `CONTEXT-MAP.md` + one `CONTEXT.md` per context)
would be signalled by workspaces or a populated `packages/`. Neither exists
here — don't introduce one.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

The project's own vocabulary is **French** and precise (calque, masque, pile,
passe, mire, verrou de pixels, encre, matière). Keep it in French even when the
surrounding prose is English; these terms name real code and real files.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts `.claude/decisions/ADR-0008` (un effet ne se pose jamais sur un calque photo) — but worth reopening because…_

Check the ADR's status first. Contradicting a `superseded` ADR costs nothing.

## Where the code wins

`CLAUDE.md` states the arbitration order explicitly: on a contradiction, the
**code** decides, then `ARCHITECTURE.md`. `docs/INDEX.json` and
`.superpowers/sdd/progress.md` have both been caught reporting a slice as done
that wasn't — verify on disk before trusting a status.
