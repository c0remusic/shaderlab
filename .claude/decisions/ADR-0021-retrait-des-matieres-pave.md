---
id: ADR-0021
status: active
date: 2026-08-27
---

# ADR-0021 : les cinq matières de PAVÉ sortent de `glass`

## Contexte

`glass` est né le 2026-08-03 du portage du système de réfraction d'Antoine
(`C:\dev\portfolio\src\shaders\verre\site.fs.glsl`). Son plan le découpait en
deux tranches : la FEUILLE — neuf matières dont le relief se répète sur une
surface continue — puis le PAVÉ, cinq matières livrées le 2026-08-04 à la fin de
la même liste, jamais dans un second effet.

Le pavé n'était pas une variante de la feuille mais un mécanisme à lui : une
grille de blocs en pixels natifs, un joint de mortier opaque peint par-dessus
l'image, une arête biseautée qui allonge le trajet optique, un moulage interne
par matière. Un tiers du fichier, et le seul endroit du registre où un effet
d'optique PEIGNAIT au lieu de réfracter.

**Il a été refusé quatre fois, sur photo, et les trois corrections livrées entre
les refus n'ont pas retourné le verdict :**

| Date | Verdict d'Antoine | Suite donnée |
|---|---|---|
| 2026-08-13 | « les espacements entre les pavés sont très moches » | joint adouci proportionnellement à sa largeur (la transition était de 1,4 pixel NATIF fixe, soit 0,18 pixel écran à 26 Mpx affichée à 13 %) |
| 2026-08-13 | « je n'aime pas l'aspect du mortier » | granulométrie à deux échelles, six fois plus marquée ; course de `Clarté du mortier` rendue entière (un facteur 0,55 posé sur un raisonnement l'avait amputée de moitié) ; ombre de contact |
| 2026-08-13 | « très artificiel, 3D des années 90 » | variation de teinte et d'éclat tirée par bloc, pilotée par l'Irrégularité existante (aucun curseur ajouté) |
| 2026-08-27 | « Pavé nuage est horrible » | **celui-ci** |

Le quatrième refus porte sur une matière dont le mécanisme avait reçu les trois
corrections. Antoine a choisi explicitement « retirer les matières Pavé » parmi
les options proposées.

## Décision

**Les cinq matières de PAVÉ sortent de `glass`** — `Pavé · Nuage`,
`Pavé · Ondulé`, `Pavé · Quadrillé`, `Pavé · Alvéolaire`, `Pavé · Lisse`.
Retrait SEC, sans remplaçant, arbitrage d'Antoine du 2026-08-27.

Le retrait porte sur tout ce que la tranche touchait :

- les cinq entrées de `MATERIALS` et les constantes `MAT_PAVE_NUAGE` /
  `MAT_PAVE_LISSE`, plus l'helper d'applicabilité `MATIERES_PAVE` ;
- les **huit paramètres** `blockSize`, `mortar`, `mortarHue`, `mortarLightness`,
  `edgeDepth`, `edgeWidth`, `bevel`, `inner` ;
- la section d'affichage « Pavé » — la seule de l'effet à porter une
  `appliesWhen`, et une section dont la condition ne peut plus être vraie n'est
  pas une section, c'est du code mort ;
- côté WGSL : les fonctions `verre_hauteurPave` et `verre_mosaiquePave`, les
  trois branches `mat >= MAT_PAVE_NUAGE` (pente de surface, variation par bloc,
  liseré d'arête et mortier), la modulation du trajet d'absorption par l'arête,
  et les deux arguments `uv` / `dims` de `verre_pentes` — que seule la branche
  des pavés lisait, parce qu'elle seule raisonnait en pixels natifs ;
- les cinq scénarios `effet-verre-pave-*` de `scripts/render-check.mjs`, leurs
  cinq références de pixels, et leurs cinq entrées de la table `ATTENDU` de
  `renderRefs.test.mjs` ;
- les huit déclarations « Sans objet hors des cinq matières Pavé » de
  `scripts/applicabilite-table.mjs`, plus les configs Pavé qu'éprouvaient
  `glass.profile`, `glass.flat` et `glass.fillet`, plus l'helper `pave()`
  devenu sans appelant.

Une garde de retrait est posée dans `test/render/effects/glass.test.ts`, même
rôle que celles de `surfaceBlur` (ADR-0011) et d'`emboss` (ADR-0019) : elle rend
le retrait CONSCIENT — réintroduire un pavé oblige à supprimer la ligne, donc à
relire cet ADR et ses quatre refus.

## Conséquences

- **Aucun index ne bouge, et c'est ce qui rend le retrait neutre.** Les cinq
  matières étaient les cinq DERNIÈRES de `MATERIALS`, les huit paramètres les
  huit DERNIERS de `params[]` (index 14 à 21). Les treize références de pixels
  de la feuille rendent donc le même bit qu'avant — c'est le gate discriminant
  du retrait, et le seul chiffre qui prouve que la feuille n'a pas été touchée
  en passant.
- **`glass` passe de 22 à 14 paramètres, de 14 à 9 matières, de 3 à 2
  sections**, et de 18 à 13 références de pixels. Le dépôt passe de 124 à 119
  PNG de référence, dont 117 gèlent un index de paramètre.
- **Le registre reste à VINGT-SIX effets.** Contrairement à ADR-0011, 0012 et
  0019, ce retrait n'ôte pas un effet : `glass` reste, amputé de sa tranche 2.
- **Un preset qui cite un pavé ne casse pas, et il ne retombe pas non plus sur
  une matière voisine.** ⚠️ Il n'y a AUCUN clamp sur le chemin — ni
  `LayerStack.updateParams`, ni `EffectPassRunner`, ni le shader n'écrêtent
  `params[0]` ; `EffectParam.max` ne borne que le CURSEUR. Une valeur 9 à 13
  traverse `verre_pentes` sans reconnaître aucune branche et sort par le bloc
  des cannelures, où la pente reste nulle : une feuille PLANE, qui n'a plus que
  son micro-relief, et sur laquelle toute l'optique continue de s'appliquer. Un
  preset qui cite `blockSize` ou l'un des sept autres pose une clé que le shader
  ne lit plus. Aucun des deux ne jette.
- **`sourceMipmaps: true` RESTE, et le retirer serait un changement de rendu.**
  Le drapeau a été justifié en 2026-08-17 sur une mesure prise sur les pavés
  (98,6 ms → 25,6 ms sur un Pavé quadrillé à 26 Mpx) : cette mesure est
  désormais historique. Mais `verre_niveau` dérive encore un niveau supérieur à
  0 dès que l'étalement d'une feuille dépasse le texel, et sans pyramide ce
  niveau retomberait sur le mip 0. Ce que le retrait change est le GAIN du
  drapeau, jamais son exactitude.
- **Le classement du coût du verre perd ses trois entrées les plus chères.** Le
  relevé du 2026-08-15 (facteur 7 entre matières, Dépoli 15,5 ms contre Pavé
  quadrillé 108,3 ms) portait sur quatorze matières dont les plus coûteuses
  étaient des pavés. Le constat de CAUSE, lui, survit intact et vaut toujours :
  ce qui rend cet effet cher est la DISPERSION de ses adresses de lecture, pas
  son ALU ni sa géométrie — c'est l'ablation `Creux` qui l'a établi, pas le
  classement.

## Ce qui est PERDU, sans équivalent

**Le seul verre À CELLULES du registre** — celui qui découpe l'image en blocs
séparés par un joint opaque, au lieu de la déformer par un relief continu.

Rien ne le remplace, et il faut le dire sans le relativiser :

- aucune autre matière de `glass` ne sépare l'image en régions : les neuf
  feuilles font toutes varier une pente sur une surface CONTINUE ;
- le mortier n'était pas une déformation mais une couleur PEINTE sous le masque
  d'une grille. Aucun autre effet du registre ne peint une grille — `aplat` pose
  une couleur unie bornée par un masque ou une primitive, jamais une trame
  répétée ;
- un masque ne le rend pas non plus : les sources de masque sont une union
  fermée (`gradient · luminosity · colorRange`), aucune géométrique.

Si la brique de verre revient un jour, elle reviendra comme un mécanisme pensé
pour elle-même, pas comme cinq entrées à la fin d'une liste de matières.

## Alternatives écartées

- **Une cinquième correction.** Écartée par le compte : quatre refus datés, trois
  corrections livrées entre eux, et le verdict n'a pas bougé d'un cran. La leçon
  du 2026-08-13 est déjà écrite dans `glass.ts` — une référence de pixels prouve
  qu'un effet porte sa propriété, jamais qu'il est beau. Continuer aurait été
  corriger une quatrième fois la même pièce, ce que ce dépôt a appris à traiter
  comme le signe qu'on ne vise pas le bon objet.
- **Garder les pavés en les dépriorisant dans la liste des matières.** Même
  objection que pour `surfaceBlur` (ADR-0011), le gaussien (ADR-0010) et
  `emboss` (ADR-0019) : une matière au registre est une matière qu'on pose.
  L'ordre d'une liste n'est pas une décision.
- **Garder une seule matière de pavé, la moins mauvaise.** Écartée : les cinq
  partagent le MÊME mécanisme (grille, mortier, arête, biseau) et ne diffèrent
  que par leur moulage interne. Le verdict porte sur ce mécanisme — le refus du
  2026-08-13 nommait « le mortier » et « les espacements », pas un moulage. En
  garder une aurait gardé tout ce qui a été refusé, pour un cinquième du choix.
- **Sortir le pavé dans un effet à part au lieu de le retirer.** Écartée : ça
  déplace le code refusé, ça ne répond pas au verdict. Et le plan d'origine avait
  déjà tranché contre un second effet, pour la raison inverse (l'optique en aval
  est commune) — la raison ne s'est pas retournée, seul le jugement d'usage l'a
  fait.

## Le chantier esthétique du verre CONTINUE, sur les feuilles

Ce retrait ne clôt pas le travail sur `glass`, il le RECENTRE. Restent ouverts,
tous sur les neuf matières de feuille :

- [ticket 17 — le reflet d'environnement](../../.scratch/retour-usage-execution/issues/17-verre-reflet-environnement.md),
  prêt à trancher entre trois voies. ⚠️ Sa planche de variantes montre un Pavé
  nuage : la décision se prend désormais sur les feuilles seules ;
- [ticket 18 — la réfraction par la pente](../../.scratch/retour-usage-execution/issues/18-verre-refraction-pente.md) ;
- [ticket 19 — la frange de bord](../../.scratch/retour-usage-execution/issues/19-verre-rim-frange-bord.md) ;
- et les deux fronts que les photos du 2026-08-13 désignaient sans être propres
  au pavé : la DIFFUSION et le CONTRASTE de la matière
  (`docs/ROADMAP.md` § « l'aspect du verre »).

Le Dépoli, refusé le même jour que les pavés, a déjà reçu sa correction (sa
diffusion était directionnelle, elle est isotrope depuis `da86f3d`) et n'est pas
retiré : son verdict portait sur un défaut nommé et corrigé, pas sur quatre
refus successifs du même mécanisme.
