# Éléments et composition — cadrage

> Chantier 3 de `docs/ROADMAP.md`. Écrit le 2026-08-05.
>
> **Ce document ne conçoit rien.** Il établit ce qui est déjà sur disque, isole
> la seule question qui bloque le reste, et sépare ce qui en dépend de ce qui
> n'en dépend pas. Le design des effets vient après l'arbitrage, pas avant.

## 1. Le contenu annoncé du chantier, et son état réel

| Sujet | État mesuré au 2026-08-05 |
| --- | --- |
| textures / scans, light leaks | rien ; du travail d'effet connu |
| formes | rien, **et bloqué par la question §2** |
| typographie | rien, **et bloquée plus durement encore (§3)** |
| finalisation du recadrage | **à moitié fait, et sciemment débranché** |
| extensions du modèle de calque | c'est la question §2 elle-même |

### Le recadrage n'est pas à commencer, il est à FINIR

C'est le seul sujet du bloc qui ait déjà du code, et son état est inhabituel :
la machine à états est complète et **délibérément injoignable**.

- `CropRect` existe (`layers/types.ts:17`), en pixels de la photo source.
- `CanvasMode` porte un mode `crop` complet, avec son `layerId` et son
  `original` pour qu'`Échap` restaure (`ui/canvasMode.ts:25`), et son garde
  structurel contre le mode attaché à un calque disparu
  (`hooks/usePhotoLayer.ts:84`).
- `LayerTransform` **n'a pas de champ `crop`**, et `ui/tools.ts:23` le dit tout
  net : « `crop` est délibérément ABSENT de la palette : `LayerTransform` n'a
  toujours pas de champ `crop` ».

Il manque donc le champ de modèle, la géométrie de rendu, et le branchement de
l'outil. Ce sujet **ne dépend d'aucun arbitrage** — il peut partir seul.

## 2. La question qui bloque : un troisième genre de calque ?

Aujourd'hui `LayerState` connaît **deux** genres, et le second n'a PAS de champ
qui le déclare :

| Genre | Comment il se reconnaît | Où vit son contenu |
| --- | --- | --- |
| calque d'effet | `imageSource` absent | nulle part — il traite ce qui est en dessous |
| calque photo | **présence d'`imageSource`** (`photoLayer.ts:69`) | `PhotoSourceStore` (`render/photoSourceStore.ts:92`), HORS du state React |

Deux choses à retenir de ce tableau, parce qu'elles cadrent tout le reste :

1. **Le genre est déduit d'un champ optionnel, jamais d'un discriminant.** Il n'y
   a pas de `kind: "photo" | "effect"`. Un calque photo est un calque ordinaire
   qui porte `imageSource` — et son `effectId` vaut `passthrough`, l'effet
   volontairement hors registre. **Un calque qui est du CONTENU plutôt qu'un
   traitement existe donc déjà** : c'est le patron, pas une nouveauté.
2. **Le contenu lourd ne vit pas dans `LayerState`.** `imageSource` n'est qu'un
   `{ sourceId }` sérialisable, résolu par un store hors React et hors
   historique. C'est l'invariant anti-OOM du dépôt (crash peinture 24 Mpx,
   `e3c7584`), et il n'est pas négociable pour un nouveau genre.

## 3. Le mur, mesuré : `params` est numérique, et c'est structurel

`LayerState.params` est un `Record<string, number>`. Ce n'est pas une commodité
qu'on pourrait élargir : `types.ts:38` documente pourquoi même une liste de
choix est stockée en INDEX numérique — « l'uniform est `array<f32, N>` et rien
d'autre ne peut franchir cette frontière ».

Conséquence directe, et elle tranche à moitié le débat avant qu'il commence :

- **La typographie a besoin d'une CHAÎNE.** Aucun encodage numérique honnête
  d'un texte saisi ne passe par `array<f32, 48>`. L'option « un effet qui
  synthétise son propre contenu » ne bute donc pas sur le rendu du texte : elle
  bute sur le modèle, avant la première ligne de WGSL.
- **Les formes, elles, passent PARTIELLEMENT.** Un rectangle ou une ellipse
  tiennent en quatre à six flottants. Un tracé à N points, non — `params` est de
  taille fixe, et `MAX_EFFECT_PARAMS` vaut 48 pour tout le registre.

Autrement dit, la réponse peut légitimement différer entre « formes » et
« typographie », et les traiter d'un bloc est le premier piège du chantier.

## 4. Les trois voies

### A — Un troisième genre, sur le patron du second

Un champ optionnel `contentSource?: { contentId }` sur `LayerState`, résolu par
un store dédié hors state React, exactement comme `imageSource` / `PhotoSourceStore`.
Le texte et le tracé vivent dans le store ; `params` ne porte que ce qui est
numérique (taille, rotation, couleur, poids).

- **Pour** : ne réinvente rien, respecte l'invariant anti-OOM par construction,
  et `effectId: "passthrough"` est déjà le vocabulaire d'un calque-contenu.
