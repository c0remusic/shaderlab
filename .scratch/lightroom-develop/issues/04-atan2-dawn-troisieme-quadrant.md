# 04 — `atan2` de Dawn rend le mauvais signe au 3ᵉ quadrant : qui d'autre est mordu ?

Type: research
Status: ready-for-human
Blocked by: none

**Constat (ticket 01, 2026-09-11, sonde GPU directe)** : le round-trip
`oklab_to_oklch` → `oklch_to_oklab` (`effects/oklab.ts`, partagés) n'est PAS
l'identité sur une couleur du 3ᵉ quadrant (a < 0, b < 0 — le bleu) : hue GPU
0,262 contre 0,733 en TS, le bleu ressort orange. Cause isolée : `atan2` sur
Dawn (D3D12, cette machine) rend le mauvais signe dans ce quadrant. Le ticket
01 a contourné (rotation 2×2 directe sur (a, b), sans `atan2` ni `fract`).

**Pourquoi les autres effets semblent immunisés** : ils construisent leur
teinte depuis un PARAMÈTRE (un angle de curseur), jamais depuis l'`atan2`
d'une couleur arbitraire. Semblent — pas prouvé.

## À faire

- [x] Lister les lecteurs de `oklab_to_oklch` / `atan2` (voir tableau ci-dessous).
- [x] Reproduire le bug en isolation dans le harnais (trois sondes : compute
      runtime + littéral, round-trip OKLCH, fragment).
- [x] Verdict rendu : le bug ne se reproduit PAS sur le process courant. AUCUN
      correctif appliqué (voir décision). `atan2_sure` proposée en garde future.

## Recherche — 2026-09-12 (sonde GPU directe, process live CDP 9223)

**GPU / pile mesurée** : NVIDIA (architecture Turing) via Dawn / D3D12, la fenêtre
shaderlab vivante (CDP 9223, Vite 1421). Modules servis depuis le disque par
l'iframe `render-check-page.html` (module map vierge), édition non commitée
comprise. Sondes versionnées :
`.scratch/lightroom-develop/assets/sonde-atan2-quadrants.mjs` (compute, runtime +
littéral, cas à `-0.0`), `sonde-oklch-roundtrip.mjs` (vraies fonctions
`OKLAB_WGSL` sur couleurs sRGB réelles), `sonde-atan2-fragment.mjs` (chemin
FRAGMENT, celui des vrais effets). Résultats JSON à côté.

### 1. Inventaire des lecteurs

Balayage exhaustif de tout le WGSL du dépôt. `oklab_to_oklch` contient
`atan2(lab.z, lab.y)` (= `atan2(b, a)` d'OKLab ; 3ᵉ quadrant = `a<0 ET b<0` = les
bleus). Verdict lu sur le CODE, pas sur le nom.

