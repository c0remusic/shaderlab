# 06 — Color Grading : trois roues, une globale, fusion et balance

Type: task
Status: ready-for-human
Blocked by: 05 (le registre de l'étage et le panneau sont tenus par HSL jusqu'à son commit) ; la MESURE Lightroom (`grading-*` dans les exports du plugin) calibre les amplitudes — table provisoire isolée sinon, comme au 05

**What to build :** le module `colorGrading` de l'étage — « go pour color grading
après », Antoine, 2026-09-11. Le panneau « Color Grading » de Lightroom
(inventaire § 4), 14 curseurs, libellés français mesurés dans ses chaînes :

| Clé Lightroom | Libellé | Borne usuelle |
|---|---|---|
| `ColorGradeShadowHue` / `Sat` / `Lum` | Ombres : Teinte / Saturation / Luminance | 0..360 / 0..100 / −100..100 |
| `ColorGradeMidtoneHue` / `Sat` / `Lum` | Tons moyens : Teinte / Saturation / Luminance | idem |
| `ColorGradeHighlightHue` / `Sat` / `Lum` | Hautes lumières : Teinte / Saturation / Luminance | idem |
| `ColorGradeGlobalHue` / `Sat` / `Lum` | Teinte / Saturation / Luminance globale | idem |
| `ColorGradeBlending` | Fusion | 0..100, défaut 50 |
| `ColorGradeBalance` | Balance | −100..100 |

Le Virage partiel (`SplitToning*`, panneau hérité) est un sous-cas (deux roues
sans tons moyens) : il n'entre pas — Lightroom lui-même ne le montre plus.

## Mécanisme

