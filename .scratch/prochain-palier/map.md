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
le passage en 16-bit plus cher. ✅ **Sa forme opposable est écrite** (mesurée le
2026-08-12, [Ce que coûte d'attendre le 16-bit](issues/02-cout-d-attendre-le-16-bit.md)) :

> **Tout site qui choisit un format de texture COULEUR reçoit `srgbFormat` par
> injection — jamais une constante littérale, jamais un format déduit sur
> place.** Une décision (`gpuContext.ts:160`), quatorze lecteurs, zéro format
> en dur : c'est cette propriété qui rend le 16-bit introduisible plus tard.
> La préserver coûte zéro ; la perdre coûte une chasse dans huit fichiers.
>
> **Corollaire : un effet ne choisit JAMAIS de format.** S'il semble en avoir
> besoin, c'est la conception qui est fausse — le patron est
> `textureLibraryStore`, où le STORE choisit et l'effet consomme.

Bonne nouvelle pour le reste de la carte : **formes, typographie et recadrage
ajoutent ZÉRO site à la facture 16-bit**, un effet ne voyant jamais le format.

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

## Notes de sortie de session — 2026-08-16

⚠️ **La CI de `master` est VERTE** (run `31986492689`), pour la première fois
depuis au moins le 2026-08-01. Les trois tickets ouverts par les sessions des 15
et 16 août — [20](issues/20-ou-vit-l-etat-de-repli-de-la-pile.md),
[21](issues/21-le-gate-wgsl-est-rouge-en-ci.md),
[22](issues/22-layerpanel-rouge-en-ci-vert-en-local.md) — sont tous `resolved`.

**Ce qui reste sur cette carte est ce qui y était avant** : onze tickets
d'arbitrage de fond (formes, typographie, parité du calque photo, masquage,
lisibilité, migration shadcn, les trois fronts des contrôles, le coût du verre).
Aucun n'est un reste de ces deux sessions.

## Decisions so far

- **Arbitrages d'Antoine du 2026-08-15**, pris sur planches et sur mesures :
  - **Le verre reçoit son mipmap de diffusion.** Seul levier qui attaque les
    7,4 ms par lecture au lieu de les compter. Écartées explicitement : ne rien
    changer (~10 images/s), et baisser la résolution pendant le geste — qui
    contredirait « pas de distinction preview/export ». Prix connu d'avance :
    18 références de verre à régénérer et à relire.
    Détail : [19](issues/19-le-cout-du-verre.md).
  - **`lensFlare` : trois interrupteurs CUMULABLES**, pas un sélecteur exclusif
    — un objectif produit les trois phénomènes à la fois (ADR-0017). Livré le
    2026-08-14, applicabilité mesurée à 0,000 % avant d'être déclarée.
  - **La pile se replie par groupes**, avec le filet, et la ligne sélectionnée
    devient un bloc décalé dont la barre bleue est l'arête (variante C,
    implantation c1) ; décalage porté de 14 à 20 px. Trois wireframes sous
    `docs/wireframes/pile-longue*.html`. Ce qui reste ouvert est le MODÈLE :
    [20](issues/20-ou-vit-l-etat-de-repli-de-la-pile.md).


<!-- une ligne par ticket clos : le gist, puis le lien pour le détail -->

- [Le coût du verre](issues/19-le-cout-du-verre.md) — **RÉSOLU le 2026-08-17.**
  Le mipmap de diffusion est livré et mesuré en production : **13,6 → 39,9
  images/s** au réglage courant, 47,4 sur la course complète d'Épaisseur. La
  cible d'usage d'Antoine (« le confort au pointeur ») est atteinte. Mécanisme :
  `EffectModule.sourceMipmaps`, un drapeau déclaratif servi par une COPIE à
  pyramide — donner la pyramide aux cibles de ping-pong faisait sortir la frame
  NOIRE, sans que `tsc` en dise rien. ⚠️ Le plafond de niveau a d'abord été posé
  à 1 sur une mesure « à niveau forcé » qui ne prédisait pas une implantation « à
  niveau dérivé » : la corriger a doublé le gain. Un plafond vérifié à UN point
  de fonctionnement ne vaut pas sur toute la course.

