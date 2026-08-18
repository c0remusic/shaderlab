# Les sections ne sectionnent pas

Type: grilling
Status: resolved
Blocked by: 15
Parent: ../map.md

> Front 2 sur 3 de la rationalisation des contrôles. Cadrage et ordre :
> [La rationalisation des contrôles n'est pas terminée](14-la-fusion-des-reglages-redondants.md).
> **Bloqué par l'applicabilité** : la densité mesurée aujourd'hui est celle d'un
> panneau qui affiche des paramètres inertes. Sectionner avant de masquer, c'est
> sectionner un panneau qui n'existera plus.

## Question

Constat d'Antoine : « beaucoup d'effets avec énormément de paramètres qui n'ont
aucune catégorie — on doit beaucoup trop scroller et les sections ne sont pas
claires ».

Mesuré le 2026-08-12 : **aucun effet n'est sans section.** Le problème n'est
donc pas l'absence — c'est que les sections ne séparent rien.

| Effet | Params / sections | Par section |
| --- | --- | --- |
| `duotone` | 11 / 1 | **11,0** |
| `lensFlare` | 30 / 3 | **10,0** |
| `outlines` | 26 / 3 | 8,7 |
| `curves` | 37 / 5 | 7,4 |
| `glass`, `channelMixer` | 22 / 3 | 7,3 |
| `gradientMap` | 20 / 3 | 6,7 |

Et le gabarit choisi l'aggrave : **`liste` représente 54 des 73 sections** —
des empilements verticaux. `paire` 8, `figure` 6, `pose` 3, `grille` 2.

**Une section de dix paramètres n'est pas une section, c'est du défilement avec
un titre au-dessus.**

## Le sous-problème des orphelins, avec sa cause

**25 paramètres sur 345 ne sont cités par aucune section.** `CLAUDE.md`
affirmait que quatre effets en laissent délibérément (`lensFlare` 9,
`channelMixer` 4, `gradientMap` 2, `curves` 1 = 16) en disant pourquoi à leur
déclaration. La mesure confirme ces quatre **et en trouve un cinquième, non
documenté** : `duotone`, **9 orphelins sur 11 paramètres**.

⚠️ **Sa cause est instructive.** Le 2026-08-05, les trois sections d'encre de
`duotone` ont été retirées parce qu'elles répétaient le libellé de leur pastille
(« Ton moyen » sous « TON MOYEN ») — une violation ADR-0001, correctement
diagnostiquée et corrigée. **Mais la correction de densité a créé neuf
orphelins**, et rien ne l'a signalé : aucun test ne compte les paramètres non
cités.

C'est le motif à retenir pour ce front : **corriger la densité d'un côté peut
créer un défaut de l'autre**, et il n'y a aujourd'hui aucun garde qui l'attrape.

## Ce qu'il faut interroger

- **Y a-t-il un plafond opposable ?** ADR-0001 borne la hauteur d'un panneau et
  interdit le défilement de colonne, mais **ne dit rien du nombre de paramètres
  par section**. Faut-il un chiffre (« au-dessus de N, la section se scinde ou
  se justifie par écrit », dans la forme de la règle des 56 px), ou est-ce un
  jugement au cas par cas ? Un chiffre est vérifiable ; un jugement ne dérive
  pas en règle morte.
- **Le vrai levier est-il le découpage ou le GABARIT ?** 74 % des sections sont
  des `liste`. Une `grille` ou une `paire` tient le même nombre de paramètres
  dans deux à quatre fois moins de hauteur. Peut-être qu'il n'y a pas trop de
  paramètres par section, mais trop de listes — et le vocabulaire est **fermé**
  (`liste` · `paire` · `grille` · `pose` · `figure`), donc le rééquilibrage ne
  demande aucun code nouveau.
- **Faut-il un sixième gabarit ?** Le vocabulaire est fermé à cinq. Si aucun ne
  tient un cas réel, c'est une décision de contrat, pas un choix de mise en
  page.
- **Les 25 orphelins, un par un.** La différence entre un orphelin voulu et un
  oubli **se LIT dans le commentaire, aucune mesure ne la donne**. Donc chacun
  doit soit porter sa raison écrite, soit entrer dans une section — et
  `duotone` tranche en premier.
- **Un garde est-il possible ?** Un test qui compte les orphelins et exige une
  raison déclarée transformerait « personne ne l'a vu » en « ça rougit ». Est-ce
  souhaitable, ou est-ce forcer une prose dans un test ?

## Contraintes dures

- **C'est de l'AFFICHAGE.** `params[]` ne se réordonne jamais, ses index sont
  persistés dans les presets, et **`test:render` doit rendre ZÉRO écart** — le
  gate discriminant : un écart prouve qu'on a trié le tableau au lieu des items.
- **ADR-0001 s'applique AU MOMENT de l'ajout**, jamais en lot de rattrapage.
  Toute décision prise ici doit dire comment elle mord sur le prochain effet
  écrit, sinon elle sera à refaire.
- Le vocabulaire de `SectionLayout` est **fermé** — l'élargir est une décision,
  pas une commodité.

## Ce qui prouve que ce front est fini

Un **plafond de densité chiffré et opposable**, aucun effet au-dessus, et
**zéro orphelin sans raison écrite**.

⚠️ Pas « les sections ont été revues ». La mesure de sortie se relance
(`assets/mesure-controles.ts`) et doit tenir toute seule.

---

## Answer — RÉSOLU le 2026-08-18

**Le levier était le GABARIT, pas le découpage.** Cinq sections dépassaient le
plafond ; quatre sont passées en `grille`, **aucune n'a été scindée ni
renommée**, et le vocabulaire fermé s'est révélé déjà suffisant. Zéro code écrit.

### ⚠️ Le tableau de densité de ce ticket portait DEUX dénominateurs faux

Le premier est celui que le ticket 15 avait déjà corrigé : **la rangée, pas le
paramètre**. Les points d'une courbe, les arrêts d'une rampe, les bornes d'une
plage tonale et les satellites d'un `colorGroup` sont consommés par un contrôle
composite — trois paramètres de pastille font UNE ligne, pas trois.

Le second est propre à ce front, et il inverse un classement : **la ligne
visuelle, pas la rangée**. `grille` et `paire` posent DEUX colonnes — leur CSS le
dit et c'est leur seule raison d'être. Le tableau comparait donc des sections
`liste` à des sections `grille` sur le même axe :

| section | rangées | gabarit | lignes RÉELLES |
| --- | --- | --- | --- |
| `glass.pave` | 8 | `grille` | **4** |
| `gooeyMerge.fusion` | 7 | `liste` | **7** |

Le ticket classait la première comme la plus dense des deux. C'est l'inverse.

### Ce qui a changé, et ce qui a été REFUSÉ

Passées en `grille` : `lensFlare.fantomes` (12 rangées → 6 lignes),
`glass.matiere` (9 → 5), `lensFlare.diffusion` (7 → 4),
`gooeyMerge.fusion` (7 → 4).

**`outlines.encre` a été laissée en `liste`, et c'est un refus mesuré.** Elle
porte deux PASTILLES, et une pastille est un contrôle repliable, pas un
curseur — `channelMixer` avait déjà écarté `grille` pour cette raison exacte et
l'avait écrit : « deux colonnes étroites tronqueraient les uns et déformeraient
l'autre ». Elle est la seule exception au plafond, déclarée avec sa raison.

Les quatre qui passent ont été ÉPROUVÉES : story `GrilleLabelsDoNotTruncate`, qui
rend `lensFlare` à 320 px — la largeur par défaut du dock — et exige qu'aucun
libellé ne déborde sa boîte. Le plus long du lot fait 24 caractères
(« Remplissage des fantômes »). Seuil DÉRIVÉ (`scrollWidth > clientWidth`),
jamais un nombre de pixels écrit en dur.

### Le plafond, chiffré et opposable

**Six lignes visuelles par section.** Calé sur le parc réel après les
changements : six sections y sont exactement, ce qu'un test vérifie — un plafond
que rien n'approche pourrait valoir 40 et ne prouverait rien. Forme identique à
la règle des 56 px d'ADR-0001, exception écrite comprise.

⚠️ **La première réponse à un dépassement n'est ni de monter le nombre ni de
scinder : c'est de regarder le gabarit.** Deux des cinq tiennent le même contenu
dans deux fois moins de hauteur.

### Les orphelins, et le garde qui les rend bruyants

**`duotone` est corrigé** : ses trois pastilles entrent dans UNE section
« Encres ». Une seule, et non trois — le titre ne répète aucun libellé de
pastille, donc la violation d'ADR-0001 qui avait fait retirer les trois sections
d'origine ne peut pas revenir. Neuf orphelins de moins, trois rangées de plus.

Restent **16 orphelins, tous déclarés avec leur raison** dans
`test/render/effects/densiteSections.test.ts` : les 9 réglages communs de
`lensFlare`, les 4 de `channelMixer` qui portent sur la matrice entière,
`curves.mix` et les 2 de `gradientMap`.

**Le garde répond à la question « est-ce forcer une prose dans un test ? » par
non** : la prose reste dans le module, à la déclaration ; ce qui vit dans le test
est la LISTE. Ajouter un orphelin sans venir écrire sa ligne fait rougir.
Symétriquement, un orphelin qui rentre dans une section doit SORTIR de la liste —
sinon elle devient un cimetière où le prochain vrai orphelin se cacherait.

⚠️ **La première version de cette liste en devinait dix-sept, dont aucun n'était
juste** : elle avait été écrite d'après le ticket au lieu d'être mesurée. Elle
citait `channelMixer.shadowsMin`, qui est cité par une section.

### État de sortie, mesuré

27 effets · aucune section au-dessus de 6 lignes hors l'exception écrite ·
**zéro orphelin sans raison déclarée**. `test:render` rend **aucun écart** — le
gate discriminant : un écart aurait prouvé qu'on a trié `params[]` au lieu des
items d'affichage.
