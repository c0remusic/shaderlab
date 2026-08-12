# Les outils sur la toile : quatre effets, trois genres

Type: grilling
Status: open
Blocked by: 18
Parent: ../map.md

> Front 3 sur 3 de la rationalisation des contrôles. Cadrage et ordre :
> [La rationalisation des contrôles n'est pas terminée](14-la-fusion-des-reglages-redondants.md).
> Le plus cher des trois, et le seul qui demande d'aller regarder dehors avant
> d'écrire quoi que ce soit — d'où son blocage par
> [Ce qu'est un manipulateur direct de niveau professionnel](18-ce-qu-est-un-manipulateur-de-niveau-pro.md).

## Question

Constat d'Antoine, 2026-08-12 : « les *outils* pour contrôler les effets sont
encore bâclés, pas du niveau de Photoshop, et pas présents partout ».

Mesuré le même jour :

| Effet | Outils | Paramètres |
| --- | --- | --- |
| `lensFlare` | `disk` | 30 |
| `lightLeak` | `point`, `axis` | 12 |
| `motionBlur` | `axis`, `point` | 7 |
| `pixelStretch` | `disk` | 12 |

**4 effets sur 23. Trois genres seulement** (`point`, `disk`, `axis`), six
instances au total.

**Arbitrage d'Antoine : les DEUX manques sont réels** — le nombre de genres
*et* la qualité du geste. Ce ticket porte donc deux sous-fronts et **ne peut pas
se clore sur un seul**.

## Sous-front A — la couverture

Absents là où la géométrie est pourtant le sujet :

| Effet | Params | Ce qui appellerait un outil |
| --- | --- | --- |
| `glass` | 22 | la surface, sa pente, l'épaisseur |
| `gradientMap` | 20 | la rampe se POSE, elle ne se règle pas au curseur |
| `lensDistortion` | 16 | le centre de distorsion, l'axe d'aberration |
| `warp` | 10 | le champ, son origine |
| `isolines`, `sliceShift`, `gooeyMerge`, `halftone` | | orientation, origine, pas |

Le cahier de postproduction d'Antoine le disait déjà, point 5 : « plusieurs
recettes demandent une GÉOMÉTRIE posée sur l'image, pas des curseurs », en
notant que le patron existait. **Il existe — il n'a simplement pas été déclaré
ailleurs.**

### ✅ La grille est arrivée — 2026-08-12

[Ce qu'est un manipulateur direct de niveau professionnel](18-ce-qu-est-un-manipulateur-de-niveau-pro.md)
est résolu : **42 lignes**, dont 17 genres et 25 points d'anatomie du geste
([`research/18-manipulateurs-directs.md`](../research/18-manipulateurs-directs.md)).
Ce ticket n'a plus à deviner — il a un critère de sortie vérifiable.

⚠️ **Un candidat que j'avais listé est INFIRMÉ** : la « poignée d'angle » des
*live shapes* n'existe pas, c'est un champ de la barre d'options. Ne pas
l'entrer au vocabulaire.

Genres confirmés qui nous manquent, les plus instructifs : **épingle
composable** (porte sa valeur, se pose hors cadre, a une profondeur) ;
**ellipse dont la rotation se prend sur le BORD, sans poignée dédiée** ; **trois
zones concentriques où le fondu EST l'écart entre deux anneaux** ; **dégradé où
l'on CRÉE une poignée en cliquant la géométrie et où on la SUPPRIME en
l'éloignant** ; anneau de valeur au survol ; maillage à politique de guides.

**11 des 42 lignes sont déjà faites en tout ou partie** — le socle n'est pas à
refaire, il est inégal.

## Sous-front B — la qualité du geste

C'est ici que « bâclés » se dit. Ce qui distingue un manipulateur professionnel
d'un point qu'on traîne — à confirmer par le ticket 18, à ne pas présumer :

- **Accroche** : aux bords, au centre, aux axes, aux autres objets.
- **Modificateurs** : Maj pour contraindre, Alt pour agir depuis le centre,
  Ctrl pour dissocier. Le dépôt en a déjà (Maj = pas large sur les cinq
  manipulateurs, Maj/Alt/Ctrl pendant un drag de transformation) — donc le
  socle est là, il est inégal.
- **Retour visuel** : valeur affichée pendant le geste, prévisualisation,
  curseur qui change de forme, mise en évidence de la poignée survolée.
- **Taille et cible** : l'audit du dock exigeait des cibles ≥ 44 px ; une
  poignée de 6 px sur une photo 24 MP ne s'attrape pas.
- **Annulation** : Échap pendant le geste, une seule entrée d'historique au
  relâchement (contrat live/commit déjà en vigueur).

## Ce qu'il faut interroger

- **Élargir le vocabulaire ou approfondir les trois genres ?** Les deux manques
  sont réels, mais pas forcément à parts égales : peut-être que trois genres
  bien faits couvrent 80 % des besoins, et que la vraie faute est de les avoir
  déclarés sur 4 effets seulement.
- **Le coût par effet.** Déclarer un `CanvasControl` est bon marché ; écrire un
  nouveau GENRE demande de la géométrie pure et son test. Ne pas confondre les
  deux quand on chiffre.
- **Qu'est-ce qui a empêché la déclaration ailleurs ?** Le mécanisme existe
  depuis le 2026-08-03 et n'a été posé que sur quatre effets. Manque de temps,
  ou inadéquation réelle du contrat `CanvasControl` aux autres cas ? La seconde
  réponse changerait le chantier.
- **`CanvasControl.visibleWhen` existe** (10 déclarations) — un outil peut déjà
  se masquer conditionnellement. Ce précédent est celui dont `appliesWhen` et
  `sections` sont issus ; il ne se réinvente pas.

## Contraintes dures

- **La peinture de masque cache le contrôle**, et Échap le restaure — comportement
  acquis au chantier des contrôles spatiaux, à ne pas régresser.
- L'alignement de l'overlay au canvas a été mesuré **sous 0,02 px** avant et
  après zoom. C'est la barre.
- `components/` ne porte aucune logique métier ; la géométrie est pure et
  testée à part (`src/ui/transform.ts` est le patron).

## Les écarts MESURÉS sur notre code, à traiter en premier

Ils ne demandent aucun genre nouveau et sont tous chiffrés :

| Écart | Preuve |
| --- | --- |
| **Zéro règle `:hover`** dans les quatre CSS d'overlay | mesuré : `AxisHandles`, `PointHandles`, `RegionHandles`, `TransformHandles` = 0 chacun |
| **Poignées de 12 px** contre 24×24 recommandés | `--slider-thumb-size: 12px` (`design/components.css:58`) |
| ⚠️ Les poignées réutilisent le token du **pouce de slider** | à découpler AVANT toute mise à la cible : agrandir l'un déforme l'autre |
| Aucune **valeur de paramètre** affichée pendant le geste | le retour chiffré existe mais montre la distance aux voisins |
| L'origine d'un `axis` est **clouée au centre** | d'où, dans `lightLeak`, « Entrée de la lumière » et « Trajet » sans aucun lien géométrique |
| Aucun magnétisme hors `TransformHandles` | alors que `src/ui/snap.ts` calcule déjà toute la géométrie nécessaire |

## ⚠️ Un lien avec le modèle, non prévu, qui peut réordonner la carte

**14 des 42 lignes de la grille supposent qu'un manipulateur soit un OBJET** —
sélectionnable, duplicable, supprimable, à cardinalité variable — là où le nôtre
est une projection de paramètres nommés sur un `Record<string, number>`.

**C'est le même mur que la typographie et les formes.** Voir
[Une forme a-t-elle besoin de `contentSource`](03-une-forme-a-t-elle-besoin-de-contentsource.md).
Une réponse à la question du modèle déciderait donc aussi du plafond de ce
front — ce que ni l'un ni l'autre ticket n'avait anticipé.

**Les 28 autres lignes ne demandent pas ce changement** : il existe un palier
atteignable sans toucher au modèle, et un au-delà qui en dépend. Ce ticket doit
dire où il s'arrête.

## Ce qui prouve que ce front est fini

**Chaque effet dont la géométrie est le sujet porte son outil**, et le geste
tient la **grille de 42 lignes** — dont 11 sont déjà faites en tout ou partie,
et 14 sont suspendues à la question du modèle.

⚠️ Pas « on en a ajouté trois ». Les deux sous-fronts se prouvent séparément, et
le ticket doit déclarer explicitement lesquelles des 42 lignes il vise.
