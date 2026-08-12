# La rationalisation des contrôles n'est pas terminée

Type: grilling
Status: resolved
Parent: ../map.md

> Ce ticket s'appelait « La fusion des réglages redondants » et ne visait qu'une
> branche. **Recadré le 2026-08-12 sur constat d'Antoine**, puis mesuré : le
> chantier est ouvert sur ses trois fronts, pas sur un.

## Question

`docs/ROADMAP.md`, `docs/INDEX.json` et `CLAUDE.md` déclarent tous les trois ce
chantier **soldé le 2026-08-05**. Antoine dit l'inverse, en trois points :

1. « des réglages orphelins qui ne font *rien* selon certains types
   d'effets/situations » ;
2. « beaucoup d'effets avec énormément de paramètres qui n'ont aucune catégorie
   — on doit beaucoup trop scroller et les sections ne sont pas claires » ;
3. « les *outils* pour contrôler les effets sont encore bâclés, pas du niveau de
   Photoshop, et pas présents partout ».

**Mesuré le 2026-08-12** sur les modules réels
([`assets/mesure-controles.ts`](../assets/mesure-controles.ts) — le grep ment,
les paramètres de `curves` sortent d'un `flatMap`). Les trois points sont
confirmés, chiffres à l'appui.

**Qu'est-ce qui reste à faire, et dans quel ordre ?**

## Ce que la mesure dit — 345 paramètres, personne n'avait ce total

### Front 1 — l'applicabilité couvre 10 % du parc

36 `appliesWhen` sur **345 paramètres**, et concentrés sur 8 effets (`glass` 14,
`outlines` 11, `lensDistortion` 3, `hatching` 2, `dither` 2, `motionBlur` 2,
`lensBlur` 1, `warp` 1).

⚠️ **15 effets sur 23 n'ont AUCUNE condition** — et ce sont les plus chargés :

| Effet | Paramètres | Conditions |
| --- | --- | --- |
| `curves` | 37 | **0** |
| `lensFlare` | 30 | **0** |
| `channelMixer` | 22 | **0** |
| `gradientMap` | 20 | **0** |
| `isolines` | 18 | **0** |

C'est exactement le point 1 d'Antoine, et le cas de `lensFlare` le démontre :
ADR-0017 dit qu'il porte **trois blocs distincts** (fantômes, diffusion, red
dot). Les paramètres d'un bloc éteint ne font rien — et rien ne les masque.

**J'avais conclu « couvert » sur un compte de 42 déclarations sans jamais
demander « 42 sur combien ».** Un compte de déclarations n'est pas une mesure
de couverture ; c'est la faute que ce dépôt catalogue depuis des semaines.

### Front 2 — les sections existent mais ne sectionnent pas

Aucun effet n'est sans section. Le problème n'est pas là : c'est la **densité**.

| Effet | Params / sections | Par section |
| --- | --- | --- |
| `duotone` | 11 / 1 | **11,0** |
| `lensFlare` | 30 / 3 | **10,0** |
| `outlines` | 26 / 3 | 8,7 |
| `curves` | 37 / 5 | 7,4 |
| `glass`, `channelMixer` | 22 / 3 | 7,3 |

Une « section » de dix paramètres n'est pas une section, c'est du défilement
avec un titre au-dessus. Et le gabarit choisi l'aggrave : **`liste` représente
54 des 73 sections** — des empilements verticaux. `paire` 8, `figure` 6,
`pose` 3, `grille` 2.

**Un orphelin non documenté, et sa cause probable** : `duotone` a 11 paramètres
dont **9 cités par aucune section**. `CLAUDE.md` affirme que quatre effets
laissent des orphelins délibérés (`lensFlare` 9, `channelMixer` 4,
`gradientMap` 2, `curves` 1 = 16) — la mesure confirme ces quatre **et en
trouve un cinquième non documenté**. Cause probable : le 2026-08-05, les trois
sections d'encre de `duotone` ont été retirées pour cause de répétition de
libellé (violation ADR-0001). **La correction de densité a créé neuf
orphelins**, et personne ne l'a vu.

### Front 3 — les outils sur la toile couvrent 4 effets sur 23

| Effet | Outils |
| --- | --- |
| `lensFlare` | `disk` |
| `lightLeak` | `point`, `axis` |
| `motionBlur` | `axis`, `point` |
| `pixelStretch` | `disk` |

**Trois genres seulement** (`point`, `disk`, `axis`), six instances au total.

Absents là où la géométrie est pourtant le sujet : `warp` (10 params),
`glass` (22), `lensDistortion` (16), `gradientMap` (20 — une rampe se pose),
`isolines`, `sliceShift`, `gooeyMerge`, `halftone`.

Le cahier de postproduction d'Antoine le disait déjà, point 5 : « plusieurs
recettes demandent une GÉOMÉTRIE posée sur l'image, pas des curseurs ». Et il
notait que le patron existait déjà. Il existe, il n'a simplement pas été
déclaré ailleurs.

