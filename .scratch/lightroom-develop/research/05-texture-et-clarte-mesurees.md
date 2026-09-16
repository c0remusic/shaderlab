# Texture et Clarté de Lightroom, mesurées — et ce que les nôtres font à la place

> ⚠️ **DEUX AFFIRMATIONS DE CE FICHIER SONT FAUSSES, et corrigées dans
> [`07-portee-des-operateurs-locaux.md`](07-portee-des-operateurs-locaux.md)**
> (campagne du 2026-09-16 au soir, sur des mires à marche horizontale) :
>
> 1. « Clarté porte un vrai terme global qui déplace un aplat de −19,59 » —
>    **non.** Sur une image sans aucun détail, Clarté ne dépasse pas 8 px et son
>    champ lointain vaut **0,00**. Ce déplacement était le grand rayon de Clarté,
>    nourri par le détail du reste de la mire, pas une courbe de ton.
> 2. « Portée qui suit la largeur, ≈125 / 219 / 295 px » — **non.** C'était
>    l'estimateur qui suivait son plateau (toujours la moitié de la largeur). À
>    plateau constant, les largeurs 1024, 2048 et 4096 rendent le **même profil à
>    0,6 niveau près**.
>
> Tout le reste de ce fichier tient, y compris les conclusions sur Texture, que
> la campagne du soir a confirmées sur une deuxième orientation de marche.

Mesuré le 2026-09-16 sur Lightroom Classic 14.5.1, par la **mire de présence**
(`assets/mire/faire-mire-presence.py`), face à notre pipeline réel
(`assets/mesure-presence-shaderlab.mjs`, iframe du harnais, modules du disque).
Tables brutes : `06-presence-tables-brutes.md`. Données : `mesures-presence/`.

## Pourquoi une troisième mire

Sur la mire principale, Texture mesure **0,00** et Clarté **14,1** niveaux. Ni
l'un ni l'autre ne parle de l'opérateur : la rampe monte par marches de 8 px et
les patches sont contigus, donc un opérateur qui regarde le voisinage y lit un
artefact de mire. La mire locale porte des aplats et des échelons — un aplat dit
qu'un opérateur local ne fait rien, un échelon excite toutes les fréquences à la
fois et rend une somme qu'on ne sait pas séparer.

Or ce qui sépare Texture de Clarté **est** une échelle. Le binaire dit en plus
que l'échelle n'est pas le seul axe : `cr_stage_texture_direct_gf_ycc`
(`cr_texture.cpp`) est un **filtre guidé** — sa réponse dépend de l'amplitude du
détail, pas seulement de sa taille — et `cr_stage_local_contrast`
(`cr_clarity.cpp`) porte un masque `LocalContrastMaskY` plus une **table 2D**
indexée par le ton. D'où trois axes mesurés séparément, un témoin plat, et des
marches.

## Ce que la mire dit d'elle-même

Le même stimulus (base 128, amplitude 16, périodes 16 et 64) est présent deux
fois : en zone AMPLITUDE, entouré de bandes de même base, et en zone TON, entouré
de bandes d'autres bases. Un opérateur assez local rend le même chiffre aux deux
endroits.

| Texture +100 | zone amplitude | zone ton |
|---|---|---|
| gain P=16 | 1,642 | 1,641 |
| ΔMoyenne P=16 | +0,21 | +0,23 |

| Clarté +100 | zone amplitude | zone ton |
|---|---|---|
| gain P=16 | 1,783 | 1,817 |
| ΔMoyenne P=16 | **−10,25** | **−6,12** |
| ΔMoyenne P=64 | **−11,21** | **−25,22** |

Texture s'accorde, Clarté non : son rayon dépasse le pas des bandes (96 px).
Les zones à bandes ne disent donc **rien** de Clarté — c'est la zone ÉCHELON qui
la mesure, et c'est pour ça qu'elle a été ajoutée après la première campagne.
L'analyse imprime ce verdict pour chaque mesure, donc la mire refuse d'elle-même
de répondre là où elle est aveugle.

## Texture : un opérateur strictement local, 10 px, non linéaire