- **Contre** : c'est le **troisième** « présent ssi » optionnel sur `LayerState`,
  après `imageSource`/`transform` et `clipToBelow`. Chaque consommateur des cinq
  couches doit connaître l'invariant, et rien dans le type ne l'énonce.

### B — Un discriminant explicite

Introduire `kind` sur `LayerState` et convertir les deux genres existants.

- **Pour** : le type dit enfin ce qu'il est ; les invariants « toujours présents
  ensemble » deviennent vérifiables par le compilateur.
- **Contre** : c'est une migration de la couche la plus partagée du projet
  (`render/`, `mask/`, `export/`, `components/`, `application/`) pour un bénéfice
  qui est de la dette remboursée, pas une capacité livrée. À faire un jour ;
  probablement pas le jour où on livre les formes.

### C — Formes en effet, typographie en genre

Les formes simples deviennent un effet qui synthétise (analytique, numérique,
tient dans `params`) ; seule la typographie ouvre le troisième genre.

- **Pour** : la voie la moins chère à court terme, et elle épouse la mesure du §3.
- **Contre** : deux mécanismes pour ce que l'utilisateur voit comme une seule
  famille (« poser un élément sur l'image »), et un plafond dur — un tracé libre
  ou une forme importée ne pourra jamais rejoindre l'effet.

### ✅ TRANCHÉ le 2026-08-05 — voie A

Antoine a retenu **A**. Le patron existe, il est éprouvé, et il est le seul qui
tienne l'invariant anti-OOM sans y penser. Le coût de B est réel mais son
bénéfice ne l'est pas encore ; C achète une tranche au prix d'un plafond.

Ce que ça engage, et qui n'est pas gratuit :

- **`LayerState` gagne un troisième « présent ssi » optionnel**, et rien dans le
  type ne l'énonce. La garde doit donc vivre dans `LayerStack`, unique chemin
  d'écriture — même patron que `setLayerClip` et que le verrou.
- **Formes ET typographie passent par le même mécanisme**, puisque A ne
  distingue pas. Le §3 disait que les formes simples pouvaient s'en passer :
  A choisit de ne pas exploiter cette possibilité, contre un mécanisme unique.
  C'est le prix accepté, à ne pas redécouvrir comme une surprise.
- **Le store de contenu est à écrire** sur le modèle de `PhotoSourceStore`, hors
  state React et hors historique — pas une Map dans un composant.
- ⚠️ **Les presets excluent déjà `imageSource`/`transform`** ; `contentSource`
  suit la même règle et doit être ajouté à cette exclusion, sans quoi un preset
  citerait un `contentId` d'une autre session.

Le design d'effet du bloc peut désormais commencer — c'est ce choix qui le
bloquait.

## 5. Ce qui ne dépend PAS de l'arbitrage

Trois sujets peuvent démarrer sans attendre :

- **le recadrage** (§1) — champ de modèle, géométrie, branchement de l'outil ;
- **textures / scans** — un effet ordinaire à texture d'entrée ; la seule
  question neuve est d'où vient la texture (importée par l'utilisateur, ou
  synthétisée) ;
- **light leaks** — la géométrie posée sur l'image existe déjà, c'est la source
  posée de `lensFlare` et le patron `CanvasControl`.

## 6. La matière première, et ce qui y est déjà périmé

`2026-08-03-references-postproduction.md` (666 lignes) alimente ce chantier. Son
propre « tri à faire » (§ final) porte cinq points, dont **un est désormais
soldé** :

- ✅ point 3, « la famille des COURBES est absente et revient partout » : `curves`
  est au registre depuis le 2026-08-04 (37 paramètres, quatre canaux).
- toujours ouverts : les recettes qui sont des **piles** et non des effets (point
  1) — dont la conclusion était « ce qui manque est souvent un **masque par
  tonalité** », qui n'existe toujours pas ; le doublon à mesurer avant d'écrire
  (point 2) ; ce qui **ne se crée pas** en postproduction et doit être dit plutôt
  que simulé (point 4) ; la géométrie posée sur l'image (point 5).

Le point 1 mérite d'être remonté : **un masque par tonalité n'est pas un effet,
c'est une extension de `LayerMask`** — donc un quatrième sujet de modèle, voisin
de celui du §2 mais distinct, et qui débloquerait à lui seul plusieurs recettes
du cahier sans écrire un seul shader.

## 7. À trancher

1. ✅ **La voie du modèle** — **A**, tranché le 2026-08-05 (§4).
2. **Par quoi on commence** — Antoine a délégué la séquence le 2026-08-05
   (« fais tout dans l'ordre le plus logique »). Ordre retenu : Task 1 du
   chantier 2 (mesure, sans dépendance), checkpoint visuel du bloc 1 groupé avec
   elle puisque l'app tourne déjà, puis le reste du chantier 2, puis le
   recadrage, puis le masque par tonalité, puis formes et typographie.
3. **Le masque par tonalité entre-t-il dans ce bloc**, ou est-ce un chantier à
   lui ? Toujours ouvert. Il ne ressemble à rien d'autre dans la liste, et il est
   le plus rentable en recettes débloquées par ligne de code.
