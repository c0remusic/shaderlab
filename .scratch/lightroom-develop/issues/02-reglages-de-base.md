# 02 — Réglages de base + courbe paramétrique : le TON en un seul effet

Type: task
Status: ready-for-human (livré le 2026-09-11 ; reste la validation esthétique d'Antoine côte à côte avec son Lightroom — planche 02)
Blocked by: — (03 livré, commit `fe5ae13`). Les paragraphes « GELÉ » ci-dessous qui parlent d'entrée `registry.ts`/`catalog.ts` et de compte 27 → 28 sont CADUCS : le module vit dans `developRegistry.ts` et est rendu par l'étage ; le compte des EFFETS ne bouge pas (26).

**What to build :** l'effet `reglagesDeBase` — le panneau « Réglages de base »
de Lightroom Classic 14.5.1 (inventaire `../research/01-…` § 1) PLUS la courbe
paramétrique (§ 2, 7 curseurs), en UN SEUL effet, parce que la mesure
`../research/02-huit-bits-mesure.md` dit qu'empiler des effets de ton en 8 bits
perd 25 % des niveaux et creuse des trous de 7, alors qu'un effet unique en
flottant, quantifié une fois, rend ce que Lightroom rend. Décision d'Antoine :
« fais comme tu peux » (2026-09-11) = 8 bits, ton d'un bloc.

## Les 22 curseurs, libellés français de Lightroom (mesurés), bornes usuelles

Sections dans l'ordre du panneau (l'ordre AFFICHÉ = l'ordre de `params[]`,
CLAUDE.md — donc déclarer `params[]` dans cet ordre dès le premier commit, les
index seront gelés par les presets et les références) :

**Balance des blancs** (JPEG : relative) — `Température` (`IncrementalTemperature`,
−100..100, bleu ↔ jaune), `Nuance` (`IncrementalTint`, −100..100, vert ↔ magenta).

**Tonalité** — `Exposition` (−5..+5 IL), `Contraste` (−100..100), `Hautes
lumières`, `Ombres`, `Blancs`, `Noirs` (−100..100 chacun).

**Présence** — `Texture` (−100..100), `Clarté` (−100..100), `Correction du
voile` (`Dehaze`, −100..100), `Vibrance` (−100..100), `Saturation` (−100..100).

**Courbe paramétrique** (« Courbe des tonalités » — région) — `Hautes lumières`,
`Teintes claires`, `Teintes sombres`, `Ombres` (`ParametricHighlights/Lights/
Darks/Shadows`, −100..100), et les trois séparations `ParametricShadowSplit`
(10..70, défaut 25), `ParametricMidtoneSplit` (20..80, défaut 50),
`ParametricHighlightSplit` (30..90, défaut 75). ⚠️ La courbe À POINTS reste
`curves` (existe, gelée) — ne pas la dupliquer.

⚠️ Bornes « usuelles » : à remplacer par `Documents/shaderlab-lightroom-ranges.txt`
(plugin `assets/shaderlab-dump.lrdevplugin`) dès qu'Antoine l'a produit.

## Mécanisme — ordre de Lightroom, en linéaire, une passe finale

