# Issue tracker: Local Markdown

Issues and specs (you may know a spec as a PRD) for this repo live as markdown files in `.scratch/`.

Chosen over GitHub Issues deliberately. The repo **does** have a GitHub remote
(`c0remusic/shaderlab`) and an authenticated `gh`, and it has **zero** issues —
work is tracked in-repo. Do not fall back to `gh issue ...` just because a
remote exists.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Where the existing specs live (read-only history)

`.scratch/` is the destination for **new** work, and did not exist before this
file. Specs written under earlier conventions are elsewhere and stay there —
read them, don't migrate them:

- `docs/superpowers/specs/` — design and porting plans (the bulk of them)
- `PRD.md`, `PRD-print-export.md`, `PRD-floating-panel-rail.md` at the repo root
- `docs/ROADMAP.md` — the only document in the repo that says what **remains**;
  read it before reconstructing a backlog from memory
- `docs/INDEX.json` — per-chantier status. Known to run optimistic against the
  actual state of the code; verify on disk before concluding a slice is done.

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## Concurrency warning

Sessions and git worktrees have collided on this repo before. A local-markdown
tracker is plain files in the working tree, so two sessions **share** a ticket's
`Status:` only when they share a worktree, and diverge silently when they don't.
Run `git worktree list` before treating a `Status:` line as authoritative.
