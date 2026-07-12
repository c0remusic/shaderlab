# Registre des skills / agents / plugins — shaderlab

> Consulté avant d'invoquer un outil (règle impérative de routage,
> `~/.claude/CLAUDE.md`). Même règle d'entretien que `docs/INDEX.json` :
> mise à jour dans le même geste que tout changement de verdict.
>
> Créé le 2026-07-12 (réplication de l'architecture de travail Sift).
> Projet jeune : verdicts encore peu nombreux, s'étoffera à l'usage.

## Verdicts actés (2026-07-12)

| Outil | Verdict | Preuve |
|---|---|---|
| `superpowers:brainstorming` → `writing-plans` → `subagent-driven-development` | **Défaut** pour tout le cycle design→implémentation | Cycle complet utilisé pour le MVP (design.md audité, plan 16 tâches, exécution en cours) |
| Sous-agent `general-purpose` en reviewer adverse | **Défaut** pour audits de spec et revues de tâche | Audit design.md : 3 vrais trous trouvés (espace colorimétrique, contrat Lightroom, VRAM). Revue Task 1 : 2 Critical réels trouvés (feature v1 inexistante en v2, structure inversée) |
| Modèles par rôle (sizing) | haiku = transcription de plan/fixes mécaniques ; sonnet = spike/intégration/review | Task 1 impl en haiku OK mais scaffold main écrit → 2 fix passes ; Task 2 (risque) en sonnet clean du premier coup |
| Vérification visuelle par sous-agent | **INTERDIT** — sous-agents headless | Task 1 : implémenteur a pris "Waiting for frontend dev server" pour une preuve de compilation. Checkpoints humains à la place (décision utilisateur) |
| `computer-use` pour vérif visuelle | **Écarté** (décision utilisateur) | Proposé après Task 1, utilisateur préfère vérifier lui-même aux checkpoints |
| Skills design (`design-flow`, `ui-ux-pro-max`, `interface-design`...) | **Pas encore évalués** pour ce projet | UI v1 = 3 panneaux fonctionnels (Task 11) ; réévaluer si/quand une passe de polish UI est demandée |

## Packs de contexte (sizing)

- **Tâche moteur de rendu/effets** : design.md (sections Architecture +
  Barre de qualité), le fichier effet concerné, `src/render/renderer.ts`,
  `src/render/gpuContext.ts`.
- **Tâche UI** : design.md (section UI), `src/components/*`, `src/App.tsx`,
  `src/layers/*`.
- **Tâche intégration Lightroom/export** : design.md (section Contrat de
  round-trip), `src/launch.ts`, `src-tauri/src/lib.rs`, `src/export/*`.
- **Reprise de session** : `.superpowers/sdd/progress.md` (ledger) + ce
  fichier + `docs/INDEX.json`. Ne jamais re-dispatcher une tâche marquée
  complete dans le ledger.