Lightroom applique dans cet ordre (PV2012, mesurable dans son propre code de
présentation : les curseurs sont listés dans cet ordre et s'appliquent ainsi) :

1. **Balance des blancs** : gain par canal en linéaire — Température déplace
   le rapport B/R (bleu ↔ jaune), Nuance le rapport V/(R+B) (vert ↔ magenta),
   normalisé pour garder la luminance d'un gris moyen. Amplitude à calibrer sur
   planche (Lightroom ±100 en JPEG est franc mais pas caricatural).
2. **Exposition** : gain `2^EV` en linéaire avec un GENOU doux vers le blanc
   (Lightroom ne clippe pas sec : au-dessus de ~0,8 la courbe s'arrondit).
3. **Contraste** : S autour du gris moyen, en espace perceptuel (sRGB ou
   OKLab L), pas en linéaire.
4. **Hautes lumières / Ombres** : ⚠️ LOCAUX chez Lightroom (PV2012) — le poids
   dépend d'une luminance FLOUTÉE à grand rayon (≈ 2-4 % de la largeur), pas du
   pixel seul ; c'est ce qui les distingue d'une courbe et évite le look
   « HDR sale ». Donc UNE passe interne de pyramide (`blurChain`, 1/8 ou 1/16)
   qui produit la luminance floue, lue par la passe finale via `prevPass`
   (la passe finale voit `color` = source ET `prevPass`, comme `glow`).
   Poids ombres = `(1 − Lflou)²`, hautes lumières = `Lflou²`, appliqués sur le
   pixel en perceptuel.
5. **Blancs / Noirs** : déplacent les points blanc et noir (les extrêmes de la
   courbe), avec un poids serré aux extrémités.
6. **Texture / Clarté / Correction du voile** : Texture = contraste local à
   PETIT rayon (≈ 0,2 % largeur), Clarté = contraste local à MOYEN rayon
   (≈ 1 %), en perceptuel, sans halo (masque de contour doux comme `nettete` le
   fait déjà — RÉUTILISE `nettete`'s mécanisme à deux bandes ; c'est la même
   chose). Dehaze = estimation d'un voile (canal sombre flouté à grand rayon —
   la même pyramide que 4) soustrait puis renormalisé ; négatif = ajoute du
   voile. Les trois lisent des flous : la pyramide fournit 2-3 échelles.
7. **Vibrance / Saturation** : Saturation = dose de chroma uniforme (OKLCH ou
   sat HSL) ; Vibrance = dose NON linéaire, forte sur les couleurs peu
   saturées, faible sur les saturées, et protège les teintes de peau (bande
   orange 20-50°) — c'est l'opérateur que le ticket 10 disait manquant.
8. **Courbe paramétrique** : quatre régions séparées par les trois
   séparations, chaque curseur lève/baisse sa région avec des transitions
   douces (cosinus entre séparations), en perceptuel.
9. Encodage sRGB par le FORMAT à l'écriture — UNE quantification.

Défauts tous à 0 (séparations 25/50/75) → identité au bit près.

## Ce qui est GELÉ

- Un fichier `src/render/effects/reglagesDeBase.ts`, entrée `registry.ts`
  APRÈS `etalonnage`, catégorie de la retouche. Sans `canvasControls`.
  Sections : `Balance des blancs` (paire) · `Tonalité` (liste 6) · `Présence`
  (liste 5) · `Courbe paramétrique` (liste 4 + grille 3 pour les séparations —
  ou `figure` si un contrôle visuel de régions vaut le coup ; pas dans ce
  ticket). 22 params > `MAX_EFFECT_PARAMS` ? Non (48). Passes : la pyramide de
  flou (réutiliser `blurChain`), `enabled` quand HL/Ombres/Texture/Clarté/
  Dehaze sont tous à 0 (une passe sautée → `prevPass` = source).
- Compte du registre 27 → 28 et paramètres (`mesure-controles.ts`) dans
  CLAUDE.md et ROADMAP, MÊME commit. Garde de câblage.
- **Mires** : `mireRampe` (existe) pour le ton — références
  `effet-reglages-temoin` (tout à 0 = source au bit près),
  `effet-reglages-ton` (Exposition +1, HL −50, Ombres +50, Noirs −20, Blancs
  +20), `effet-reglages-courbe` (paramétrique HL −60 / Ombres +60, séparations
  déplacées), et sur une mire COLORÉE (celle du ticket 01, `mirePrimaires`, ou
  la commune) `effet-reglages-couleur` (Température +40, Nuance −30, Vibrance
  +60) et `effet-reglages-presence` (Texture +60, Clarté +60, Dehaze +40 — se
  juge en crop 1:1). Scénario + `ATTENDU`, même commit.
- **Preuve du « une seule quantification »** : un test unit sur la fonction
  pure TS (miroir de la WGSL, comme `aperture.ts`) qui rejoue la chaîne du
  ticket 02 de recherche et compte 132 niveaux, pas 109 — le gate qui dit que
  l'effet tient sa raison d'être.
- Planche pour Antoine sur ses deux photos : témoin · Exposition ±1 · HL −80 ·
  Ombres +80 · Blancs/Noirs · Texture +80 · Clarté +80 · Dehaze ±60 · Vibrance
  +80 vs Saturation +80 (la différence doit se voir sur la peau) · Température
  ±50 · le look « paramétrique ». Il compare à SON Lightroom, mêmes valeurs.

- [x] `reglagesDeBase.ts` : **20** params (pas 22 — voir décision) dans l'ordre du panneau, pyramide de luminance (moyen-large) + tente fine, chaîne dans l'ordre de Lightroom, identité à 0 (garde + saut de l'étage).
- [x] Module dans `developRegistry.ts` (l'étage, PAS `registry.ts`) : application `etalonnage`→`reglagesDeBase`, affichage `reglagesDeBase`→`etalonnage`. Compte des EFFETS inchangé (26). CLAUDE.md/ROADMAP (références 133→139). Câblage vert (20 params lus), `test:wgsl` vert, `gpu-shaders` vert (7 passes + composite).
- [x] **6** références + ATTENDU, `test:render` zéro écart sur les 133 existantes, +6 (139).
- [x] Test « 132 niveaux » : mesuré **130 niveaux d'un bloc / trou 3**, contre **104 empilé** (`reglagesDeBase.test.ts`). Vibrance ≠ saturation prouvée sur la peau.
- [x] Planche sur les deux photos d'Antoine (`planche-02-reglages-{rendu,assemble}.mjs` → `planche-02-reglages.html`) + capture du panneau CDP (`etage-02-panneau.png`), `frameSignature` change à Exposition +1 et revient au bit près à 0.
- [ ] Bornes réelles du plugin : `Documents/shaderlab-lightroom-ranges.txt` ABSENT → bornes usuelles du ticket. À reprendre si Antoine produit le fichier.
- [ ] Validation esthétique d'Antoine côte à côte avec son Lightroom (planche 02).

## Décisions et écarts d'exécution (2026-09-11)

- **20 curseurs, pas 22.** Le « 22 » comptait les 15 LIGNES du panneau Basic de
  `research/01 § 1` + 7 de courbe. Deux de ces lignes ne sont pas des curseurs de
  ton continus de CE module : `WhiteBalance` (un CHOIX — en JPEG relatif,
  Température/Nuance suffisent) et `ConvertToGrayscale` (le N&B, module séparé).
  13 Basic + 7 courbe = 20.
- **Transport des flous : une seule pyramide + une tente fine.** La chaîne de
  passes est LINÉAIRE (un seul `prevPass`) — pas de transport de plusieurs
  textures floutées. `prevPass` porte le flou MOYEN-LARGE (pyramide `blurChain`,
  structure de la bande Clarté de `nettete`, 4 descentes + 3 remontées), lu par
  Hautes lumières/Ombres (poids), Clarté (contraste local) et Voile. La bande
  FINE de Texture se calcule dans la passe finale par une tente 3×3 à un texel sur
  `srcTexture`. Écart assumé à Lightroom (qui donne à Clarté un rayon plus serré
  qu'aux HL/Ombres) — en 8 bits et sur ses rayons descriptifs jamais chiffrés, le
  partage est acceptable ; les deux rayons sont bien SÉPARÉS (fin vs moyen-large)
  et calibrables sur la planche.
- **Amplitudes (`k` des constantes, ce qu'un +100 fait).** WB : R+0,30/B−0,30 à
  Température +100, R+B+0,15/G−0,15 à Nuance +100 (gains linéaires, renormalisés
  au blanc → luminance d'un gris préservée, vérifié sur photo : Température ±50
  garde la moyenne à 63,6). Exposition : 2^IL, clamp (PAS de genou — en 8 bits un
  genou sous 1.0 casse l'identité, au-dessus la quantification l'efface).
  Contraste : pente 1+k. HL/Ombres locaux : 0,5·poids·(1−s) à |100|. Blancs/Noirs :
  0,4·poids à |100|. Texture : gain additif 1,2·détail fin. Clarté : 0,9·détail
  moyen. Voile : 0,35. Courbe paramétrique : lift perceptuel max 0,35 par région,
  transitions cosinus (demi-largeur 0,15). Vibrance/Saturation : facteur OKLab
  1+k, vibrance éteinte au-delà de 0,20 de chroma et sur la direction peau (a,b).
- **`emboss`/`noise` non touchés.** Le module vit dans l'étage ; `mesure-controles.ts`
  ne compte QUE `effectRegistry`, donc les 20 params n'y entrent pas (compte
  effets/params inchangé).
- **Bug d'exécution corrigé (hors périmètre strict) :** `runDevelopStage`
  n'exécutait PAS les passes internes (`etalonnage`, seul module jusqu'ici, n'en a
  aucune) — un module de l'étage à pyramide n'aurait jamais eu son `prevPass`.
  Étendu à `runInternalPasses` comme la boucle des calques. `wgslNaga.test.ts` et
  `gpu-shader-check.mjs` composaient aussi l'étage sans `hasPrevPass` : corrigés.
- **Repli « Effet » de `ParamPanel` retiré pour l'étage** par une prop `flat`
  (pas un fork). `DevelopPanel` fait de chaque module un ACCORDÉON (`Disclosure`,
  Lightroom) — réponse ADR-0001 quand l'étage dépasse un écran ; on replie ce
  qu'on ne règle pas.


## Calibration — 2026-09-12 (« contraste et luminosité rendent un peu bizarre »)

Le ton du ticket datait d'AVANT le pont de mesure : formes plausibles, jamais
confrontées aux rampes. Calibré sur les 30 rampes `research/mesures/*.json`
(`assets/calibrer-ton.py`, table isolée `src/render/effects/reglagesDeBaseTable.ts`,
lue par le twin ET le WGSL). Écart moyen à Lightroom sur les rampes : **13,1 →
3,6 niveaux** (contraste −100 : 51,4 → 3,3 ; exposition ±2 : ~13 → ~2,4).

Changements de forme : exposition = gamma perceptuel ancré (le gain 2^EV nu n'a
pas le genou mesuré — blanc tenu à −2 IL) ; contraste = gamma double pivoté ancré
0/pivot/1 ; ombres/HL/noirs/blancs = cloches bêta par signe (Lightroom est
asymétrique). Résidus au-dessus de 5 niveaux : param-lights +100 (16,5),
param-darks +100 (13,3), param-ombres +100 (8,4), ombres +100 (8,0), noirs −50
(7,0) — formes de la courbe paramétrique à revoir si l'œil le demande.
Références : `developpement-reglages-ton` et `-courbe` régénérées (correction) ;
témoin et les 145 autres au bit près.
