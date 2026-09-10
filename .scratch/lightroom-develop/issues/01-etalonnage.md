# 01 — Étalonnage (Lightroom « Etalonnage » : nuance foncée + primaires)

Type: task
Status: ready-for-agent
Blocked by: none

**What to build :** l'effet `etalonnage`, portage du panneau Étalonnage de
Lightroom Classic 14.5.1 (inventaire `../research/01-inventaire-module-developpement.md`
§ 9) — « ok pour étalonnage », Antoine, 2026-09-11. Sept curseurs, libellés
français de Lightroom (mesurés dans ses chaînes) :

| Clé Lightroom | Libellé | Borne usuelle | Ce que ça fait |
|---|---|---|---|
| `ShadowTint` | Nuance foncée | −100..100 | vert ↔ magenta, dans les OMBRES seules |
| `RedHue` / `RedSaturation` | Rouge primaire : Teinte / Saturation | −100..100 | tourne / dose la primaire ROUGE |
| `GreenHue` / `GreenSaturation` | Vert primaire : Teinte / Saturation | −100..100 | idem verte |
| `BlueHue` / `BlueSaturation` | Bleu primaire : Teinte / Saturation | −100..100 | idem bleue |

⚠️ Ce n'est PAS un HSL. HSL déplace les couleurs de l'IMAGE par bande ;
l'étalonnage déplace ce que R, V, B DÉSIGNENT — tout l'image glisse ensemble,
en douceur, sans frontière de bande. C'est le « look » global (teal-and-orange
par Bleu primaire : teinte −, saturation +). L'opérateur est une MATRICE 3×3 en
lumière linéaire, dont les colonnes sont les primaires ajustées.

## Mécanisme

1. Les trois primaires de sRGB linéaire : R = (1,0,0), V = (0,1,0), B = (0,0,1).
2. Pour chaque primaire, dans un espace perceptuel à teinte séparable
   (`effects/oklab.ts` existe — OKLCH) : tourner sa teinte de `hue × k°` (k à
   calibrer, ±100 ≈ ±30° chez Lightroom, à juger sur planche) et multiplier sa
   chroma par `1 + sat / 100` ; reconvertir en linéaire. ⚠️ Une primaire pure
   sort du gamut à la reconversion — borner en linéaire, pas en gamma, et
   NORMALISER pour que le blanc reste blanc : la somme des trois colonnes doit
   rester (1,1,1) (renormaliser chaque ligne).
3. `out = M · in` en linéaire (`textureSample` rend déjà du linéaire, format
   `-srgb`, aucun gamma manuel — CLAUDE.md).
