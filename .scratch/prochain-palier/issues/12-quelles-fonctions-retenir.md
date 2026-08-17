# Quelles fonctions retenir, et dans quel ordre

Type: grilling
Status: open
Blocked by: 10
Parent: ../map.md

## Question

[Quelles fonctions de Photoshop et Lightroom compléteraient les nôtres](10-quelles-fonctions-completeraient-les-notres.md)
a instruit **12 fonctions**, en a écarté huit comme doublons et en a rejeté
cinq sur la règle d'Antoine — voir
[`research/10-fonctions-complementaires.md`](../research/10-fonctions-complementaires.md).

**Lesquelles retenir pour ce palier, et dans quel ordre ?**

## Le candidat qui domine, et pourquoi il est à part

**Les quatre modes de fusion non séparables** (Couleur, Luminosité, Teinte,
Saturation). C'est le seul candidat dont l'absence se prouve **par la forme de
l'opérateur** et non par un essai : tous nos modes sont des fonctions canal par
canal (`blend/modes.ts`), donc aucun ne peut préserver la luminance en
changeant la chroma. Ce n'est pas « nous ne l'avons pas encore fait », c'est
« la famille actuelle ne peut structurellement pas le produire ».

Coût le plus bas du document : l'interface est déjà `vec3→vec3`, et
`blendMode` est une **chaîne** (`src/layers/types.ts:58`), donc en ajouter
quatre ne déplace **aucun index de preset** — contrairement à un choix nommé
d'effet, où l'index EST persisté.

Et il solde une dette nommée : le **split-tone**, différé depuis le
2026-07-20 dans `PRD-print-export.md`, devient atteignable par la pile sans
nouvel effet.

## Les quatre autres retenus

- **Netteté / contraste local** — absent, et DOUBLEMENT bloqué : aucun mode de
  fusion signé (ni Différence ni Soustraction), et un effet ne peut lire aucun
  autre calque. ⚠️ **C'est le mot le plus répété du cahier d'Antoine — neuf
  mentions, zéro effet.** Le déséquilibre mérite d'être expliqué avant d'être
  corrigé : est-ce un vrai manque, ou le cahier décrit-il un geste que la pile
  fait autrement ?
- **Carte de déplacement pilotée par une image** — le binding 7 d'ADR-0018 la
  rend bon marché ; `warp` et `glass` déplacent par champ procédural,
  `texture` lit une image mais sort le scan brut.
- **Courbe libre / solarisation** — le shader l'évalue DÉJÀ ; c'est
  `constrainCurvePoint`, côté interface, qui l'interdit. Le coût est donc
  celui de lever une contrainte, pas d'écrire un effet.
- **Masque mesuré sur le composite en dessous** (façon Blend If) — nos sources
  sont ancrées sur la photo ORIGINALE **par décision écrite**. La rouvrir est
  un vrai arbitrage, pas un oubli.

Plus cher et probablement hors de ce palier : groupes de calques (~96 Mo par
niveau, `LayerState` plat à passer en arbre), déformation peinte, pixel
sorting.

## Ce que ce ticket doit produire, en plus d'une liste

Un **ordre**, pas seulement un tri. Les quatre modes de fusion et la courbe
libre lèvent des contraintes existantes ; la netteté et le Blend If ouvrent des
capacités nouvelles. Les premiers rendent les seconds moins chers ou inutiles —
l'inverse n'est pas vrai. L'ordre porte donc de l'information que la liste ne
porte pas.

## Seconde source, relevée le 2026-08-17 : effect.app

Antoine a signalé <https://effect.app> (« ses effets sont pas mal »). Relevé sur
place : **69 effets** en huit catégories, plus **77 presets**. C'est la source la
plus proche de notre domaine — Photoshop et Lightroom sont des outils de
retouche, celui-ci est un catalogue d'effets, comme nous.

⚠️ **Ce qui a été regardé, et ce qui ne l'a PAS été.** Leur code est propriétaire
et sans licence accordée : rien n'en a été lu ni copié, et rien ne doit l'être.
N'ont été relevés que des éléments PUBLICS — la liste des effets, leurs mots-clés
de recherche, leurs vignettes de démonstration publiées, et les libellés de
paramètres visibles dans l'interface.

