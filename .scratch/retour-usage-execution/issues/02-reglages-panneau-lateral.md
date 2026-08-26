# 02 — Réglages d'effet en panneau latéral (deux colonnes)

**What to build:** Les réglages de l'effet sélectionné passent d'un onglet de la
colonne de dock à une DEUXIÈME colonne, à côté de la pile — comme le panneau
*Properties* de Photoshop / le panneau *Develop* de Lightroom. Content-sized, sans
défilement (ADR-0001), groupes à onglets préservés (on ajoute une colonne, on ne
rouvre pas le layout déjà tranché).

Wireframe : `docs/wireframes/reglages-panneau-lateral.html`.

**Blocked by:** None — can start immediately. ⚠️ Trois sous-questions à trancher
LIVE avec Antoine au démarrage (elles ne bloquent pas le début, elles orientent) :
côté de la colonne Propriétés (droite de la pile / gauche côté toile), sort de
l'onglet Masque (reste avec la pile / part avec les Propriétés), largeur totale et
repli d'une colonne sur petit écran.

**Status:** ready-for-human
**Type:** prototype

- [ ] Les réglages de l'effet sélectionné s'affichent dans une colonne distincte à côté de la pile.
- [ ] Aucune colonne ne défile ; chacune prend la hauteur de son contenu (`curves` 37 params compris).
- [ ] Groupes à onglets intacts (hybride ticket 04 non rouvert).
- [ ] Les trois sous-questions (côté, onglet Masque, repli) tranchées avec Antoine.
- [ ] Validé à l'œil par Antoine.
