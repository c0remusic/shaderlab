# Ce qu'est un manipulateur direct de niveau professionnel

Type: research
Status: resolved
Parent: ../map.md

> Bloque [Les outils sur la toile](17-les-outils-sur-la-toile.md). AFK, ne dépend
> d'aucun autre front, **peut partir tout de suite en parallèle**.

## Question

Antoine juge nos outils posés sur la toile « bâclés, pas du niveau de
Photoshop ». C'est un jugement juste et inexploitable tel quel : on ne peut pas
implémenter « mieux ». **Il faut la grille.**

Établir, en sources primaires, ce qui compose un manipulateur direct
professionnel — pour que le ticket 17 dispose d'une liste vérifiable **avant**
d'écrire une ligne, et non d'une impression à la fin.

## Deux questions distinctes, à ne pas fondre

### A — Le vocabulaire de genres

Nous en avons **trois** : `point`, `disk`, `axis`. Quels genres de
manipulateurs Photoshop, Lightroom et Camera Raw exposent-ils réellement sur
l'image ? Nommer chacun, dire ce qu'il pilote, et **ce qu'il rend possible
qu'un curseur ne rend pas**.

Candidats à confirmer ou infirmer, pas à supposer : rectangle à poignées,
courbe posée, poignée d'angle, dégradé posé (deux points + rampe), masque
radial, pinceau de correction locale.

### B — L'anatomie du geste

Pour un manipulateur donné, ce que le produit fait pendant qu'on le tire :

- **accroche** — à quoi, avec quelle tolérance, et comment on la désactive ;
- **modificateurs** — Maj, Alt, Ctrl et leurs combinaisons, avec leur sens
  documenté (Adobe le publie) ;
- **retour visuel** — valeur pendant le geste, prévisualisation, changement de
  curseur, survol de poignée ;
- **cibles** — taille des poignées, zone de saisie, ce qui se passe quand deux
  poignées se recouvrent ;
- **annulation** — Échap en cours de geste, granularité de l'historique.

## Ce qui rendrait cette recherche inutilisable

- Une liste de fonctionnalités sans le **mécanisme**. « Photoshop a un masque
  radial » n'aide pas ; « le masque radial expose quatre poignées de rayon plus
  une de rotation, Alt agit depuis le centre » aide.
- Des affirmations sans source. Une par affirmation, et ce qui n'est pas
  documenté se marque `non vérifié` plutôt que de se combler.

## Pièges de méthode, mesurés dans ce dépôt le 2026-08-11

- ⚠️ **`helpx.adobe.com` bloque les clients HTTP non-navigateur.** WebFetch et
  `curl` restent à 0 octet sur toute page de contenu. Passer par un vrai
  navigateur qui rend la page, puis extraire le DOM.
- ⚠️ **Le résumeur de recherche fabrique.** Deux faussetés vérifiables lors de
  la passe précédente, dont une inversion pure et simple de ce qu'Adobe écrit.
  Vérifier toute affirmation sur la page elle-même.
- ⚠️ **Adobe a réécrit une grande partie du guide Photoshop le 2026-02-23**, en
  remplaçant le mécanisme par des chemins de clic. La prose de mécanisme survit
  parfois sur les pages de référence plus anciennes.
- ⚠️ **Ne jamais inférer un comportement d'animation ou de transition depuis une
  capture fixe.** Règle permanente ici, née d'une erreur réelle.

## Ce que nous avons déjà, à ne pas redécouvrir

Lire avant de chercher dehors : `src/render/effects/types.ts` (l'union
`CanvasControl`, `visibleWhen`), `src/ui/transform.ts` (géométrie pure,
poignées, `clampTransformScale`), et les quatre effets qui en portent
(`lensFlare`, `lightLeak`, `motionBlur`, `pixelStretch`). Le dépôt a déjà des
modificateurs (Maj = pas large sur les cinq manipulateurs, Maj/Alt/Ctrl pendant
un drag de transformation) et un alignement d'overlay mesuré **sous 0,02 px** —
donc le socle existe et il est inégal, ce n'est pas un départ de zéro.

`.scratch/prochain-palier/research/09-lisibilite-photoshop-lightroom.md` a déjà
couvert la lisibilité des PANNEAUX ; il ne couvre pas la manipulation directe.
Le lire pour ne pas doublonner.

## Livrable

Un Markdown cité dans `.scratch/prochain-palier/research/`, en deux parties (A
et B), avec pour chaque élément : le mécanisme, sa source, et **où il
s'appliquerait chez nous** (fichier réel). Il n'arbitre rien — il fournit la
grille que le ticket 17 utilisera comme critère de sortie.

## Answer

Résolu le 2026-08-12. Findings :
[`research/18-manipulateurs-directs.md`](../research/18-manipulateurs-directs.md)
— deux passes de navigateur indépendantes, qui se recoupent sur le Filtre
radial. **42 lignes de grille** au total.

### A — 17 genres recensés, dont plusieurs qu'on n'aurait pas devinés