- **Portée indépendante de la LARGEUR** — et pas « absolue », ce que cette mire
  ne peut pas dire. Largeur efficace du halo sur une marche : **10,2 · 10,5 ·
  10,6 px** pour des mires de 1024, 2048 et 4096 px de large. Mieux que « proche » :
  les profils d'échelon sont **identiques au chiffre près** aux trois tailles
  (sommet −9,34 / +10,91 partout). Ce qui est exclu, c'est un rayon
  proportionnel à la largeur, qui aurait rendu 5,25 · 10,5 · 21. Ce qui ne l'est
  pas : les trois mires ont la **même hauteur (7584)**, donc « absolu » et
  « proportionnel à la hauteur » restent indiscernables — exactement la réserve
  posée plus bas pour Clarté, qui vaut ici aussi.
- **Aucun terme global.** Déplacement des trois aplats : **+0,00 / +0,00 / +0,00**
  exactement. Texture ne touche pas un aplat, jamais.
- **Gain contre l'échelle**, à +100 : une ÉTAGÈRE, pas une bande passante —
  1,75 (P=3) · 1,51 (P=16) · 1,37 (P=64) · 1,12 (P=256). Elle ne revient jamais
  à 1 dans la fenêtre mesurée, et son coude est vers P=64.
- **Gain contre l'amplitude** (P=16) : 1,79 · 1,78 · 1,74 · 1,64 · 1,40 · 1,15
  pour des amplitudes de 2 · 4 · 8 · 16 · 32 · 64 niveaux. C'est l'epsilon du
  filtre guidé, et il est lisible : la moitié de l'excès est perdue vers une
  amplitude de **32 niveaux**. Un passe-haut linéaire rendrait une ligne plate.
- **Dépendance au ton** (P=16, amplitude 16) : 1,43 (base 24) · 1,58 (72) ·
  1,64 (128) · 1,63 (184) · 1,47 (232). Maximum au milieu, doux aux deux bouts.
- **Symétrique** : deuxième harmonique à 0,006 du fondamental.
- **À −100, il ne détruit pas le détail** : le gain plancher vaut **0,32** à
  P=3, et remonte à 0,90 à P=256.

## Clarté : un grand rayon PLUS une courbe de ton globale

- **Portée qui SUIT la largeur de l'image.** Largeur efficace du halo, à dose
  identique, médiane sur les six côtés de marche : **≈125 px** (mire 1024) ·
  **≈219 px** (2048) · **≈295 px** (4096). ⚠️ **Ces chiffres n'ont pas trois
  décimales de sens** : l'estimateur disperse de ±30 % selon le côté, et les
  côtés à faible sommet tombent à 66 (1024) et 142 (2048) — ce sont des
  ORDRES, et c'est la FORME de la suite qui porte la conclusion. « Constant »
  (rapport 1,0) et « proportionnel à la largeur » (2,0) sont tous deux exclus ;
  la racine de l'aire (1,41) est la loi simple la plus proche et rate le
  premier pas (1,75 mesuré). **Trois tailles ne fixent pas la loi.**
- **Un vrai terme global**, que rien chez nous ne porte. Déplacement des aplats :
  **−2,66** (base 32) · **−19,59** (base 128) · **+2,68** (base 224). C'est une
  courbe de ton, pivot vers le haut, et elle agit sur une surface parfaitement
  unie.
  Ce chiffre unique ne prouverait rien — un aplat de 256 px lu sur ses 64 lignes
  centrales est à portée d'un rayon de 220 px, donc ses voisins verticaux
  pourraient l'expliquer. **Ce qui le prouve, c'est sa constance d'une taille de
  mire à l'autre** : −18,42 · −19,59 · −19,30 alors que le rayon varie de 2,4×.
  Une contamination de voisinage devrait croître avec le rayon ; celle-ci ne
  bouge pas de plus de 1,2 niveau. Et l'écart-type de l'aplat reste à 0,1–0,5,
  donc le décalage est UNIFORME sur les lignes lues, pas un flanc de halo. La
  part de contamination est bornée à ~3 niveaux par le déplacement des aplats
  voisins, et elle s'annule en partie à la base 128 (voisin sombre d'un côté,
  clair de l'autre). Le terme global vaut donc −17 à −19,6, et il existe.
- **Gain plat sur toute l'échelle** : 1,78 de P=3 à P=512. Ce n'est pas une
  propriété de l'opérateur, c'est la conséquence de son rayon — à 220 px, tout
  ce que porte cette mire est du « détail ».
