# Affinity v2 — relevé sur l'application RÉELLE

Relevé le 2026-08-19, sur la fenêtre Affinity v2 ouverte sur la machine
d'Antoine (`Affinity`, 2580 × 1029, persona **Pixel**, document
`customstudio [Verrouillé] @ 20 %`).

**Déclencheur** : arbitrage d'Antoine — « on va se baser sur affinity pour le
design de l'appli ». La référence de design passe de Photoshop à Affinity.

## Méthode, et ce qu'elle vaut

Captures d'écran de la fenêtre native, prises par PowerShell
(`Graphics.CopyFromScreen` sur le rect de `GetWindowRect`), puis recadrées et
échantillonnées hors ligne. **Aucune documentation lue** : tout ci-dessous est
lu sur des pixels de la vraie application.

⚠️ **Ce que cette méthode ne donne PAS.** Les couleurs sont exactes, les
structures sont sûres, mais **les dimensions en pixels ne sont pas
transposables** : la fenêtre relevée est à un facteur d'échelle Windows inconnu,
et Affinity a son propre réglage de taille d'interface. Ne pas recopier une
hauteur de ligne d'ici sans la remesurer — c'est le même piège que le relevé
Adobe, descriptif et jamais dimensionnel, sauf qu'ici l'illusion de précision
est pire parce que les nombres existent.

⚠️ **Un seul persona, un seul document, un seul thème.** Le relevé montre
Affinity en Pixel, en thème sombre, avec trois groupes de Studios ouverts. Rien
ne dit que c'est la configuration par défaut ni la plus courante.

## 1. La colonne des Studios — des groupes à ONGLETS, empilés

Trois groupes, chacun avec sa barre d'onglets et son chevron de repli :

| Groupe | Onglets |
| --- | --- |
| 1 | **Histogramme** · Couleur |
| 2 | **Calques** · Canaux · Pinceaux · Stock |
| 3 | **Navigateur** · Transformer · Historique |

L'onglet actif est en clair, les autres en retrait. Une poignée de glissement
(`⋮` vertical) précède la barre d'onglets ; le chevron `⌄` la termine.

✅ **Ceci VALIDE le dock à onglets livré le 2026-08-19** (commit `50f5d0b`,
adopté alors sur le modèle Photoshop). Les deux références font la même chose :
des groupes à onglets empilés dans une colonne. Le travail ne se jette pas.

## 2. Le panneau Calques — DEUX zones fixes, pas une

C'est l'écart le plus net avec ce que nous faisons, et avec ADR-0001.

```
┌ Calques │ Canaux │ Pinceaux │ Stock            ⌄ ┐   <- barre d'onglets
│ Opacité: 100 % ⌄   Normal ⌄            ⚙   🔒     │   <- EN-TÊTE fixe
├───────────────────────────────────────────────────┤
│ ⋮⋮  [vignette]  Artboard1                    👁   │   <- la liste
│                                                   │
├───────────────────────────────────────────────────┤
│ ✏  fx ▣ ⧗ ◑        ▣ 🗀 ▩ 🗑                       │   <- PIED fixe
└───────────────────────────────────────────────────┘
```

**En-tête** : opacité, mode de fusion, un engrenage, **un cadenas**.
**Pied** : ~8 icônes d'action (ajouter un réglage, un masque, grouper, nouveau,
supprimer).

⚠️ **ADR-0001 dit « zone de contrôles fixe en-tête OU pied ». Affinity utilise
les DEUX**, et le partage n'est pas arbitraire :

- **l'en-tête porte ce qui DÉCRIT le calque sélectionné** — son opacité, sa
  fusion, son verrou ;
- **le pied porte ce qui AGIT sur la pile** — ajouter, grouper, supprimer.

C'est une distinction que notre zone unique ne peut pas exprimer : elle mélange
les deux familles dans la même rangée.

## 3. Le verrou — UN seul, dans l'en-tête

**Un cadenas unique**, à droite de l'engrenage, agissant sur le calque
sélectionné. Aucune rangée de quatre verrous, aucun cadenas plein/creux sur la
ligne.

⚠️ **Ceci CONTREDIT les quatre verrous livrés le même jour** (commit `0deb368`,
modèle Photoshop). Sur la référence Affinity, ce travail est à défaire — c'est
le seul des cinq commits du jour dans ce cas.