Les plus instructifs, parce qu'ils décrivent un mécanisme et pas une
fonctionnalité : l'**épingle composable** (elle porte sa propre valeur, se pose
hors cadre, a une profondeur) ; l'**anneau de valeur révélé au survol** ;
l'**ellipse à quatre poignées dont la rotation se prend sur le BORD, sans
poignée dédiée** ; les **trois zones concentriques** où le fondu EST l'écart
entre deux anneaux ; le **dégradé Photoshop où l'on CRÉE une poignée en cliquant
la géométrie et où on la SUPPRIME en l'éloignant** ; le **maillage à politique
de guides** (Auto / Toujours / Jamais) ; la **validité encodée par la couleur**.

⚠️ **Un candidat de ce ticket est INFIRMÉ** : la « poignée d'angle » des *live
shapes* n'existe pas — c'est un champ de la barre d'options. Bien vu de
l'avoir demandé à confirmer plutôt que de l'inventer ; il serait entré dans le
vocabulaire sans raison.

### B — L'anatomie du geste, et trois pièges contre l'intuition

25 lignes. Les plus structurantes : **sept rôles de modificateur et non trois
touches** ; **dissocier les deux termes d'un geste** (longueur OU angle) ;
**suspendre le geste par Espace sans lâcher le bouton** ; un curseur qui change
au survol, dont Adobe décrit la forme manipulateur par manipulateur ; un état
lisible par couleur **et** forme **et** validité ; **cycler entre cibles
superposées plutôt que viser** ; six chemins de commit ; cible ≥ 24×24 px CSS.

Trois pièges mesurés, tous contraires à ce qu'on aurait supposé :

- **L'accroche d'angle n'est pas un seul nombre** — 15° en rotation, **45°** sur
  un point de chemin, avec la même touche.
- **`Maj` dans Photoshop depuis 2019 n'a pas de sens fixe** : c'est une bascule
  d'un état **persistant**, invisible dans le geste lui-même.
- La croyance « Photoshop masque ses poignées sur une petite sélection » n'est
  confirmée par **aucune** page — marquée « ne pas asserter ».

### Ce que nous avons déjà, et qui est au niveau

**11 lignes sur 42 sont faites en tout ou partie** : seuil d'accroche en pixels
ÉCRAN, accroche vers une valeur remarquable en tolérance relative, `Ctrl` comme
échappatoire (la même touche qu'Adobe), pas d'accroche au clavier, cadre en deux
traits pour se lire sur toute photo, curseurs différenciés par axe, forme de
poignée qui annonce l'axe, un geste = une entrée d'historique, `pointercancel`
qui n'engage pas.

### Le socle est inégal, et l'écart est chiffré

| Constat | Vérifié |
| --- | --- |
| **Zéro règle `:hover`** dans les quatre CSS d'overlay | ✅ mesuré : `AxisHandles`, `PointHandles`, `RegionHandles`, `TransformHandles` = 0 chacun |
| **Poignées de 12 px** pour 24 recommandés | ✅ `--slider-thumb-size: 12px` (`design/components.css:58`) |
| `src/ui/snap.ts` calcule déjà la géométrie qu'il faudrait | ✅ existe, `SNAP_THRESHOLD_SCREEN_PX = 8`, `SnapGuide`, `boundingBox` |
| Aucune valeur de paramètre affichée pendant le geste | rapporté (le retour chiffré existe, mais c'est la **distance aux voisins**, pas la valeur) |
| L'origine d'un `axis` est clouée au centre | rapporté — d'où, dans `lightLeak`, une « Entrée de la lumière » et un « Trajet » sans **aucun lien géométrique** |
| Deux poignées sur cinq sautent sous le curseur ; aucun magnétisme hors `TransformHandles` | rapporté |

⚠️ **Détail que la recherche ne relève pas et qui compte** : les poignées de
toile réutilisent `--slider-thumb-size`, le token du **pouce de curseur**. Une
poignée de manipulateur n'est pas un pouce de slider — les coupler veut dire
qu'on ne peut pas agrandir l'une sans déformer l'autre. À découpler avant toute
mise à la cible de 24 px.

### ⚠️ L'observation de forme, qui dépasse ce front

**14 des 42 lignes supposent qu'un manipulateur soit un OBJET** — sélectionnable,
duplicable, supprimable, à cardinalité variable — là où le nôtre est une
projection de paramètres nommés sur un `Record<string, number>`.

**C'est exactement le même mur que la typographie et les formes** (voir
[Une forme a-t-elle besoin de contentSource](03-une-forme-a-t-elle-besoin-de-contentsource.md)
et [La typographie entre-t-elle dans ce palier](04-la-typographie-entre-t-elle-dans-ce-palier.md)) :
`params` ne sait nommer qu'un nombre, jamais une collection d'objets. Le lien
n'était pas prévu, et il change l'ordre de la carte — une réponse à la question
du modèle déciderait aussi du plafond de ce front.

**Les 28 autres lignes ne demandent pas ce changement.** Il y a donc un palier
atteignable sans toucher au modèle, et un au-delà qui en dépend.

### Trous déclarés, non comblés

Animation et transition (aucune source), tolérance d'accroche et taille de
poignée d'Adobe (jamais publiées), repli d'un glissement en une entrée
d'historique. ⚠️ Et une note de conservation : **la référence de raccourcis
Photoshop a été SUPPRIMÉE du site d'Adobe** ; §Méthode du document liste les dix
pages survivantes en style ancien, à archiver si le ticket 17 doit s'y appuyer
dans six mois.
