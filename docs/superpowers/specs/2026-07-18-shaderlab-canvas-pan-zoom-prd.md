# PRD — Pan/zoom du canvas de shaderlab

> Produit par le skill `interview` (le QUOI, usage). Nourrit
> `superpowers:brainstorming` (le COMMENT). Mode FEATURE + préambule planchers.
> Interview réelle avec Antoine, 2026-07-18.

## Contexte

shaderlab = outil desktop Windows d'effets shader GPU temps réel sur photos JPEG,
faisant aussi office d'éditeur externe Lightroom. Aujourd'hui le canvas
(`src/components/Canvas.tsx`) est **1:1 avec sa taille CSS** : aucune transform,
l'image est centrée passivement (`.canvas-stage` en flex center, `<canvas>` en
`max-width/height: 100%`), et `toImageCoords` mappe `clientX/clientY` vers les
coordonnées image via le seul ratio `getBoundingClientRect`. Conséquence : sur une
photo 24MP affichée réduite pour tenir à l'écran, **impossible de zoomer pour
peindre un masque avec précision** ni de naviguer dans l'image. C'est un vrai frein
à l'usage réel (retouche fine).

Origine du besoin : Antoine a remarqué et apprécié le pan/zoom fluide d'un produit
concurrent (dasca.studio) — discussion de concept uniquement, aucun code extrait.

## Objectif

Naviguer librement dans la photo — zoomer et déplacer de façon fluide — sans jamais
dégrader la précision du geste de peinture ni la fidélité du rendu.

## Comportements (quand X → Y)

**Zoom**
- Quand je scrolle la molette au-dessus du canvas → l'image zoome, **centrée sur la
  position du curseur** (le point sous le curseur reste sous le curseur).
- Quand je clique les boutons zoom +/- de l'UI (ou lis le % courant) → l'image
  zoome par pas, centrée sur le centre du canvas ; le pourcentage courant est
  visible.
- Le zoom va du fit-to-screen (dézoom pour voir toute l'image) jusqu'à **100 %
  maximum** (1 pixel image = 1 pixel écran) — pas de zoom au-delà du pixel natif.

**Pan (déplacement)**
- Quand je maintiens **Espace** et glisse à la souris → l'image se déplace dans le
  canvas ; tant qu'Espace est maintenu, le clic gauche ne peint pas (pas de conflit
  avec le pinceau).
- Le pan est **borné** : impossible de faire sortir l'image entièrement de la vue,
  un bord au moins reste toujours atteignable.

**Ouverture & retour**
- Quand j'ouvre une photo → elle s'affiche **entière (fit-to-screen)**, quelle que
  soit sa résolution.
- Quand j'appuie sur le raccourci reset → retour instantané au fit-to-screen.

**Peinture pendant zoom/pan**
- Quand je peins un masque alors que l'image est zoomée/déplacée → le trait tombe
  **exactement sur le pixel image sous le curseur**, à n'importe quel niveau de
  zoom/pan (le mapping écran→image tient compte de la transform courante).

**Minimap**
- Quand l'image dépasse le cadre visible (zoomée au-delà du fit-to-screen) → une
  **mini-carte** apparaît, montrant la vignette de l'image entière et un rectangle
  proportionnel indiquant la portion actuellement visible.
