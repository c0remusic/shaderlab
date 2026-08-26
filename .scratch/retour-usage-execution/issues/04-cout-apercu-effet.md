# 04 — Mesurer le coût d'un aperçu d'effet (26 Mpx)

**What to build:** Chiffrer le coût de composer UN aperçu d'effet basse-définition
sur une photo 26 Mpx, pour décider la faisabilité et la résolution des vignettes
de galerie (ticket 05). C'est une mesure, pas du rendu final — la résolution
vignette est autorisée ici (l'invariant « pas de distinction preview/export » vise
le rendu de la toile, pas une vignette d'UI).

**Blocked by:** None — can start immediately. (Prérequis : l'app tourne ; mesure en
build de production si le chiffre doit être comparable à une cadence réelle.)

**Status:** done
**Type:** research

- [x] Coût mesuré (ms) pour composer 1 aperçu à résolution vignette, sur 26 Mpx.
- [x] Verdict : à la volée au survol, ou pré-calcul à l'ouverture du sélecteur.
- [x] Résolution de vignette recommandée, et le coût des 27 effets si pré-calcul.

## Mesuré le 2026-08-21 — verdict : l'aperçu est GRATUIT à taille vignette

Instrument : `__shaderlabDebug.frameSignature()`, qui fait `Renderer.exportFrame()`
(rendu + relecture CPU) puis un balayage léger. 15 itérations après 3 de chauffe,
médiane retenue. ⚠️ Build de DÉVELOPPEMENT — le plancher de dev est 2,6× celui de
la prod sur le travail JS synchrone, donc les chiffres ci-dessous sont un
MAJORANT ; en production ils ne peuvent que baisser.

| Pile | Taille | Médiane | Min | Max |
| --- | --- | --- | --- | --- |
| photo seule | 200 × 150 (0,03 Mpx) | **4,0 ms** | 3,3 | 5,0 |
| photo + `glass` | 200 × 150 | **4,0 ms** | 1,9 | 5,4 |
| photo + `glass` | 6240 × 4160 (25,96 Mpx) | **261,4 ms** | 243,1 | 301,9 |

**Le coût d'un aperçu ne dépend PAS de l'effet.** `glass` est l'effet le plus cher
du registre (facteur 7 entre ses matières, jusqu'à 108 ms de temps GPU sur
26 Mpx), et à taille vignette il ne se distingue pas de la photo nue : les deux
rendent 4,0 ms. À 0,03 Mpx le travail GPU d'un effet est ~900 fois plus petit
qu'à 26 Mpx et disparaît sous le PLANCHER de la composition (rendu + relecture +
JS), qui est fixe.

**Le témoin discriminant est la troisième ligne**, et il est la raison pour
laquelle les deux premières sont lisibles : même pile, même code, 65× plus cher
en pleine définition. Sans lui, un « 4,0 ms » identique deux fois de suite se
lirait aussi bien comme « l'instrument ne mesure rien » (règle de la skill
`run-shaderlab` : une sonde sans témoin de discrimination ne prouve rien, même
en vert).

### Ce que ça décide pour le ticket 05

- **À LA VOLÉE AU SURVOL : oui, sans réserve.** 4 ms par aperçu est sous le seuil
  de perception, et c'est un MAJORANT (mesure en dev). Pas besoin de pré-calcul.
- **Pré-calculer les 26 à l'ouverture du sélecteur : possible mais inutile** —
  ~104 ms d'un bloc, soit un à-coup visible à l'ouverture, pour économiser 4 ms
  par survol. Le calcul paresseux au survol, mémorisé par effet, prend le meilleur
  des deux.
- **La résolution de vignette est LIBRE.** Le coût étant un plancher et non un
  produit, descendre sous 200 × 150 n'économise rien de mesurable : choisir la
  taille qui rend le mieux à l'œil, pas la moins chère.
- **Piste d'implémentation, non mesurée** : ce plancher est dominé par la
  RELECTURE CPU (`exportFrame` rapatrie les pixels). Un aperçu qui resterait sur
  le GPU — rendu direct dans un canvas de vignette, sans retour CPU — devrait
  coûter nettement moins. À vérifier si les 4 ms gênaient un jour ; ils ne gênent
  pas aujourd'hui.
