# curves en linéaire ou en perçu

Type: grilling
Status: open
Parent: ../map.md

## Question

`src/render/effects/curves.ts` n'importe aucune transformation sRGB : sa courbe
s'applique donc à des valeurs **linéaires**, quand tous les outils de courbe
qu'un photographe connaît travaillent sur la valeur **perçue**.

Mesuré le 2026-08-05 en pilotant l'app, puis vérifié analytiquement — lever le
point noir à 20 % :

| | Sortie en sRGB |
| --- | --- |
| appliqué en **linéaire** — ce que fait shaderlab | **124** / 255 |
| appliqué en **perçu** — ce que fait Photoshop | **51** / 255 |
| milieu à 50 % perçu, en linéaire | 157 / 255 |
| milieu à 50 % perçu, en perçu | 134 / 255 |

À l'écran : la silhouette part en gris moyen au lieu d'un noir délavé, et les
ombres perdent toute séparation d'un coup.

**Le dépôt porte déjà la règle inverse**, écrite dans `texture.ts` à propos de
ses niveaux — « étirer en linéaire déplacerait le point médian PERÇU, et le
curseur ne répondrait pas là où l'œil l'attend ». `dither`, `halftone`,
`hatching`, `gradientMap` et `channelMixer` la suivent tous. **`curves`, le
seul effet qui SOIT une courbe tonale, ne la suit pas.**

C'est le seul point du bloc 1 du ROADMAP qui demande une décision de CODE et
non un goût.

## Ce qu'il faut interroger

- **Qui a raison : l'effet ou la règle ?** « Linéaire strict » est une décision
  structurante du projet (`CLAUDE.md` § Stack). C'est peut-être ELLE qu'il faut
  amender ici, pas l'effet. Trancher dans le mauvais sens propage l'erreur aux
  six effets déjà alignés.
- **`effects/blendSpace.ts` existe déjà** — espace de mélange en sRGB /
  Linéaire / OKLab / OKLCH, plus un vocabulaire restreint aux deux courbes de
  transfert pour les opérateurs qui ne sont pas une interpolation (la matrice
  de `channelMixer`). Est-ce que `curves` doit simplement l'adopter, plutôt
  que de coder son choix en dur ? Un effet qui adopte ce contrôle transversal
  garde son rendu **au bit près sur son défaut** — ce qui déplace la question :
  quel est le bon DÉFAUT ?
- **Le coût est nommé et non nul.** Corriger change le rendu, donc les deux
  références de pixels de `curves` (`effet-courbes-neutre`, `effet-courbes`).
  Ce n'est pas une finition qu'on glisse dans un commit de nettoyage.
- **Les presets citant `curves` changent d'apparence** si le défaut bascule.
  Combien y en a-t-il ? À mesurer, pas à supposer.

## Amendement du 2026-08-11 — « ce que fait Photoshop » n'est pas documenté

Trouvé en vérification de sources primaires
([`research/10b-sources-primaires-fonctions.md`](../research/10b-sources-primaires-fonctions.md)),
et ça déplace la ligne du tableau ci-dessus qui dit « appliqué en perçu — ce
que fait Photoshop » :

**Adobe n'énonce NULLE PART l'encodage sur lequel Curves opère.** La page
Curves ne dit que « niveaux d'entrée (valeurs originales) ». Aucune phrase
Adobe ne dit que Curves est perçu, ni qu'il est linéaire. Notre tableau
présentait donc comme un fait documenté ce qui est une déduction.

Ce qu'Adobe documente en revanche, et qui est plus intéressant : *Edit > Color
Settings > More Options > **Blend RGB Colors Using Gamma***. Coché, le mélange
se fait dans l'espace du gamma spécifié, et Adobe précise qu'un gamma de
**1,00 est « colorimétriquement correct » et produit le moins d'artefacts de
bord**. Décoché, le mélange se fait dans l'espace du document — et Adobe
avertit que le COCHER fait diverger le rendu des autres applications.

⚠️ **L'avertissement d'interopérabilité ne fait sens que si cocher est la
déviation.** Donc l'option est décochée par défaut, donc la composition par
défaut de Photoshop — et les valeurs que voit un Curves — est l'espace encodé
en gamma, pas la lumière linéaire. **C'est une inférence, pas une citation** ;
la traiter comme telle.

**Ce que ça change pour l'arbitrage** : ce ticket opposait « linéaire strict »
(notre décision structurante) à « ce que fait Photoshop », comme si le second
était une référence. Il ne l'est pas — **Photoshop qualifie son propre défaut
de non colorimétriquement correct, en toutes lettres, et le laisse quand même
désactivé.** L'argument « faisons comme Photoshop » perd donc son autorité, et
la vraie question redevient celle du dépôt : le curseur doit-il répondre là où
l'œil l'attend (règle écrite dans `texture.ts`, suivie par cinq effets), ou la
mathématique doit-elle rester juste ? Adobe a tranché pour le premier en
sachant que c'était le second qui était correct. C'est un précédent, pas une
preuve.

## Le piège spécifique de ce ticket

L'autre moitié du sujet — la **fluidité** du tirage de poignée — ne se capture
pas : elle se sent au pointeur, aucune planche de contact n'y répond. Ne pas
la confondre avec celle-ci, et ne pas clore ce ticket en croyant l'avoir
traitée.
