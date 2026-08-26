---
id: ADR-0020
status: active
date: 2026-08-21
---

# ADR-0020 : l'écrêtage sort du dépôt

## Contexte

L'écrêtage est entré le 2026-07-27 (design
`docs/superpowers/specs/2026-07-27-shaderlab-panneau-photo-et-ecretage-design.md`
§3.2) : une case par calque d'effet, `LayerState.clipToBelow`, qui bornait
l'effet à là où le calque photo situé en dessous COUVRE l'image. Une option, pas
un changement de régime — absente, le calque rendait linéairement comme avant.

Devant l'app le 2026-08-21, Antoine a dit deux choses à la fois, et quand on lui
a demandé laquelle était la sienne, il a répondu « c'est les deux » :

- **le libellé était contradictoire.** La case disait « Écrêter sur la photo du
  **dessus** » quand le modèle et le code disaient « le calque photo situé **en
  dessous** ». Les deux étaient vrais, chacun dans son repère : le modèle
  raisonne en indices de `layers[]`, où la base est d'indice INFÉRIEUR, tandis
  que la liste se lit dans le sens CAUSAL depuis l'ADR-0004 — la photo qui
  traite ouvre son groupe par le HAUT. Une même relation nommée dans deux sens
  opposés selon l'endroit où on la lit est précisément l'ambiguïté qu'on ne
  garde pas ;
- **la fonction était obsolète.** Verdict d'usage, comme pour `surfaceBlur`
  (ADR-0011) et `emboss` (ADR-0019) : le geste ne servait pas.

## Ce que la mesure a établi avant d'écrire une ligne

Le coût du retrait a été mesuré, et il est bas :

- **Aucune référence de pixels ne l'utilisait.** `scripts/render-check.mjs` n'a
  jamais porté un seul scénario écrêté. `npm run test:render` doit donc rester
  vert SANS qu'aucune référence soit régénérée — c'est le gate discriminant du
  chantier : un écart de pixels prouverait qu'on a touché autre chose que
  l'écrêtage.
- **Aucun preset ne le persistait.** `presets/presetDocument.ts:capture` prend
  `effectId`, `params`, `enabled`, `opacity`, `blendMode` — jamais
  `clipToBelow`. Aucun document existant ne change de rendu, et il n'y a rien à
  migrer.
- **Le regroupement de la pile survit.** `components/layerTree.ts` faisait
  passer l'écrêtage AVANT la proximité, mais retombait déjà sur elle dès que
  l'écrêtage était inerte. La proximité (ADR-0005) était le cas général ; elle
  est maintenant le seul cas, et aucune ligne ne perd son rattachement.

## Décision

**L'écrêtage est retiré du dépôt, sans remplaçant** (arbitrage d'Antoine,
2026-08-21 — portée « retrait sec »).

Le retrait porte sur toute la machinerie, pas seulement sur la case :

- le champ `LayerState.clipToBelow` (`src/layers/types.ts`) ;
- le module `src/layers/clipping.ts` (`clipBaseId`, `resolveClipping`,
  `ClipResolution`) et son fichier de tests ;
- le mutateur `LayerStack.setLayerClip` et sa garde « un calque photo ne peut
  pas être écrêté » ;
- l'exception d'isolation de `layers/isolation.ts` — isoler un calque écrêté
  tirait aussi sa base photo, sans quoi l'écran restait vide. Plus aucun calque
  ne dépend d'un autre pour rendre, donc `isolationVisibleIds` ne lit plus la
  pile : son paramètre `layers` est parti avec la règle ;
- la branche d'écrêtage de `components/layerTree.ts` ;
- l'option `clipToCoverage` de `render/shaderCompose.ts`, l'option
  `clipCoverageView` de `render/effectPassRunner.ts` et de la frontière de ports
  de `render/framePipelineExecutor.ts`, plus la résolution et la rétention de
  couverture de la boucle de frame ;
- l'UI : la case « Écrêter sur la photo du dessus » (`ParamPanel`) et la flèche
  coudée de la ligne (`LayerPanel`) ;
- le scénario `composite+clip` et la garde d'exclusion mutuelle de
  `scripts/gpu-shader-check.mjs`, plus la variante correspondante de
  `test/render/wgslNaga.test.ts`.