⚠️ **Piège de leurs vignettes, à ne pas oublier en les relisant** : chaque effet
a sa PROPRE photo de démonstration, choisie pour le flatter. On peut comparer un
effet à son avant ; on ne peut pas comparer deux effets entre eux, ni juger une
famille sur une planche.

### Ce que leur catalogue confirme de nos absences

Trois se confirment comme des trous francs, et deux d'entre eux sont bon marché
chez nous :

- ~~**Vignette.**~~ ✅ **MESURÉE le 2026-08-17, et elle EXISTE DÉJÀ.** Voir le
  bloc dédié ci-dessous : `aplat` plus un masque dégradé radial inversé la
  produit sans une ligne de code. Ce qui manque n'est pas un effet, c'est **un
  paramètre**.
- **Carte de déplacement** (leur `Displacement`) — déjà retenue plus haut, et
  cette source la confirme comme une entrée de catalogue à part entière et non
  une variante de warp.
- **Emboss.** Un relief gris tiré du gradient. Nous avons déjà la machinerie
  exacte — `effects/edgeGradient.ts`, Scharr 3×3 avec ton perceptuel. Le coût
  est celui d'un habillage, pas d'un détecteur.

### Ce qu'ils font et que nous n'avons pas envisagé

- **Bevel** — un biseau éclairé, métallique, appliqué à une FORME. C'est leur
  effet le plus récent, et il vise clairement le lettrage et le logo. Il suppose
  une couverture alpha à biseauter, donc il retombe sur la question de la
  sélection (ticket 03).
- **Scatter** — semis de sprites sur une grille à clé de couleur. Leur nouveauté
  de tête, rien d'approchant ici.
- **ASCII**, **LED screen**, **CRT / VHS / NTSC** — la famille « écran », entière
  et absente. À décider en bloc : c'est une DA, pas une fonction.
- **Risograph** — séparation en encres tramées avec décalage de repérage et
  grain. Nos `dither` et `duotone` en approchent des morceaux ; l'overprint de
  deux ou trois encres SPOT, non.
- **Palette adaptative** sur leur `Dither` (mot-clé « palette adaptive »). Le
  nôtre quantifie par canal ou vers deux encres — pas de palette dérivée de
  l'image.

### Ce qui confirme nos choix, et compte autant

- Leur **Thermal** est une fausse couleur par table — c'est exactement ce que
  `gradientMap` fait déjà. Bon exemple de doublon qu'on n'écrit pas.
- Ils ont **Gaussian blur** ; ADR-0010 le garde délibérément dehors. Rien dans
  leur catalogue ne rouvre cet arbitrage.
- Leur `Reeded glass` est **un seul effet** là où `glass` porte quatorze
  matières, cinq profils et dix-huit références. Nous sommes en avance là.
- `isolines`, `outlines` et ses trois modes de détection, `sliceShift`,
  `pixelStretch`, `gooeyMerge`, `lightLeak` : **aucun équivalent chez eux**.

### La densité de leurs panneaux, qui est un signal pour le chantier des contrôles

Leur `Halftone screen` expose **dix-neuf** réglages : Pattern, Frequency,
Roughness, Fuzziness, Paper Fiber, Ink Texture, Ink Density, quatre angles
d'encre, quatre interrupteurs d'encre, quatre décalages d'encre.

Deux choses à en retenir, et la seconde vaut plus que la première :

1. **Un interrupteur PAR ENCRE et un décalage PAR ENCRE.** Le décalage est le
   défaut de repérage d'une presse — ce qui fait qu'une trame imprimée n'est
   jamais parfaitement superposée. Notre `halftone` a la rosette mais pas ça.
2. **Ils séparent le SUPPORT de l'ENCRE** (`Paper Fiber` d'un côté, `Ink Texture`
   et `Ink Density` de l'autre). Nous avons `inkTexture` en contrôle transversal,
   mais rien qui décrive le papier — et le cahier de postproduction en parle.

⚠️ Et ils portent dix-neuf réglages à plat, sans sections apparentes. C'est
exactement le défaut que le chantier des contrôles (tickets 15/16/17) traite
chez nous : à citer comme contre-exemple, pas comme modèle.

