# 05 — Vignettes de galerie des effets au survol

**What to build:** Dans le sélecteur « Ajouter un effet », survoler un effet montre
un aperçu basse-définition de ce qu'il ferait — galerie façon filtre Photoshop.
Résolution et moment de calcul (à la volée vs pré-calcul) selon le verdict du
ticket 04.

**Blocked by:** ~~04~~ — ✅ **DÉBLOQUÉ le 2026-08-21**, la mesure est faite.

## Ce que la mesure du ticket 04 a décidé

- **À LA VOLÉE au survol**, pas de pré-calcul — **à condition** d'avoir un rendu
  en taille vignette : la pile rend en **4,0 ms** à 0,03 Mpx (majorant, mesuré en
  dev). ⚠️ Ce chemin N'EXISTE PAS aujourd'hui : `exportFrame` rend à la taille du
  DOCUMENT, donc un aperçu de la photo réelle coûte **261 ms**, pas 4. Le premier
  travail de ce ticket est donc le rendu réduit, pas l'UI.
- **Le coût ne dépend PAS de l'effet** : `glass`, le plus cher du registre, rend
  exactement le même 4,0 ms que la photo nue à cette taille. Inutile de traiter
  les effets chers à part.
- **La résolution est libre** (le coût est un plancher, pas un produit) :
  choisir ce qui rend le mieux à l'œil. 200 × 150 mesuré.
- Mémoriser l'aperçu par effet après le premier survol suffit.
- Piste si les 4 ms gênaient un jour : le plancher est dominé par la RELECTURE
  CPU d'`exportFrame` ; un aperçu qui reste sur le GPU coûterait moins. Non
  mesuré, pas nécessaire aujourd'hui.

**Status:** ready-for-agent
**Type:** task

- [ ] Un chemin de rendu de la pile à taille VIGNETTE existe (aujourd'hui absent).
- [ ] La fidélité des paramètres SPATIAUX est tranchée : mise à l'échelle, ou détail 1:1 (façon galerie Photoshop). Un aperçu qui ment sur le résultat est pire que pas d'aperçu.
- [ ] Survoler un effet dans le sélecteur → une vignette d'aperçu apparaît.
- [ ] Coût tenu selon le verdict de 04 (aucun gel de l'interface au survol).
- [ ] Validé à l'œil par Antoine.