- Luminance perceptuelle L du pixel (OKLab L, ou luma sRGB — mesurer laquelle
  colle à Lightroom sur `grading-ombres-bleu` / `grading-hl-orange` : à quelle
  L le teintage des ombres s'éteint-il ?).
- Trois POIDS sur L : ombres (haut à L = 0, éteint vers les moyens), tons moyens
  (bosse centrée), hautes lumières (haut à L = 1). **Fusion** (`Blending`)
  règle le RECOUVREMENT des trois plages (0 = plages tranchées, 100 = très
  fondues). **Balance** DÉPLACE le point de bascule ombres ↔ hautes lumières
  (−100 : tout est ombre, +100 : tout est haute lumière). Les poids somment à 1
  ou pas — à mesurer (le comportement de Lightroom à Fusion 0 le dit).
- Chaque roue ajoute un VECTEUR de chroma en OKLab : `(cos h, sin h) × sat × k
  × poids` — rotation par matrice, jamais `atan2` (ticket 04) — et un décalage
  de L : `lum × k' × poids`. La roue globale s'applique partout (poids 1).
  Teinter n'est PAS remplacer : un bleu teinté orange dans les ombres devient
  moins bleu, pas orange ; le vecteur s'AJOUTE à la chroma existante, en
  proportion (mesurer sur le balayage de teinte de la mire : `grading-*`).
- Une passe finale, aucune passe interne.

## Interface — ⚠️ AMENDÉ le 2026-09-11 : une VRAIE ROUE, parité exigée

Antoine : « il faut aussi que la qualité et le layout des contrôles soit de
qualité identique ». Donc PAS un sélecteur de couleur par groupe : une **roue
chromatique** comme celle de Lightroom (teinte sur le pourtour, saturation au
rayon, un point qu'on tire, la luminance en curseur dessous, les quatre roues
en rangée « Réglages » avec les icônes Ombres / Tons moyens / Hautes lumières /
Globale / Tout comme sur la capture `assets/reference-ui/`). Contrôle NEUF
`ColorWheelControl` dans `src/components/ui/` + déclaration par le module
(`EffectModule.colorWheelControls`, même patron que `colorRampControls` :
déclaré par le module, rendu par `ParamPanel` sans branche par id). Voir le
ticket 07 (parité des contrôles) pour le style. Le paragraphe ci-dessous est
l'ancienne version, gardée pour la trace.

## Interface (version d'avant l'amendement)

Lightroom montre des ROUES (teinte sur le pourtour, saturation au rayon). Chez
nous, une roue n'existe pas : `EffectParam.colorGroup` (rôles hue / saturation
/ lightness) rend un sélecteur de couleur par groupe — l'utiliser pour chaque
roue (Ombres, Tons moyens, Hautes lumières, Globale), avec la luminance en
curseur à côté. Sections : `Ombres` · `Tons moyens` · `Hautes lumières` ·
`Globale` (chacune : le groupe couleur + Luminance) · `Fusion et balance`
(paire). Pas de roue neuve dans ce ticket : si `colorGroup` ne suffit pas à
l'usage, c'est une suite (une roue est un contrôle, `src/components/ui/` +
`ParamPanel`, comme `ColorRampControl` l'a été).

## Gelé

- Module dans `developRegistry` — application après `hsl` ; affichage après
  HSL (Réglages de base · HSL · Color Grading · Étalonnage). Test de liste.
- Twin TS + tests : identité à sat 0 partout ; un gris moyen teinté « ombres »
  ne bouge pas, un gris sombre si ; Balance ±100 bascule ; Fusion 0 tranche ;
  la roue globale teinte un gris de toute luminance.
- Références sur `mireBalayage`/`mirePrimaires` (rampe de gris + balayage) :
  `developpement-grading-ombres-bleu` (220°, 60), `developpement-grading-hl-orange`
  (40°, 60), `developpement-grading-balance` (les deux + Balance +100),
  `developpement-grading-fusion-0` (les deux + Fusion 0) — mêmes réglages que
  les mesures du plugin pour comparer canal par canal (`comparer-lightroom.py`
  du 05). Scénario + `ATTENDU`, 143 → 147.
- Table d'amplitudes isolée (`colorGradingTable.ts`) + `calibrer-grading.py`
  quand les exports existent — même contrat qu'au 05.
- Planche pour Antoine, ses deux photos : ombres bleu / HL orange (le
  teal-and-orange par grading, à comparer à celui par étalonnage) · tons moyens
  vert · global lum ±50 · balance ±100 · fusion 0 / 100.

- [x] `colorGrading.ts`, 14 params, une passe, table isolée (`colorGradingTable.ts`).
- [x] Registre (application après HSL, affichage HSL → Color Grading → Étalonnage), panneau (VRAIES ROUES `ColorWheelControl`, pas des groupes couleur — amendement), applicabilité sans objet (aucun `choices`). ✅ Références 143 → 147 GRAVÉES et committées (`71ca502`, 2026-09-12, session principale, app relancée en CDP 9223) : 143 anciennes byte-identiques après `--update`, les 4 neuves relues à l'œil (bleu dans la moitié sombre, orange dans la claire, balance bascule tout, fusion 0 tranche), suite unitaire 2333 verte, `test:render` complet sans écart.
- [x] Comparaison à Lightroom : `assets/calibrer-grading.py` prêt et exécuté (Tons moyens rmse 0,0025 chroma OKLab ; Global luminance rmse 0,0050 dL). Ombres/Hautes lumières/Fusion/Balance **non mesurables** dans les exports (voir Livraison).
- [ ] Planche, verdict d'Antoine. → NON faite (nécessite l'app + les deux photos d'Antoine).

## Livraison 2026-09-12 (sous-agent Opus 4.8)

UN commit (`242b612`, non poussé). Moteur + UI + twin + registre + story + script de
calibration. Périmètre livré et vérifié ; références de pixels et planche en attente
de l'app vivante (voir cases).

**Écart au brief, prémisse fausse sur pièce.** Le brief annonçait `grading-ombres-bleu`
« PROPRE » et calibrable. Mesuré en OKLab sur `rampe_rgb` : `grading-ombres-bleu`
(ShadowHue 220/Sat 60) ET `grading-hl-orange` (40/60) rendent une rampe de gris
**strictement neutre** dans les exports (dch = 0 à tous les niveaux), de même que
`grading-balance-p100`, `grading-fusion-0/100`. Cause : le plugin a écrit
`ColorGradeShadowHue`/`ColorGradeHighlightHue`, que Lightroom Classic **ignore** — les
teintes Ombres/Hautes lumières y vivent sous les clés héritées `SplitToningShadow*`/
`SplitToningHighlight*`. Donc les teintes Ombres/HL, Balance et Fusion **ne sont pas
mesurables** dans ces exports. Seuls **Tons moyens** (`grading-moyens-vert`,
`ColorGradeMidtoneHue/Sat`, clés réelles) et **Global luminance**
(`grading-global-lum-p50`) le sont.

**Calibré vs borné par twin.**
- Calibré sur mesure : `chromaK` 0,164 et cloche des tons moyens (`midCenter` 0,61,
  `midSigma` 0,144) sur `grading-moyens-vert` ; `lumK` 0,074 sur `grading-global-lum-p50`.
  `chromaK`/`lumK` réutilisés pour les quatre roues (un seul modèle de mélange).
- Modélisés, bornés par le twin, provisoires : profils de poids Ombres/Hautes lumières
  (`shadowCenter`, `highCenter`, `softBase`), ouverture de Fusion (`softSpread`,
  `midSoft`), geste de Balance (`balanceShift`).

**Reste ouvert :** gravure des 4 références + relecture à l'œil ; planche des deux photos
d'Antoine ; verdict d'usage. Si un re-run Lightroom avec les BONNES clés (`SplitToning*`
pour Ombres/HL, ou l'UI Color Grading pilotée directement) devient possible, Ombres/HL/
Balance/Fusion deviendraient calibrables et `colorGradingTable.ts` se recalerait par le
même script.

## Exploitation des mesures du 2026-09-15 — le virage est enfin mesurable

Les teintes Ombres et Hautes lumières, la Balance, la Fusion et les quatre
Luminances par plage ont été mesurées sous leurs VRAIES clés (`SplitToning*`
pour les deux premières — Lightroom ignore `ColorGradeShadowHue`). Treize
mesures exploitables, témoin `temoin3`.

**Livré — le clip de gamut qui PRÉSERVE LA TEINTE.** L'écrêtage par canal en fin
de module faisait dériver la teinte là où le virage est le plus fort : il coupe
le canal qui déborde et laisse les deux autres, ce qui TOURNE la couleur au lieu
de la désaturer. Remplacé par une réduction de chroma à L constant (bissection
en seize pas, twin et WGSL jumeaux). Écart aux treize mesures, recalculé par la
session principale avec le vrai twin : **moyenne 7,50 → 6,51 niveaux, pire cas
74,8 → 60,7**. Aucune constante nouvelle, aucun champ d'interface. Le pire cas
était le blanc de `st-hl-orange`, que Lightroom rend blanc et que l'écrêtage par
canal rendait jaune. Quatre références régénérées et relues.

**Retenu — `tintExp` et le nouveau `softSpread`.** La contre-expertise a montré
que le constat qui les portait (« la chute aux extrêmes est un vrai poids, pas de
l'écrêtage ») est faux là où l'enveloppe agirait : aux niveaux concernés le canal
rouge est déjà à 0 ou à 255. Une partie de l'écart attribué à un poids de plage
était donc de l'écrêtage — ce que le clip ci-dessus corrige sans constante. Il
reste à refaire l'ajustement AVEC le clip en place avant de juger s'il subsiste
un écart qu'une enveloppe expliquerait.

**Retenu — le signe de `softSpread`.** Ces treize mesures ne le déterminent pas :
0,158 niveau sur toute la plage ±0,4, et deux optimiseurs de part et d'autre de
zéro à 3 % de coût. Cause identifiée : `soft` sature contre son clamp dès
Fusion ≤ 18, donc l'optimiseur pousse dans une direction que le clamp absorbe
gratuitement. Si `softBase` monte un jour, BORNER `softSpread` pour que la course
reste vivante — sinon le curseur Fusion est mort sur 18 % de sa course.

**Ce que les mesures disent et qui reste à porter** (aucun code écrit dessus) :
les directions de teinte sont fausses de +15,7° sur l'orange, −12,9° sur le vert
et +26,8° sur le bleu, et la déformation n'est pas un décalage constant — sept
hypothèses d'espace ont été testées et rejetées, la nôtre reste la moins mauvaise.
Les poids de plage mesurés ont des traînées bien plus longues que nos smoothsteps
(30 % du pic encore à L = 0,60 pour les ombres, là où le nôtre est déjà nul).
Fusion est un MULTIPLICATEUR centré sur la bascule (×2,25 à la bascule, ×1 aux
bouts) et non un élargissement, et son sens est l'INVERSE de notre documentation :
100 rend la transition plus franche.

## La MÉTHODE d'Adobe, lue dans le binaire puis vérifiée sur les mesures (2026-09-15)

Antoine, le même jour : « et à chaque fois regarde le code pour être sûr de la
méthode ». Appliqué à ce module, ça change la FORME et pas seulement les
constantes.

**Ce que le binaire dit.** `cr_split_tone.cpp`, étage `cr_stage_SplitTone`,
pipeline `splitTone`. Les champs de son uniforme `UniformsSplitTone`, dans
l'ordre :

```
balanceMapAlpha · blending · globalNOPBalanceMapAlpha
fPadding1 · fPadding2 · fPadding3
shadowFactor · deltaFactor · midtoneMapAlpha · luminance · globalMapAlpha
```

Il n'y a **pas de `highlightMapAlpha`**. Les ombres et les hautes lumières ne
sont donc pas deux poids indépendants : une seule rampe (`balanceMapAlpha`) fond
la teinte des ombres vers celle des hautes lumières, `shadowFactor` portant la
première et `deltaFactor` la différence vers la seconde. Les tons moyens et la
roue globale ont, eux, leur propre alpha.

**Ce que les mesures confirment.** Si c'est un fondu, alors la PART du virage qui
revient aux ombres — `chroma(st-ombres-bleu) / (chroma(st-ombres-bleu) +
chroma(st-hl-orange))` — doit descendre proprement de 1 à 0. Mesuré, en L OKLab :

```
L      0,14  0,21  0,28  0,34  0,46  0,52  0,57  0,63  0,68  0,73  0,83  0,93
part   1,00  1,00  1,00  0,93  0,82  0,71  0,56  0,49  0,37  0,21  0,07  0,00
```

Monotone, et elle croise 0,5 à L ≈ 0,60 — exactement la bascule mesurée par une
tout autre voie (le passage par zéro de la chroma signée du duo). Deux méthodes
indépendantes, le même nombre.

**Ce que ça condamne dans notre modèle.** Nos poids sont deux `smoothstep`
indépendants plus une gaussienne. Le poids d'ombres tombe à ZÉRO dès L = 0,46, là
où la mesure dit encore 0,82 : c'est la cause première des « traînées trop
courtes » constatées sans être expliquées. La forme juste est UNE rampe `alpha(L)`
et son complément, pas deux courbes libres — et elle coûte MOINS de constantes que
ce qu'on a, pas plus.

⚠️ La somme des deux chromas mesurées n'est pas plate (0,0248 au ras du noir,
0,0535 au pic, creux à 0,0286 vers la bascule, 0,0110 près du blanc) : par-dessus
le fondu il y a une enveloppe de teintabilité, et elle dépend de la TEINTE (le
bleu et l'orange n'ont pas la même place dans le gamut à L donné). C'est ce que
`tintExp` essayait d'attraper à l'aveugle. Le mesurer proprement demande les
teintes supplémentaires de la campagne A.

## Les poids refaits sur la forme d'Adobe (2026-09-15) — le fondu livré, les cloches retenues

Antoine : « refais les poids avec la bonne forme ». Fait, et la forme s'est
précisée en route.

**La forme est une HOMOGRAPHIE, pas un smoothstep.** Le binaire porte la fonction
elle-même : `cr_div_map` (RVA 0xc7d600), `f(x,a) = a·x / (a·x + 1 − x)`. Elle
CLOUE les deux bouts — f(0)=0, f(1)=1, identité à a=1 — et tout champ `*MapAlpha`
de `UniformsSplitTone` est le `a` d'une de ces cartes. Ce qui la distingue d'un
smoothstep translaté se mesure au ras du noir : le rapport de chroma du duo à
Balance +100 sur Balance 0 vaut 0,556 / 0,389 / 0,274 / 0,115 aux niveaux 8 à 20 ;
l'homographie rend 0,585 / 0,425 / 0,284 / 0,157 (écart 0,031), un smoothstep
translaté rend 0,206 / 0,160 / 0,114 / 0,067 (écart 0,196). Une homographie ne
peut pas décoller le bout, une translation le déplace, et la mesure dit que le
bout ne bouge pas.

**L'axe est sRGB, pas L d'OKLab.** Trois arguments indépendants : les bornes du
smoothstep libre se posent sur [0,014 ; 1,002], l'exposant libre sur 1,024, et la
balance est symétrique à 2 % sur l'axe sRGB contre 20 % sur l'axe L. En métrique
de pixels, 4,275 contre 4,999 — 17 %.

**Ce qui est livré** : `divMap` et son jumeau WGSL, l'abscisse sRGB, `balanceMid`
et `blendDepth`, `ws = (1−α)·cov` et `wh = α·cov`. Quatre champs partent
(`shadowCenter`, `highCenter`, `softBase`, `softSpread`), deux arrivent : la forme
juste coûte MOINS que les deux courbes libres. Écart aux treize mesures, recalculé
par la session principale avec le vrai twin : **6,51 → 4,41 niveaux (−32 %), pire
cas 60,7 → 40,7 (−33 %)**, douze mesures sur treize en gain. La contre-expertise
qui a autorisé ce sous-ensemble l'avait mesuré hors échantillon sur SIX jeux —
gris, sat50, l25, l75, patches — avec des gains de 17 à 32 %, cinq d'entre eux
colorés et n'ayant servi à aucun ajustement.

**Le défaut que l'ancien modèle cachait** : `ws` valait EXACTEMENT 0 dès L = 0,46,
donc `ws + wh` s'annulait et l'alpha effectif basculait à 1,000 sur toute la moitié
haute de la rampe. Ce n'était pas une traînée trop courte, c'était une rampe qui
s'arrête au milieu avec un 0/0 derrière. RMS de l'ancien alpha contre le mesuré :
0,3831, soit 42,6 fois le bruit.

**Retenu — les deux cloches** (`wheelCenter`, `midSharp`, `globalSharp`, en
remplacement de la gaussienne des tons moyens et du `4L(1−L)` de la roue globale).
Elles gagnent nettement sur la rampe grise (roue globale ×10,3) mais RÉGRESSENT sur
les quatre jeux colorés, et elles ont été ajustées sur gris seul. Débloqué par une
ré-évaluation sur les `balayage_*` et `patches` déjà présents dans les JSON, et si
elles passent, par deux références neuves `developpement-grading-moyens` et
`-global` dans le même commit — sans elles, trois constantes seraient gelées par
rien, et `globalSharp` est déterminée par une seule mesure.

**Retenu — `cov` comme poids.** La même roue reçoit un verdict opposé selon qu'on
la mesure en chroma (−2,05) ou en luminance (+0,12). Cause probable, nommée par la
contre-expertise : une amplitude UNIQUE (`chromaK`, `lumK`) porte quatre roues dont
les optima mesurés divergent d'un facteur 2 (0,133 / 0,120 / 0,163 en chroma), donc
un terme multiplicatif libre absorbe l'erreur d'amplitude et la fait passer pour
une couverture. L'arbitrage se refait APRÈS une amplitude par roue, jamais avant.

**Défaut structurel ouvert, que ni l'ancien modèle ni le nouveau ne rendent** : le
poids mesuré des hautes lumières est NON MONOTONE — il culmine au niveau 205 puis
retombe à 0,51 au niveau 240 et 0,26 au niveau 248, dans les deux grandeurs, sans
écrêtage possible jusqu'à 240. Aucune homographie ne rend ça. C'est la seule mesure
des treize qui régresse (`cg-hl-lum-p50`, 1,75 → 2,36).

**Erreur de lecture rattrapée par la mesure, à consigner** : en portant le
mécanisme j'ai d'abord inversé le sens de Fusion dans un commentaire et dans une
garde. Le mécanisme est bien « creuser une bande neutre » et non « élargir des
plages », mais c'est Fusion BASSE qui creuse — mesuré au niveau 160 : 0,0119 de
chroma à Fusion 0, 0,0161 à 50, 0,0292 à 100. Le test d'origine avait le bon sens.

## 2026-09-15 — le blanc écrasé : ce qui est corrigé, ce qui reste ouvert

**Le défaut portait un nom trop doux.** Il était consigné comme « le poids des
hautes lumières est NON MONOTONE » — une question d'ajustement à 0,5 niveau près.
Mesuré dans le twin, c'est une PERTE DE DÉTAIL : à `Luminance des hautes lumières`
+50, notre décalage additif rendait les niveaux 244 à 254 **tous à 255** — onze
niveaux de rampe en un aplat, dix-neuf à +100. Lightroom ne le fait jamais : au
même réglage il rend 251,3 au niveau 248 et 253,4 au 252.

**Ce qui est livré : la saturation contre la borne.** `appliqueLum` (twin) /
`cg_lum_apply` (WGSL) : le décalage consomme une FRACTION de ce qui reste jusqu'à
la borne (`1 − exp(−|dL|/h)`), donc il se confond avec l'additif tant que `dL` est
petit devant `h`, et n'atteint la borne qu'à l'infini. Prix mesuré sur les cinq
mesures de luminance, `lumK` inchangé : **1,57 → 1,63 niveau** d'écart moyen. Sur
les treize : **4,27 → 4,29**. Gain : 11 niveaux écrasés → 5 (et ces 5 ne sont plus
qu'un arrondi 8 bits, pas un aplat), 19 → 8 à +100.

Fondé sur une mesure et non sur une intuition : les QUATRE mesures de luminance
(ombres ±50, moyens +50, hautes +50, globale +50) rendent `lin_out == lin_in`
**exactement** à partir du niveau 248. Les deux bouts de Lightroom sont cloués,
comme les deux bouts de sa carte `divMap` le sont.

**Pièce minée le même jour** (`CameraRaw.dll` 14.5.1). `cr_stage_SplitTone` porte,
dans le binaire, le titre du brevet Adobe qui le décrit : *« Color toning while
maintaining constant luminance while using color curve slopes »*, Mark Hamburg. Et
son uniforme `UniformsSplitTone` porte **`balanceMapAlpha`, `blending`,
`globalNOPBalanceMapAlpha`, `shadowFactor`, `deltaFactor`, `midtoneMapAlpha`,
`luminance`, `globalMapAlpha`** — confirme « une rampe et son complément »
(shadowFactor + deltaFactor), et ne porte aucun poids de hautes lumières. Le
kernel lui-même est dans l'un des 293 blobs DXBC, sans nom exploitable : la math
exacte n'est pas atteignable par regex.

### Ce qui reste ouvert, et qui est PLUS gros que ce qui vient d'être corrigé

1. **La FORME du poids des hautes lumières.** Le profil mesuré (`cg-hl-lum-p50`,
   converti en ΔL d'OKLab) CULMINE au niveau 201 à 0,0402 puis retombe à 0,0099 au
   248 ; notre `wh` monte encore. **Trois familles de correctifs ont été ajustées
   sur les cinq mesures de luminance et RÉGRESSENT toutes** : un facteur `(1−L)`
   (2,55 niveaux contre 1,62), `(1−lin)` (2,52), `1−L^n` (1,64 au mieux, à n = 24,
   c'est-à-dire en ne faisant presque rien). Un balayage à deux exposants
   (`base^p · (1−borne)^q`, trois bases, 14 × 8 couples) place le meilleur ajustement
   du seul profil des hautes lumières à `lin²·(1−L)`, à 4 % du pic — mais aucun
   n'améliore l'ensemble. **Conclusion mesurée : ce n'est pas un facteur qui
   manque, c'est la forme de `wh` elle-même**, et `wh` porte AUSSI le partage de la
   CHROMA, lui mesuré juste (croisement à L = 0,6). Un poids de luminance distinct
   du poids de chroma serait la piste, et il coûte une seconde forme là où le
   binaire n'en nomme qu'une.
2. **Le noir n'est pas levé, et c'est le plus gros résidu des treize.** À
   `Luminance des ombres` +50, Lightroom porte le niveau 0 à **14,33** ; nous à
   **0,16** — un facteur 100 en lumière linéaire, et les 14,2 niveaux de pire cas de
   `cg-ombres-lum-p50`. Un décalage de L en OKLab ne peut pas lever un noir absolu
   (L = 0 ⇒ lin = 0), un OFFSET en lumière linéaire le fait par construction. Les
   diagnostics de transfert vont dans le même sens : sur cette mesure le RAPPORT
   `lin_out/lin_in` vaut 3,59 au niveau 8 et retombe à 1 au blanc — la signature
   d'un lift, pas d'un décalage perceptuel. **Hypothèse à éprouver : les luminances
   des quatre roues agissent en lumière LINÉAIRE (lift / gain), pas sur le L
   d'OKLab.** C'est un changement de modèle, pas un réglage.
3. **`lumK` ne gagne rien à être refitté.** Balayé de 0,040 à 0,220 : l'optimum sur
   les cinq mesures de luminance est 0,076 (additif) ou 0,080 (borné), contre 0,074
   aujourd'hui, et sur les treize scènes la moyenne bouge de 4,27 à 4,25 — sous le
   bruit. Ne pas regraver quatre références pour ça.

### Outil versionné : `assets/verifier-grading.mjs`

Relance l'écart aux treize mesures avec le VRAI twin (bundlé à la volée par
esbuild, donc lu sur disque). Il existe parce que le chiffre « 4,41 / 40,7 » du
2026-09-14 avait été produit par un script jamais versionné : un chiffre qu'on ne
peut pas relancer se recopie au lieu de se mesurer. Les réglages de chaque scène
sont RECONSTRUITS depuis son nom (les exports ne les portent pas) et la
reconstruction se vérifie par son résultat : le pire cas retombe sur 40,7, même
scène. Les `grading2-*` sont exclues — leur base est `temoin2`, pas l'identité.

### Référence de pixels : la cinquième, et pourquoi les quatre premières n'ont rien vu

`developpement-grading-hl-lum` (`highlightLum: 50`) est la SEULE qui passe par le
chemin de LUMINANCE du module. Les quatre existantes ne règlent que teinte et
saturation : leur `dL` vaut zéro, `appliqueLum` y est l'identité au bit près, et
elles sont restées **inchangées au bit près** le jour où ce chemin a changé. Un
verrou de pixels ne verrouille que ce que sa scène traverse.

## 2026-09-15 (2ᵉ passe) — ce qu'une revue adverse a corrigé du matin même

Une contre-expertise a été lancée sur le correctif `60562b5` avec pour seule
consigne de CHERCHER L'ERREUR. Elle en a rendu dix. Six touchaient des
affirmations, deux la couverture, deux une décision. Les voici et ce qu'elles ont
changé.

**Trois chiffres faux, corrigés dans le code.** (a) « onze niveaux de détail
rendus » : la saturation ramène l'écrasement de **11 à 5**, elle ne le supprime
pas — 250 à 254 restaient indiscernables du blanc. (b) « les quatre mesures
rendent `lin_out == lin_in` exactement à partir du niveau 248 » : FAUX pour deux
des cinq, dont `cg-hl-lum-p50`, celle que le correctif vise — et contredit par la
phrase d'à côté qui cite 251,3 au niveau 248. L'énoncé juste, plus fort, est que
Lightroom n'atteint 255 QU'À L'ENTRÉE 255, sur les cinq. (c) « 1,57 → 1,63 » :
le delta était juste, le niveau non — **1,764 → 1,826**, relançable par le script
que ce même commit versionnait pour rendre les chiffres relançables.

**Une garde de test qui citait une mesure fausse.** « Lightroom mesuré : 0,0222 »
au gris moyen sous virage bleu des ombres : relancé sur `st-ombres-bleu` au niveau
128, c'est **0,0151**, et le profil de Lightroom est une CLOCHE (pic 0,048 au
niveau 64), pas une rampe qui décroît depuis le noir. Nous rendions 0,0216, soit
43 % au-dessus, et la borne fausse protégeait exactement cet écart.

**Une assertion inerte.** `expect(L).toBeLessThan(1)` ne peut pas échouer : le
round-trip OKLab du blanc pur rend 0,99999999347. La garde tenait par sa seule
monotonie ; elle compare désormais au L du blanc, et mord au premier niveau écrasé.

**Un trou de couverture GPU.** Les cinq références de virage n'empruntaient que la
branche POSITIVE de la saturation de luminance : une inversion du seul membre
négatif du `select` WGSL serait passée par tous les gates (twin TS juste, test
unitaire vert, aucune PNG déplacée). D'où `developpement-grading-ombres-lum-m50`,
sixième référence, qui gèle aussi l'index 2 du uniform.

### La décision que la revue a renversée : `rangeContrast`

Le matin, deux constantes (un exposant de contraste des plages, une amplitude de
luminance par plage) avaient été essayées, mesurées à 4,29 → 3,79 sur la rampe,
puis **revertées** au motif d'un sur-ajustement — le hors-échantillon montait de
10,25 à 10,49. La revue a attaqué ce verdict, et elle avait raison sur les deux
points :

- la **validation croisée PAR RÉGLAGE** n'avait pas été faite. Refaite : ajusté
  sur les OMBRES seules, l'optimum améliore les HAUTES lumières (2,28 → 1,09) ;
  ajusté sur les HAUTES seules, il améliore les OMBRES (2,50 → 0,85) — et les deux
  jeux DISJOINTS désignent le même optimum ; ajusté sur les luminances, il améliore
  les scènes de TEINTE (5,84 → 5,56), qui n'ont servi à aucun ajustement. Deux
  constantes qui généralisent d'une roue à l'autre puis de la luminance vers la
  chroma ne décrivent pas le bruit de l'échantillon ;
- le **hors-échantillon ne jugeait pas ce qu'on croyait** : la hausse était entière
  sur les deux balayages dont **100 % des entrées ont déjà un canal à 1,0** (mesuré),
  où élever la luminance sort du gamut par construction. Sur les deux balayages non
  saturés, le changement gagnait.

**Livré : `rangeContrast = 1,6`, une seule constante.** Trois chiffres dans le même
sens, aucune contrepartie : écart aux treize mesures **4,295 → 4,167** ; niveaux
écrasés à `Luminance des hautes lumières` +50 **5 → 4** (8 → 7 à +100) ; chroma du
gris moyen **0,0216 → 0,0143** contre 0,0151 mesurés (43 % d'écart → 5 %). Hors
échantillon aussi : 10,25 → 10,19.

**Refusé : l'amplitude de luminance par plage.** Les mesures la réclament (les deux
roues de plage demandent ~1,8 fois l'amplitude nominale ; les deux roues sur
lesquelles `lumK` est calibré tombent juste) et elle gagne 0,4 niveau de plus
(4,17 → 3,76). Mais elle fait repasser l'écrasement de **4 à 9 niveaux** : elle
échange un défaut VISIBLE contre un dixième de niveau sur une mire. Le plafond
n'est pas l'amplitude, c'est la forme du poids au ras du blanc.

### L'hypothèse « luminance en lumière LINÉAIRE » reste OUVERTE

Un test avait été construit pour la trancher : extraire le poids implicite des deux
signes (`W+ = ΔL/(1−L)`, `W− = −ΔL/L`), normaliser, comparer — l'espace où les deux
signes se superposent serait le bon. Il donnait OKLab 0,123 contre linéaire 0,475.
**La revue l'a réfuté par contrôle synthétique** : sur des rampes fabriquées en
lumière LINÉAIRE, ce test répond « OKLab » ; sur des rampes fabriquées en OKLab, il
répond « ni l'un ni l'autre » et désigne un exposant sans lecture colorimétrique
(0,10). Il mesure la compression, pas l'espace. L'hypothèse du § précédent n'est
donc ni confirmée ni réfutée, et le fait qui la motive tient toujours : à
`Luminance des ombres` +50, Lightroom porte le niveau 0 à 14,33, nous à 0,16.

### Piste ouverte par la même revue : `blendDepth` creuse trop à Fusion 0

En cherchant le réglage qui explique le mieux chaque mesure, `cg-fusion-0` est
mieux rendu par **Fusion 50 que par Fusion 0** (4,49 contre 5,09). Deux lectures,
et la seconde est la plus probable : soit la scène a été exportée à un autre
réglage que son nom, soit notre `blendDepth` SUR-CREUSE la bande neutre à Fusion
basse. Ce qui penche pour la seconde : les rampes mesurées de `st-duo` et
`cg-fusion-0` ne diffèrent que de 0,92 niveau en moyenne (max 4,3), là où
`cg-fusion-0` et `cg-fusion-100` diffèrent de 4,09 — donc Fusion 0 et le défaut
50 rendent presque la même chose chez Lightroom, et pas chez nous.