| Site | Entrée de l'`atan2` | 3ᵉ quadrant atteignable par… | Sort en |
|---|---|---|---|
| `oklab.ts:150` (`oklab_to_oklch`) | `lab.yz` de l'appelant | dépend de l'appelant (ci-dessous) | fonction partagée |
| `blendSpace.ts:245-246` (`mix_in_space` OKLCH) | `a`/`b`, bouts du mélange | **PARAMÈTRE** : seul appelant = `gradientMap` via `mix_srgb_in_space`, bouts = arrêts `shadowStop/midStop/highStop` (pickers). Défaut sRGB (pas d'OKLCH). Jamais l'échantillon d'image. | couleur (interpolée) |
| `isolines.ts:285-286` | `hsl2rgb(params[8..13])` | **PARAMÈTRE** : encres bas/haut d'altitude (pickers). Un picker bleu suffit. | couleur (interpolée) |
| `lensFlare.ts:646` | `hsl2rgb(params[12..14])` | **PARAMÈTRE** : teinte du traitement (picker). | couleur (dérive de teinte) |
| `outlines.ts:779-780` (mode Échos) | `hsl2rgb(params[4..6]/[23..25])` | **PARAMÈTRE** : encres début/fin (pickers). | couleur (interpolée) |
| `outlines.ts:831` (Roue d'orientation) | `dirVec = gTone + chroma·3·gChroma` | **IMAGE** : direction du gradient de Scharr de la photo. Un bord orienté en bas-à-gauche donne `dirVec.x<0, y<0`. | teinte d'encre (roue) |
| `aplat.ts:306` (`aplat_polygone`) | `k` = position dans la forme | **GÉOMÉTRIE** : coin bas-gauche du polygone. Pas une couleur. | rayon du polygone |
| `lensFlare.ts:531` (`ghost_cover`) | `p` = position dans l'ouverture | **GÉOMÉTRIE** : bas-gauche du fantôme. Pas une couleur. | rayon du diaphragme |
| `ui/transform.ts:597` | `Math.atan2` (JS/CPU) | hors GPU — outil de rotation. Non concerné par Dawn. | angle de poignée |

Synthèse : **une seule entrée de l'`atan2` peut être une COULEUR d'image
arbitraire** — `outlines.ts:831`, la roue d'orientation, via la direction du
gradient. Tous les `oklab_to_oklch` sur couleur sont pilotés par des PARAMÈTRES
(pickers) : leur 3ᵉ quadrant s'atteint en choisissant un bleu, jamais depuis un
texel de la photo. Les deux `atan2` nus restants (`aplat`, `lensFlare` fantômes)
sont de la géométrie de forme, pas de la couleur.

### 2. Reproduction en isolation — le bug ne se reproduit PAS

Trois sondes, valeurs LUES d'un storage buffer (défait le const-fold de Tint) :

- **atan2 direct, 3ᵉ quadrant fini** : `atan2(-0.5,-0.5) = -2.3562` (réf -2.3562),
  `atan2(-0.312,-0.032) = -1.6729` (le bleu, réf -1.6730), `atan2(-0.001,-0.002)`,
  etc. — **tous corrects**, en compute ET en fragment, runtime ET littéral.
- **Round-trip OKLCH sur couleurs réelles** (vraies fonctions `OKLAB_WGSL`) : bleu
  pur `a=-0.032, b=-0.312` → **hue GPU 0,7335 = hue TS 0,7335** ;
  `oklch_to_oklab(oklab_to_oklch(lab))` = `lab` à **5,8e-8** près. Neuf teintes
  testées, `dHue` circulaire nul partout, round-trip identité partout.
- **Le symptôme cité par le ticket 01 (hue 0,262 au lieu de 0,733) ne se
  reproduit pas.** Le bleu ne sort pas orange ; il sort bleu.

**Seule divergence réelle et reproductible** : le ZÉRO SIGNÉ. `atan2(-0.0, x<0)`
rend `+π` sur Dawn là où IEEE/`Math.atan2` rend `-π` (présent en runtime ET en
littéral — ce n'est donc pas un défaut d'instruction runtime, c'est le
comportement de `atan2` sur `±0`). **Sans effet sur aucune couleur** : dans le
chemin couleur la teinte passe par `fract`, et `fract(+0.5) = fract(-0.5) = 0.5` —
le seul cas où `b` vaut exactement `∓0` (axe `a<0`) donne la même teinte 0,5 des
deux côtés. Ce n'est pas « le mauvais signe au 3ᵉ quadrant ».

### 3. Décision — aucun correctif, `atan2_sure` proposée en garde future

Le 3ᵉ quadrant fini est correct sur cette pile ; aucun effet réel n'est mordu, y
compris `outlines.ts:831` (seul site atteint par une couleur d'image), y compris
les sites param-pilotés. **Aucune `atan2_sure` n'a été introduite** et aucune
référence n'a bougé : appliquer un correctif préventif changerait des références
figées pour rien, contre la consigne « pas de correctif préventif si toutes les
entrées à risque sont saines ».

Ce que je ne peux PAS trancher sans la sonde d'origine du ticket 01 (non
conservée) : soit le diagnostic « c'est `atan2` » était une erreur d'attribution
et le vrai défaut de la première implémentation OKLCH venait d'ailleurs (corrigé
par la réécriture en rotation 2×2), soit le bug était réel le 2026-09-11 et une
mise à jour Dawn/pilote l'a résolu depuis. Dans les deux cas, rien à faire
aujourd'hui.

**Les contournements 2×2 existants restent** (`etalonnage`, `hslDevelop`,
`hslBandes`, `reglagesDeBase`, `colorGrading`) : la rotation directe est
mathématiquement identique à OKLCH et correcte quelle que soit la réponse
ci-dessus ; les retirer serait hors périmètre et risqué. **Arbitrage laissé à
Antoine** (d'où `ready-for-human`) : (a) adopter `atan2_sure` comme garde
défensive à froid (repli `atan` + correction de quadrant explicite) malgré
l'absence de bug mesuré, ou laisser tel quel ; (b) adoucir la formulation
catégorique « `atan2` de Dawn rend le mauvais signe au 3ᵉ quadrant » dans les
en-têtes des cinq modules et dans CLAUDE.md, qui n'est plus vraie sur pièce (le
vrai écart mesurable est le zéro signé, sans conséquence).
