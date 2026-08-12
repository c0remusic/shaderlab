# Ce qu'est un manipulateur direct de niveau professionnel

Type: research
Status: open
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