- **Beaucoup moins non linéaire que Texture** : le gain tient 1,77 jusqu'à une
  amplitude de 32 niveaux et ne tombe qu'à 1,50 à 64.
- **Pas symétrique en haut** : deuxième harmonique jusqu'à 0,19 du fondamental
  sur la base 232.
- **À −100, gain 0,39 à toutes les périodes.**

## Ce que nous faisons à la place

| | Lightroom | shaderlab |
|---|---|---|
| Texture, largeur du halo | 10,5 px | **1,0 px** |
| Texture, gain à P=16 (+100) | 1,51 | **1,04** |
| Texture, gain à P=3 (+100) | 1,75 | 1,99 |
| Texture, gain contre l'amplitude | 1,79 → 1,15 | **plat, ~1,04** |
| Texture, terme global | 0,00 | 0,00 |
| Clarté, largeur du halo | 219 px | **13,5 px** |
| Clarté, gain à P=64 (+100) | 1,78 | 1,79 |
| Clarté, gain à P=256 (+100) | 1,78 | **1,27** |
| Clarté, terme global (aplat 128) | −19,59 | **0,00** |
| Clarté, gain à P=3 (−100) | 0,39 | **0,10** |

Trois écarts de nature, pas de dosage :

1. **Notre Texture est un anneau d'un pixel.** Sa tente 3×3 à un texel n'a
   presque aucune réponse à la période 16 (0,038 de passe-haut par construction),
   donc le curseur ne fait rien à l'échelle où Lightroom fait le plus. Et il n'a
   **aucune dépendance à l'amplitude** : l'epsilon du filtre guidé, qui est la
   moitié de ce qui définit Texture, n'existe pas chez nous.
2. **Notre Clarté a le rayon de leur Texture.** 13,5 px contre 219 : nous avons
   construit, sous le nom de Clarté, un opérateur d'une échelle vingt fois trop
   fine — et notre pyramide donne un rayon qui suit la taille de l'image, ce qui
   est le bon comportement pour Clarté, à la mauvaise échelle.
3. **Il manque la courbe de ton globale de Clarté.** Notre terme est
   `(lp − blurLuma)`, nul sur un aplat par construction : à Clarté +100 nous ne
   bougeons pas un aplat de 128 là où Lightroom le descend de 19,6 niveaux. C'est
   la composante qui manquait de la même façon au voile, corrigée le 2026-09-15
   par un terme global séparé.

## Ce qui n'est pas tranché

- **La loi du rayon, pour les DEUX opérateurs.** Les trois mires partagent leur
  hauteur, donc elles ne disent rien de la dépendance à la hauteur : « Texture
  est absolue » et « Texture est proportionnelle à la hauteur » rendent le même
  chiffre, et « Clarté suit la racine de l'aire » n'est pas séparée de « Clarté
  suit la largeur seule ». **Une seule campagne les tranche toutes les deux** :
  une mire à hauteur DOUBLÉE et largeur constante, trois exports (témoin,
  `texture-p100`, `clarte-p100`). C'est la mesure à faire avant d'écrire une
  ligne de shader, parce qu'elle décide si le rayon se règle en pixels ou en
  fraction de l'image.
- **La forme exacte de la table 2D de Clarté.** Les aplats donnent trois points
  de sa diagonale (32 · 128 · 224) ; sa surface complète demanderait des aplats à
  plus de niveaux, ce que la mire porte déjà en zone TON une fois le rayon connu.
## En prime : le voile a un défaut que la rampe ne pouvait pas voir

`pres-voile-p100` était dans la campagne pour vérifier que la correction du
2026-09-15 tenait. Elle tient là où elle a été calibrée, et elle casse ailleurs.

| Correction du voile +100 | Lightroom | shaderlab |
|---|---|---|
| aplat 32 | −22,98 | −23,00 |
| aplat 128 | −79,38 | −76,00 |
| **aplat 224** | **+0,00** | **−59,00** |
| gain local à P=16 (amplitude 16) | **1,95** | **0,88** |

Deux choses, indépendantes :

