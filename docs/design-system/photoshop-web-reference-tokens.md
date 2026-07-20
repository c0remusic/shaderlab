# Référence Photoshop en ligne — tokens réels observés (2026-07-20)

Source : onglet Chrome ouvert sur `photoshop.adobe.com` (session réelle d'Antoine,
inspection en LECTURE SEULE via `claude-in-chrome`, aucune interaction/mutation —
cf. règle NG19). Valeurs extraites par `getComputedStyle` sur les éléments réels
(perçant le Shadow DOM des web components Adobe `UE-*`/`PSW-*`/`SP-*`), pas
estimées depuis un screenshot (règle NG20).

## Constat structurel majeur (à trancher avec Antoine avant d'implémenter)

Photoshop web n'utilise **PAS** des panneaux flottants indépendants comme
`FloatingPanel` (shaderlab) — Calques/Propriétés/Historique sont **dockés en
une seule colonne empilée verticalement** (`UE-PANEL-DOCK`), séparés par un
`.splitter` (poignée de redimensionnement, pas une bordure visible), PAS des
cartes indépendantes avec leur propre ombre/bordure/border-radius chacune.

Ça contredit l'architecture actuelle de `FloatingPanel` (panneaux librement
déplaçables, magnétisme, fantôme de drag — design.md du 2026-07-20,
décision produit déjà actée et implémentée). **Ne pas migrer vers un dock
empilé sans validation explicite d'Antoine** — ça remettrait en cause le
système de drag/magnétisme déjà construit. Cette page documente les VALEURS
(couleur, typo, densité) indépendamment de ce choix structurel.

## Valeurs réelles

| Rôle | Valeur observée |
|---|---|
| Fond panneau/document | `rgb(34, 34, 45)` → en réalité `rgb(34, 34, 34)` (#222222) |
| Titre de panneau (`<h4 class="panel-title">`) | 16px, weight 700, `rgb(219,219,219)`, **PAS d'uppercase**, letter-spacing normal |
| Texte de ligne (nom de calque) | 14px, weight 400, `rgb(219,219,219)` normal / `rgb(255,255,255)` sélectionné |
| Largeur de panneau | 320px (shaderlab actuel : `--inspector-width-default` = 288px) |
| Border-radius du cadre externe (`UE-PANEL-FRAME`) | 8px — mais 0 sur le contenu interne (`.surface`), le radius vient du conteneur qui clippe |
| Ombre portée | **AUCUNE** (`box-shadow: none` partout observé) — design plat, pas de `shadow-panel-resting` façon carte |
| Séparation entre panneaux empilés | Pas de bordure visible détectée entre Calques et Propriétés au point sondé — juste le `.splitter` (poignée), l'espacement suffit visuellement |
| Police | `adobe-clean, "Adobe Clean", "Source Sans Pro", -apple-system, ...` — **propriétaire Adobe, ne pas reproduire** (droits), shaderlab garde sa propre police (Inter/Space Grotesk) |
| Barre du haut (`UE-HEADER-CONTAINER`) | Même fond que les panneaux, 56px de haut |

## Écarts avec le thème actuel shaderlab (`src/design/*.css`)

- shaderlab utilise déjà des ombres de panneau (`--shadow-panel-resting` sur
  `.floating-panel`) — Photoshop web n'en a aucune. Si on veut se rapprocher
  du flat design observé, retirer/réduire drastiquement cette ombre serait
  cohérent (mais change le look "carte flottante" actuellement choisi pour
  FloatingPanel — cf. constat structurel ci-dessus, ombre = un des signaux
  visuels qui fait qu'un panneau flottant SE LIT comme flottant plutôt que
  docké ; à trancher ensemble, pas une simple substitution de valeur).
- Titre de panneau shaderlab actuel : `.floating-panel__title` est en
  `text-transform: uppercase` + `letter-spacing: var(--tracking-label)`
  (`FloatingPanel.css:45-54`) — Photoshop web n'a NI uppercase NI
  letter-spacing sur son `.panel-title`. Écart net, facile à corriger si
  voulu.
- Largeur : 288px (shaderlab) vs 320px (Photoshop web) — mineur, ajustable.

## Prochaine étape

Ce fichier est une référence de valeurs, pas un plan d'implémentation. Le
chantier thème/positionnement des panneaux (chip lancé le 2026-07-20,
session séparée) peut s'en servir directement pour ses choix de tokens —
notamment sur la question ombre/flat et l'uppercase des titres. La question
structurelle (dock empilé vs flottant) reste HORS scope de ce chantier tant
qu'Antoine ne l'a pas explicitement demandée.
