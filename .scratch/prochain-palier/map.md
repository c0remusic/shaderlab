# Carte — Le prochain palier de shaderlab

Label : `wayfinder:map`
Chartée le 2026-08-11, depuis un balayage mesuré sur disque (pas repris des docs).

## Destination

Le prochain palier a sa route dégagée : **composition** (formes, typographie),
**recadrage**, **lisibilité et complétude de l'interface**, et les **chantiers
dormants** trouvés au balayage du 2026-08-11 ont chacun soit une décision prise
et un plan écrivable, soit une sortie de portée écrite — le tout sans rendre
l'export print 16-bit plus cher à introduire ensuite.

L'axe interface est entré le 2026-08-11 sur demande d'Antoine : rendre lisibles
les menus et les fonctions, et compléter par ce qui manque — instruit par
comparaison avec Photoshop et Lightroom, sous la règle du dépôt (« le doublon
se mesure avant de s'écrire ») et sous ADR-0001.

Fin de carte = plus aucun arbitrage bloquant entre ici et le premier
implémenteur. La carte produit des **décisions**, pas du code.

## Notes

**Domaine et lectures obligatoires** : `CLAUDE.md` (règles permanentes),
`CONTEXT.md` (vocabulaire), `ARCHITECTURE.md` (couches, ports de test),
`docs/ROADMAP.md` (ce qui reste), `.claude/decisions/INDEX.md` (ADR actifs —
citer le DOSSIER, jamais un numéro nu : `docs/adr/` a sa propre numérotation
qui recouvre celle-ci).

**Skills à consulter** : `/grilling` et `/domain-modeling` par défaut ;
`/prototype` quand la question est « à quoi ça ressemble » ; `/research` pour
tout ce qui vit hors du dépôt ; `/run-shaderlab` pour toute preuve visuelle.

**Contrainte permanente de cette carte** — issue de la destination : l'export
print est **réel mais lointain**. Aucune décision de cette carte ne doit rendre
le passage en 16-bit plus cher. La forme opposable de cette contrainte est
produite par [Ce que coûte d'attendre le 16-bit](issues/02-cout-d-attendre-le-16-bit.md) ;
tant qu'elle n'est pas écrite, chaque ticket note simplement où il touche le
chemin de rendu.

**Préférences de méthode, payées cher, non négociables ici** :

- **Mesurer sur disque avant de conclure.** `docs/INDEX.json` et
  `.superpowers/sdd/progress.md` ont tous deux été pris en défaut optimiste.
  Un statut de doc n'est vrai qu'à la date de sa mesure — un champ de
  `INDEX.json` a survécu 9 jours à sa propre réfutation.
- **L'index d'un paramètre est PERSISTÉ dans les presets.** `params[]` ne se
  réordonne jamais ; on ajoute une entrée à la FIN d'une liste de choix,
  jamais au milieu.
- **Un doublon se mesure avant de se retirer**, et la mesure répond souvent
  deux choses (cf. ADR-0016 : 0,005 % d'écart sur un axe, 23,1 % sur l'autre).
- **Demander les photos d'Antoine avant de raffiner sur des références
  publiques** — deux passes sur trois économisées sur `lensFlare`.
- **Avant tout dispatch** : `git worktree list` ET `git log --oneline -3`.
  Des sessions concurrentes ont déjà collisionné sur ce dépôt.

## Decisions so far

<!-- une ligne par ticket clos : le gist, puis le lien pour le détail -->

- [Ce dont le 16-bit a besoin hors du dépôt](issues/01-ce-dont-le-16-bit-a-besoin-hors-du-depot.md)
  — faisabilité **acquise** (`rgba16float` sans aucune feature, crate TIFF+ICC
  déjà en dépendance, matrice à 4 coefficients) ; mais l'invariant « sRGB par
  le FORMAT » **ne survit pas** au flottant, et toute la mesure a été prise
  dans Edge, pas dans le WebView2 réel.
- [Ce que Photoshop et Lightroom rendent lisible](issues/09-ce-que-photoshop-et-lightroom-rendent-lisible.md)
  — 31 mécanismes sourcés, dont cinq à accrochage existant ; et une troisième
  voie sur `appliesWhen` (faner au lieu de masquer) que nous n'avions jamais
  instruite. Trois absences que le ticket AFFIRMAIT étaient fausses.
- [Quelles fonctions de Photoshop et Lightroom compléteraient les nôtres](issues/10-quelles-fonctions-completeraient-les-notres.md)
  — 12 instruites, 8 écartées en doublons, 5 rejetées sur la règle « ce qui ne
  se crée pas en postproduction doit être dit » ; les **quatre modes de fusion
  non séparables** dominent, seul candidat dont l'absence se prouve par la
  FORME de l'opérateur.

## Not yet specified

Brouillard en portée, pas encore assez net pour être ticketé.

- **Le design d'effet des formes** — rendu vectoriel sur GPU, anticrénelage,
  quelles primitives. Suspendu à la réponse de
  [Une forme a-t-elle besoin de `contentSource`](issues/03-une-forme-a-t-elle-besoin-de-contentsource.md) :
  selon qu'une forme est un effet ordinaire ou un troisième genre de calque,
  ce n'est pas le même design ni le même nombre de tickets.
- **Le plan du recadrage et du miroir** — suspendu à
  [Ce qui reste du design de parité du calque photo](issues/05-ce-qui-reste-du-design-de-parite-du-calque-photo.md).
  Le geste touche `LayerState`, la couche la plus partagée du projet
  (`render/`, `mask/`, `export/`, `components/`, `application/`), donc le plan
  s'écrit avant la première ligne — mais son design §3.1 a été partiellement
  renversé par le passage à deux échelles du 2026-07-31, donc on ne sait pas
  encore quel plan.
- **Ce que devient le dock** — trois questions voisines dont on ne sait pas
  encore si elles font un ticket ou trois : la largeur redimensionnable
  (décidée le 2026-07-21, « plan séparé après celui-ci », jamais écrit) ; le
  saut de 6 px quand la barre de défilement apparaît (326 px pour 320 annoncés
  — `flex-shrink` et `scrollbar-gutter` tous deux testés inefficaces) ; et le
  finding P1 de `docs/design-qa/2026-08-04-dock-flat-workspace.md`, « sens de
  *plein écran* non déterminé », qui demande explicitement un arbitrage avant
  toute mutation de layout.
- **Le tri restant du cahier de postproduction** — trois des cinq points de
  `docs/superpowers/specs/2026-08-03-references-postproduction.md` sont
  ouverts. Le plus flou : « ce qui ne se crée pas en postproduction doit être
  DIT et non simulé » — on ne sait pas encore si c'est de la documentation, un
  refus d'effet à écrire en ADR, ou rien.
- **Ce que le jugement esthétique fera remonter** — bloc 1 du ROADMAP, six
  sujets, planche de contact déjà publiée. Ce sont des VALEURS à ajuster et
  non du code (le Dépoli du verre, les cinq pavés jamais vus sur photo, les
  deux défauts probables du light leak), mais on ne sait pas lesquelles avant
  qu'Antoine ait regardé.

## Out of scope

Ruled beyond the destination. Ne graduent jamais.

- **L'implémentation de l'export print elle-même** — pipeline 16-bit,
  encodeur TIFF, conversion de gamut, ICC. Réel mais lointain (arbitrage
  d'Antoine, 2026-08-11) : cette carte n'y va pas, elle en garde seulement la
  contrainte. `PRD-print-export.md` reste valide et dormant ; le rouvrir sera
  une carte à lui.
- **La suppression des branches mortes** — mesurée le 2026-08-11 :
  `claude/lucid-vaughan-6f8fc7` est superseded par `master`,
  `claude/wonderful-thompson-fd0488` est déjà dans `master` (`87cf44f`),
  `feature/dock-width-resize` / `claude/quizzical-hofstadter-b276ac` /
  `worktree-agent-af9e8ffc69359d5ab` sont à 0 commit d'avance. Aucune décision
  à prendre, rien de bloqué : c'est une corvée, pas une étape de la route. Le
  sort de `sat-feather`, lui, EST une décision — voir son ticket.
- **`PRD-floating-panel-rail.md`** — cadre un rail pour `FloatingPanel`,
  composant supprimé le 2026-07-21, et le rail a été livré autrement (panneaux
  contextuels, 2026-07-25/26). PRD zombie : une suppression et une ligne de
  note, aucune décision.
- **`docs/adr/0003-master-tracks-feature-design-system.md`** — décrit l'inverse
  de la réalité mesurée (`master` est à 393 commits d'avance sur
  `feature/design-system`, qui n'a rien en retour). Corvée de documentation,
  sauf si [Le sort de `sat-feather`](issues/07-le-sort-de-sat-feather.md)
  rouvre la question de la branche canonique — auquel cas elle y est traitée.

### Corrections de documentation mesurées, en attente d'un geste

Aucune n'est une décision — ce sont des faits vérifiés le 2026-08-11 contre
des documents qui disent autre chose. Elles sont consignées ICI parce que la
faute que cette carte diagnostique est précisément celle-là : signaler et
oublier. À appliquer d'un seul geste, pas une par une.

| Document | Ce qu'il dit | Ce que le disque dit |
| --- | --- | --- |
| `CONTEXT.md:259`, `ARCHITECTURE.md:565`, `ARCHITECTURE.md:615` | `MAX_PHOTO_LAYERS = 4` | **5** (`src/layers/photoLayer.ts:66`). Le risque VRAM R1 d'`ARCHITECTURE.md` est chiffré sur le mauvais plafond |
| `CLAUDE.md:84` | la config du canvas est en `gpuContext.ts:64-78` | **lignes 155-164** — la citation se trompe de ~90 lignes, dans le fichier que chaque session lit |
| `docs/ROADMAP.md` §2 | le recadrage « ne dépend d'aucun arbitrage », « le SEUL item prêt à coder » | son design §3.1 a été partiellement renversé par le passage à deux échelles du 2026-07-31 — voir [Ce qui reste du design de parité du calque photo](issues/05-ce-qui-reste-du-design-de-parite-du-calque-photo.md) |
| `docs/design-system/photoshop-web-reference-tokens.md` § Constat structurel majeur | met en garde contre un dock empilé, au nom de `FloatingPanel` | `FloatingPanel` est supprimé depuis le 2026-07-21 ; la mise en garde vise un composant qui n'existe plus |
| `docs/INDEX.json` | n'a **aucune** entrée pour `2026-07-26-shaderlab-photo-layer-parity-design.md` | ce design est cité par `CONTEXT.md`, `PRD.md` et quatre fichiers source |
