# Les sections ne sectionnent pas

Type: grilling
Status: open
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
