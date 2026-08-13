# curves en linéaire ou en perçu

Type: grilling
Status: resolved

## Verdict du 2026-08-13 — PERÇU, et l'effet est corrigé

Arbitrage d'Antoine, rendu devant l'image et non sur document : « fais en sorte
qu'on n'ait pas les points rouges et l'effet délavé ». C'est donc l'EFFET qui se
corrige, pas la règle « linéaire strict » du dépôt qui s'amende.

**Ce n'est pas une entorse à la règle**, et c'est ce qui rend le verdict tenable :
`srgbTransfer.ts` documente depuis le 2026-08-01 une seconde exception, l'aller-
retour FERMÉ — encoder, appliquer, redécoder dans la même expression. Ce qui sort
est linéaire, comme ce qui entre, et le mix final reste linéaire. Cinq effets la
suivaient déjà (`texture`, `dither`, `halftone`, `hatching`, `gradientMap`,
`channelMixer`) ; `curves` était le seul à ne pas le faire, alors qu'il est le
plus tonal de tous.

### Deux défauts, pas un — et le second ne se voyait qu'une fois le premier corrigé

1. **L'espace.** La courbe s'appliquait à la lumière linéaire. Point noir levé à
   25 % : moyenne 146,3/255 et écart-type effondré à **19,1** (photo nue : 60,7),
   soit toute séparation des ombres perdue. Après passage en perçu : moyenne 96,5,
   écart-type **44,7**.
2. **Le gain du canal maître.** Le maître préserve la teinte en multipliant par
   `mappedLuma / luma`. Quand `luma` tend vers zéro ce facteur explose — 0,001 en
   entrée et 0,25 en sortie donnent un gain de 250 — et il multiplie le bruit
   chromatique du JPEG avec le reste. **C'est lui, la vraie cause des points
   rouges** ; le passage en perçu les atténuait sans les supprimer. Le gain est
   désormais plafonné à 4, et au-delà on complète vers le gris neutre : la luma
   visée est atteinte dans les deux cas, et **sous le plafond le résultat est
   identique au bit près** à l'ancienne formule.

⚠️ La leçon : corriger l'espace faisait disparaître 80 % des points colorés, ce
qui aurait facilement passé pour « réglé ». Ce sont les captures relues à l'œil,
pas les chiffres, qui ont montré qu'il en restait.

### Ce que ça a coûté au verrou de pixels

`effet-courbes-neutre` : **aucun écart, au bit près** — la courbe identité
court-circuite avant toute conversion, donc le neutre reste neutre. C'est le
témoin qui prouve que le changement ne touche que ce qu'il devait toucher.
`effet-courbes` : écart max 56, moyenne 14,3 — attendu, référence régénérée et
relue (dégradé lisse, sans bande, montant plus tôt vers les clairs qu'avant).
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