1. **Lightroom ne touche PAS un aplat à 224.** Exactement zéro, et l'échelon
   176\|224 le confirme séparément (champ lointain +0,00 sur son plateau clair,
   avec 1024 px de marge). Nous le descendons de 59 niveaux. Le terme global de
   notre voile n'a pas de plancher en haut — la rampe ne pouvait pas le dire,
   puisque ses hautes lumières y sont mêlées à tout le reste de la course.
2. **Le voile de Lightroom AJOUTE du contraste local** (×1,95 à P=16) là où le
   nôtre en RETIRE (×0,88). Nous portons bien un terme local
   (`DEHAZE_AMT * (lp − blurLuma)`), mais la compression globale le domine et le
   signe net s'inverse.

Ces deux points sont mesurés, pas corrigés : ils appartiennent au voile, pas à
ce chantier.

## Ce qui n'est pas mesuré ici

- Le grain, l'accentuation et le débruitage partagent la famille des opérateurs
  locaux et ne sont dans aucune campagne. La mire les porterait telle quelle.

## Ce que l'instrument vaut — attaqué, chiffres à l'appui

Revue adverse du 2026-09-16, recalculs faits depuis les JSON bruts.

Ce qui **tient** :

- **Le plancher de bruit est nul.** Le témoin rend `mean|écart| = 0,000` et
  `std = 0,000` sur les trois tailles et tous les échelons — largeur efficace du
  témoin : 0,0 px. L'objection « la somme des écarts intègre du bruit sur un
  demi-plateau de 1024 px et gonfle la largeur » tombe donc d'elle-même. Et la
  décomposition le confirme : sur Clarté à 2048, sur 216 px de largeur, 34
  viennent des 40 premiers pixels et **182 sont de la queue réelle**.
- **Lightroom au repos EST l'identité**, ce qui était le vrai risque pour
  Texture : aucune accentuation de capture par défaut sur un JPEG. Le témoin rend
  un rapport amplitude/entrée de 0,990 à 1,008 sur toutes les périodes, et ses
  aplats valent 32,000 · 128,000 · 224,000 exactement.
- **La démodulation ne fuit pas** (nombre de cycles entier) et la convention de
  phase est la même des trois côtés — et de toute façon le gain étant un RAPPORT
  de deux démodulations identiques, une erreur de convention s'y annulerait.
- **Les deux côtés mesurent la même chose** : même mire en entrée, module appliqué
  en fin de pipeline des deux côtés, mêmes coefficients de luminance, même
  géométrie lue dans le même JSON, et les deux témoins ont le même rapport
  d'amplitude — donc des dénominateurs identiques.

Ce qu'il faut savoir en lisant les chiffres :

- **La « largeur efficace » n'est pas un rayon**, c'est la somme des écarts
  rapportée au sommet. Pour une décroissance en exp(−x/L) elle vaut exactement L ;
  la réponse de Clarté n'en est pas une — elle mélange un dépassement de bord
  (~34 px) et une longue queue basse (~180 px). Le scalaire est honnête, le mot
  « rayon » est une approximation.
- **Les points d'amplitude 2 et 4 portent 3 à 5 % d'incertitude** (une sinusoïde
  de ±2 niveaux quantifiée en 8 bits). Les conclusions sur l'epsilon reposent sur
  les amplitudes 16 à 64, où l'incertitude est sous 0,3 %.
- **Un « gain » ici est un gain en valeur ENCODÉE sRGB**, pas un contraste
  physique. Les deux côtés font pareil, donc la comparaison tient ; une
  amplitude en lumière linéaire ne s'en déduit pas directement.

## Rejouer la campagne

Trois lancements, un par taille de mire (le plugin consomme une mire par
démarrage) :

```
python .scratch/lightroom-develop/assets/mire/faire-mire-presence.py
copy .scratch\lightroom-develop\assets\mire\shaderlab-mire-presence-*.jpg %USERPROFILE%\Pictures\shaderlab-mire\
```

puis, pour chaque taille, poser `Documents/shaderlab-mesures-go.txt` et
`shaderlab-mesures-extra.txt` (voir `assets/listes-de-mesures.md`, campagne C) et
redémarrer Lightroom. Enfin :

```
python .scratch/lightroom-develop/assets/analyse-mire-presence.py
node .scratch/lightroom-develop/assets/mesure-presence-shaderlab.mjs
python .scratch/lightroom-develop/assets/comparer-presence.py
```
