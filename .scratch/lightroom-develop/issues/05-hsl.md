# 05 — HSL / Couleur / Noir et blanc : 33 curseurs de bande

Type: task
Status: ready-for-agent
Blocked by: 02 (le panneau à deux modules et son repli), et la MESURE `../research/03-courbes-lightroom-mesurees.md` (les bandes de Lightroom se lisent sur le balayage de teinte : centre et largeur de chaque bande, forme du recouvrement — ne pas les écrire de tête)

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

- [ ] Poids de bande dérivés de la mesure (centres, largeurs, forme), écrits dans le ticket avec les chiffres.
- [ ] `hsl.ts` (33 params, N&B par `choices` + `appliesWhen` mesurés et tabulés), une passe.
- [ ] Références + comparaison chiffrée à l'export Lightroom.
- [ ] Panneau : sections en grilles, mode N&B masque/démasque.
- [ ] Planche, verdict d'Antoine.
