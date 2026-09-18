# 10 — Le module DÉTAIL de l'étage de développement

Type: task
Status: ready-for-agent
Blocked by: none

**Demandé par Antoine le 2026-09-18**, après que
[`research/15`](../research/15-l-anneau-de-texture-est-un-debruitage-manquant.md)
a établi que l'anneau de Texture n'est pas un défaut de portail mais un
**débruitage absent** : donnez au portail un signal dégrainé et sa course passe
de 1,5 % à 52 %.

## Les dix réglages, VÉRIFIÉS dans le binaire

Chacun cherché seul et borné dans `CameraRaw.dll` 14.5.1, avec son compte
d'occurrences — un nom absent du binaire ne serait pas un réglage de cette
version. Instrument : `assets/miner-detail2.py`.

| section | réglage ACR | occurrences |
|---|---|---|
| **Netteté** | `Sharpness` | 11 |
| | `SharpenRadius` | 5 |
| | `SharpenDetail` | 5 |
| | `SharpenEdgeMasking` | 5 |
| **Bruit — luminance** | `LuminanceSmoothing` | 7 |
| | `LuminanceNoiseReductionDetail` | 5 |
| | `LuminanceNoiseReductionContrast` | 5 |
| **Bruit — couleur** | `ColorNoiseReduction` | 8 |
| | `ColorNoiseReductionDetail` | 5 |
| | `ColorNoiseReductionSmoothness` | 6 |

⚠️ **Ne PAS confondre avec `OutputSharpen*`** (`OutputSharpenRadius`,
`OutputSharpenAmount`, `OutputSharpenThreshold`, `OutputSharpenHighPassRadius`…) :
c'est l'accentuation d'EXPORT, un autre étage, hors de ce panneau. Le premier
minage les a ramenés ensemble.

## Les étages, et ce qu'ils disent de la forme

```
DÉBRUITAGE      cr_noise.cpp
                cr_stage_denoise · cr_stage_denoise_local · cr_stage_denoise_gpu_helper
                cr_stage_wavelet · cr_stage_wavelet_map · cr_stage_wavelet_wavelet
                cr_stage_wavelet_waveletTempA/B · cr_stage_wavelet_tempA/B
                cr_stage_apply_flat_noise · cr_stage_blend_noise

NETTETÉ         cr_stage_sharpen · _2 · _3 · _3_local · _3_hdr
                cr_stage_localized_detail_sharpness_mask

GUIDE RÉDUIT    cr_stage_insert_small_content · _rgb
                cr_stage_get_Ip_product_YCC/_YRGB · cr_stage_compute_a_b_ycc/_yrgb
                cr_stage_shuffle_AB_planes · cr_stage_guided_filter_affine/_ycc/_rgb
                cr_stage_box_conv_texture · cr_stage_texture_direct_gf_ycc
```

Trois lectures, et la troisième change le plan :

1. **Le débruitage est par ONDELETTES**, avec deux tampons temporaires — une
   décomposition à plusieurs niveaux, pas un noyau unique.
2. **La netteté est en TROIS étages** (`sharpen`, `_2`, `_3`), plus un `_local` et
   un `_hdr`. Et son masquage de bords est
   `cr_stage_localized_detail_sharpness_mask` — **le FRÈRE de
   `cr_stage_localized_detail_clarity_mask`**. Les deux sortent du même étage
   `localized_detail`, donc du même producteur.
   ✅ **Ce producteur, nous l'avons déjà** : le troisième canal de la pyramide
   ([`research/09`](../research/09-le-canal-de-detail.md), `2e8ad6a`), mesuré à
   0,00 sur un aplat et 50/255 sur un réseau au même ton. `SharpenEdgeMasking`
   s'écrirait donc dessus, sans rien construire de neuf.
3. ⚠️ **Et `cr_stage_insert_small_content` vit DANS la chaîne du filtre guidé**,
   entre le produit `Ip` et le calcul de `a`/`b`. La « small content image » n'est
   donc pas le résultat d'un débruitage : c'est l'image RÉDUITE qui sert de GUIDE.
   C'est le filtre guidé RAPIDE de He — `a` et `b` calculés en basse résolution,
   remontés, appliqués affinement (`guided_filter_affine`, `shuffle_AB_planes`).

**Conséquence sur le plan**, et elle vaut d'être dite avant d'écrire : `15`
conclut « il manque un débruitage ». Le binaire précise que ce qui dégraine le
GUIDE de Texture est sa RÉDUCTION, pas la réduction de bruit du panneau. Les deux
aident, mais la première est beaucoup moins chère.

⚠️ **Et `research/08` a DÉJÀ essayé le filtre guidé rapide, sans succès** —
tranchée inchangée, bord creusé. Son guide n'était pas réduit. La différence
tient à ce seul mot, ce qui rend la piste tentante ET dangereuse : c'est la
cinquième tentative sur ce coefficient, et `15` demande explicitement de ne pas
en écrire une de plus sans mesure neuve.

## Découpage proposé

1. **Bruit de LUMINANCE** (`LuminanceSmoothing` + ses deux modulateurs). C'est la
   tranche qui débloque Texture, et la seule dont l'effet soit déjà mesuré
   (portail à 52 % de course sur un signal dégrainé).
2. **Bruit de COULEUR** (trois réglages). Indépendant du reste, sur la chroma
   seule ; notre chaîne travaille déjà en OKLab pour la vibrance.
3. **Netteté** (quatre réglages), dont `SharpenEdgeMasking` sur le canal de
   détail existant.

⚠️ **Deux obstacles connus, à ne pas redécouvrir** :

- **Les cibles de passe sont en 8 bits sRGB.** Une décomposition en ondelettes y
  perd ses coefficients de détail fins. Toute grandeur dérivée doit s'écrire en
  ÉCART-TYPE et non en variance (`research/14`), ou se calculer en registres
  dans une passe.
- **Le budget de passes.** L'étage en compte aujourd'hui 16 pour
  `reglagesDeBase` (7 moyennes + 9 profondes). Une chaîne d'ondelettes en ajoute
  autant. Mesuré : à 26 Mpx le coût est **0,65 ms par mégapixel** et proportionnel
  aux pixels traités (`.scratch/optimisation/01`), donc une passe pleine
  résolution de plus coûte ~0,8 ms. Les passes réduites sont quasi gratuites.

## Ce que la tranche 1 demande comme mesure

La campagne Lightroom existe et se rejoue : plugin `shaderlab-mesures`, mire ou
photo, sentinelles dans `Documents/` puis REDÉMARRAGE de Lightroom. Ce qu'il faut
relever, sur `DSCF5171.JPG` (grain 6,663 mesuré) :

1. `LuminanceSmoothing` à 0, 25, 50, 100 — l'écart-type local dans le décile le
   plus plat, qui donne la LOI de réduction ;
2. la même chose avec `LuminanceNoiseReductionDetail` à 0 et 100, qui dit ce que
   ce modulateur retient ;
3. un profil en travers d'un bord connu, pour mesurer ce que le débruitage
   COÛTE en netteté — c'est le compromis que tout débruiteur arbitre.

⚠️ `assets/trouver-photo-propre.py` mesure déjà le grain d'un fichier de la même
façon ; s'en servir des deux côtés, sinon les deux chiffres ne sont pas
comparables.
