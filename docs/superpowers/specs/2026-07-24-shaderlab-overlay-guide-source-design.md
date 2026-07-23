# Guide de l'overlay de contour = image source, pas le composite

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

## Décision

Le guide de l'overlay passe de `composedTexture` à `sourceTexture`, avec
`guideEpoch: 0` — même guide et même epoch que le rendu normal du premier
calque de la pile. Un seul appel `masks.resolve()` par calque partage
désormais un guide de statut cohérent, quel que soit l'appelant.

**Preuve à l'appui** (spike visuel, session brainstorming 2026-07-24, CDP sur
l'app en dev) : comparaison du contour avec guide=composite puis guide=source
sur deux effets poussés à l'extrême (Glow bloom fort, Warp 8% d'amplitude) —
aucune différence visuelle perceptible dans les deux cas. Le filtre edge-aware
ne fait qu'un ajustement local fin (snapping dans un petit rayon autour du
seuil), pas un repositionnement grossier — la position du contour reste
dominée par le masque résident (peinture/luminosité/dégradé), pas par
l'identité du guide.

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
  Branche overlay : masks.resolve(overlayLayer, encoder,
  sourceTexture.createView(), pendingDestroy, 0) — au lieu de
  composedTexture.createView() / this.runGeneration.
  composedTexture reste inchangé comme cible de runOverlayPass() (le
  compositing visuel de l'overlay ne change pas, seul le guide interne au
  filtre edge-aware change).
```

## Testing

- `framePipelineExecutor.test.ts` : nouveau cas qui capture les arguments de
  l'appel `masks.resolve` déclenché par la branche overlay et vérifie
  `colorView` = vue de `sourceTexture` (pas `composedTexture`) et
  `guideEpoch === 0`. Le test existant
  ("captures composedTexture/overlayMaskTexture from the ping-pong buffer...")
  ne vérifiait pas ces deux arguments — c'est le trou qui a laissé passer la
  régression de cache.
- Aucun changement de test attendu côté `maskTextureResolver.test.ts`.
- Vérification perf (`.dev-diag`) : édition d'un calque masqué avec overlay
  actif plusieurs secondes sur une image ~24MP — le cache SAT ne doit plus se
  reconstruire à chaque frame (repère : compteur de reconstruction SAT stable
  après la première frame, à instrumenter si absent).

## Validation

- `npx tsc --noEmit` et `npm run test` verts.
- Nouveau test de garde (ci-dessus) rouge avant le fix, vert après.
- Checkpoint visuel humain (CDP, moyen de preuve déclaré du projet) : contour
  toujours correctement positionné après le changement, sur un calque avec un
  effet fort en dessous.