⚠️ **Mais le relevé ne dit pas ce que le cadenas d'Affinity REFUSE.** Un
booléen dans l'interface peut très bien geler plusieurs choses ; il faudra
l'éprouver sur un document réel avant de conclure que « un seul verrou » veut
dire « une seule chose gelée ».

## 4. La ligne de calque — l'œil à DROITE

`⋮⋮ poignée · vignette · nom · 👁 œil` — l'œil est **à droite**, la poignée à
gauche. Chez nous l'œil est à gauche, collé à la poignée.

Sur la ligne sélectionnée, le fond passe au **bleu plein** (`#205D9F`), pas à
une teinte discrète.

## 5. Les barres du haut — QUATRE rangées

1. **Menu** (`#282828`) : Fichier · Edition · Document · Texte · Vecteur ·
   Pixel · Calque · Affichage · Fenêtre · Aide.
2. **Personas** (`#404040`) : pastilles `Vecteur` · `Pixel` · `Mise en page` ·
   `IA Canva`, la pastille ACTIVE étant remplie d'un magenta franc. À droite :
   les métadonnées du document en texte brut
   (`3000 × 3750px, 11.25MP, RVBA/8 - sRGB IEC61966-2.1`) et un bouton
   `Exporter PNG ⌄`.
3. **Onglets de DOCUMENT** (`#404040`) : `customstudio [Verrouillé] @ 20 %` avec
   sa croix. Le zoom est dans le titre de l'onglet.
4. **Barre contextuelle** (`#3B3B3B`) : flottante, centrée au-dessus de la
   toile, contenu dépendant de l'outil.

⚠️ **Le persona est le concept qu'on n'a pas**, et il n'est pas décoratif : il
change les outils ET les Studios d'un coup. Rien chez nous n'en a besoin
aujourd'hui, mais c'est la pièce qui explique pourquoi Affinity peut se
permettre une seule colonne de Studios.

## 6. Le rail d'outils — colonne unique, couleurs en bas

Une seule colonne étroite. Un petit **coin replié** en bas à droite d'une icône
signale un outil à variantes. En bas du rail : `…` (plus d'outils), puis les
**pastilles de couleur premier plan / arrière-plan**, puis un contrôle
d'échange.

⚠️ **La couleur de premier plan vit dans le RAIL**, pas dans la barre
contextuelle. Nous l'avons mise dans la barre d'options le 2026-08-18.

## 7. Couleurs relevées

Échantillonnées par couleur DOMINANTE d'un carré de 13 px — un pixel isolé tombe
sur du texte ou une icône, et les trois premières valeurs relevées ainsi étaient
fausses.

| Surface | Valeur |
| --- | --- |
| Barre de menu | `#282828` |
| Personas · rail d'outils · onglets de document | `#404040` |
| Barre contextuelle | `#3B3B3B` |
| Pasteboard (autour de la toile) | `#1C1C1C` |
| Fond des Studios | `#1F1F1F` |
| Ligne de calque sélectionnée | `#205D9F` |
| Pastille de persona active (Pixel) | `#E380F9` |

⚠️ **Le pasteboard est plus SOMBRE que les panneaux** (`#1C1C1C` contre
`#1F1F1F`), et les barres d'outils plus CLAIRES qu'eux (`#404040`). L'échelle
n'est donc pas monotone du fond vers l'avant : la hiérarchie est
« toile la plus sombre, panneaux au milieu, chrome le plus clair ». Nos tokens
font l'inverse sur le chrome (`--surface-window` est notre valeur la plus
sombre).

⚠️ La couleur de persona (`#E380F9`) est probablement **propre au persona
Pixel** — Affinity en change d'un persona à l'autre. Ne pas la prendre pour la
couleur d'accent de l'application avant d'avoir regardé les trois autres.

## Ce que ce relevé N'A PAS regardé

À faire avant de trancher un design complet :

- les autres personas (Vecteur, Mise en page) et leurs couleurs ;
- le thème CLAIR ;
- le panneau Calques avec une VRAIE pile (le document relevé n'a qu'une ligne) —
  donc rien sur l'imbrication, les groupes, les masques, l'écrêtage ;
- ce que le cadenas refuse réellement ;
- les densités et hauteurs à un facteur d'échelle connu ;
- les Studios détachés/flottants, et ce qui se passe quand la colonne manque de
  hauteur — la question qui a occupé toute la journée du 2026-08-19.
