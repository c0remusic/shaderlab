# 02 — Réglages de base + courbe paramétrique : le TON en un seul effet

Type: task
Status: ready-for-agent
Blocked by: 03 (le module vit dans le registre de DÉVELOPPEMENT de l'étage, pas dans `effects/registry.ts` — Antoine, 2026-09-11 : « en fin de chaîne, après tous les calques », « affiché dans le menu à droite »). Les paragraphes « GELÉ » ci-dessous qui parlent d'entrée `registry.ts`/`catalog.ts` et de compte 27 → 28 sont CADUCS : même contrat `EffectModule`, même shader, même `ParamPanel`, mais enregistré dans `developRegistry.ts` et rendu par l'étage.

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

- [ ] `reglagesDeBase.ts` : 22 params dans l'ordre du panneau, pyramide de luminance, chaîne dans l'ordre de Lightroom, identité à 0.
- [ ] Registre 27 → 28, catalogue, CLAUDE.md/ROADMAP, câblage, `test:wgsl`, `gpu-shaders`.
- [ ] 5 références + ATTENDU, `test:render` zéro écart ailleurs.
- [ ] Test « 132 niveaux, pas 109 ».
- [ ] Planche sur les photos d'Antoine, comparée à son Lightroom.
- [ ] Bornes réelles du plugin.