- [Une forme a-t-elle besoin de `contentSource`](issues/03-une-forme-a-t-elle-besoin-de-contentsource.md)
  — **NON, et la question était mal posée**. Arbitrage d'Antoine du 2026-08-17,
  devant le prototype : « c'était pour les masques et la sélection, pas pour un
  effet ». Une forme n'est ni un troisième genre de calque ni un effet — c'est
  une façon de SÉLECTIONNER une région. La voie A perd donc sa justification
  côté formes ; elle est à réexaminer pour la typographie seule (ticket 04).
  ⚠️ Les documents disaient le contraire de lui — le cadrage du 2026-08-05 ne
  contient pas une fois le mot « sélection » — et **c'est le CODE qui a tranché** :
  `mask/sources/types.ts:2` porte une union fermée à trois sources, sans aucune
  source géométrique. Trou franc que ni le ROADMAP, ni le cadrage, ni cette carte
  ne signalaient.
- [À quoi ressemble une forme dans shaderlab](issues/23-a-quoi-ressemble-une-forme-dans-shaderlab.md)
  — ouvert et **résolu le 2026-08-17**. Antoine, mis devant le périmètre du
  ticket 03 : « je ne sais pas encore — montre-moi ». Prototype construit
  (`src/render/effects/aplat.ts`, une couleur unie bornée par un masque ou par
  une primitive posée) et trois scènes capturées sur sa photo. ⚠️ Il établit que
  **les deux demandes du cahier de postproduction se rendent sans aucune
  géométrie nouvelle** — l'ombre graphique du §393 sort d'une couleur unie plus
  un masque de luminosité, deux pièces qui existaient déjà ; ce qui manquait au
  registre était la couleur unie. Et il montre en creux le seul niveau qui bute
  vraiment sur le modèle : la forme LIBRE, qu'un `array<f32, 48>` ne peut pas
  porter. **Le ticket 03 est débloqué et prêt à trancher.**

