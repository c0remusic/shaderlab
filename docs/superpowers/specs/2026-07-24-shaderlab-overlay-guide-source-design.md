# Guide de l'overlay de contour = image source, pas le composite

> **Amendement 2026-07-24** : la Décision initiale ci-dessous ne couvrait que
> le calque du bas (premier calque de la pile, seul cas exercé par le spike
> visuel). Revue finale de branche (voir `.superpowers/sdd/`) : pour un calque
> non-premier en édition, le rendu normal de ce calque appelle aussi
> `masks.resolve()` avec `guideEpoch: this.runGeneration`
> ([effectPassRunner.ts:199](../../../src/render/effectPassRunner.ts#L199),
> [framePipelineExecutor.ts:219](../../../src/render/framePipelineExecutor.ts#L219)) —
> un epoch qui CHANGE à chaque frame. L'overlay fixé à `guideEpoch: 0`
> (constant) ne coïncide donc plus JAMAIS avec ce calque non-premier, alors
> qu'AVANT ce chantier les deux appels partageaient la même valeur numérique
> `this.runGeneration` (même si les textures de guide différaient en
> contenu) et ne se invalidaient donc pas mutuellement au sein d'une frame.
> Résultat : le fix initial corrige le calque du bas mais aggrave le calque
> non-premier (double invalidation par frame au lieu d'aucune). Voir
> Décision amendée ci-dessous.

## Contexte

Le contour de seuil animé (`2026-07-23-shaderlab-mask-threshold-contour-design.md`)
appelle `masks.resolve()` une seconde fois par frame pour le calque en édition,
avec `composedTexture` (composite complet post-effets) comme guide du filtre
edge-aware, et `guideEpoch: this.runGeneration` (toujours incrémenté).

Le rendu normal du même calque appelle aussi `masks.resolve()`, avec un guide
différent (image source stable pour le premier calque, composite partiel
sinon) et un epoch qui ne change QUE quand ce guide change réellement.

`MaskTextureResolver` garde une seule entrée `lastGuideEpochByLayer` par
calque ([maskTextureResolver.ts:128](../../../src/render/maskTextureResolver.ts#L128)) —
les deux appels écrivent dans le même slot, donc quand l'overlay est actif
pendant l'édition d'un calque, l'epoch overlay écrase l'epoch du rendu normal
(et vice-versa) à chaque frame → le cache SAT du filtre edge-aware
(chantier Fast Guided Filter, `9741ac0`/`54dd380`) est invalidé en continu,
annulant son gain de perf.

## Décision (amendée)

**Le vrai invariant à préserver n'est pas "l'overlay utilise tel guide fixe"
mais "les deux appels `masks.resolve()` d'un même calque, dans la même frame,
portent le même `guideEpoch` numérique"** — c'est la seule chose que
`MaskTextureResolver` compare pour décider d'invalider
([maskTextureResolver.ts:243-247](../../../src/render/maskTextureResolver.ts#L243)),
pas l'identité de texture. L'overlay doit donc mirroriser exactement la
formule déjà utilisée par la boucle de rendu principale pour CE calque
([framePipelineExecutor.ts:219](../../../src/render/framePipelineExecutor.ts#L219)) :
`index === 0 ? 0 : this.runGeneration`, où `index` est la position du calque
overlay dans `enabledLayers` — pas une valeur fixe.

- **Calque du bas (`index === 0`)** : guide = `sourceTexture`, epoch `0` —
  identique au rendu normal (déjà validé par le spike).
- **Calque non-premier (`index > 0`)** : guide = `composedTexture` (le
  composite complet, approximation du "composite en dessous" réellement
  utilisé par le rendu normal de ce calque — la texture exacte
  intermédiaire n'est pas récupérable après coup, le ping-pong l'a déjà
  écrasée), epoch `this.runGeneration` — même valeur numérique que le rendu
  normal de ce calque pour cette frame, donc aucune invalidation croisée
  entre les deux appels. C'est exactement le comportement d'AVANT ce
  chantier pour ce cas (déjà correct, jamais cassé) — l'amendement ne fait
  que le restaurer en même temps que le fix du calque du bas.
- **Calque overlay absent de `enabledLayers`** (désactivé) : traité comme
  `index === 0` (guide source, epoch 0) — cas dégénéré sans pile en dessous
  à considérer.

**Preuve à l'appui du choix `sourceTexture` pour le cas `index === 0`**
(spike visuel, session brainstorming 2026-07-24, CDP sur l'app en dev) :
comparaison du contour avec guide=composite puis guide=source sur deux
effets poussés à l'extrême (Glow bloom fort, Warp 8% d'amplitude) — aucune
différence visuelle perceptible dans les deux cas. Le filtre edge-aware ne
fait qu'un ajustement local fin (snapping dans un petit rayon autour du
seuil), pas un repositionnement grossier — la position du contour reste
dominée par le masque résident (peinture/luminosité/dégradé), pas par
l'identité du guide.

⚠️ **Limite connue du spike** : le calque overlay y était toujours l'unique
calque de la pile (donc toujours `index === 0` par construction) — le spike
n'a jamais exercé le cas `index > 0` en pratique. La décision pour ce cas
repose sur le raisonnement de cohérence d'epoch ci-dessus (restaurer le
comportement pré-chantier), pas sur une preuve visuelle dédiée. Un
checkpoint visuel humain avec une pile ≥2 calques et l'overlay sur le calque
du dessus reste à faire (voir Testing/Validation).

## Hors scope

- **Cache double par calque** (un `EdgeWork` par guide) — écarté : le spike ne
  montre aucun gain de fidélité visuelle qui justifierait le coût VRAM
  supplémentaire pour les calques avec overlay actif.
- **Réécriture de `2026-07-23-shaderlab-mask-threshold-contour-design.md`** —
  ce doc garde son texte d'origine (relate une décision passée, pas un
  contrat à jour) ; y ajouter un renvoi vers ce doc plutôt que le modifier en
  place.
- **`maskTextureResolver.ts`** — aucun changement : le cache à deux paliers
  fonctionne correctement, c'est l'appelant (`framePipelineExecutor.ts`) qui
  envoyait deux guides incohérents pour le même calque.

## Architecture cible

```
src/render/framePipelineExecutor.ts:230-250
  Branche overlay : calcule overlayIndex = enabledLayers.findIndex(l =>
  l.id === overlayLayer.id) juste avant l'appel masks.resolve(). Si
  overlayIndex <= 0 (premier calque, ou calque overlay désactivé donc
  absent de enabledLayers) : colorView = sourceTexture.createView(),
  guideEpoch = 0. Sinon : colorView = composedTexture.createView(),
  guideEpoch = this.runGeneration — même formule que la boucle principale
  (framePipelineExecutor.ts:219) appliquée à l'index réel du calque
  overlay, plutôt qu'une valeur fixe.
  composedTexture reste inchangé comme cible de runOverlayPass() (le
  compositing visuel de l'overlay ne change pas, seul le guide interne au
  filtre edge-aware change).
```

## Testing

- `framePipelineExecutor.test.ts` : trois cas remplaçant/complétant le test
  existant sur l'appel `masks.resolve` de la branche overlay :
  1. Calque overlay = premier calque (`index === 0`, un seul calque
     activé) : `colorView` = vue de `sourceTexture`, `guideEpoch === 0`.
  2. Calque overlay = second calque d'une pile de deux calques activés
     (`index === 1`) : `colorView` = vue de `composedTexture`,
     `guideEpoch === this.runGeneration` (même valeur que l'epoch passé au
     `runEffectPass` de ce même calque dans la boucle principale — capturer
     les deux appels et comparer les epochs directement plutôt que
     deviner la valeur numérique de `runGeneration`).
  3. Calque overlay désactivé (absent de `enabledLayers`, pile non vide
     par ailleurs) : `colorView` = vue de `sourceTexture`, `guideEpoch === 0`
     — le test existant "captures composedTexture/overlayMaskTexture from
     the ping-pong buffer when the overlay layer is enabled" utilisait déjà
     un seul calque activé = overlayLayer, il continue de couvrir le cas 1
     et peut rester tel quel une fois ses assertions sur `colorView`/
     `guideEpoch` ajoutées.
- Aucun changement de test attendu côté `maskTextureResolver.test.ts`.
- Vérification perf (`.dev-diag`) : édition d'un calque masqué avec overlay
  actif plusieurs secondes sur une image ~24MP — le cache SAT ne doit plus se
  reconstruire à chaque frame (repère : compteur de reconstruction SAT stable
  après la première frame, à instrumenter si absent). À vérifier dans LES
  DEUX configurations : overlay sur le calque du bas ET overlay sur un
  calque au-dessus d'au moins un autre calque activé — c'est ce second cas
  que l'amendement corrige, jamais vérifié par le spike initial.

## Validation

- `npx tsc --noEmit` et `npm run test` verts.
- Nouveau test de garde (ci-dessus) rouge avant le fix, vert après.
- Checkpoint visuel humain (CDP, moyen de preuve déclaré du projet) : contour
  toujours correctement positionné après le changement, sur un calque avec un
  effet fort en dessous.
