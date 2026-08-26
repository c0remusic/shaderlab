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

**Status:** ready-for-human

- [x] Un mode de source « l'image en dessous » à côté du mode « texture de la
      bibliothèque » (`carte_texel` branche sur `params[6]`, les deux sources
      passent par le même `carte_uv` ; le repli 1x1 ne vaut qu'en Bibliothèque).
- [x] Le choix se fait par un paramètre à `choices` — `source`, ajouté en FIN de
      `params[]` (index 6). `rang` porte `appliesWhen: { source: 0 }`, MESURÉ
      inerte par `--applicabilite` (bornes 0/63 en source Image, 0 écart, effet
      actif sur 40,5 % des canaux — entrée ajoutée à `applicabilite-table.mjs`).
- [x] La pente se lit sur la luminance de l'image (même dot Rec.709), finesse,
      amplitude, échelle et angle inchangés de sens dans les deux sources.
- [x] Référence `effet-deplacement-image` posée (relue à l'œil : damier
      auto-déformé, barres cisaillées, aplat du disque immobile — la propriété
      se voit) ; `test:render` complet : zéro écart sur tout l'existant.
- [ ] Validé à l'œil par Antoine — c'est un geste créatif, le harnais ne dit pas
      s'il est beau.

⚠️ Limite d'affichage connue, mesurée dans la vraie fenêtre : « Source de la
carte » sort en FIN de section Carte, pas en tête — l'ordre d'affichage d'un
bloc EST celui de `params[]` (jamais réordonné, index gelés par les presets,
`ParamPanel.groupEffectParams` le dit en toutes lettres), et un paramètre neuf
va en fin de liste. La section `sections[].params` ne commande PAS l'ordre.
Si l'ordre gêne à l'usage, c'est un arbitrage (déplacer l'index casserait les
presets), pas un correctif.
