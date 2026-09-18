# La luminance des roues n'est ni linéaire, ni une question d'amplitude

Mesuré le 2026-09-18. Ce document ferme une hypothèse ouverte depuis le
2026-09-15, corrige une phrase fausse que deux documents portaient, et **refuse
une correction tentante pour une raison mesurée**. Aucun changement dans `src/`.

## Ce qui était écrit, et qui motivait tout

`docs/ROADMAP.md` et le [ticket 06](../issues/06-color-grading.md) portent :

> À `Luminance des ombres` +50, Lightroom porte le niveau 0 à **14,33** ; nous à
> **0,16**. Un décalage de L en OKLab **ne PEUT pas** lever un noir absolu ; un
> offset en lumière linéaire le fait par construction. Hypothèse à éprouver : les
> luminances des quatre roues agissent en lumière LINÉAIRE. **Changement de
> modèle, pas un réglage.**

Un premier test avait été construit pour trancher, puis **réfuté par contrôle
synthétique** : il mesurait la compression, pas l'espace. L'hypothèse est restée
entière et non tranchée.

## 1. Le binaire nomme l'étage, et il cite un BREVET

Consigne permanente : le binaire donne la FORME. Minage
(`assets/miner-split-tone.py`, `miner-brevets.py`), et le résultat est en clair
dans `CameraRaw.dll`, à quelques octets de `cr_stage_SplitTone` :

> Adobe patent application tracking # B220, entitled **'Color toning while
> maintaining constant luminance while using color curve slopes'**,
> inventors: Mark Hamburg

C'est la source la plus directe que ce dossier ait eue sur la forme d'un
opérateur. Elle dit deux choses :

- **le virage préserve la luminance** — donc les curseurs de Luminance des roues
  sont un terme SÉPARÉ, pas un effet de bord du virage ;
- **le mécanisme est une COURBE** (« color curve slopes »).

L'étage s'appelle `cr_stage_SplitTone` / `cr_split_tone` / `cr_split_tone_function`,
ses uniformes sont nommés `splitTone` avec `Shadows Midtones Highlights Global`.
Sur cinq brevets cités dans tout le binaire, **un seul** touche notre question ;
les quatre autres sont l'ajustement automatique et trois sur les yeux rouges.

⚠️ **Deux fausses pistes écartées avant d'en conclure quoi que ce soit.**
`LiftShadows` et `RedLiftMatte` portent le mot « lift » mais sont des noms de
PRESETS (voisins : `CoolShadowsAndWarmHighlights`, `SepiaTone`, `BlurVignette`).
Et `cr_black_lift_curve` vit dans l'étage d'EXPOSITION (voisins :
`cr_exposure_stage`, `cr_stage_local_whites_blacks`, `whiteClip`) — c'est la
machinerie des Noirs, pas celle du virage.

⚠️ **Et un balayage de sous-chaînes ne vaut rien ici** : chercher « lab » au ras
de `cr_split_tone` rend 8 fenêtres sur 8, parce que `cr_memory_scalable_allocator`
contient « lab ». Ce premier balayage est jeté ; il mesurait l'allocateur mémoire.

## 2. « Un décalage de L ne PEUT pas lever un noir absolu » est FAUX

Mesuré (`assets/verifier-lift-noir.mjs`). OKLab L est une racine cubique, donc
`L = dL` au noir donne `lin = dL³`, qui n'est pas nul :

| dL | linéaire | niveau sRGB |
|---|---|---|
| 0,05 | 1,25 × 10⁻⁴ | 0,41 |
| 0,10 | 1,00 × 10⁻³ | 3,29 |
| **0,1653** | **4,52 × 10⁻³** | **14,33** |
| 0,20 | 8,00 × 10⁻³ | 21,96 |

**Un décalage de L de 0,1653 porte le niveau 0 à 14,33 exactement** — la valeur
de Lightroom. Notre opérateur en applique au plus 0,037 (`lumK` 0,074 × dose
0,5). Le fait qui motivait un changement de MODÈLE était donc, à ce point-là, un
écart d'AMPLITUDE.

## 3. L'hypothèse « lumière linéaire » est RÉFUTÉE, sur les deux signes

`assets/comparer-lum-modeles.mjs` confronte les deux modèles à la rampe entière,
chacun avec **son propre optimum d'amplitude** — un modèle qui gagne en ajustant
son k ne prouverait rien, les deux sont donc ajustés équitablement.

⚠️ **Le poids de plage n'est PAS réécrit** : une première version l'avait
réinventé en logistique, alors que le vrai est `pow(1 − α, 1.6) · cov` avec α
tiré du NIVEAU sRGB, pas de L. Il est désormais **récupéré du code en service**
en inversant `appliqueLum`, et le modèle A doit reproduire `colorGradingSpec`
avant toute comparaison — écart maximal mesuré **5,7 × 10⁻¹⁴ niveau**.

