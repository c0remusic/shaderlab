---
id: ADR-0017
status: active
date: 2026-08-03
---

# ADR-0017 : `lensFlare` rouvre la famille des halos à trois

## Contexte

Demande d'Antoine : « chromatic aberration est pas mal, mais je voudrais un
effet un peu plus précis pour faire des flares ».

Le cahier de références nommait déjà ce manque, en creux et depuis le
2026-08-01 : il décrit la traînée anamorphique comme « **ni bloom ni flare à
fantômes** : un *smear* directionnel ». Le flare à fantômes y était donc désigné
comme absent — et il l'est resté, y compris à travers l'absorption de
`anamorphicStreak` par `lensDistortion` le matin même (ADR-0014), qui portait sur
la traînée et pas sur les fantômes.

Périmètre arbitré par Antoine, sur quatre phénomènes proposés :

- **retenus** : les fantômes (la chaîne de polygones en travers du cadre),
  l'anneau irisé, et le voile (le lavage général du contraste) ;
- **écarté** : les aigrettes — l'étoile à N branches sur un point lumineux. Le
  seul poste cher des quatre (~48 taps, ou des passes internes de plus), et le
  seul dont l'absence ne se remarque pas sur une photo.

Source arbitrée : **les deux**, automatique depuis les hautes lumières ET un
point posé sur la toile.

## Décision

Un **nouvel effet**, `lensFlare`, posé dans la famille des HALOS, après `glow`
et `halation`.

### Pourquoi pas un mode de `lensDistortion`

Le CLAUDE.md range déjà l'optique en trois questions : ce qu'un objectif
**renvoie** (les halos), ce qu'il ne met pas au point (les flous), ce que sa
**forme** déforme (`lensDistortion`). Un flare n'est pas une déformation —
l'image derrière ne bouge pas d'un pixel. C'est de la lumière **ajoutée**, par
réflexion entre les faces des lentilles. Première question, pas la troisième, et
le fait qu'elle vienne du même objectif n'y change rien : c'est le même critère
qui a fait sortir `anamorphicStreak` des halos ce matin, appliqué dans l'autre
sens.

### La famille des halos rouvre à TROIS

Elle avait été déclarée close à deux le matin même. La clôture portait sur un
**découpage** : `glow` étale sans colorer (diffusion), `halation` réexpose en
rouge sur fond sombre (film). Celui-ci n'est variante ni de l'un ni de l'autre —
c'est une RÉFLEXION, qui produit des copies **déplacées** de la source au lieu de
l'étaler sur place. Une famille close par un découpage se rouvre quand un
mécanisme qui n'y entre pas se présente ; elle ne se rouvre pas pour une nuance.

### Les deux sources sont UNE machinerie

Le point posé est **injecté dans la passe de seuillage**, comme un lobe
synthétique ajouté aux hautes lumières réelles. Tout l'aval le traite ensuite
comme n'importe quelle lumière de l'image.

Et ça rend gratuitement une propriété qu'un fantôme dessiné après coup ne
pourrait pas avoir : **le lobe injecté porte la forme du diaphragme, donc ses
copies l'héritent**. Un fantôme est un polygone parce que la source vue à travers
le diaphragme en est un — pas parce qu'on a dessiné un polygone.

⚠️ Corollaire assumé et visible : les fantômes issus d'une haute lumière RÉELLE
sont ronds et mous, parce que cette lumière-là n'a pas de forme connue. C'est le
prix de la voie automatique.

### Le diaphragme devient partagé

`aperture_radius` est extrait de `lensBlur` vers `effects/aperture.ts`, au moment
où ce second consommateur arrive — même geste que `edgeGradient.ts` et
`blurChain.ts`. Ici la conséquence d'une copie serait pire qu'ailleurs : **un
objectif n'a qu'un diaphragme**, et deux effets posés sur la même photo qui
rendraient un hexagone de bokeh et un heptagone de fantôme ne seraient pas
approximativement justes, ils seraient faux. Extraction vérifiée neutre — les
références de `lensBlur` sortent `aucun ecart`.

## Conséquences

- **Le registre passe de dix-neuf à vingt effets.**
- **Cinq passes internes**, toutes conditionnées aux trois contributions
  (`EffectPass.enabled`), plus `nombre de fantômes + 10` taps en composite.
- ⚠️ **La passe finale porte le MÊME prédicat, en sortie anticipée.** Sans lui,
  un effet posé et réglé à zéro lirait la texture SOURCE en croyant lire son
  champ de hautes lumières, et ajouterait l'image à elle-même. C'est
  l'avertissement écrit sur `EffectPass.enabled` depuis sa création, et c'est le
  premier effet du dépôt où il mord réellement.
- **Les lectures ne sont PAS repliées** (`mirrorUv`), contrairement à presque
  tout le dossier. Un fantôme lit très loin du pixel courant — c'est sa
  définition — et le repli ferait réapparaître une source réelle par réflexion
  sur le bord, donc un fantôme de fantôme à un endroit qu'aucune optique ne
  justifie.

## Trois géométries fausses, et pourquoi elles paraissaient bonnes

Aucune n'aurait été trahie par un test unitaire écrit après coup. Les trois
compilaient et rendaient quelque chose. Ce sont les références de pixels qui les
ont montrées, une par une — et le garde de signal du harnais qui a refusé
d'écrire la première.

1. **L'anneau lu à pas fixe depuis le pixel** (`uv - dir · rayon`). Chaque pixel
   lit alors un point différent, donc une source ponctuelle n'est vue que par un
   seul pixel : rien ne se forme. Le harnais a refusé la référence en constatant
   que le scénario « n'agit plus sur l'image ».
