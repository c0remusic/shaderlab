---
id: ADR-0001
status: active
date: 2026-07-27
---

# Densité de l'UI : un contrôle répété devient un contrôle unique sur la sélection

## Contexte

Le dock de shaderlab a cinq panneaux (Presets, Calques, Photo, Réglages, Masque).
Mesure CDP sur la fenêtre réelle le 2026-07-27 (3440×1377, **deux** calques
seulement) : la colonne demande **1613 px** de contenu pour **1345 px**
disponibles. Détail : Presets 136 · **Calques 532** · Photo 382 · Réglages 235 ·
Masque 296. La barre de défilement système mange 15 px de largeur (320 → 305).

Cause : chaque ligne de calque porte ses propres contrôles — opacité, mode de
fusion, sélecteur d'effet. Une ligne non sélectionnée fait **167,2 px**,
sélectionnée **224,8 px**.

Observation directe de Photoshop web dans la session d'Antoine, avec une pile de
8 calques (`docs/design-system/photoshop-web-observations-2026-07-27.md`) : leurs
lignes font **~29 px** parce que fusion et opacité vivent dans un **en-tête
unique** appliqué au calque sélectionné, l'en-tête ne défile pas, la liste défile
à l'intérieur du panneau, et les panneaux du dessous restent visibles. Facteur
**5,8×**.

Déclencheur direct de cet ADR : le panneau Photo a été livré le 2026-07-27 alors
que le principe de densité était déjà posé mais que le lot correspondant n'avait
pas encore été exécuté. Une cinquième carte a donc été ajoutée à une colonne qui
débordait déjà. Verbatim d'Antoine à la vue du résultat : « on a à nouveau des
menus trop chargés, le plan qu'on avait fait avant pour centraliser les contrôles
n'a pas été pris en compte pour ce nouvel élément ».

## Décision

**Un contrôle qui se répète sur chaque ligne d'une liste devient UN contrôle
unique, placé dans une zone de contrôles fixe du panneau, agissant sur
l'élément sélectionné.**

Corollaire structurel, indissociable : **zone de contrôles fixe (en-tête OU
pied) + liste défilante à l'intérieur du panneau + hauteur de panneau bornée**.
Sortir les contrôles sans ce triplet ne donne rien — la zone défilerait avec la
colonne.

Ce que le triplet exige de la zone, c'est d'être **unique**, **fixe** et **hors
du conteneur défilant**. Sa POSITION — en haut ou en bas de la carte — n'est pas
contrainte par cet ADR : voir l'entrée datée du 2026-07-28 en fin de document.

**Cette décision s'applique à tout élément d'interface AJOUTÉ après cette date,
au moment où il est ajouté — pas dans un lot de rattrapage ultérieur.**

### Checklist obligatoire pour tout nouveau panneau, carte ou liste

À passer AVANT de déclarer la tranche terminée. Chaque réponse doit être écrite
dans le rapport de la tranche, pas supposée.

1. Un contrôle apparaît-il plus d'une fois à l'écran dans ce composant ?
   → Si oui, il monte dans la zone de contrôles du panneau et agit sur la sélection.
2. La liste peut-elle dépasser la hauteur de son panneau ?
   → Si oui, c'est le PANNEAU qui défile, jamais la colonne, et la zone de
     contrôles reste fixe, hors du conteneur défilant.