| mesure | A · OKLab | B · linéaire | en service (k = 0,074) |
|---|---|---|---|
| `cg-ombres-lum-p50` | k 0,179 → **0,970** | k 0,030 → 2,939 | 3,005 |
| `cg-ombres-lum-m50` | k 0,174 → **0,997** | k 0,034 → 3,402 | 2,481 |

**OKLab gagne d'un facteur 3 sur les DEUX signes.** Et le profil dit pourquoi :
un offset en lumière linéaire à dose négative écrase à zéro tous les niveaux
jusqu'à 16, là où Lightroom mesure 1,00 · 2,00 · 4,08 · 8,83. L'hypothèse est
close — l'espace est perceptuel, pas linéaire.

## 4. L'amplitude par roue : mesurée, et c'est un PIÈGE

`assets/ajuster-lum-roues.mjs`, sur les six rampes disponibles :

| roue | k optimal | accord entre ses mesures | facteur vs 0,074 |
|---|---|---|---|
| **ombres** | **0,1766** | 2 mesures, étendue **0,0048** | **2,39** |
| moyens | 0,0793 | 1 mesure | 1,07 |
| hautes | 0,0973 | 2 mesures, étendue **0,1650** | — |
| global | 0,0795 | 1 mesure | 1,07 |

Trois lectures :

1. **Tons moyens et Globale tombent juste** (1,07×) — c'est sur elles que `lumK`
   avait été calibré, et le ticket 06 le disait déjà.
2. **Les ombres demandent 2,4×, et leurs deux signes s'accordent à 0,005.** C'est
   de la validation croisée, la forme forte : deux jeux disjoints, même optimum.
3. **Les hautes lumières ne s'accordent pas du tout** — 0,1798 à +50 contre
   0,0148 à −100. Ce n'est pas une amplitude, c'est la FORME du poids, et ça
   confirme par une autre voie le défaut déjà connu (« le poids des hautes
   lumières est NON MONOTONE »). Son résidu reste à 2,864 même à son propre
   optimum : ne pas la réajuster tant que son poids n'est pas repris.

### Et pourtant on ne pose pas k = 0,177

Un cran au-delà de l'échantillon qui l'a fixé (`assets/extreme-lum-ombres.mjs`) :

| dose | k | niveaux distincts | collés à 0 | plus grand trou |
|---|---|---|---|---|
| +100 | 0,074 | 243 | 0 | 8 |
| +100 | **0,177** | **224** | 0 | **14** |
| −50 | 0,074 | 250 | 2 | 2 |
| −50 | **0,177** | 244 | **5** | 2 |
| −100 | 0,074 | 246 | 4 | 2 |
| −100 | **0,177** | 236 | **11** | 2 |

**Onze niveaux écrasés au noir à −100, cinq à −50** — et la rampe mesurée dit que
Lightroom, à −50, n'en écrase **qu'un** (niveau 0 → 0,00 ; niveau 2 → 1,00 ;
niveau 4 → 2,00 ; niveau 8 → 4,08).

C'est exactement le marché que le ticket 06 a déjà refusé une fois : *« elle
échange un défaut VISIBLE contre un dixième de niveau sur une mire »*. Le gain
est ici plus gros qu'un dixième (3,0 → 0,97 niveau de moyenne), mais le coût est
de la même nature, et **la mesure dit que Lightroom ne le paie pas**. Le résidu
moyen était le mauvais objectif : il moyenne un bas de rampe que l'œil regarde.

## Ce que ça laisse

**L'écart n'est ni l'espace, ni l'amplitude : c'est la FORME au bas de la
rampe.** Lightroom lève beaucoup le noir absolu (14,33) ET garde cinq niveaux
distincts sous 8 à dose négative. Un décalage pondéré de L, quel que soit son k,
ne peut pas faire les deux — c'est le même opérateur des deux côtés.

Un opérateur qui le peut : une COURBE portant un terme de point noir séparé.
C'est ce que le binaire nomme, et c'est la seule piste que ce relevé laisse
ouverte. ⚠️ Elle demande un modèle, pas un réglage — cette fois pour de bon, et
avec une raison mesurée au lieu d'une phrase fausse.

⚠️ **Ce qui manque pour l'éprouver** : aucune rampe `Luminance des ombres` à
±100 n'a été mesurée chez Lightroom. On ne sait donc pas si LEUR opérateur écrase
à −100 — et c'est précisément le chiffre qui dirait si le bas de rampe est un
défaut de notre forme ou une propriété de l'opérateur.

⚠️ **Et ça ne s'ajoute PAS à la campagne armée.** Les mesures `cg-*` portent un
champ `rampe`, donc elles ont été prises sur une MIRE ; la campagne Détail qui
attend un redémarrage porte `DSCF5171.JPG`, et `shaderlab-mesures-go.txt` ne
tient qu'UNE photo. Deux lignes ajoutées là mesureraient le virage sur une photo,
ce qui ne se compare à aucune des treize. C'est une seconde course, sur la mire —
à armer quand la première aura rendu ses exports, pas à la place.
