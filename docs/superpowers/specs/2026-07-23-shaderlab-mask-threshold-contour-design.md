# Contour de seuil animé sur l'overlay de masque

> **Mise à jour 2026-07-24** : le guide du filtre edge-aware pour ce contour
> n'est plus `composedTexture` mais `sourceTexture` — voir
> [2026-07-24-shaderlab-overlay-guide-source-design.md](2026-07-24-shaderlab-overlay-guide-source-design.md).
> Ce document garde son texte d'origine pour l'historique de la décision
> initiale, périmée sur ce point précis.

## Objectif

Le masque (dégradé/luminosité/range couleur/pinceau, combinés) est
volontairement continu, jamais binaire (`prd.md` 2026-07-18, lignes 79-81 :
« un curseur de tolérance/dureté génère un masque continu (pas binaire) »).
Ce modèle ne donne aujourd'hui aucun repère visuel « dedans/dehors » —
l'overlay rouge existant (safelight) montre l'intensité par transparence,
mais rien n'indique où la sélection bascule. Objectif : ajouter un contour
animé au seuil 50 % de la valeur du masque combiné, par-dessus l'overlay
existant, sans changer le modèle de masquage sous-jacent.

## Décisions

- **Déclencheur élargi** : le contour ET le rouge safelight s'affichent dès
  qu'un calque sélectionné a un masque actif (`layer.mask.enabled` et au
  moins une source), pas seulement en mode peinture comme aujourd'hui
  ([App.tsx:171](../../../src/App.tsx#L171)). Ce périmètre couvre
  l'édition des sources dégradé/luminosité/range couleur, qui ne passe
  jamais par le mode peinture — c'est le cas qui donnait l'impression
  qu'une source active « ne fait rien ».
- **Contour, pas seuil binaire caché** : le masque réel reste continu ; le
  contour est un repère visuel superposé, tracé par dérivée d'écran
  (`fwidth(m - 0.5)`) dans le pass d'overlay existant — pas de tracé
  d'isoligne côté CPU (marching squares), pas de nouvelle passe GPU
  séparée.
- **Animation découplée du pipeline lourd** : les pointillés avancent via
  un `time` uniform sur le pass d'overlay seul, jamais en relançant le
  fold du masque ni les effets. Justifié par la sensibilité perf/VRAM déjà
  documentée du projet à 24MP (crash historique, voir bandeau `CLAUDE.md`),
  pas par une hypothèse sur l'implémentation de Photoshop (non vérifiable,
  écartée comme justification).
- **Texture composée exposée** : `FramePipelineExecutor.run()` ne retourne
  aujourd'hui que `{enabledLayerCount, churnedResourceCount}`
  ([framePipelineExecutor.ts:51-54](../../../src/render/framePipelineExecutor.ts#L51)) ;
  la texture pré-overlay (`pingPong[writeIndex]`) est calculée puis jetée.
  `FramePipelineResult` gagne deux champs — `composedTexture: GPUTexture | null`
  (texture pré-overlay) et `overlayMaskTexture: GPUTexture | null` (texture
  de masque déjà résolue par `masks.resolve()` pour ce rendu) — tous deux
  `null` si aucun `overlayLayer`. C'est la seule source de vérité pour la
  boucle d'animation, qui ne devine jamais quel buffer est le bon et ne
  rappelle **jamais** `masks.resolve()` elle-même (voir plus bas pourquoi).
- **`resolve()` n'est PAS un cache de résultat, seulement de pipelines
  compilés** : vérifié sur pièce
  ([maskTextureResolver.ts:139-174](../../../src/render/maskTextureResolver.ts#L139)) —
  pour un calque à une seule source, `resolve()` ré-exécute `resident()` +
  `edge()` (edge-aware/guided filter, l'opération la plus coûteuse de la
  Tranche 3) + `refine()` à CHAQUE appel, sans court-circuit ; pour
  plusieurs sources, seul le fold est mis en cache (`foldInputsEqual`),
  `edge()`/`refine()` tournent quand même à chaque appel. Rappeler
  `resolve()` à chaque tick d'animation romprait tout l'objectif de
  découplage. `refine()` écrit dans `refineEdgePingPongByLayer`, une map
  de textures possédée par la classe (pas détruite après submit, même
  pattern que `pingPong`) — la texture retournée reste donc valide et
  réutilisable tant qu'un nouveau `resolve()` n'est pas déclenché par un
  vrai rendu complet.
- **Deux boucles rAF coexistent, assumé** : les rendus normaux (slider,
  pinceau) passent déjà par un `FrameScheduler` coalescé
  ([renderer.ts:166-171](../../../src/render/renderer.ts#L166)). La
  boucle d'animation du contour est un second rAF indépendant. Les deux
  peuvent se déclencher sur la même frame visuelle dans de rares cas
  (double submit GPU ce tick-là) — sans incorrection fonctionnelle, juste
  un gaspillage occasionnel négligeable. Unifier les deux schedulers est
  un coût d'ingénierie disproportionné pour ce bénéfice ; non fait.

## Architecture cible (module map)

```
src/render/effectPassRunner.ts
  MASK_OVERLAY_WGSL étendu : uniform `time`, calcul du contour via fwidth,
  alternance noir/blanc le long du contour. runOverlayPass() prend un
  paramètre time en plus.

src/render/framePipelineExecutor.ts
  FramePipelineResult gagne composedTexture: GPUTexture | null et
  overlayMaskTexture: GPUTexture | null. run() les renseigne avec
  pingPong[writeIndex] et la texture retournée par masks.resolve() quand
  overlayLayer existe.

src/render/renderer.ts
  Stocke les deux textures retournées par runPipeline() dans un champ privé
  (lastOverlayFrame). Nouvelle méthode tickOverlayAnimation(timeMs) :
  relit lastOverlayFrame (composedTexture + overlayMaskTexture, JAMAIS de
  nouvel appel à masks.resolve()), réexécute uniquement runOverlayPass avec
  le time courant vers le canvas. No-op si lastOverlayFrame est null (pas
  d'overlay actif).

src/render/overlayAnimationLoop.ts (nouveau, interface étroite)
  start(cb: (timeMs: number) => void): void
  stop(): void
  rAF/cancelAnimationFrame injectables au constructeur (même pattern que
  frameScheduler.ts, testable en env Node sans rAF global).

src/App.tsx
  Condition d'affichage élargie (calque sélectionné + masque actif, pas
  seulement maskPaintMode). Possède l'instance OverlayAnimationLoop,
  start/stop selon cette condition (useEffect, cleanup symétrique).
```

Les modules de rendu (`effectPassRunner`, `framePipelineExecutor`,
`renderer`) ne connaissent ni React ni l'état UI — ils exposent une
interface étroite (`composedTexture`, `tickOverlayAnimation`) consommée
par `App.tsx`, qui seul décide quand la boucle tourne. `overlayAnimationLoop.ts`
ne connaît ni le rendu ni le masquage — une boucle temporisée générique,
même rôle que `frameScheduler.ts` pour la coalescence.

## Hors scope

- Tracé exact d'isoligne (marching squares CPU) — le contour reste une
  bande de quelques pixels au seuil 0.5, pas un chemin vectoriel exact.
- Vitesse/couleur du contour configurables — constantes fixes, à ajuster
  plus tard si un besoin réel apparaît (YAGNI).
- Unification des deux boucles rAF (scheduler de rendu normal + boucle
  d'animation) — trade-off assumé, voir Décisions.
- Tout changement au modèle de masquage lui-même (reste continu,
  conforme au PRD) — ce chantier ajoute un repère visuel, ne touche pas
  au fold ni aux sources.

## Testing

- `overlayAnimationLoop.ts` testable unitairement en Node (rAF/caf
  injectés), même pattern que `frameScheduler.test.ts` existant.
- `FramePipelineExecutor.run()` : test existant étendu pour vérifier que
  `composedTexture` est `null` sans `overlayLayer`, non-null sinon.
- Rendu GPU réel (contour visible, animation fluide, pas de double submit
  perceptible) : checkpoint visuel humain sur la vraie fenêtre WebView2
  (CDP) — moyen de preuve déclaré du projet, aucun test automatisé ne
  peut valider le rendu WebGPU lui-même.

## Validation

- `npx tsc --noEmit` et `npm run test` verts.
- Condition d'affichage vérifiée : contour visible en éditant une source
  luminosité/dégradé/range couleur SANS entrer en mode peinture — corrige
  le symptôme d'origine.
- Aucune régression perf mesurable (`.dev-diag`) sur une image ~24MP avec
  le contour actif plusieurs secondes.
