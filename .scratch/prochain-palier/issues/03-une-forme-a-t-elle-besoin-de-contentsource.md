# Une forme a-t-elle besoin de contentSource

Type: grilling
Status: resolved
Blocked by: 23
Parent: ../map.md

## Question

`docs/ROADMAP.md` déclare la voie du modèle tranchée le 2026-08-05 : **voie A**,
un champ optionnel `contentSource?: { contentId }` sur `LayerState`, résolu par
un store hors du state React, sur le patron `imageSource` / `PhotoSourceStore`.
Il ajoute : « Il n'y a plus d'arbitrage ouvert ici. »

**Le même jour, ADR-0018 a fait exactement le contraire pour les textures** — et
il a renversé la décision D1 du design du même jour, sur trois relances
d'objection d'Antoine. Le mur invoqué était identique (`params` est un
`Record<string, number>`, uniform `array<f32, 48>`, donc un effet n'a aucun
champ par lequel désigner une image) et l'ADR l'a contourné sans toucher
`LayerState` : **le paramètre porte le RANG** dans un catalogue trié, **le
binding 7 porte les pixels**. `EffectModule.libraryTexture` est déclaré
GÉNÉRIQUE.

Le ROADMAP le concède lui-même : « Les formes simples tiennent en quatre à six
flottants et passent **partiellement**. » C'est ce « partiellement » qu'il faut
crever.

**Une forme a-t-elle réellement besoin d'un troisième genre de calque, ou est-ce
un effet ordinaire à six flottants ?**

## Ce qu'il faut interroger

- **Quelles formes, exactement ?** Rectangle, ellipse, polygone régulier,
  trait, flèche, forme libre ? Chacune a un coût en flottants différent, et la
  réponse peut changer entre elles. Le cahier de postproduction parle
  d'« aplats colorés », de « masque dur », d'« ombre graphique en perspective ».
  Une ombre en perspective n'est pas un rectangle.
- **Une forme est-elle du CONTENU ou un TRAITEMENT ?** Un calque photo est déjà
  un calque ordinaire portant `imageSource` avec `effectId: passthrough` — le
  deuxième genre n'a donc aucun discriminant. Un troisième genre est-il une
  invention, ou la reconnaissance de ce qui existe déjà ?
- **ADR-0008** interdit un `effectId` SUR un calque photo, pas un calque
  d'effet écrêté au-dessus. Ce n'est donc PAS un argument contre la voie
  « effet » — l'erreur a déjà été commise une fois, en présentant ADR-0008
  comme écartant l'option ; ADR-0018 la corrige explicitement. Ne pas la
  refaire.
- **`CanvasControl` et le gabarit de section `pose`** existent déjà et posent
  une géométrie sur l'image. Une forme est-elle autre chose qu'un
  `CanvasControl` dont le résultat est peint au lieu de piloter un curseur ?
- **Le coût de se tromper n'est pas symétrique.** `LayerState` est consommé par
  cinq couches ; un effet de plus est un fichier de plus. Si les deux voies
  marchent, ce n'est pas un match nul.

## Contraintes dures

- L'index d'un paramètre est **persisté dans les presets** : `params[]` ne se
  réordonne jamais.
- `MAX_EFFECT_PARAMS` vaut **48** depuis le 2026-08-04 (élargi de 32 pour
  `curves`). Une forme à six flottants y tient largement ; une forme libre à
  N points, non.
- `libraryTexture` + passes internes est **refusé** par `validateEffect` — le
  binding n'est résolu que pour la passe finale.

## Ce que ce ticket ne tranche PAS

Le rendu (anticrénelage, primitives, WGSL). C'est du brouillard tant que le
modèle n'est pas fixé — il est noté dans **Not yet specified** de la carte et
graduera après.

## Answer

**Non — et la question était mal posée, par ce ticket comme par le document
dont il l'a héritée.**

Arbitrage d'Antoine, 2026-08-17, devant le prototype du
[ticket 23](23-a-quoi-ressemble-une-forme-dans-shaderlab.md) : « mais c'était
pour les masques et la sélection non ? pas pour un effet ».

Une forme n'est **ni un troisième genre de calque, ni un effet**. C'est une
manière de **SÉLECTIONNER une région**. La voie A n'est donc pas nécessaire pour
les formes, et `contentSource` n'a plus de justification de ce côté — il faudra
la rechercher du côté de la typographie seule
([ticket 04](04-la-typographie-entre-t-elle-dans-ce-palier.md)), qui reste le cas
dur.

### Ce que la mesure dit du recadrage, et il coupe dans les deux sens

**Les documents disaient le contraire d'Antoine.** Le cadrage du 2026-08-05
(`docs/superpowers/specs/2026-08-05-elements-et-composition-cadrage.md`) traite
« formes » exclusivement comme du CONTENU à poser — « poser un élément sur
l'image », rangé avec la typographie, et c'est ce cadrage qui a produit les
voies A/B/C puis l'arbitrage A. Le mot « sélection » n'y apparaît pas une fois.

**Le code lui donne raison.** `src/mask/sources/types.ts:2` :

```ts
id: "gradient" | "luminosity" | "colorRange";
```

Union **fermée**. Trois sources paramétriques plus le pinceau, et **aucune source
géométrique** — pas de rectangle, pas d'ellipse, aucun équivalent du marquee ou
du lasso que tout éditeur porte. Trou franc, signalé par aucun document du dépôt.

⚠️ **La leçon de méthode est celle que l'en-tête de ce ticket mettait déjà en
garde de ne pas refaire, et il l'a refaite quand même** : il a hérité du cadrage
d'un document sans interroger le mot le plus chargé de son titre. Toute la
discussion voie A / voie C portait sur « où vit le CONTENU d'une forme », alors
que la question d'Antoine était « avec quoi je sélectionne une région ». Un
arbitrage rendu sur la mauvaise question reste faux même quand il est bien
argumenté.

### Ce que ça ouvre, et qui dépasse cette carte

Antoine ne s'arrête pas à la primitive : ce qu'il veut est une vraie
**SÉLECTION** — détourer à la main, tracer une silhouette, combiner des régions
(ajouter, soustraire). Ça dépasse les six flottants d'un rectangle, et le sujet
devient l'OUTIL de sélection, pas la forme.

C'est un effort à part entière, à charter sur sa propre carte. Il sort donc du
périmètre de celle-ci — voir sa section **Out of scope**.