- Quand je reviens au fit-to-screen (toute l'image visible) → la minimap
  **disparaît** (elle n'apporte rien quand tout est déjà visible).

## Hors-scope explicite

- **Rotation / flip du canvas** (Photoshop les propose ; pas demandé ici).
- **Zoom au-delà de 100 %** (agrandir des pixels déjà vus, jugé peu utile sur un
  raster fixe).
- **Geste tactile / trackpad (pincer)** : non retenu (usage souris à la molette).
- **Interaction sur la minimap** (cliquer/glisser dedans pour se déplacer) : la
  minimap est un **indicateur** en v1, pas un contrôle de navigation. À rouvrir si
  le besoin se confirme à l'usage.

## Contraintes d'inacceptable

### Inacceptable (projet) — réutilisable par les futures features

- **Latence** : un paramètre peut mettre jusqu'à ~100 ms, mais **le geste direct
  (peindre, ici zoomer/déplacer) DOIT suivre à 60fps**. En-dessous = échec.
- **Empilement / rendu** : aucune dérive couleur/lumière due au pipeline ;
  compositing en **espace linéaire strict** ; textures couleur au **format sRGB
  préféré de la plateforme** (`${getPreferredCanvasFormat()}-srgb` — donc
  `bgra8unorm-srgb` sur Windows/D3D12, `rgba8unorm-srgb` ailleurs ; voir
  `gpuContext.ts:68-69`), pas de gamma manuel en WGSL.
- **Qualité** : pas de rendu « filtre Photoshop 2005 » (déjà acté, CLAUDE.md).
- **Validation** : la correction visuelle se juge **à l'œil, par checkpoint
  humain** ; jamais affirmée sans avoir été vue.

### Inacceptable (feature pan/zoom)

- **Fluidité du geste** : le pan et le zoom doivent tenir **60fps** pendant le geste
  lui-même, sur une vraie photo 24MP. En-dessous = échec (même plancher dur que le
  pinceau — un seul chiffre à tenir dans tout l'outil).
- **Précision de peinture** : le point peint doit être **pixel-exact** sous le
  curseur, à **n'importe quel niveau de zoom/pan**. Aucun décalage toléré
  (cohérent avec « masque exact » du PRD calques).
- **Ne jamais perdre l'image hors champ** : le pan borné garantit qu'on ne se
  retrouve pas face à un canvas vide sans comprendre pourquoi.

## Terminé = démontrable

Checkpoint visuel humain (Antoine valide dans la vraie fenêtre WebView2, jamais
affirmé sans avoir été vu) :

1. **Zoom/pan fluides à l'œil** : molette + boutons zoom, Espace+glisser pan, sur
   une vraie photo 24MP dans la fenêtre native — fluide sans à-coup.
2. **Pinceau pixel-exact à tout niveau de zoom** : peindre un masque à fit-to-screen
   puis à zoom profond ; le trait tombe exactement sous le curseur dans les deux cas.
3. **Fit-to-screen + reset + bornes** : ouverture d'une photo = fit automatique ;
   la touche reset revient au fit ; impossible de faire sortir l'image entièrement
   du cadre.
4. **Minimap au bon moment** : invisible à fit-to-screen, apparaît dès qu'on zoome
   au-delà, reflète correctement la portion visible.

## Annexe — Choix techniques déduits (à valider au brainstorming)

Déduits de l'usage, validés avec Antoine en fin d'interview le 2026-07-18 :

- **Transform CSS sur l'élément `<canvas>`** (translate + scale), PAS de viewport
  dans le shader → cohérent avec l'archi actuelle (canvas DOM simple) ; le rendu GPU
  reste toujours à résolution native, **zéro impact qualité**. Justification : le
  projet a déjà verrouillé « pas de distinction preview/export, résolution native
  toujours » — un viewport shader introduirait une notion de sous-échantillonnage
  qu'on veut éviter.
- **`toImageCoords` inverse la transform CSS** (translate + scale) en plus du ratio
  taille-affichée/taille-réelle actuel → réalise le plancher **pixel-exact** à tout
  zoom. C'est le point technique le plus sensible (le pinceau en dépend directement).
  ⚠️ **Conflit de fichier avec la feature masquage** (`2026-07-18-shaderlab-layers-
  masking-design.md`) : les deux chantiers modifient la MÊME fonction
  `toImageCoords` (`src/components/Canvas.tsx:37-44`). Le masquage suppose le mapping
  actuel ; le pan/zoom le change. Séquencement à acter : livrer l'un, puis le second
  relit ce fichier et s'adapte à la nouvelle signature — ne pas supposer l'ancien
  mapping. Si la transform CSS est posée sur un **wrapper** plutôt que sur le
  `<canvas>`, `getBoundingClientRect()` du canvas change aussi → à vérifier.
- **Zoom centré curseur** = recalcul du `translate` autour du point pointé
  avant/après changement de `scale` (molette), ou du centre du canvas (boutons) →
  comportement standard Photoshop/Lightroom.
- **État « Espace maintenu » local au composant Canvas**, suspend le mode peinture
  tant qu'Espace est appuyé → évite tout conflit clic gauche peinture / clic gauche
  pan.
- **Bornes de pan** calculées depuis la taille affichée de l'image (scale courant)
  vs la taille du viewport, `translate` clampé → réalise le pan borné.
- **Fit-to-screen** = scale initial calculé pour que l'image entière tienne dans le
  viewport ; **reset** = ré-application de ce scale + translate centré.
- **Minimap = composant séparé** (vignette de l'image + rectangle proportionnel du
  viewport visible dérivé de scale/translate), monté conditionnellement dès que le
  scale courant dépasse le scale fit-to-screen → « visible seulement quand utile ».
  Indicateur seulement (pas cliquable en v1).

**Point ouvert pour le brainstorming** : au redimensionnement de la fenêtre, le
scale fit-to-screen change — décider si un état zoomé est préservé (et re-clampé) ou
si on retombe au fit. À trancher au COMMENT, pas bloquant pour le QUOI.

---

**Prochaine étape** : PRD prêt → reprendre `superpowers:brainstorming` pour
concevoir le COMMENT (transform, inversion de coordonnées, minimap, gestion du
resize).
