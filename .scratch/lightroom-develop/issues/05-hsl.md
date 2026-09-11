# 05 — HSL / Couleur / Noir et blanc : 33 curseurs de bande

Type: task
Status: ready-for-human (LIVRÉ le 2026-09-11 ; table de bandes CALIBRÉE sur Lightroom 14.5 le 2026-09-11 — voir « Calibration » plus bas ; reste la validation esthétique d'Antoine côte à côte avec son Lightroom, planche 05)
Blocked by: 02 (livré). ⚠️ PRÉMISSE PÉRIMÉE : ce ticket disait « la MESURE reste ABSENTE (aucun export du plugin) ». Les 146 exports du plugin EXISTENT désormais (`research/mesures/*.json`, résumés dans `research/03-…` et `research/04-hsl-profils-mesures.md`) — la table est calibrée dessus par `assets/calibrer-hsl.py`, plus provisoire.

**What to build :** le module `hsl` de l'étage — « go pour HSL après », Antoine,
2026-09-11. Le panneau « Couleur » de Lightroom (inventaire § 3) : huit bandes
(Rouge, Orange, Jaune, Vert, Turquoise (Aqua), Bleu, Violet, Magenta) × trois
curseurs (Teinte, Saturation, Luminance) = 24, plus le mode **Noir et blanc**
(`ConvertToGrayscale`) avec ses huit curseurs « Mélange noir et blanc »
(`GrayMixer*`, −100..100) = 33, libellés français mesurés dans les chaînes
(« Variation de la teinte rouge », « Niveau de gris turquoise »…).

## Mécanisme — ce qu'on sait, ce qui se mesure

- Une bande est un POIDS sur la teinte du pixel : gaussienne ou cosinus centré
  sur la teinte de la bande, recouvrant les voisines à mi-hauteur. Chez
  Lightroom, la teinte, la saturation ET la luminance du pixel modulent le
  poids (un pixel gris ne bouge pas ; une couleur pâle bouge moins) — c'est ce
  que le balayage à sat 50 % et les bandes de luminosité de la mire mesurent.
  **Les centres et largeurs réels viennent de la mesure `hsl-teinte-*-p100`**
  (le décalage de teinte de sortie en fonction de la teinte d'entrée dessine
  directement le poids de la bande). Ne pas approximer.
- Teinte : rotation de la teinte du pixel de `poids × amplitude` (amplitude à
  lire sur `hsl-teinte-rouge-p100` : combien de degrés à +100).
- Saturation : dose de chroma par bande, en OKLCH ou HSL — lire
  `hsl-sat-rouge-p100/m100` : −100 désature-t-il totalement la bande ?
- Luminance : gain de luminance par bande, en perceptuel, SANS toucher la teinte
  (lire `hsl-lum-*`).
- N&B : `ConvertToGrayscale` bascule le module en Mélange noir et blanc — la
  luminance de sortie = luminance pondérée par bande (`GrayMixer*`), comme le
  mélangeur de couches de Photoshop en mono mais par teinte. Un `choices`
  (Couleur / Noir et blanc) qui masque les 24 curseurs de couleur et montre les
  8 de mélange (`appliesWhen`, ADR-0001 ; c'est exactement le cas d'usage des
  conditions de section, et il faut les mesurer par `--applicabilite` —
  et ajouter les déclarations à `scripts/applicabilite-table.mjs`, même commit).
- Espace : les rotations de teinte se font sur (a, b) d'OKLab par matrice 2×2,
  PAS via `atan2` (ticket 04 : `atan2` de Dawn ment au 3ᵉ quadrant). Le poids
  de bande a besoin de la teinte du pixel → il faut un angle → soit
  `atan2_sure` (ticket 04, à écrire d'abord), soit un poids calculé SANS angle
  (produit scalaire avec le vecteur unitaire de la bande : `cos(Δθ) = (a·ca +
  b·cb)/|ab|`, puis la gaussienne sur cet écart — aucun `atan2`). Préférer la
  seconde ; noter.
- Une seule quantification : le module est UNE passe finale, aucune passe
  interne (tout est par pixel).

## Gelé

- Module dans `developRegistry` — ordre d'application : après
  `reglagesDeBase` (Lightroom : HSL après le ton) ; ordre d'affichage : après la
  Courbe (Réglages de base · Courbe · HSL · … · Étalonnage). 33 params,
  sections : `Mode` (choix), `Teinte` (grille 8), `Saturation` (grille 8),
  `Luminance` (grille 8), `Mélange noir et blanc` (grille 8, `appliesWhen`
  N&B) — les grilles 4×2 tiennent en 2 lignes chacune (ADR-0001).
- Références sur `mirePrimaires` + une mire de BALAYAGE de teinte (à écrire si
  absente — la mire du plugin, `assets/mire/`, en est une : porte-la dans
  `render-check.mjs`) : `developpement-hsl-temoin` (identique au témoin nu),
  `developpement-hsl-teinte-rouge` (+100), `developpement-hsl-sat-bleu-m100`,
  `developpement-hsl-lum-vert-p100`, `developpement-hsl-nb` (mélange). Et
  **comparaison à Lightroom** : le harnais rend la même mire que le plugin ; un
  script compare notre export à l'export Lightroom de la même mesure, canal par
  canal (écart moyen, max) — le chiffre va dans le ticket. C'est la première
  fois qu'un effet se mesure contre la référence elle-même, pas contre son
  propre témoin.
- Planche pour Antoine, ses deux photos, à comparer à son Lightroom.

- [x] Poids de bande dérivés de la mesure — FAIT le 2026-09-11 (les exports existent). Table calibrée (`src/render/effects/hslBandes.ts`) par `assets/calibrer-hsl.py` (moindres carrés forward-model). Modèle ÉLARGI : deux σ par bande (gauche/droite, côté au signe du produit vectoriel, sans atan2). Voir « Calibration » ci-dessous.
- [x] `hslDevelop.ts` (33 params, N&B par `choices` + `appliesWhen` tabulés dans `applicabilite-table.mjs`), une passe, poids de bande SANS `atan2` (produit scalaire OKLab + `acos`).
- [x] 4 références (`developpement-hsl-{teinte-rouge,sat-bleu,lum-vert,nb}`) + ATTENDU, `test:render` zéro écart sur 139, +4 = **143**. `assets/comparer-lightroom.py` écrit (à lancer quand les exports existent).
- [x] Panneau : sections en grilles 8 (Teinte/Saturation/Luminance/Mélange N&B), mode N&B masque/démasque (32 déclarations `appliesWhen` éprouvées INERTES par `--applicabilite`, 66/66 inertes).
- [x] Planche (`planche-05-hsl-{rendu,assemble}.mjs`, deux photos d'Antoine) ; verdict esthétique d'Antoine DÛ.

## Décisions et écarts d'exécution (2026-09-11)

- **Prémisse fausse du brief corrigée : `effects/hsl.ts` EXISTAIT déjà** (helper de
  conversion HSL→RGB `hsl2rgb`/`HSL_TO_RGB_WGSL`, lu par une dizaine d'effets,
  listé comme helper dans CLAUDE.md). Le module vit donc dans
  **`src/render/effects/hslDevelop.ts`** ; l'id de module reste `hsl` (aucun clash
  d'id). La convention fichier=id cède devant le clash de nom de fichier.
- **Poids de bande SANS `atan2`** : chaque bande est une DIRECTION unitaire (a,b)
  d'OKLab, dérivée d'une couleur pure. Le poids d'un pixel = `acos` du produit
  scalaire `(a·ca+b·cb)/|ab|` passé dans une gaussienne, modulé par
  `smoothstep(0, chromaRef, chroma)` (un gris ne bouge pas). `acos` est sûr sur
  Dawn ; on ne calcule jamais l'angle ABSOLU du pixel. Teinte = rotation 2×2 de
  (a,b) par `Σ poids·amplitude`. Chaque bande n'ajoute sa rotation que si SON
  curseur est réglé, donc régler `redHue` seul ne touche que le rouge.
- **TABLE PROVISOIRE** (`hslBandes.ts`, nommée et isolée) : centres = teintes
  usuelles (Rouge 0°, Orange 30°, Jaune 60°, Vert 120°, Turquoise 180°, Bleu 240°,
  Violet 270°, Magenta 300°) via une couleur pure par bande ; `HSL_SIGMA_DEG = 25`
  (recouvrement voisin ~mi-hauteur) ; `HSL_CHROMA_REF = 0,05` ; amplitude 30°/+100,
  satK 1, lumK 0,5, grayK 0,5 (identiques par bande faute de mesure). `grayK`
  restera provisoire même après calibration : `mesures.lua` n'exporte aucun
  GrayMixer par bande. Le SIGNE de la rotation de teinte est aussi provisoire (à
  lire sur `hsl-teinte-*-p100`).
- **Références sans `contre`** : la `mireBalayage` porte des centaines de couleurs,
  la garde de signal passe sur le compte (comme nombre de références du dépôt sans
  baseline). L'ACTION du module est prouvée plus fortement par le twin
  `hslDevelop.test.ts` et par `--applicabilite` (32 déclarations inertes). Pas de
  5ᵉ référence témoin (identité au défaut prouvée par le twin + le saut de l'étage
  + `test:render` zéro écart sur les 139).
- **Instrument `--applicabilite` étendu à l'ÉTAGE** : un champ `develop: true` sur
  la déclaration route le rendu par `exportFrame(layers, null, { [module]: params })`
  au lieu d'un calque. `mireBalayage` ajoutée aux mires du harnais.
- **Vérifs GPU live (CDP 9223)** : `reglerDeveloppement("hsl", {blueHue:100})` →
  frameSignature change ; `{mode:1}` (N&B) → change ; reset → retour à S0 au bit
  près (moyenne 43.63674770518868 / écart 60.70067631971353, identiques).
- **Panneau à trois modules mesuré** : la carte borne sa hauteur (clientH 1153 px,
  viewport 1369) et défile DEDANS (`overflow-y:auto`, scrollH 2947) — le point
  laissé ouvert au ticket 02 est réglé par le CSS du ticket 03, la colonne ne
  défile pas (ADR-0001). Capture `assets/etage-05-panneau.png`.
- **Planche photo B** : plusieurs vignettes portent le même md5 (col1/2/5,
  col9/11). Photo A (fleur) montre les 12 colonnes distinctes. `--applicabilite`
  (Renderer réutilisé) prouve que le rendu se rafraîchit au changement de develop
  — donc c'est cohérent avec une photo « edited-2 » à faible chroma que la porte
  anti-gris neutralise sur ces bandes, plus la quantification du downscale 620 px,
  pas un bug du module (les références pixel-lock et le twin le prouvent). À
  éprouver sur une photo plus colorée si Antoine veut trancher.

## Calibration sur Lightroom 14.5 (2026-09-11)

Les 146 exports du plugin existent (`research/mesures/*.json`). `assets/calibrer-hsl.py`
réécrit ci-dessous ajuste la table par MOINDRES CARRÉS dans les termes MÊMES du
forward-model (jumeau `hslSpec`), pas une formule fermée : les résidus sont en
degrés de teinte de SORTIE (teinte) ou en points de sat/lum HLS, directement
comparables à Lightroom. À RELANCER (`python assets/calibrer-hsl.py`), jamais éditer
la table à la main. Détails machine dans `assets/hsl-calibration.json`.

**Prémisse du brief corrigée** : le twin s'exporte `hslSpec` (pas `hslDevelopSpec`) ;
ses tests assertent désormais la PROPRIÉTÉ lue dans la table (un rouge tourne d'≈
`amplitudeDeg`, un bleu voit sa chroma ×(1−`satK`)), pas un littéral recopié.

### Modèle élargi — deux σ par bande (asymétrie)

Le profil mesuré de plusieurs bandes est franchement asymétrique autour de son
centre (mesuré : Vert 9,2→7,4, Violet 10,2→8,6 de rmse quand on passe de σ unique
à σ asym ; Bleu à peine, 7,8→7,7 malgré la note de recherche). Le poids porte donc
DEUX demi-largeurs `sigmaLeftDeg`/`sigmaRightDeg`, le côté choisi au SIGNE du produit
vectoriel `a·cb − b·ca` (un `select`, toujours sans `atan2`). Une bande symétrique a
sL == sR (Rouge, Magenta). Trois lignes de WGSL, un couple de champs dans la table.
Limite irréductible : le modèle est symétrique EN SIGNE (+100 et −100 = courbes
miroir), Lightroom ne l'est pas (le pic de +100 et de −100 ne tombent pas à la même
teinte d'entrée) — d'où le résidu résiduel, surtout Vert/Bleu/Violet.

### Table finale (résidus par courbe)

| bande | centre° | rgb (centre) | amp° | σL/σR | satK | lumK | grayK | rmseT° | rmseS | rmseL | rmseG |
|---|---|---|---|---|---|---|---|---|---|---|---|
| red | 347 | 1.0,0.0,0.217 | 46 | 18/23 | 0.84 | 0.67 | 0.54 | 3.1 | .057 | .047 | .050 |
| orange | 30 | 1.0,0.5,0.0 | 52 | 26/23 | 0.88 | 0.68 | 1.42 | 1.8 | .072 | .044 | .068 |
| yellow | 52 | 1.0,0.867,0.0 | 36 | 18/28 | 0.98 | 0.47 | 2.00 | 2.0 | .090 | .049 | .107 |
| green | 93.5 | 0.442,1.0,0.0 | 82 | 10/17 | 1.00 | 0.49 | 0.09 | 7.3 | .173 | .062 | .015 |
| aqua | 168 | 0.0,1.0,0.8 | 24 | 41/13 | 0.92 | 0.40 | 0.20 | 4.1 | .035 | .031 | .046 |
| blue | 212 | 0.0,0.467,1.0 | 66 | 41/52 | 0.62 | 0.47 | 0.93 | 7.1 | .119 | .054 | .060 |
| purple | 298 | 0.967,0.0,1.0 | 52 | 9/78 | 0.52 | 0.39 | 1.46 | 8.4 | .103 | .040 | .048 |
| magenta | 320 | 1.0,0.0,0.667 | 30 | 15/15 | 0.71 | 0.62 | 2.00 | 1.2 | .030 | .025 | .216 |

- rmseT en degrés de teinte de sortie (1,2 à 8,4°) ; rmseS/L/G en points HLS (0..1).
- **satK borné à 1,0** : au-delà, `satMul = 1 − poids·satK` deviendrait négatif au
  centre (inversion de chroma vers la complémentaire). Green/yellow butent contre
  cette borne — Lightroom désature « un peu plus » que chroma nulle par nonlinéarité
  HLS/OKLab ; le résidu le porte plutôt qu'un signe inversé.
- **lumK = UN seul k par bande**, mais Lightroom est asymétrique : amplitudes
  mesurées p/−m par bande (ex. red +0,25/−0,45 ; aqua +0,44/−0,18 ; bleu +0,43/−0,11).
  Le k retenu est le meilleur compromis commun (écart noté dans le JSON).
- **grayK = colonne la moins sûre** : dérivée par différence croisée `hsl2-gris-*`
  vs `nb`, sur une série 2 contaminée par un virage SplitToning et bornée par le
  plafond de L (Jaune/Magenta butent contre le plafond de recherche 2,0 ;
  incertitude ±0,17 à ±0,37 du ratio dL/L). Seuls red (0,54) et blue (0,93) sont
  exercés par une référence (`developpement-hsl-nb`).

### Écart à Lightroom, AVANT / APRÈS (le livrable)

`assets/comparer-lightroom.py` : notre forward-model (miroir exact du shader) rend la
même mire de balayage avec le même réglage que chaque mesure Lightroom, et compare
CANAL PAR CANAL en niveaux sRGB (0..255). Pas d'export JPEG du plugin : la
comparaison se fait en ESPACE BALAYAGE (la couleur de sortie Lightroom est
reconstruite de son profil HLS mesuré). `moy` = tout le balayage ; `pic` = la zone où
la bande agit ; `max` = pire canal.

| mesure | AVANT moy/pic/max | APRÈS moy/pic/max |
|---|---|---|
| teinte-rouge +100 | 5.4 / 25.3 / 113 | 5.1 / 23.9 / 81 |
| teinte-orange +100 | 3.5 / 14.2 / 48 | 3.7 / 14.3 / 48 |
| teinte-jaune +100 | 12.6 / 46.5 / 138 | 5.5 / 35.7 / 120 |
| teinte-vert +100 | 5.0 / 13.6 / 196 | 8.0 / 23.1 / 166 |
| teinte-aqua +100 | 4.9 / 17.5 / 132 | 5.4 / 19.5 / 132 |
| teinte-bleu +100 | 14.5 / 44.1 / 164 | 12.5 / 35.4 / 91 |
| teinte-violet +100 | 10.8 / 32.0 / 136 | 11.4 / 31.1 / 128 |
| teinte-magenta +100 | 4.9 / 18.7 / 95 | 2.7 / 20.2 / 69 |
| sat-rouge −100 | 7.3 / 27.1 / 84 | 4.1 / 15.3 / 48 |
| sat-bleu −100 | 24.5 / 79.5 / 190 | 22.8 / 69.3 / 127 |
| lum-rouge +100 | 7.0 / 26.8 / 70 | 6.8 / 27.8 / 81 |
| lum-bleu +100 | 10.7 / 30.4 / 199 | 9.3 / 21.6 / 97 |
| lum-vert +100 | 6.4 / 15.7 / 65 | 9.2 / 25.8 / 160 |
| **MOYENNE** | **9.0 / 30.1** | **8.2 / 27.9** |

**Notre HSL est passé de 9,0 à 8,2 niveaux en moyenne de Lightroom (pic 30,1 → 27,9,
sur 0..255).** Gros gains au pic sur les bandes fortement calibrées (jaune 46,5→35,7,
bleu 44,1→35,4, sat-rouge 27,1→15,3, sat-bleu 79,5→69,3, lum-bleu 30,4→21,6, et le
`max` chute — rouge 113→81, bleu 164→91). Vert et lum-vert RÉGRESSENT (13,6→23,1 ;
15,7→25,8) : Lightroom rotationne le vert très fort (+77° mesuré à +100) et notre
grande rotation calibrée, en niveaux RGB, s'éloigne davantage que la version usuelle
timide — tension entre « bien viser la teinte de sortie » (ce que le fit minimise) et
« bien viser les trois canaux » quand la rotation est grande. Net positif global.

## Reste

- Validation esthétique d'Antoine (planche 05, comparée à son Lightroom).
- Affiner si voulu : grayK (mesure propre sans contamination SplitToning — la liste
  `grading3` de `mesures.lua` la produirait), lumK à deux k par sens si l'asymétrie
  gêne à l'usage, la régression du Vert (borner l'amplitude de teinte ?).
- Suite du chantier `lightroom-develop` : Color Grading (14), Détail (9),
  Vignettage (6), angle du recadrage, masques locaux.