Une **garde de retrait** est posée dans `test/layers/layerStack.test.ts`, sur le
patron de celle de `surfaceBlur` : elle vérifie que `setLayerClip` n'existe plus
et qu'aucun calque ne porte la clé `clipToBelow`. Réintroduire l'un ou l'autre
demande de supprimer ces lignes, donc de relire cet ADR.

## Conséquences

- **CE QUI EST PERDU, et il faut le dire en toutes lettres : borner un effet à
  la COUVERTURE d'une photo.** Aucune source de masque ne sait le refaire. Les
  sources sont une union FERMÉE — `gradient · luminosity · colorRange`
  (`mask/sources/registry.ts`) — et aucune des trois n'est géométrique ni ne lit
  la couverture d'un autre calque : elles dérivent toutes du CONTENU de l'image
  sous le calque. Le geste « cet effet, seulement là où cette photo est » n'a
  donc, aujourd'hui, aucun équivalent. C'est le trou que la **source de
  sélection géométrique** du ticket 11 (`.scratch/prochain-palier/`) comblerait,
  et c'est par là qu'il faudra le retrouver — par un masque, pas par une case.
- **Aucun document existant ne casse et aucun pixel ne bouge.** Le champ n'était
  persisté nulle part (aucun document n'est enregistré, `capture` ne le prenait
  pas), et aucune référence de pixels ne le portait.
- **Le binding 6 (`coverageTexture`) reste, avec son nom neutre.** Il avait DEUX
  fournisseurs — la photo du calque lui-même, et la couverture de la base photo
  du dessous pour un calque écrêté — dont l'exclusion mutuelle était un `throw`
  dans `composeShader`. Il n'en a plus qu'un ; le chemin `hasImageSource`
  (double exposure, `ARCHITECTURE.md` §4.3) est intact au bit près, et son nom
  reste juste : c'est bien une couverture qu'il porte.
- **La piste de grille de la ligne de calque ne bouge pas d'un pixel.** La
  vignette et la flèche d'écrêtage partageaient `.layer-panel__col--mark`
  (fusion du 2026-07-29, qui avait rendu 18 px au nom) ; la piste avait DÉJÀ la
  largeur de la vignette, le plus large des deux contenus. C'est ce qui permet à
  `AllRowFormsShareOneGrid` et à `FiveRowDocumentHidesNoRow` — les deux gardes
  qu'ADR-0001 nomme pour son point 6 — de rester vertes sans retouche de layout.
- **La passe neutre `PASSTHROUGH_EFFECT` perd un de ses deux sites.** Elle
  neutralisait un calque écrêté dont la base photo n'était pas rendue, en le
  gardant à son index pour ne pas casser ce que la boucle dérive de
  `enabledLayers`. Il ne lui reste que le court-circuit « 0 calque activé ».
- **ADR-0008 n'est PAS touché.** « Un effet ne se pose jamais sur un calque
  photo » reste actif : le refus vit dans `LayerStack.setLayerEffect`, et il ne
  reposait pas sur l'écrêtage. Sa formulation, en revanche, l'invoquait comme le
  geste de remplacement (« un calque à part, écrêté à la photo ») ; elle se lit
  désormais « un calque à part, posé AU-DESSUS d'elle », ce qui est ce que le
  pipeline fait de toute façon.

## Alternatives écartées

- **Corriger le libellé et garder la fonction.** C'est la lecture minimale du
  retour, et Antoine l'a explicitement refusée : « c'est les deux ». Un libellé
  juste sur un geste qu'on n'utilise pas ne fait qu'ajouter une case correcte à
  une liste qu'on parcourt à chaque calque — même objection qu'ADR-0011 oppose à
  « garder en dépriorisant ».
- **Attendre le remplaçant (ticket 11, source de sélection géométrique) avant de
  retirer.** C'était la portée (b) du ticket 23, et elle a un vrai argument :
  la doctrine du dépôt (ADR-0016) dit qu'un doublon se MESURE avant de se
  retirer. Ici la mesure a répondu deux choses — le retrait est bon marché, ET
  il enlève une capacité sans équivalent. Antoine a tranché (a) : un geste qui
  ne sert pas ne se garde pas en otage d'un chantier qui n'a pas commencé, et
  l'ADR ci-dessus écrit noir sur blanc ce qu'il faudra retrouver.
- **Garder `clipping.ts` en le débranchant de l'UI.** Un module mort dont
  personne ne sait s'il est une capacité ou un vestige. Le retrait est sec ou il
  n'est pas.
