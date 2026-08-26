# 22: La carte de déplacement peut lire L'IMAGE elle-même

**What to build:** `displacementMap` peut prendre pour carte **ce qui est en
dessous de lui** (la photo, ou le composite) au lieu d'un scan de la
bibliothèque. Demande d'Antoine le 2026-08-21 : « je voulais que ça se base sur
l'image moi ». Aujourd'hui sa carte est forcément une texture de bibliothèque
(`libraryTexture`, binding 7) ; l'image, qui est pourtant la source de relief la
plus riche et la plus à portée, n'est pas offerte.

Ce que ça donne visuellement : l'image se déforme selon son propre relief
tonal — les zones claires et sombres se poussent les unes les autres. C'est un
geste très différent de la déformation par un scan, et il n'a besoin d'aucune
bibliothèque.

## Pourquoi la demande est arrivée — le vrai symptôme

Antoine : « l'effet est le même selon les textures ». Mesuré le même jour, et la
cause n'est PAS dans l'effet : sa bibliothèque contient sept scans `Cardboard*` /
`Paper*` d'ambientCG, qui sont des **albédos PBR dé-éclairés**, mesurés à ~10
niveaux sur 255 par la recherche du ticket 08 — donc quasi PLATS. Une carte de
déplacement lit une PENTE ; une image plate n'en a aucune, et toutes les
textures rendent donc à peu près la même chose. L'effet marchait, son entrée ne
portait pas d'information.

Deux conséquences distinctes, à ne pas confondre :
- **court terme** : ce ticket (lire l'image) donne une source de relief riche,
  disponible sans installer quoi que ce soit ;
- **fond** : le catalogue a besoin de vraies cartes de relief — c'est le
  ticket 09, et la recherche du 08 a déjà nommé la source (Texture Ninja, CC0,
  scans photographiques, contre les albédos plats d'ambientCG).

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Un mode de source « l'image en dessous » à côté du mode « texture de la bibliothèque ».
- [ ] Le choix se fait par un paramètre à `choices` (l'index se persiste : nouvelle entrée en FIN de liste, jamais insérée au milieu).
- [ ] La pente se lit sur la luminance de l'image, avec la même convention que le mode texture (finesse, amplitude, angle inchangés de sens).
- [ ] Référence de pixels posée pour le mode neuf ; les références existantes du mode texture inchangées au bit près.
- [ ] Validé à l'œil par Antoine — c'est un geste créatif, le harnais ne dit pas s'il est beau.
