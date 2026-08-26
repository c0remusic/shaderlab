# 01 — Aperçu live des modes de fusion au survol

**What to build:** Dans le sélecteur de mode de fusion d'un calque, survoler un
mode recompose le calque sélectionné dans ce mode sur la toile, et revient au
mode réellement appliqué dès que le pointeur quitte. Convention Photoshop (scrub
la liste = aperçu live). Cheap : un seul recompose par survol.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent
**Type:** task

- [ ] Survoler un mode → la toile montre le calque composé dans ce mode.
- [ ] Quitter le survol → retour au mode réel, aucun état persistant (undo intact).
- [ ] Aucun coût quand le sélecteur est fermé ; un recompose par survol, pas par frame.
- [ ] Validé à l'œil par Antoine (capture CDP) — le geste doit suivre le pointeur.
