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
unique, placé dans un en-tête fixe du panneau, agissant sur l'élément
sélectionné.**

Corollaire structurel, indissociable : **en-tête fixe + liste défilante à
l'intérieur du panneau + hauteur de panneau bornée**. Sortir les contrôles sans
ce triplet ne donne rien — l'en-tête défilerait avec la colonne.

**Cette décision s'applique à tout élément d'interface AJOUTÉ après cette date,
au moment où il est ajouté — pas dans un lot de rattrapage ultérieur.**

### Checklist obligatoire pour tout nouveau panneau, carte ou liste

À passer AVANT de déclarer la tranche terminée. Chaque réponse doit être écrite
dans le rapport de la tranche, pas supposée.

1. Un contrôle apparaît-il plus d'une fois à l'écran dans ce composant ?
   → Si oui, il monte en en-tête et agit sur la sélection.
2. La liste peut-elle dépasser la hauteur de son panneau ?
   → Si oui, c'est le PANNEAU qui défile, jamais la colonne, et l'en-tête reste fixe.
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

- **Perte assumée** : régler un contrôle sans changer la sélection devient
  impossible. Aujourd'hui un `stopPropagation` sur le slider d'opacité permet de
  régler le calque B en gardant A sélectionné. Ce cas disparaît. Atténuation
  retenue : la valeur reste affichée en lecture seule sur la ligne.
- **Prérequis technique** : changer de sélection périme l'ouverture manuelle d'un
  panneau (`selectedId` sert de `triggerKey` à `useContextualPanel`) — un panneau
  fermé au rail se rouvrirait à chaque sélection. À corriger avant, sinon le
  principe dégrade l'expérience au lieu de l'améliorer.
- Chaque changement de sélection déclenche un rendu pleine résolution.
- `DockedPanelCard` gagne un troisième slot (titlebar / **en-tête** / contenu),
  l'en-tête en `flex-shrink: 0`, hors du conteneur défilant.

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
