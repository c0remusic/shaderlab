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

Genres qui manquent probablement au vocabulaire : rectangle, courbe posée,
poignée d'angle, dégradé posé (deux points + une rampe). ⚠️ À confirmer par
[le ticket 18](18-ce-qu-est-un-manipulateur-de-niveau-pro.md) plutôt qu'à
inventer.

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

## Ce qui prouve que ce front est fini

**Chaque effet dont la géométrie est le sujet porte son outil**, et le geste
tient une **grille de qualité écrite avant d'implémenter** — produite par le
ticket 18, pas improvisée à la fin.

⚠️ Pas « on en a ajouté trois ». Les deux sous-fronts se prouvent séparément.
