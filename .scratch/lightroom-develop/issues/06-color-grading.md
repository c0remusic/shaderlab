# 06 — Color Grading : trois roues, une globale, fusion et balance

Type: task
Status: ready-for-agent
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

- [ ] `colorGrading.ts`, 14 params, une passe, table isolée.
- [ ] Registre, panneau (groupes couleur), références 143 → 147, applicabilité sans objet (aucun `choices`).
- [ ] Comparaison à Lightroom si exports ; sinon script prêt.
- [ ] Planche, verdict d'Antoine.