4. Nuance foncée : après la matrice, décalage vert/magenta = ajout de
   `t × (−g, +g, −g)`-ish en linéaire (magenta = +R +B −G ; vert = l'inverse),
   pondéré par `(1 − luminance)²` pour ne toucher que les ombres, `t` de −100..100
   → petite amplitude (à calibrer sur planche, Lightroom est subtil).
5. Défauts tous à 0 → identité au bit près (à vérifier : la matrice identité et
   la nuance 0 rendent exactement la source ; référence `-temoin`).

## Ce qui est GELÉ par le dépôt

- Effet = un fichier `src/render/effects/etalonnage.ts` + une entrée
  `registry.ts` + une catégorie `catalog.ts` (famille de retouche : celle de
  `curves`/`channelMixer`). Sans `canvasControls` : c'est de la retouche
  (critère d'Antoine, 2026-08-21). Sections déclarées (« Nuance foncée »,
  « Rouge primaire », « Vert primaire », « Bleu primaire » — ou une `grille` 3×2
  pour les primaires, ADR-0001 : pas de section d'un seul item sans raison).
- ⚠️ **Le compte et la liste du registre dans CLAUDE.md (« vingt-six ») et
  `docs/ROADMAP.md` se mettent à jour DANS LE COMMIT qui ajoute l'effet**
  (règle CLAUDE.md), 26 → 27.
- Garde de câblage `parametresCables.test.ts` : chaque param lu à SON index.
- **Un verrou aveugle ne verrouille rien** : la mire doit MONTRER la propriété.
  Une rotation de primaire se lit sur des APLATS SATURÉS des trois primaires et
  de leurs secondaires + une rampe de gris (pour prouver que les gris ne
  bougent pas) : chercher dans `scripts/render-check.mjs` une mire colorée
  existante ; sinon en écrire une (`mirePrimaires`), comme `mireBokeh` a été
  écrite pour `lensBlur`. Références : `effet-etalonnage-temoin` (tout à 0 =
  source au bit près), `effet-etalonnage-bleu` (Bleu teinte −60 sat +40, le
  teal-and-orange), `effet-etalonnage-nuance` (nuance foncée +80). DEUX points
  d'enregistrement chacune (scénario + table `ATTENDU`), même commit.
- Planche pour Antoine (harnais iframe, ses photos `Pictures\2018\2018-01-25\
  DSCF5171.JPG` et `DSCF5169-edited-2.JPG`) : témoin · Rouge ±60 · Vert ±60 ·
  Bleu ±60 (teinte) · Bleu sat +60 · Nuance ±80 · le look teal-and-orange —
  vignette réduite (par masses). Il compare à SON Lightroom, côte à côte.

- [x] `etalonnage.ts` : 7 params, matrice de primaires tournées dans OKLab → linéaire, normalisée au blanc, nuance foncée pondérée par les ombres ; identité à 0 (garde early-return). Jumeau TS `etalonnageSpec` testé (identité, gris invariant, blanc invariant, rotation du bleu ne touche pas un rouge pur, bipolarité, nuance sur ombres).
- [x] Registre + catalogue + CLAUDE.md/ROADMAP (26 → 27) dans le même commit.
- [x] Mire colorée `mirePrimaires` (écrite : 6 aplats 100 %/50 %, bande de peau, rampe de gris), 3 références + ATTENDU (`effet-etalonnage-temoin/-bleu/-nuance`), `test:render` zéro écart sur les 128 (131 au total).
- [~] Planche rendue sur les deux photos d'Antoine (`assets/planche-01-etalonnage.html`, 11 colonnes × 2 photos) — **en attente du verdict d'Antoine côté à côté avec son Lightroom**.
- [ ] Bornes RÉELLES depuis `Documents/shaderlab-lightroom-ranges.txt` quand le plugin aura tourné (remplacer ±100 « usuel » si différent).

## Décisions et écarts d'exécution (2026-09-11)

- **`k` (degrés/unité) = 0,30**, soit ±100 → ±30°, la valeur de Lightroom citée par
  le ticket. Sur la planche, les rotations de teinte sont sobres (la moyenne bouge
  à peine, le décalage est chromatique) — cohérent avec la subtilité voulue.
- **`SHADOW_TINT_AMOUNT` = 0,05** (pas 0,10). À 0,10, Nuance foncée +80 lavait tout
  le fond sombre d'une photo en magenta — très loin de la subtilité de Lightroom.
  0,05 garde un cast net dans les ombres, hautes lumières épargnées. Reste un
  candidat à affiner avec Antoine.
- **Normalisation au blanc : par LIGNE** (chaque ligne divisée par sa somme = la
  composante du point blanc). Un gris reste gris exact et le blanc reste blanc à
  tout réglage (testé). C'est la même opération que « ajuster les colonnes pour
  M·(1,1,1)=(1,1,1) ».
- **⚠️ ÉCART AU TICKET, prémisse fausse sur pièce : le clamp de gamut est sur la
  SORTIE, PAS sur les colonnes.** Le ticket demandait de borner chaque primaire
  tournée à [0,1] avant la matrice. Mesuré : une primaire PURE est un coin de
  gamut ; la tourner l'envoie hors gamut sur son flanc sombre, et la borner à
  [0,1] la reprojette EXACTEMENT sur elle-même → colonne = primaire d'origine →
  matrice = identité → effet INERTE (0 % d'écart sur une peau à Bleu −60/+40).
  Une matrice de calibration ne borne pas ses colonnes : colonnes non bornées,
  renormalisation au blanc, puis clamp du RÉSULTAT en linéaire. Le blanc reste
  blanc (renormalisation sur colonnes non bornées) et un gris n'atteint jamais
  les bornes.
- **⚠️ BUG GPU trouvé et contourné : `atan2` de Dawn rend le mauvais signe au 3ᵉ
  quadrant.** La première implémentation passait par OKLCH (`oklab_to_oklch` /
  `oklch_to_oklab`, partagés). Sur GPU, le round-trip polaire d'une couleur du 3ᵉ
  quadrant (bleu, a<0 b<0) N'ÉTAIT PAS l'identité — le bleu sortait orange (hue
  mesuré 0,262 au lieu de 0,733). Cause isolée par sonde GPU directe : `atan2`
  renvoie le mauvais signe, donc `oklch_to_oklab` n'inverse plus `oklab_to_oklch`.
  Les autres effets construisent leur teinte depuis un PARAMÈTRE et n'exercent
  jamais l'`atan2` d'une couleur arbitraire — d'où leur immunité. Correction :
  rotation directe du vecteur (a,b) par une matrice 2×2 (a' = a·cosθ − b·sinθ,
  b' = a·sinθ + b·cosθ, ×k), mathématiquement identique à OKLCH mais SANS `atan2`
  ni `fract`.
- **Sections** : « Rouge primaire », « Vert primaire », « Bleu primaire » (Teinte
  + Saturation chacune, `liste`). `shadowTint` reste ORPHELIN rendu en tête
  (index 0) — une section « Nuance foncée » d'un seul item viole ADR-0001 ;
  déclaré dans `ORPHELINS_DECLARES` de `densiteSections.test.ts`. C'est aussi la
  disposition de Lightroom (Nuance foncée en haut).
