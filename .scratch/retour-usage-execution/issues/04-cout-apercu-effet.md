# 04 — Mesurer le coût d'un aperçu d'effet (26 Mpx)

**What to build:** Chiffrer le coût de composer UN aperçu d'effet basse-définition
sur une photo 26 Mpx, pour décider la faisabilité et la résolution des vignettes
de galerie (ticket 05). C'est une mesure, pas du rendu final — la résolution
vignette est autorisée ici (l'invariant « pas de distinction preview/export » vise
le rendu de la toile, pas une vignette d'UI).

**Blocked by:** None — can start immediately. (Prérequis : l'app tourne ; mesure en
build de production si le chiffre doit être comparable à une cadence réelle.)

**Status:** ready-for-agent
**Type:** research

- [ ] Coût mesuré (ms) pour composer 1 aperçu à résolution vignette, sur 26 Mpx.
- [ ] Verdict : à la volée au survol, ou pré-calcul à l'ouverture du sélecteur.
- [ ] Résolution de vignette recommandée, et le coût des 27 effets si pré-calcul.