3. La hauteur de ligne dépasse-t-elle **56 px** hors état sélectionné ?
   → Si oui, justifier par écrit ou réduire. Cible : la ligne porte l'identité
     (icône d'état, vignette, nom) et les actions propres à la ligne, rien d'autre.
4. Le total des cartes ouvertes tient-il dans `100vh − 32px` sur **1920×1080** ?
   → Le mesurer, ne pas l'estimer. `scratchpad/mesure-densite.mjs` ou une mesure
     CDP équivalente.
5. Une valeur déportée en en-tête reste-t-elle **lisible** sur la ligne ?
   → Un chiffre en lecture seule suffit ; l'utilisateur doit pouvoir comparer
     sans sélectionner chaque élément.

### Où le principe s'applique, et où il ne s'applique PAS

Établi par inventaire sur pièce (`scratchpad/inventaire-controles-repetes.md`) :

| Liste | Applicable | Raison |
|---|---|---|
| Calques | **oui** | opacité + fusion + effet répétés ; gain −68,9 % par ligne |
| Sources de masque | **oui, partiel** | mode de combinaison répété ; gain −47 %, plafonné par ≤4 sources |
| Presets | non | aucune sélection — le clic applique directement |
| Paramètres d'effet | non | rien ne se répète ; c'est la DESTINATION du principe |
| Cartes du dock | non | le repli doit rester posable carte par carte |
| Rail, poignées de transform | non | actions et géométrie, pas des listes |

## Conséquences

- `DockedPanelCard` porte la zone dans un slot `controls` accompagné de
  `controlsPlacement` (`"top"` par défaut, `"bottom"` sur la carte Effets).
  Ex-slot `header`, renommé le 2026-07-28 : « en-tête » était devenu faux.
- **Perte assumée** : régler un contrôle sans changer la sélection devient
  impossible. Aujourd'hui un `stopPropagation` sur le slider d'opacité permet de
  régler le calque B en gardant A sélectionné. Ce cas disparaît. Atténuation
  retenue : la valeur reste affichée en lecture seule sur la ligne.
  **Atténuation RETIRÉE le 2026-07-29** — voir l'entrée datée en fin de document.
- **Prérequis technique** : changer de sélection périme l'ouverture manuelle d'un
  panneau (`selectedId` sert de `triggerKey` à `useContextualPanel`) — un panneau
  fermé au rail se rouvrirait à chaque sélection. À corriger avant, sinon le
  principe dégrade l'expérience au lieu de l'améliorer.
- Chaque changement de sélection déclenche un rendu pleine résolution.
- `DockedPanelCard` gagne un troisième slot (titlebar / **contrôles** /
  contenu), la zone en `flex-shrink: 0`, hors du conteneur défilant.

## Alternatives écartées

- **Laisser les contrôles sur les lignes et replier les cartes.** Ne règle rien :
  la carte Calques seule dépasse déjà, et replier masque un état d'application.
- **Plafonner chaque carte à un `vh` fixe** (`max-height: 42vh`, retiré le
  2026-07-27). Tronque alors qu'il reste de la place à l'écran, et le plafond ne
  dépend pas du nombre de cartes ouvertes.
- **Garder le défilement au niveau de la colonne** (choix du commit `f8b2a0b`,
  le matin même). Réfuté par l'observation : les panneaux du dessous sortent de
  l'écran dès que la pile s'allonge — cause directe du « plusieurs calques
  gênaient la navigation » rapporté par Antoine.

## Croyances révisées

- Croyance : « supprimer le double défilement, peu importe lequel des deux on
  garde ».
  Réfutée par : l'observation directe de Photoshop web sur 8 calques
  (2026-07-27) — le scroll doit vivre dans le panneau, pas dans la colonne.
  Ce que ça change : `f8b2a0b` a gardé la mauvaise moitié et doit être inversé.

- Croyance : « le `max-height: 42vh` des cartes est une survivance en conflit
  avec le splitter `react-resizable-panels` ».
  Réfutée par : `0efdfe4` (2026-07-21) — le splitter a été RETIRÉ et le `42vh`
  introduit par le même commit comme son remplaçant. La documentation
  (`CLAUDE.md`, `AGENTS.md`) décrivait encore le splitter six jours plus tard et
  a produit une prémisse fausse dans un brief.
  Ce que ça change : toute règle de dimensionnement du dock se vérifie sur le
  code, jamais sur la documentation d'architecture.

- **2026-07-28** — Croyance : « la zone de contrôles doit être un EN-TÊTE ».
  Réfutée par : décision d'Antoine du 2026-07-28, demandant les contrôles
  Effet/Fusion/Opacité SOUS la liste — « on lit d'abord ce qui est modifié, puis
  les réglages ». Relecture de la preuve d'origine : l'observation de Photoshop
  web (§2 et §5bis) établit que la zone est **unique**, **fixe** et **hors du
  scroller** ; elle n'a jamais établi que le HAUT était load-bearing. Cette
  position avait été recopiée de la référence sans être justifiée à part.
  Ce que ça change : la décision est reformulée en « zone de contrôles fixe
  (en-tête ou pied) ». Le triplet et la checklist sont inchangés — ce qui les
  fait tenir est l'unicité et le hors-scroller, pas la position. La carte Effets
  passe en `controlsPlacement: "bottom"` ; les invariants de l'ADR sont
  verrouillés par les stories `ControlsOnTop`/`ControlsAtBottom`/
  `CollapsedHidesControls` (`src/components/dockedPanel/DockedPanelCard.stories.tsx`),
  qui vérifient l'unicité de la zone et le fait qu'elle n'est jamais enfant du
  conteneur défilant.

- **2026-07-29** — Croyance : « la décision a été appliquée à la ligne de calque
  le 2026-07-27 ; il ne reste que l'opacité, la fusion et l'effet à déporter ».
  Réfutée par : mesure de la LARGEUR laissée au nom sur la vraie carte, à la
  largeur de dock par défaut — **32 px**. Trois contrôles étaient partis, mais
  la ligne portait encore sept colonnes plus un groupe d'actions (opacité en
  lecture, dupliquer, supprimer) et un verrou toujours rendu : « Chromatic
  bleed » s'affichait « C… », « DSCF5160-edited.JPG » « DSC… ». Aucune assertion
  ne mesurait cette largeur — la checklist en cinq points porte sur la HAUTEUR
  (points 3 et 4) et sur la lisibilité d'une valeur déportée (point 5), jamais
  sur ce qu'il RESTE au contenu élastique de la ligne.
  Ce que ça change, en trois points :
  1. Verrouiller/dupliquer/supprimer descendent dans la zone de contrôles et
     agissent sur la sélection, comme les trois précédents. Le nom passe à
     **152 px** sur la même carte.
  2. **L'atténuation du § Conséquences est retirée** : l'opacité en lecture seule
     quitte la ligne. Elle doublait exactement le champ de la zone de contrôles
     — même unité, même valeur — et le point 5 ne l'exigeait que parce que la
     valeur était *déportée hors de vue* ; elle ne l'est pas, elle est juste
     ailleurs sur la même carte. Le verrou, lui, RESTE sur la ligne au titre du
     point 5, mais **uniquement quand il est posé** : un verrou fermé est un état
     à balayer sur toute la pile, un verrou ouvert n'est rien à voir. Il y
     devient un MARQUEUR (`role="img"`) ; le contrôle vit dans la zone.
  3. **La checklist gagne un sixième point** : *le contenu élastique de la ligne
     (le nom) garde-t-il une largeur lisible à la largeur de dock par défaut ?
     Le mesurer sur la carte réelle, pas sur le composant monté nu — le chrome
     de `DockedPanelCard` vaut 24 px de différence (176 px contre 152 px sur la
     même pile).* Assertions : `PanelColumn.stories.tsx >
     FiveRowDocumentHidesNoRow` (carte réelle) et `LayerPanel.stories.tsx >
     AllRowFormsShareOneGrid` (panneau nu).
  Corollaire mesuré au passage : le budget de hauteur de la carte est si serré
  qu'une TROISIÈME ligne de zone de contrôles (+36 px) renvoyait aussitôt une
  ligne de liste hors champ. Les trois actions se logent donc dans la place
  libre de la ligne « Effet ». La mise en garde du § « Une LIGNE de la zone de
  contrôles » (`LayerPanel.css`) tient toujours : cette zone existe pour RENDRE
  de la hauteur à la liste, pas pour la lui prendre.