2. **L'anneau lu au point diamétralement opposé** (`centre - dir · rayon`).
   Mieux : tous les pixels d'un même rayon lisent le même point. Mais seul le
   SECTEUR face à la source s'allume — ça rend un ARC, et l'image l'a montré.
   Un anneau demande que chaque point du tour connaisse l'énergie de TOUT le
   tour : huit prélèvements réguliers sur le cercle, leur moyenne peinte partout.
3. **L'atténuation des fantômes au CARRÉ.** Le fantôme d'indice 0 — le miroir
   exact de la source par le centre, donc celui qui signe le flare — tombait à
   19 % quand les suivants, plus près de l'axe, passaient devant. La chaîne se
   lisait à l'envers.

Et deux calibrages, du même genre que ceux du portage du VERRE la veille :

- **La pyramide à quatre niveaux** descendait au 1/16, où un lobe de diaphragme
  de 12 px ne survit pas : les fantômes sortaient RONDS, ce qui vide de son sens
  toute la mécanique d'injection. Ramenée à deux niveaux. C'est une différence de
  NATURE avec un bloom : le halo d'un `glow` EST un flou, un fantôme est une
  IMAGE de l'ouverture.
- **Le rayon par défaut de la source** est passé de 0,05 à 0,10, pour la même
  raison — et l'infobulle dit désormais qu'en dessous de ~0,08 on renonce au
  polygone.

## Amendement du 2026-08-03 (soir) — la revue d'Antoine, et ce qu'elle a corrigé

Deux verdicts d'usage successifs ont refait la moitié de l'effet. Ils sont
consignés ici plutôt que dans un ADR séparé : la décision de fond — un flare est
de la lumière ajoutée, il vit dans les halos — n'a pas bougé.

**1. « Pas très raffiné »**, et la cause était structurelle. La première version
prélevait TOUS les fantômes dans le champ de hautes lumières, à la façon du
« pseudo lens flare » d'écran — dont l'auteur écrit lui-même que ses fantômes
« gardent la forme de l'image SOURCE » et conseille de ne pas s'y fier seule.
Hullin & al. le disent par l'autre bout : un fantôme est *« a deformed image of
the aperture opening »*. **Une image de l'OUVERTURE, pas de la source.** Un
prélèvement ne peut donc pas en produire.

D'où la chaîne DESSINÉE pour la source posée (`ghost_cover`) : on connaît sa
position, donc celle et la taille de chaque fantôme sont en forme close. Quatre
traits relevés sur photographies, aucun rendu avant — un fantôme est un ANNEAU
et non une tache pleine ; il est DÉCOUPÉ EN CROISSANT dès qu'il s'éloigne de
l'axe (par intersection avec le disque du barillet, pas en dessinant un
croissant) ; son liseré est coloré différemment d'un fantôme à l'autre ; les
tailles sont très inégales. Un cinquième a fait revoir un réglage : les couleurs
sont PASTEL, pas néon.

**Conséquence en cascade : le lobe injecté a été déposé.** Une fois les fantômes
dessinés, il en produisait EN DOUBLE des prélevés au même endroit. Trois dosages
essayés (pleine force, 0,3, 0,08) : aucun ne réglait à la fois l'empâtement et
l'effondrement des termes diffus. Ce n'était pas un problème de dosage mais de
RÔLE — d'où le passage de l'anneau et du voile en analytique eux aussi, et un
champ qui ne contient plus que les hautes lumières réelles.

**2. « Et pour les autres types de flares ? »** La question était juste : la
taxonomie reconnue en compte TROIS, et seule la première était modélisée. Elles
ne diffèrent pas par leur apparence mais par l'endroit où la lumière se perd —
entre deux faces polies (ghosting), sur une surface sale (diffusion, des stries
radiales), par aller-retour avec le capteur (un quadrillage régulier). Les trois
sont désormais présentes, plus les arcs de barillet relevés sur les photos.

⚠️ **Un défaut RÉEL trouvé au passage, et mesuré avant d'être corrigé.**
L'anneau et le voile étaient prélevés dans le champ, où le lobe est rastérisé :
ils ne rendaient donc **rien** quand la source était hors cadre — alors que le
curseur va de −0,5 à 1,5 et que l'infobulle promet ce cas. À `sourceX = 1.25`,
les fantômes dessinés entraient bien par le bord et le voile réglé à 1,6 était
absent. Le curseur et l'infobulle mentaient tous les deux. Le passage en
analytique le corrige par nature, et rend le voile DIRECTIONNEL par-dessus le
marché — le lavage qui entre par un bord, le cas le plus courant en photographie.

**Le composite porte désormais DEUX prédicats en sortie anticipée**, et ils ne
disent pas la même chose : `champActif` est le jumeau de celui des passes,
`dessinActif` laisse passer ce qui ne lit aucune texture. Un flare entièrement
posé sur une photo sans haute lumière est légitime, et c'est le premier cas qui
cassait quand la sortie ne regardait que le champ.

Effet à 26 paramètres, cinq références de pixels. Les aigrettes restent écartées.

## Alternatives écartées

- **Un mode de `lensDistortion`.** Voir ci-dessus : ce n'est pas une déformation.
  Et l'effet est déjà à seize paramètres avec géométrie, trois aberrations et
  traînée ; y ajouter fantômes, anneau et voile en ferait le fourre-tout de
  l'optique.
- **Inclure les aigrettes.** Arbitrage d'Antoine, et le bon : c'est le seul poste
  cher, et une aigrette se remarque surtout par son absence sur une source
  ponctuelle très brillante — un cas que la photo produit rarement.
- **Deux effets, un par source.** La demande « les deux » n'oblige pas à écrire
  deux fois : l'injection dans le bright-pass les réunit, et c'est elle qui donne
  gratuitement leur forme aux fantômes.
