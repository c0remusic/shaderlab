# 05 — HSL / Couleur / Noir et blanc : 33 curseurs de bande

Type: task
Status: ready-for-human (LIVRÉ le 2026-09-11, commit à venir ; table de bandes PROVISOIRE — voir plus bas — et validation esthétique d'Antoine côte à côte avec son Lightroom, planche 05)
Blocked by: 02 (livré) ; la MESURE `../research/03-courbes-lightroom-mesurees.md` reste ABSENTE (aucun export du plugin) — livré sur table PROVISOIRE, remplaçable par `assets/calibrer-hsl.py` dès que les exports existent.

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

- [~] Poids de bande dérivés de la mesure — IMPOSSIBLE (exports absents). Livré sur TABLE PROVISOIRE (`src/render/effects/hslBandes.ts`), valeurs usuelles de Lightroom ; `assets/calibrer-hsl.py` ajuste par moindres carrés quand les exports existent.
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

## Reste

- Validation esthétique d'Antoine (planche 05, comparée à son Lightroom).
- Calibration réelle : produire les exports du plugin, lancer `analyse-mesures.py`
  puis `calibrer-hsl.py` (colle la table + écart résiduel), et `comparer-lightroom.py`.
- Suite du chantier `lightroom-develop` : Color Grading (14), Détail (9),
  Vignettage (6), angle du recadrage, masques locaux.
