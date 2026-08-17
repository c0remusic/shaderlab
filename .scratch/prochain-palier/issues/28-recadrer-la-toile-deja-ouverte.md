# Recadrer la toile déjà ouverte

Type: grilling
Status: open
Parent: ../map.md

## Question

Ouvert le 2026-08-18, par l'arbitrage d'Antoine sur le
[ticket 05](05-ce-qui-reste-du-design-de-parite-du-calque-photo.md) : **les deux
recadrages sont demandés, et ce sont des gestes distincts.** Rogner un CALQUE
photo est spécifié par le design de parité §3.1 et sort de ce ticket-ci.
Recadrer la TOILE ne l'est nulle part.

**Quand la toile d'un document ouvert change de format, que deviennent les
rasters de masque déjà peints ?**

## Ce qui est déjà tranché, et qu'il ne faut pas rouvrir

**Ce geste n'est pas un oubli — il est DIFFÉRÉ avec son déclencheur nommé**, et
le déclencheur vient d'être tiré. Design montage du 2026-07-29 §9 :

> **Redimensionner / recadrer une toile déjà ouverte.** C'est la seule partie du
> chantier qui casse les masques peints (§4.1) et qui oblige à reconstruire les
> ressources GPU du document (§4.2). **Déclencheur** : Antoine commence un
> montage puis demande à en changer le format sans repartir de zéro. Le jour où
> ça arrive, la première décision à prendre n'est pas technique : c'est le sort
> des masques déjà peints (invalider / recadrer / rééchantillonner).

ADR-0007 (`format de toile à la création`) **ne s'y oppose pas** : il le met
explicitement hors de sa propre portée — « Ce qui n'est PAS en jeu ici :
redimensionner une toile **déjà ouverte**. […] La décision ci-dessous ne
concerne que l'instant où aucun raster de masque n'existe encore. » L'ADR n'a
donc pas à être amendé ; il a à être COMPLÉTÉ.

Écarté aussi, et à ne pas ressusciter (design montage §10.3) : faire dériver la
taille de toile de l'enveloppe des calques — la toile changerait de taille à
chaque déplacement d'image, invalidant les masques à chaque geste.

## Ce que la mesure du 2026-08-18 confirme, et aggrave

Le design classait §4.1 **CRITIQUE**. Vérifié sur disque, c'est pire que ce
qu'il décrit :

- `MaskPainter` alloue aux dimensions reçues en constructeur
  (`src/mask/maskPainter.ts:81-82`), et `App.tsx` lui passe `imageSize`
  (`src/App.tsx:152`, `:744`) — c'est-à-dire la taille du DOCUMENT.
- **`maskPainterSync.ts` ne contient pas une seule occurrence de `width` ou
  `height`.** Le cache retrouve son peintre par `entries.get(layerId)`
  (`:49`) et ne revalide donc JAMAIS ses dimensions — pas « rarement »,
  jamais. Une toile qui bouge laisserait un peintre à l'ancienne taille peindre
  dans un document à la nouvelle, **en silence**.
- Corollaire déjà écrit ailleurs et qui devient faux le même jour :
  `LayerStack.setLayerImageSource` justifie de ne pas toucher au masque
  **précisément parce que « la toile ne bouge pas »**
  (`src/layers/layerStack.ts`, en-tête de la méthode).

Le design le pose sans détour : **aucune des trois issues n'est gratuite, et le
silence est le seul résultat inacceptable.**

## Ce qu'il faut interroger

- **Les trois issues, et leur prix.** *Invalider* (les masques peints sont
  effacés, avertissement obligatoire) · *recadrer* (le raster est découpé au
  même rectangle : les pixels dedans restent alignés au pixel près, ceux dehors
  sont perdus — c'est ce que fait Photoshop) · *rééchantillonner* (remapper à la
  nouvelle taille — a du sens pour un REDIMENSIONNEMENT, probablement faux pour
  un recadrage, où il déformerait un masque qui n'a pas bougé).
- **Le recadrage de toile est-il DESTRUCTIF ?** Photoshop pose la question par
  une case (« Supprimer les pixels rognés »). Tout le projet est non destructif
  (masques non destructifs, effets empilables, undo en session) — mais un
  recadrage non destructif veut dire que les calques gardent leur contenu hors
  cadre, ce qui interdit de découper les rasters de masque. **Les deux questions
  ci-dessus sont donc liées, et se tranchent ensemble.**
- **Le geste est-il annulable ?** `History.push` snapshotte la pile. Si le
  recadrage découpe des rasters, l'undo doit les rendre — donc les anciens
  rasters vivent dans l'historique, et le budget mémoire d'un recadrage n'est
  pas nul. Mesurer avant de promettre.
- **Que devient le format de toile choisi à la création ?** ADR-0007 dérive
  carré / 4:5 / A3 par CONTENANCE. Un recadrage produit un format quelconque :
  le document garde-t-il la mémoire de son format d'origine, ou le perd-il ?

## Contraintes dures

- **§4.2 (HAUTE)** : les ressources GPU dimensionnées au document ne sont
  construites qu'à `loadImage`. Recadrer demande de les reconstruire hors de ce
  chemin.
- **§4.3 (HAUTE)** : `imageSize` (React) et `ImageFrameResources.width/height`
  (GPU) sont deux sources séparées que rien ne réconcilie. Un recadrage les fait
  diverger par construction.
- **Contrainte permanente de la carte** : ne rien rendre plus cher pour le
  16-bit. Un recadrage ne choisit aucun format de texture couleur — il change
  des DIMENSIONS. Il n'ajoute donc aucun site à la facture, à condition que la
  reconstruction des ressources continue de recevoir `srgbFormat` par injection
  (voir [ticket 02](02-cout-d-attendre-le-16-bit.md)).

## Ce que ce ticket ne tranche PAS

Le rognage d'un CALQUE photo — c'est le design de parité §3.1, résolu par le
[ticket 05](05-ce-qui-reste-du-design-de-parite-du-calque-photo.md). Les deux
gestes ne se bloquent pas l'un l'autre.

Ni le plan d'exécution. Ce ticket produit la décision sur le sort des masques ;
le plan s'écrit après, et avant la première ligne (le geste touche la couche la
plus partagée du projet).
