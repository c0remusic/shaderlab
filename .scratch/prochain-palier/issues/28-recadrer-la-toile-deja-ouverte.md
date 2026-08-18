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

---

## Mesure du 2026-08-18 — « le sort des masques » est TROIS questions, pas une

Travail AFK, avant toute question. Rien n'est tranché : le ticket reste
`grilling`. Mais l'énoncé parle des « rasters de masque » comme d'un bloc, et
le modèle en distingue trois natures dont **une seule** porte des pixels.

### Seules les sources PINCEAU ont un raster

`src/mask/types.ts` : `raster: Uint8Array` n'existe que sur `BrushMaskSource`.
Les trois sources paramétriques portent `raster: null` — leur contribution est
calculée dans le shader à chaque frame. D'où trois sorts, et ils ne se
ressemblent pas :

| Nature | Ce qu'elle stocke | Sort sous un recadrage de toile |
| --- | --- | --- |
| `brush` | un `Uint8Array` de W×H | **le seul vrai sujet** — à découper, invalider ou perdre |
| `gradient` | quatre flottants en **UV** | **casse en SILENCE**, sans coûter un octet |
| `luminosity`, `colorRange` | rien de géométrique | **survivent intactes, gratuitement** |

**Deux tiers des sources de masque ne sont pas concernées par la question du
ticket**, et la troisième l'est d'une façon qu'il ne décrit pas.

### ⚠️ Le dégradé casse sans qu'on le voie, et ce n'est PAS un choix

Ses points sont en UV de la toile (`params[0..3] = startX/startY/endX/endY`,
`gradient.ts`). Recadrer la toile remappe donc l'UV : **le dégradé glisse par
rapport à la photo**, alors que rien ne l'a déplacé.

Pire pour le radial : son commentaire dit qu'il est « CIRCULAIRE SUR LA TOILE,
pas dans l'espace UV » et corrige par l'aspect de la toile — que le recadrage
change. Son rayon relatif à la photo bouge donc aussi.

**Ce n'est pas une des trois issues à arbitrer : c'est de l'arithmétique.** Les
quatre flottants se remappent exactement, sans perte et sans décision — comme
`recenterForCrop` le fait pour le transform d'un calque photo (ticket 05). À
faire, pas à trancher. Mais **rien ne le signale aujourd'hui**, et c'est le
genre de défaut que la session d'hier a payé deux fois : ça compile, ça rend, et
le masque n'est simplement plus au bon endroit.

### Le chiffre du raster pinceau, et pourquoi l'undo décide

- **1 octet par pixel de DOCUMENT** (`new Uint8Array(width * height)`,
  `maskPainter.ts:81-84`) — soit **~26 Mo** par raster sur une photo 26 Mpx, et
  **64 Mo** au plafond `MAX_CANVAS_PIXELS`.
- L'historique est borné à **512 Mo** par document
  (`DEFAULT_BUDGET_BYTES`, `history.ts:3`) et **refcompte chaque buffer
  UNIQUE** : aujourd'hui `clone()` PARTAGE les références, donc dix entrées
  d'historique qui portent le même masque coûtent **un** raster, pas dix.

**C'est cette économie que le recadrage casse.** Découper les rasters les
REMPLACE : les anciens restent retenus par les entrées passées (sinon l'undo ne
rend rien), les nouveaux s'ajoutent. Un recadrage annulable coûte donc
`surface_conservée × total_actuel` en plus, et rien n'est libérable tant que
l'undo est possible.

Ordre de grandeur, à 26 Mpx et quatre traits de pinceau dans la pile : 104 Mo
retenus aujourd'hui ; un recadrage à la moitié de la surface porte le total à
**156 Mo sur les 512**. Tenable. Au plafond de 64 Mpx, **huit rasters suffisent
à saturer le budget avant tout recadrage** — le geste n'y est pas annulable, ou
alors il évince les entrées les plus anciennes.

### Ce que la mesure retire de la question, et ce qu'elle y laisse

Le design montage propose trois issues — invalider / recadrer / rééchantillonner.
**La troisième n'en est pas une** : rééchantillonner a un sens pour un
REDIMENSIONNEMENT (la toile change d'échelle) et aucun pour un RECADRAGE, où
les pixels conservés n'ont pas bougé d'un texel. La proposer reviendrait à
déformer un masque que personne n'a touché.

Il reste donc **deux** issues pour le pinceau — découper ou invalider — et la
mesure ci-dessus dit que découper est **le seul qui préserve l'alignement au
pixel**, au prix d'une empreinte d'historique bornée mais réelle.

**La vraie question qui subsiste, et elle n'est pas dans la liste d'origine** :
le recadrage est-il DESTRUCTIF ? S'il ne l'est pas — si les calques gardent leur
contenu hors cadre, comme le reste du projet — alors **il ne faut pas découper
les rasters du tout** : on change le cadre, pas les données, et l'empreinte
d'historique tombe à zéro. C'est cette question-là qui gouverne les autres, et
c'est celle qu'il faut poser en premier.