Planches de contact assemblées dans le scratchpad de session — elles ne
survivent pas, et **elles n'ont pas leur place dans le dépôt** : ce sont leurs
images. Les regénérer depuis `https://effect.app/effects/<Categorie>/<id>.jpg`
si besoin ; la liste des 69 identifiants est reconstructible depuis les attributs
`data-effect-id` de leur page d'accueil.

### ✅ La vignette, mesurée dans l'app le 2026-08-17

Elle était notée « à mesurer avant d'écrire quoi que ce soit ». Fait, dans la
vraie fenêtre, sur `photo-1.jpg` à 26 Mpx.

**Elle existe déjà, sans une ligne de code** : un calque `aplat` noir, borné par
le masque du calque, avec une source de masque **Dégradé en mode Radial** et la
case **Inverser** cochée. Capture à l'appui — les bords s'assombrissent, le
centre reste ouvert.

**Et elle ne bande pas.** Ablation sur la même ligne de 770 px, calque affiché
puis masqué :

| | sans vignette | avec vignette |
| --- | --- | --- |
| valeurs distinctes | 102 | 76 |
| plus long palier | 3 px | **7 px** |
| palier moyen | 1,04 px | 1,08 px |
| maximum | 169 | 114 |

Le palier double mais reste à 7 px, loin des dizaines de pixels qu'il faut pour
qu'une bande se voie. La perte de valeurs distinctes est de la **compression de
plage** (le maximum tombe de 169 à 114), pas du banding — multiplier par un
facteur lisse inférieur à 1 réduit mécaniquement le nombre de valeurs. Sur une
vraie photo, le grain dithère la chute tout seul.

⚠️ Leur mot-clé `dither` sur la vignette reste donc non expliqué par cette
mesure. Deux hypothèses non départagées : du contenu LISSE (un aplat, un ciel
synthétique) où le grain ne rattrape rien, ou une chute bien plus dure que celle
que j'ai réglée. **Ne pas conclure que leur dither est décoratif** sur la foi
d'une seule mesure faite sur une photo bruitée.

### Ce que la mesure a trouvé et qu'on ne cherchait pas : `aplat` n'a pas d'INVERSE

Leurs mots-clés listent six formes de vignette — `oval triangle diamond
rectangle hexagon octagon`. Nous avons désormais les trois primitives qui les
couvrent toutes (rectangle, ellipse, polygone à 3–12 côtés, livrés le
2026-08-17).

**Mais la couverture d'`aplat` remplit l'INTÉRIEUR de sa forme.** Une vignette
veut l'extérieur. Le chemin qui marche aujourd'hui — le masque dégradé radial
inversé — n'est disponible que pour le radial et le linéaire, parce que
l'inversion vit sur le MASQUE et que les sources de masque n'ont pas de
géométrie (union fermée à `gradient` / `luminosity` / `colorRange`, voir
[ticket 03](03-une-forme-a-t-elle-besoin-de-contentsource.md)).

Donc une vignette **hexagonale** n'est pas atteignable, alors que la forme
hexagonale existe. Ce qui la sépare de nous est **un booléen sur `aplat`** —
inverser sa couverture — ajouté à la fin de `params[]`, sans toucher aucun index
persisté.

C'est le genre de trouvaille qui justifie la règle du dépôt : la question posée
était « faut-il un effet vignette », la mesure répond « non, il faut un
paramètre ». Écrire l'effet aurait produit un doublon de tout ce qui est déjà là.

**À trancher ici** : ajoute-t-on cet inverse à `aplat` ? Il est presque gratuit,
mais il n'a pas été demandé — et `aplat` est déjà entré au registre par une
question à laquelle il n'a pas répondu.

## La règle qui garde ce ticket honnête

**Le doublon se mesure avant de s'écrire**, et la mesure répond souvent deux
choses (ADR-0016 : 0,005 % d'écart sur un axe, 23,1 % sur l'autre). Les huit
écartées l'ont été sur lecture — dont le **bleach bypass**, jugé atteignable
par deux calques existants, donc un PRESET et non un effet. Avant de clore,
décider lesquelles de ces huit méritent une mesure plutôt qu'une lecture.
