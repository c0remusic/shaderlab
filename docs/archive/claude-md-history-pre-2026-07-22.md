# Historique CLAUDE.md — archivé le 2026-07-22

> Ce fichier est une archive, hors du path scanné activement en session (règle
> globale `~/.claude/rules/workflow.md` § Politique doc-rot : un bandeau
> d'historique chronologique laissé au même niveau que le code vivant devient
> un doc-rot — le code diverge, la session future s'aligne sur une réalité
> périmée). Contenu déplacé tel quel depuis le haut de `CLAUDE.md` (bloc
> narratif de sessions 2026-07-12 → 2026-07-21), sans réécriture. Le statut
> COURANT d'un chantier/plan se lit dans `docs/INDEX.json`, pas ici.

---

> Nom provisoire (placeholder, jamais tranché — même logique que track-finder).
> Repo local `C:\dev\shaderlab`, pas encore de remote GitHub. (Déplacé depuis
> `C:\Users\LEETJ\Desktop\shaderlab` — l'ancien chemin n'existe plus ; une
> relocalisation d'un repo Tauri exige un `cargo clean` COMPLET : le cache
> `target/` contient des chemins absolus périmés qui cassent le build-script.)
> Branche de dev active : `feature/design-system` (plan design system Tasks
> 1-10, MVP mergé sur master). `feature/archi-remediation` (11-task
> remédiation archi + fix OOM peinture au masque, voir `src/render/maskUpload.ts`)
> a été MERGÉ dans `feature/design-system` le 2026-07-16 (divergence à `0a2e151`,
> jamais reconvergée avant ce merge) — n'est plus un worktree de travail séparé ;
> le worktree `shaderlab-archi-remediation` a été RETIRÉ le 2026-07-16
> (`git worktree remove`, branche `feature/archi-remediation` conservée). Checkpoint
> humain visuel du fix dirty-rect toujours EN ATTENTE de confirmation (voir
> `docs/INDEX.json`). `design-system-mine` : commits superseded (worktree retiré
> le 2026-07-16, branche conservée) — voir la mémoire projet
> `design-system-branch-reconciliation`. ✅ Le crash de peinture au masque à
> 24MP est RÉSOLU le 2026-07-18 (`e3c7584`) : la cause n'était NI le GPU NI le
> driver mais le buffer `maskData` r8 de ~26 Mo transitant par le state React,
> qui fait hanger WebView2 au re-render de `setLayers()` en fin de stroke (les 3
> fix précédents — dirty-rect, GPU-copy, wait-for-idle — ciblaient tous le
> GPU/timing, d'où leur échec). Fix : `maskData` hors du state React —
> `layersRef` = source de vérité complète pour rendu/historique/export, le state
> React n'est qu'une projection d'affichage sans `maskData`
> (`src/layers/displayProjection.ts`, `toDisplayLayers`). Règle héritée : garder
> les gros buffers/textures de masque HORS du state React. `device.lost` reste
> remonté à l'UI (`ErrorBanner`, `src/render/gpuContext.ts`). Détails dans
> `.claude/learning-log.md` (entrée 2026-07-18) et le bandeau RÉSOLU de
> `docs/superpowers/specs/2026-07-17-native-wgpu-decision.md`. Tranche
> panneaux flottants (`FloatingPanel`) TERMINÉE le 2026-07-20 : `Inspector.tsx`
> supprimé, magnétisme entre panneaux uniquement (jamais au bord canvas,
> retiré après test), thème neutre façon Photoshop appliqué (tokens Adobe
> Spectrum réels). 2 checkpoints visuels humains en attente. `PRD-floating-panel-rail.md`
> cadré (rail d'icônes dockable) mais PAS implémenté — brainstorming à faire
> en premier. **Tranche 3 masquage** (Tasks 1-6 : edge-aware guided filter,
> refine edge forme-seule, sources paramétriques dégradé/luminosité/range
> couleur, câblage GPU + UI panneau Masque) **codée et review-clean** au
> 2026-07-20 (`.superpowers/sdd/progress.md`), avec UN gap spec RÉEL non
> détecté par la review Steps 10-12 (verdict "spec ✅" trop optimiste,
> basé sur la section Interfaces du brief Task 6 sans relire le corps du
> Step 10) : le plan
> (`docs/superpowers/plans/2026-07-20-shaderlab-masking-tranche3.md:1616`,
> Step 10 point 2) exige une checkbox `enabled` par source de masque dans
> l'UI — jamais livrée, `LayerStack` n'expose que `setMaskEnabled` au
> niveau du masque entier, pas de setter par source. À trancher : ajouter
> `setMaskSourceEnabled`, ou documenter formellement ce point comme différé
> dans le plan lui-même (pas encore fait). Le checkpoint visuel
> final (8 points, Task 6 Step 13) est BLOQUÉ : problèmes
> pré-existants sur `FloatingPanel` (thème incohérent, canvas mal centré,
> imbrication panneaux cassée) découverts en tentant ce checkpoint. 2 bugs
> réels déjà corrigés (`3e4f41c` : compensation centrage canvas doublée par
> erreur ; position Réglages suppose Calques toujours à hauteur max). Suite
> à la demande d'Antoine de rapprocher l'UI de Photoshop en ligne, `FloatingPanel`
> (drag libre + magnétisme + nudge clavier) a été **REMPLACÉ** le 2026-07-20/21
> par `PanelColumn`/`DockedPanelCard` (dock fixe à droite, splitter vertical
> `react-resizable-panels`) : plan `docs/superpowers/plans/2026-07-20-shaderlab-docked-panels.md`
> (8 tâches, review-clean, `src/components/floatingPanel/` entièrement
> supprimé). Le checkpoint visuel humain (Task 8) a été fait via CDP +
> confirmation Antoine EN DIRECT dans la conversation — 3 demandes de suite
> en sont sorties (pas des bugs, des manques identifiés à l'usage) :
> réordonner les cartes par glisser-déposer, redimensionner la colonne en
> largeur, thème visuel encore trop éloigné de Photoshop web. Design doc
> `docs/superpowers/specs/2026-07-21-shaderlab-panel-drag-reorder-design.md`
> + plan combiné `docs/superpowers/plans/2026-07-21-shaderlab-dock-reorder-and-theme-polish.md`
> couvrent 2 des 3 : drag-to-reorder (Tasks 4-7 du plan) et thème réduit à
> une échelle d'ombres nommée (`--shadow-dragging`/`--shadow-popover`, Tasks
> 1-2) + ratio padding boutons (Task 3) — **en cours d'exécution par Codex au
> 2026-07-21** (Tasks 1-5/8 committées au dernier point de contrôle : tokens
> d'ombre, application popovers, padding boutons, extraction
> `src/ui/dragReorder.ts`, migration `LayerPanel` — vérifier `git log` pour
> l'avancement réel avant de repartir dessus). **Redimensionnement en
> largeur de la colonne** (3e demande, 240-400px déjà bornés via
> `--inspector-width-min/max`) : PAS DANS CE PLAN — oublié lors de la
> combinaison des chantiers. Un plan séparé A BIEN été écrit le 2026-07-21
> (`docs/superpowers/plans/2026-07-21-shaderlab-dock-width-resize.md`,
> `2bcae3a`) — ⚠️ ce bandeau affirmait à tort "pas encore écrit" jusqu'au
> 2026-07-21 (trouvé seulement via `git ls-files` complet, jamais relu avant).
> NON exécuté, et maintenant PÉRIMÉ : il cible l'ancienne API
> `panelOrder`/`onReorder` de `PanelColumn`, remplacée le 2026-07-21 par
> `layout`/`onMove` (plan dock-grid, grille 2D) — à réécrire avant toute
> exécution. Un audit clean-code du 2026-07-21 a aussi produit 3 plans dormants
> jamais exécutés (`docs/superpowers/plans/2026-07-21-audit-{mask-integrity,
> document-export-safety,ui-runtime-hygiene}.md` + design
> `docs/superpowers/specs/2026-07-21-audit-remediation-design.md`) — le plan
> mask-integrity Task 3 comble justement le gap checkbox `enabled` par source
> cité plus bas dans ce bandeau. `ADR-0001` (buffers GPU jetables par frame)
> reste valide et appliqué. Le checkpoint Tranche 3 masquage (gap spec
> checkbox `enabled` par source, voir plus haut) reste à refaire une fois
> CE remplacement de panneaux stabilisé — pas encore retenté depuis.
> **MISE À JOUR 2026-07-21 (session checkpoint Task 8)** : `feature/mask-integrity`
> MERGÉ (`769ed60`, gap checkbox `enabled` par source enfin comblé, 3
> worktrees morts nettoyés : `ui-audit-remediation`/`beautiful-wing-eca6ea`/
> `nervous-leakey-2d5e24`). Le checkpoint visuel Task 8 (dock-reorder-and-theme-polish)
> a démarré normalement mais a fait remonter 9 bugs/incohérences réels en
> cours de route (pas de simples ajustements cosmétiques) — tous corrigés
> dans `959d9ed` : hover de "Fichier" totalement cassé (`var(--secondary)`
> inexistant dans une formule `color-mix` Tailwind → transparent au survol),
> `--surface-inset` était le SEUL token resté sur l'ancienne palette chaude
> pré-migration Spectrum (`#141210`, jamais migré le 2026-07-20), Select
> (`src/ui/Select.tsx`) avait 2 bugs d'interaction réels (le listener
> `scroll` capture fermait la liste sur son PROPRE scroll interne ; `scrollIntoView`
> se déclenchait sur `onMouseEnter` et se battait avec un scroll manuel).
> "Masque" extrait de `ParamPanel` en panneau docké séparé (nouveau
> `src/components/MaskPanel.tsx`, 3e carte du dock). Plusieurs rangs de
> padding/espacement corrigés (marge extérieure d'un contrôle plus petite
> que son propre padding interne — violait la règle du socle `rules/ui.md`
> § Espacement). Voir `.claude/learning-log.md` (entrée 2026-07-21) pour le
> pattern méthode extrait de cette session (trop de micro-fixes séquentiels
> — un audit token/CSS large en amont en aurait capturé plusieurs d'un coup).
