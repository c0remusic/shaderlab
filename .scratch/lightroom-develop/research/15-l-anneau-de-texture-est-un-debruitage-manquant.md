# L'anneau de Texture n'est pas un portail à régler — c'est un débruitage qui manque

Status: ready-for-human
Type: research

Mesuré le 2026-09-18. Instruments : `assets/sonde-prelissage.mjs`,
`assets/faire-temoin-degraine.py`, `assets/sonde-portail.mjs`,
`assets/miner-ordre.py`.

## 1. Corriger le témoin du `14` avant de s'en servir

[`14`](14-le-portail-n-est-pas-le-defaut-le-grain-l-est.md) réduit la photo d'un
facteur 4, voit la discrimination passer de 1,14 à 2,20, et attribue le saut au
grain. ⚠️ **Ce témoin changeait DEUX choses à la fois** : le grain baisse, mais
toutes les structures deviennent aussi quatre fois plus petites en pixels — et
les noyaux de ce module ont un écartement ABSOLU. Il ne pouvait pas séparer les
deux causes, et le fichier l'affirmait quand même.

Le témoin qui les sépare : réduire au quart **puis remonter** à la taille
d'origine. Le grain a été moyenné et l'agrandissement ne le recrée pas ;
l'échelle des structures, elle, est rendue.

| photo | grain | discrimination | course du portail |
|---|---|---|---|
| originale | 6,663 | 1,14 | **1,5 %** |
| au quart (échelle changée) | 1,286 | 2,20 | 41 % |
| **dégrainée, PLEINE échelle** | **1,133** | **6,25** | **52 %** |

✅ **L'attribution du `14` était juste, et son témoin SOUS-ESTIMAIT l'effet.** À
échelle rendue, la discrimination ne double pas : elle est multipliée par 5,5.

⚠️ **Réserve, et elle vaut pour les trois lignes** : le classement bord / plat se
fait sur le gradient de l'image rendue, et sur une photo grenue le grain
lui-même franchit le seuil de « bord ». L'ensemble « bord » y est donc pollué de
plats grenus, ce qui écrase le rapport. Les valeurs absolues ne sont PAS
comparables d'une ligne à l'autre. Ce qui l'est, et qui ne dépend d'aucun
classement, est la mesure directe du `08` : un profil en travers d'un bord connu,
portail de 0,369 à 0,315, **15 % de course**. Les trois lignes ci-dessus
racontent la même histoire ; seule celle-là la prouve.

## 2. Le pré-lissage dans la passe finale NE MARCHE PAS

Si le grain est la cause, lisser avant de mesurer la variance devrait suffire.
Éprouvé en registres dans la passe finale, prélèvements bilinéaires (un
prélèvement entre quatre texels en moyenne quatre pour le prix d'un), rayon et
écartement balayés :

| champ | rapport |
|---|---|
| actuel, aucun pré-lissage | 1,14 |
| lissage 1 px, écart 4 | 1,24 |
| lissage 2 px, écart 8 | **1,29** |
| lissage 4 px, écart 16 | 1,28 |
| lissage 8 px, écart 32 | 1,15 |

**Le meilleur rend 1,29 quand la photo dégrainée rend 6,25.** Et le chiffre qui
dit pourquoi : sur un aplat, le pré-lissage fait tomber la mesure de 0,021 à
0,012 — un facteur **1,7**, là où moyenner seize texels de bruit blanc en
donnerait 4.

> **Le grain de ces fichiers est CORRÉLÉ** — dématriçage et blocs JPEG de 8 px —
> donc une petite boîte ne le tue pas. Il faut une vraie réduction, c'est-à-dire
> plusieurs niveaux, pas quatre prélèvements.

C'est aussi la troisième piste de portail éprouvée et écartée, après les deux du
`08` et celle du `13`. Aucune n'a échoué pour la même raison, et aucune n'a
rattrapé le grain.

## 3. Ce que le binaire dit, et qui clôt la question

```
cr_noise.cpp
cr_stage_denoise            cr_stage_denoise_local      cr_stage_denoise_gpu_helper
cr_stage_wavelet            cr_stage_wavelet_map        cr_stage_wavelet_wavelet
cr_stage_apply_flat_noise   cr_stage_blend_noise
cr_stage_insert_small_content        cr_stage_insert_small_content_rgb
cr_stage_texture_direct_gf_ycc       cr_stage_guided_filter_ycc
cr_stage_box_conv_texture            cr_stage_bilateral_downsample_3D
```

Lightroom porte une **chaîne de débruitage par ondelettes**, et la « small
content image » sur laquelle son filtre guidé de Texture s'appuie n'est pas une
métaphore : c'est un ÉTAGE nommé, `cr_stage_insert_small_content`.

**Nous n'avons aucun débruitage.** Notre étage de développement porte
`etalonnage`, `reglagesDeBase`, `hsl`, `colorGrading` — le panneau *Détail* de
Lightroom (Netteté + Réduction du bruit) n'est pas porté du tout. Notre Texture
travaille donc sur un signal que la leur ne voit jamais.

## 4. Conclusion

**L'anneau de Texture n'est pas un défaut de portail.** Son portail est correct
et sa calibration l'est aussi : donnez-lui un signal débruité et il retrouve
52 % de course au lieu de 1,5 %. Ce qui manque est en amont, et c'est un MODULE,
pas un coefficient.

Ça explique aussi, sans rien ajouter, pourquoi Lightroom amplifie le grain PLUS
que nous (×1,76 contre ×1,62, `08`) : chez eux Texture amplifie un grain déjà
réduit, et son portail reste ouvert ; chez nous il amplifie le grain brut, et le
grain referme le portail qui devrait servir aux bords.

⚠️ **Et ça ferme quatre pistes d'un coup.** Les deux corrections du `08`, le
champ de structure du `13` et le pré-lissage ci-dessus visaient tous le portail.
Aucun ne pouvait aboutir. **Ne pas en écrire une cinquième.**

## Ce que ça ouvre, et qui demande un arbitrage

Un module **Détail** (Réduction du bruit, et la Netteté qui l'accompagne chez
Lightroom) dans l'étage de développement. C'est un chantier entier — un module
de plus dans `developRegistry`, une chaîne d'ondelettes ou équivalent, sa propre
campagne de mesure — et il ne se décide pas depuis ce fichier.

Deux choses le rendent moins lourd qu'il n'en a l'air : l'étage existe et sait
accueillir un module (quatre y vivent), et le mécanisme de flou auxiliaire
(`auxPass`, `1254ade`) est déjà livré et sans client dédié.

Et une mesure resterait à prendre avant, la voie 1 du [`13`](13-le-portail-vu-au-lieu-d-etre-suppose.md) :
le même relevé de portail **chez Lightroom**, sur la même photo. Tout ce dossier
déduit l'ouverture de leur portail de chiffres indirects ; personne ne l'a
mesurée.
