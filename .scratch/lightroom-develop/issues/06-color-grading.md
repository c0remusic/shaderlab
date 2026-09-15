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