⚠️ **« Pas du niveau de Photoshop » est un jugement d'Antoine, pas une mesure**,
et c'est lui qui doit le préciser : ce qui manque est-il le NOMBRE de genres
(rectangle, courbe posée, poignée d'angle, dégradé posé), la QUALITÉ du geste
(accroche, contrainte au Maj, retour visuel, poignées à la bonne taille), ou
les DEUX ? La réponse change entièrement le chantier.

## Ce qu'il faut interroger

- **Par quel front commencer ?** Ils ne coûtent pas pareil. L'applicabilité est
  déclarative et réversible ; les sections touchent l'affichage ; les outils sur
  la toile demandent de la géométrie et du geste. Le front 1 rendrait peut-être
  le front 2 moins urgent (masquer réduit le défilement sans re-sectionner).
- **Une applicabilité se MESURE avant de se déclarer.** Le gate existe :
  `node scripts/render-check.mjs --applicabilite`. Sur 41 déclarations éprouvées
  le 2026-08-05, **une était FAUSSE** (`glass.flat`, 47 % des canaux en Martelé).
  Masquer sur une croyance ne fait rougir aucun test — un curseur caché ne bouge
  plus aucun pixel.
- **Y a-t-il un plafond de densité ?** ADR-0001 borne la hauteur d'un panneau et
  interdit le défilement de colonne, mais ne dit rien du nombre de paramètres
  par section. Faut-il un chiffre opposable, ou est-ce un jugement au cas par
  cas ?
- **Les 25 orphelins : lesquels sont voulus ?** Quatre effets le disent à leur
  déclaration ; `duotone` non. La différence se LIT dans le commentaire, aucune
  mesure ne la donne — donc chaque orphelin doit soit porter sa raison, soit
  entrer dans une section.

## Contrainte dure, non négociable

**L'index d'un paramètre est PERSISTÉ dans les presets.** `params[]` ne se
réordonne jamais, et retirer un paramètre casse les presets qui le citent —
contrairement à un effet retiré, que `presetDocument.ts` sait ignorer avec un
avertissement. Toute fusion doit dire ce qu'elle fait des index libérés, et le
prouver.

**Et `test:render` doit rendre zéro écart** après tout travail de panneau :
c'est le gate discriminant, un écart prouve qu'on a trié `params[]` au lieu de
l'affichage.

## ⚠️ Le motif de méthode, qui vaut au-delà de ce ticket

`INDEX.json` écrit que ce chantier avait **déjà été rouvert une fois**, « parce
que le précédent n'avait traité que les contrôles spécialisés et avait été
clôturé comme s'il était complet ». **C'est la troisième clôture prématurée du
même chantier** — et cette fois trois documents la portent en chœur.

Personne n'a menti : chaque plan décrit fidèlement ce qu'il a fait. C'est la
CLÔTURE qui a porté sur le chantier entier. Avant de refermer quoi que ce soit
ici, dire **quelle mesure prouvera que c'est fini** — un compte de déclarations
n'en est pas une.

## Answer

Résolu le 2026-08-12 en **cadrage**. Ce ticket ne construit rien : il découpe,
ordonne, et pose les mesures de sortie. Les trois fronts partent en tickets
séparés.

### La décision de structure, et sa raison

**Trois tickets, pas un.** C'est structurel, pas cosmétique : ce chantier a été
clôturé prématurément **trois fois**, chaque fois parce qu'un plan couvrant une
partie a été lu comme couvrant le tout. Trois tickets nommés, avec chacun sa
mesure de sortie, rendent cette confusion mécaniquement impossible — clore l'un
ne peut plus se lire comme clore le chantier.

| Front | Ticket |
| --- | --- |
| 1. Applicabilité | [L'applicabilité couvre 10 % du parc](15-l-applicabilite-couvre-10-pourcent.md) |
| 2. Sections et densité | [Les sections ne sectionnent pas](16-les-sections-ne-sectionnent-pas.md) |
| 3. Outils sur la toile | [Les outils sur la toile : quatre effets, trois genres](17-les-outils-sur-la-toile.md) |

### L'ordre, et pourquoi il n'est pas arbitraire

**1 → 2 → 3**, et l'ordre porte de l'information :

- **L'applicabilité d'abord.** Elle est déclarative, réversible, et son gate de
  mesure existe déjà. Surtout : masquer **réduit mécaniquement ce qui est à
  l'écran**. Re-sectionner avant de masquer, ce serait sectionner un panneau
  qui n'existera plus.
- **Les sections ensuite**, sur le parc réellement visible après masquage. La
  densité mesurée aujourd'hui (`lensFlare` 10 par section) est celle d'un
  panneau qui affiche des paramètres inertes.
- **Les outils en dernier** : c'est le plus cher (géométrie **et** geste), et
  le seul qui demande d'aller regarder dehors avant d'écrire quoi que ce soit.

⚠️ **Une exception à cet ordre** : la recherche du front 3 ne dépend d'aucun des
deux autres et ne demande personne. Elle peut partir **tout de suite, en
parallèle**.

### Le front 3 porte les DEUX manques — arbitrage d'Antoine, 2026-08-12

La question laissée ouverte (« le NOMBRE de genres ou la QUALITÉ du geste ? »)
est tranchée : **les deux**. Le ticket 17 porte donc deux sous-fronts distincts
et ne peut pas se clore sur un seul.

### Les mesures de sortie, écrites AVANT de commencer

C'est la parade à la quatrième clôture prématurée. Aucun de ces trois tickets
ne se clôt sur un compte de déclarations.

| Front | Ce qui prouve que c'est fini |
| --- | --- |
| 1 | Zéro paramètre INERTE non masqué, prouvé effet par effet — et chaque déclaration éprouvée par `render-check.mjs --applicabilite`, jamais posée sur une croyance |
| 2 | Un plafond de densité **chiffré et opposable**, et aucun effet au-dessus ; plus zéro orphelin sans raison écrite (il y en a 25, dont 9 non documentés sur `duotone`) |
| 3 | Chaque effet dont la géométrie est le sujet porte son outil, et le geste tient une grille de qualité écrite **avant** d'implémenter |

### Ce que ce cadrage ne tranche pas

Le plafond de densité lui-même (un chiffre ? un jugement ?), le sort des 25
orphelins un par un, et la grille de qualité du geste. Chacun appartient à son
ticket — les remonter ici recréerait exactement l'objet trop gros qui a produit
les trois clôtures.
