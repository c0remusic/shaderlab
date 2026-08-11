# Une forme a-t-elle besoin de contentSource

Type: grilling
Status: open
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
