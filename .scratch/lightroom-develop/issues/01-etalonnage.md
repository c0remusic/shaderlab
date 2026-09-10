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

- [ ] `etalonnage.ts` : 7 params, matrice de primaires en OKLCH → linéaire, normalisée au blanc, nuance foncée pondérée par les ombres ; identité à 0.
- [ ] Registre + catalogue + CLAUDE.md/ROADMAP (26 → 27) dans le même commit.
- [ ] Mire colorée (existante ou `mirePrimaires`), 3 références + ATTENDU, `test:render` zéro écart ailleurs.
- [ ] Planche sur les photos d'Antoine ; il juge contre son Lightroom.
- [ ] Bornes RÉELLES depuis `Documents/shaderlab-lightroom-ranges.txt` quand le plugin aura tourné (remplacer ±100 « usuel » si différent).
