# 23: Retirer l'écrêtage (décision de portée à confirmer)

**What to build:** Retirer l'écrêtage — la case « Écrêter sur la photo du dessus »
et le champ `LayerState.clipToBelow` avec toute sa machinerie. Antoine, le
2026-08-21 : le libellé est faux ET la fonction est obsolète (« c'est les deux »).

Le libellé était effectivement contradictoire : il dit « du dessus » quand le
modèle dit « le calque photo situé EN DESSOUS » — les deux sont vrais dans leur
repère (ADR-0004 inverse l'ordre d'affichage), ce qui est précisément le genre
d'ambiguïté qu'on ne veut pas garder.

## Ce que la mesure dit du coût — 2026-08-21

Le retrait est bien moins risqué qu'attendu :
- **Aucune référence de pixels** ne l'utilise (`render-check.mjs` n'a aucun
  scénario écrêté) → `test:render` reste vert sans régénération.
- **Aucun preset ne le persiste** : `presetDocument.capture` prend `effectId`,
  `params`, `enabled`, `opacity`, `blendMode` — pas `clipToBelow`. Aucun document
  existant ne change.
- **Le regroupement de la pile survit** : `layerTree` fait passer l'écrêtage avant
  la proximité, mais la proximité (ADR-0005) est le cas général et reste.

Portée réelle : ~26 fichiers (modèle, `clipping.ts`, `shaderCompose`,
`framePipelineExecutor`, `effectPassRunner`, `isolation`, `layerTree`, UI, plus
leurs tests et la garde de `gpu-shader-check`).

## ⚠️ LA QUESTION DE PORTÉE, à trancher avant d'écrire une ligne

L'écrêtage fait UNE chose qu'aucun masque ne sait faire aujourd'hui :
**restreindre un effet à là où une photo COUVRE**. Les sources de masque sont une
union fermée — `gradient · luminosity · colorRange` — sans aucune source
géométrique ni de couverture (c'est le trou que le ticket 11 comble).

Donc deux portées possibles, et elles ne coûtent pas la même chose :

- **(a) Retrait SEC** — on accepte de perdre « borner un effet à la couverture
  d'une photo » jusqu'à ce qu'un masque sache le refaire. Défendable si le geste
  n'est jamais utilisé ; c'est le cas de figure d'ADR-0011 (`surfaceBlur`), retiré
  sur verdict d'usage sans remplaçant.
- **(b) Retrait APRÈS remplaçant** — bloqué par le ticket 11 (source de sélection
  géométrique), qui rendrait le geste par un masque au lieu d'une case.

Le dépôt a une doctrine explicite là-dessus (ADR-0016) : un doublon se MESURE
avant de se retirer, et la mesure répond souvent deux choses. Ici elle en dit
deux : le retrait est bon marché, et il enlève une capacité sans équivalent.

**Blocked by:** la décision de portée ci-dessus. En (b), aussi bloqué par 11.

**Status:** ready-for-human
**HITL — portée (a) ou (b) à trancher par Antoine.**

- [ ] Portée tranchée : retrait sec, ou après remplaçant.
- [ ] ADR de retrait écrit (patron des ADR-0011 / 0012 / 0019), disant ce qui est perdu.
- [ ] Champ, machinerie, UI et tests retirés ; garde de retrait posée comme pour `surfaceBlur`.
- [ ] `test:render` vert SANS régénération (c'est le gate discriminant : un écart prouverait qu'on a touché autre chose que l'écrêtage).