- **Arbitrages d'Antoine du 2026-08-13**, pris devant l'app et non sur document —
  ils tranchent des tickets ouverts et en ouvrent d'autres :
  - **`curves` passe en PERÇU** (« pas les points rouges ni l'effet délavé ») —
    tranche le ticket 06 dans le sens « corriger l'effet », pas « amender la
    règle linéaire du dépôt. Casse les deux références de pixels de `curves`, à
    relire à l'œil avant de committer.
  - **`lensFlare` : ses trois phénomènes deviennent trois options
    SÉLECTIONNABLES dans l'effet** — pas trois entrées du registre. La famille
    des halos ne se rouvre donc pas une seconde fois (ADR-0017 tient).
  - **Light leak refusé en l'état** : « très lampe torche, très grossier ». Ce
    n'est pas qu'un réglage de valeurs — la FORME est en cause.
  - **Verre : le grain doit être plus fin, et les matières comparées à de
    vraies photos** avant d'être crédibles. Les espacements des pavés sont
    « très moches » — mesuré depuis : notre rapport joint/pavé (8 px sur 132,
    soit 6,1 %) est pourtant DANS la fourchette réelle (9–15 mm pour 190–200,
    soit 5–8 %), donc le défaut est ailleurs que dans la largeur.
  - **Un wireframe est demandé pour la pile à 7 calques et plus.**
  - **La perf du masque est un blocage d'usage**, re-signalée deux fois.

- [Où vit l'état de repli de la pile](issues/20-ou-vit-l-etat-de-repli-de-la-pile.md)
  — ouvert le 2026-08-15, **RÉSOLU ET IMPLANTÉ le 2026-08-16**. État
  d'INTERFACE (`useCollapsedGroups`), sélection qui remonte au parent au repli
  et revient à l'enfant quitté au dépliage. ⚠️ La mesure a d'abord **réfuté
  l'énoncé** : la question opposait « persisté » à « perdu à la réouverture »
  alors que le projet n'a **aucune persistance de document** — les deux branches
  perdaient. Ce qui les séparait vraiment était l'ANNULABILITÉ (`History.push`
  snapshotte la pile, donc un champ de `LayerState` serait rejoué par l'undo).
  Livré avec chevron, pastille et moignon ; le repli cassait silencieusement la
  conversion d'index du glisser-déposer, refermée par
  `visibleInsertToModelInsert`.
- [La dérogation du gate WGSL est bornée, mais pas comptée](issues/21-le-gate-wgsl-est-rouge-en-ci.md)
  — ouvert le 2026-08-15, requalifié le 2026-08-16, **RÉSOLU le même jour**. La
  dérogation est comptée (attendu DÉRIVÉ, jamais littéral). ⚠️ Et l'épreuve du
  compteur a trouvé pire que ce qu'il comptait : **`naga` colore sa sortie même
  derrière un tuyau**, l'ancre `/^error:/gm` ne matchait donc plus rien, et la
  dérogation était INERTE — gate rouge sous Bash, vert sous PowerShell et en CI.
  Un gate dont le verdict dépend du terminal donne raison au dernier qui l'a
  lancé.
- [`LayerPanel.stories` est rouge en CI et vert en local](issues/22-layerpanel-rouge-en-ci-vert-en-local.md)
  — ouvert le 2026-08-16, **RÉSOLU le même jour**. Ni React, ni ubuntu : c'est
  l'état du **cache de pré-bundling**. Vite découvrait `react/jsx-dev-runtime` en
  cours d'exécution, ré-optimisait et RECHARGEAIT la page — l'arbre React détruit
  en plein rendu, d'où un dispatcher nul. Une ligne d'`optimizeDeps.include`.
  ⚠️ **Vider le cache reproduit la CI en local** : à froid, 5 fichiers tombent ;
  à chaud, 32/32 vert. C'est la manipulation qui manquait, l'énoncé proposant
  trois pistes coûteuses et toutes fausses. Et Vite annonçait la cause en toutes
  lettres — dans un message qui ne contient ni `FAIL` ni `Error`, donc invisible
  dans un log de CI filtré.
- [Ce dont le 16-bit a besoin hors du dépôt](issues/01-ce-dont-le-16-bit-a-besoin-hors-du-depot.md)
  — faisabilité **acquise** (`rgba16float` sans aucune feature, crate TIFF+ICC
  déjà en dépendance, matrice à 4 coefficients) ; mais l'invariant « sRGB par
  le FORMAT » **ne survit pas** au flottant, et toute la mesure a été prise
  dans Edge, pas dans le WebView2 réel.
- [Ce qu'est un manipulateur direct de niveau professionnel](issues/18-ce-qu-est-un-manipulateur-de-niveau-pro.md)
  — **42 lignes de grille** (17 genres, 25 points d'anatomie du geste), dont
  **11 déjà faites** chez nous. Écarts chiffrés : zéro `:hover` dans les quatre
  CSS d'overlay, poignées de 12 px pour 24 recommandés, aucune valeur affichée
  pendant le geste. ⚠️ **14 des 42 lignes supposent qu'un manipulateur soit un
  OBJET** — le même mur que la typographie et les formes, lien non prévu qui
  peut réordonner la carte.
- [La rationalisation des contrôles n'est pas terminée](issues/14-la-fusion-des-reglages-redondants.md)
  — **résolu en CADRAGE** : trois documents la déclaraient soldée, la mesure dit
  le contraire sur ses **trois** fronts. 345 paramètres au total ; 10 % portent
  une condition et 15 effets sur 23 n'en ont aucune ; `liste` = 54 des 73
  sections ; 4 effets sur 23 ont un outil sur la toile. Découpée en
  [15](issues/15-l-applicabilite-couvre-10-pourcent.md) →
  [16](issues/16-les-sections-ne-sectionnent-pas.md) →
  [17](issues/17-les-outils-sur-la-toile.md), **un ticket par front avec sa
  mesure de sortie**, parce que c'est la 3ᵉ clôture prématurée du même chantier
  et que la cause est toujours un plan partiel lu comme un chantier entier.
- [Ce que coûte d'attendre le 16-bit](issues/02-cout-d-attendre-le-16-bit.md)
  — **presque rien** : le chemin couleur n'a qu'UNE décision de format
  (`srgbFormat`, injecté, 14 lecteurs, zéro format en dur) et les 23 effets ne
  voient jamais le format, donc formes/typo/recadrage n'ajoutent aucun site.
  La rupture est aux BORNES (présentation, export), et les 77 références de
  pixels sont sauves tant que le 16-bit reste un SECOND point d'entrée. ⚠️ 22
  effets sur 23 bornent leur sortie, donc la marge au-dessus de 1,0 serait
  inutilisée — seule la précision dans [0,1] compte, ce qui rend contraignante
  la limite des ~11 bits près du blanc.
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

- ~~**Le design d'effet des formes**~~ — **sans objet depuis le 2026-08-17.** Le
  ticket 03 a répondu que ce n'est ni un effet ni un genre de calque, donc il n'y
  a pas de « design d'effet des formes » à écrire. Ce qui le remplace — un outil
  de SÉLECTION — est plus gros que cette carte : voir **Out of scope**.
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

- 🆕 **L'outil de SÉLECTION — hors périmètre le 2026-08-17, et il lui faut sa
  propre carte.** Le ticket 03 a établi qu'une forme sélectionne au lieu de se
  poser ; Antoine ne s'arrête pas à la primitive géométrique — il veut détourer à
  la main, tracer une silhouette, combiner des régions (ajouter, soustraire).
  Ça dépasse les six flottants d'un rectangle, et le sujet devient l'OUTIL, pas
  la forme.
  Ce que le dépôt a déjà et qui compte pour cet effort : quatre façons de borner
  (pinceau, `gradient`, `luminosity`, `colorRange`), un `MaskSourceModule` à
  huit flottants, un `CanvasControl` à trois genres, et un prototype de
  géométrie transférable (`src/render/effects/aplat.ts`, ticket 23).
  Ce qui lui manque : toute source géométrique, et toute composition de régions.
  ⚠️ Ce n'est PAS une exclusion de valeur — c'est une exclusion de TAILLE. Cette
  carte-ci produit des décisions pour le prochain palier ; un outil de sélection
  est un palier à lui seul.

- **L'implémentation de l'export print elle-même** — pipeline 16-bit,
  encodeur TIFF, conversion de gamut, ICC. Réel mais lointain (arbitrage
  d'Antoine, 2026-08-11) : cette carte n'y va pas, elle en garde seulement la
  contrainte. `PRD-print-export.md` reste valide et dormant ; le rouvrir sera
  une carte à lui.
- ✅ **La suppression des branches mortes — FAITE le 2026-08-16.** Sept branches
  distantes retirées, chacune vérifiée avant le geste. ⚠️ Et ce n'était pas la
  corvée annoncée : `claude/mattpocock-skills-wayfinder-6lxjiz` portait depuis le
  2026-08-11 un correctif du défaut CI du ticket 22, **plus complet que celui
  trouvé le 2026-08-16** — récolté avant suppression. Deux affirmations de cette
  carte étaient par ailleurs fausses (« déjà dans master », « superseded » sur des
  branches qui portaient des commits uniques : vrai en contenu, faux en commits).
  ✅ **`mipmaps-bibliotheque` a reçu son verdict le 2026-08-17 et est fusionnée** —
  rendu par la mesure que son propre commit réclamait (scan 8192² sur photo
  26 Mpx : le coût de la passe devient PLAT au lieu de croître avec la
  minification). ⚠️ Sa prémisse écrite était pourtant FAUSSE — « échantillonné à
  l'échelle de l'écran, 1:8 », alors que le canvas est à la résolution native et
  n'est réduit que par CSS : au défaut c'est ~2:1. **Un geste juste pour une
  raison fausse se fusionne quand même, mais sa raison se corrige** — sinon elle
  sert de prémisse au chantier suivant, qui est ici le mipmap de diffusion du
  verre. Reste `task-management` (480 lignes orphelines — décision, pas corvée).
  Détail dans `docs/ROADMAP.md` § 4.

- **`PRD-floating-panel-rail.md`** — cadre un rail pour `FloatingPanel`,
  composant supprimé le 2026-07-21, et le rail a été livré autrement (panneaux
  contextuels, 2026-07-25/26). PRD zombie : une suppression et une ligne de
  note, aucune décision.
- ✅ **`docs/adr/0003-master-tracks-feature-design-system.md` — RÉGLÉ le
  2026-08-16, et ce n'était pas une corvée.** Cette entrée le rangeait en
  « corvée de documentation » ; c'en était une décision. Tant que l'ADR restait
  `active`, il prescrivait une synchronisation manuelle que personne ne faisait,
  et la branche par défaut du dépôt montrait un instantané de trois semaines.
  `master` est désormais canonique et par défaut
  ([ADR-0005](../../docs/adr/0005-master-est-la-branche-canonique.md)).

### Corrections de documentation mesurées — ✅ SOLDÉES le 2026-08-13

Aucune n'était une décision — ce sont des faits vérifiés le 2026-08-11 contre
des documents qui disaient autre chose. Elles étaient consignées ICI parce que
la faute que cette carte diagnostique est précisément celle-là : signaler et
oublier.

**Re-mesurées une par une le 2026-08-13 avant d'y toucher : les cinq étaient
déjà appliquées.** Elles l'ont été au fil des sessions des 11 et 12 août, sans
que personne raye la table — donc la table listait comme « en attente » un
travail fait, ce qui est la même faute vue de l'autre côté. Leçon opposable :
**une liste de corrections se re-mesure avant de s'appliquer**, sinon on
réécrit du correct par-dessus du correct.

| Document | Ce qu'il disait | Ce que le disque dit | État au 2026-08-13 |
| --- | --- | --- | --- |
| `CONTEXT.md:259`, `ARCHITECTURE.md:565`, `ARCHITECTURE.md:618` | `MAX_PHOTO_LAYERS = 4` | **5**, fond compris (`src/layers/photoLayer.ts:66`) | ✅ déjà corrigé, R1 compris (« MESURÉ, deux fois ») |
| `CLAUDE.md:84` | config du canvas en `gpuContext.ts:64-78` | **lignes 155-164** | ✅ déjà corrigé, avec la trace de l'écart |
| `docs/ROADMAP.md` §2 | le recadrage « ne dépend d'aucun arbitrage », « le SEUL item prêt à coder » | design §3.1 renversé par le passage à deux échelles du 2026-07-31 | ✅ déjà corrigé, renvoie au [ticket 05](issues/05-ce-qui-reste-du-design-de-parite-du-calque-photo.md) |
| `docs/design-system/photoshop-web-reference-tokens.md` § Constat structurel majeur | met en garde contre un dock empilé, au nom de `FloatingPanel` | supprimé le 2026-07-21 | ✅ section réécrite, l'écart réel (splitter vs content-sized) isolé |
| `docs/INDEX.json` | aucune entrée pour `2026-07-26-shaderlab-photo-layer-parity-design.md` | — | ✅ entrée présente |

**Le seul reste était HORS de cette table** : `PRD.md` portait le même plafond
faux à trois endroits (`= 4`, « plus de 2 photos sources » en hors-scope,
« limite 2 photos respectée » en critère de fin) **et une seconde erreur que
personne n'avait relevée** — « borne de sécurité VRAM non encore mesurée »,
alors que c'est la mesure du 2026-07-30 qui a fixé la valeur. Corrigé le
2026-08-13. Ce qui l'a fait sortir : avoir cherché la CONSTANTE dans tout le
dépôt au lieu de relire les lignes citées par la table.
