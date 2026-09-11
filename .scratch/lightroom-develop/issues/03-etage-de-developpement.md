# 03 — L'étage de développement : en fin de chaîne, après tous les calques, dans le dock à droite

Type: task
Status: ready-for-agent
Blocked by: 01 (le registre et le catalogue sont tenus par le ticket 01 jusqu'à son commit ; ce ticket les RETOUCHE ensuite)

**What to build :** Antoine, 2026-09-11 : « Il faudrait que tout ça s'applique
en fin de chaîne, après tous les calques d'ailleurs » — « et que ce soit
affiché dans le menu à droite ». Le module Lightroom n'est donc PAS une famille
d'effets qu'on pose en calque : c'est un **ÉTAGE** du document, appliqué au
COMPOSITE de toute la pile, avant la présentation et l'export — exactement ce
que Lightroom fait de ses réglages, qui n'ont pas de « calque ». Et il a son
**panneau permanent dans la colonne de droite**, avec les sections de
Lightroom, indépendant du calque sélectionné.

Conséquences sur les tickets 01 et 02 : leurs modules (`etalonnage`,
`reglagesDeBase`) sont des `EffectModule` — le même contrat, le même shader,
le même `ParamPanel` — mais ils vivent dans un **registre de développement**
(`developRegistry.ts`, ordre FIXE), PAS dans `effects/registry.ts` : ils ne
sont pas choisissables comme calque (même statut que `PASSTHROUGH_EFFECT`,
« résolu mais hors du registre »). Le ticket 01, livré dans le registre des
effets, se DÉPLACE ici (retirer l'entrée `registry.ts`/`catalog.ts`, remettre
le compte à 26 dans CLAUDE.md/ROADMAP — le compte des EFFETS ne bouge pas, c'est
un étage qui naît).

## Modèle

- `DevelopSettings` sur `LayerStack` (à côté de `cadre`) : `Record<moduleId,
  Record<param, number>>` — un jeu de valeurs par module de développement.
  Vit sur la pile → `History` l'annule par le même Ctrl+Z (précédent : le
  cadre, ticket 32). `displayLayers()` inchangé (aucun raster).
- `developRegistry.ts` : liste ORDONNÉE des modules de l'étage, dans l'ordre
  d'application de Lightroom (à établir sur pièce — l'inventaire § ordre :
  Étalonnage (primaires, en premier : c'est l'entrée) → Réglages de base (BdB,
  ton, présence) → Courbe paramétrique (dans le même module que le ton, ticket
  02) → HSL / N&B → Color Grading → Détail → Effets (vignettage) ; les
  panneaux s'AFFICHENT dans l'ordre de Lightroom (Réglages de base, Courbe,
  HSL, Color Grading, Détail, Effets, Étalonnage), qui n'est pas l'ordre
  d'application — deux listes, pas une.
- Un module de l'étage dont tous les paramètres sont au défaut est SAUTÉ
  (identité au bit près → aucune passe, aucun coût, aucune quantification :
  c'est ce qui garde `test:render` à zéro écart sur les 128+ références quand
  l'étage existe mais n'est pas réglé — LE gate discriminant de ce ticket).
- Les masques LOCAUX de Lightroom : hors de ce ticket. Un réglage local se
  fait chez nous par un calque d'effet masqué — les modules pourraient aussi
  rester posables en calque pour ça ; NON, tranché : hors du registre des
  effets (Antoine : « en fin de chaîne, après tous les calques »). À rouvrir
  seulement s'il le demande.

## Moteur

- `FramePipelineExecutor.run` : après la boucle des calques, avant la
  présentation, exécuter les modules de `developRegistry` dont les valeurs ne
  sont pas au défaut, par `EffectPassRunner` (ping-pong existant, une
  « couche » sans masque, opacité 1, fusion normale), en espace d'ORIGINE, plein
  cadre (le cadre de recadrage ne s'applique qu'à la présentation/export — le
  développement voit toute la toile, comme Lightroom applique ses réglages
  avant de recadrer ce qu'on montre). `exportFrame` passe par le même chemin
  (un seul pipeline, CLAUDE.md).
- Presets : `presetDocument.capture` capture aussi `DevelopSettings` (un preset
  Lightroom EST ça) ; un preset ancien sans étage → défauts ; un module inconnu
  → avertissement, jamais une exception (précédent `presetDocument.ts`).
- Perf : mesurer le coût de l'étage réglé (26 Mpx, `perf-probe` en prod à
  préparer pour Antoine) — la pyramide de luminance du ticket 02 est le poste.

## Interface — le panneau « Développement » à droite

- Une CARTE de dock (`DockedPanelCard`, colonne de droite, `ui/dockLayout.ts`
  — groupes à onglets, la colonne ne défile pas, ADR-0001) nommée
  **Développement**, avec un onglet ou une section par module dans l'ordre
  d'affichage de Lightroom. Chaque section est un `ParamPanel` du module
  (sections déclarées par le module, `appliesWhen`, `sections` — tout le
  mécanisme existant), branché sur `DevelopSettings` et non sur un calque.
  Lightroom replie ses panneaux (accordéon) : reprendre le repli existant des
  sections si `ParamPanel` le porte, sinon les onglets du groupe.
- Bouton « Réinitialiser » par section et pour l'étage (Lightroom :
  « Réinitialiser » en bas du module). Double-clic sur un libellé de curseur
  = retour au défaut (geste Lightroom ; vérifier si `LabeledSlider` le fait
  déjà).
- Le panneau est VISIBLE sans calque sélectionné et sans effet : c'est le point
  d'entrée d'un utilisateur Lightroom qui ouvre une photo.
- Densité : ADR-0001 — un seul jeu de contrôles, zone fixe, pas de défilement
  de colonne ; 22 + 7 + 33 + … curseurs n'entrent pas d'un coup, d'où
  onglets/accordéon. Mesurer sur la vraie fenêtre à 1345 px.

## Gates

- `test:render` zéro écart sur toutes les références existantes avec l'étage
  présent et au défaut (le module sauté).
- Nouvelles références : `developpement-etalonnage` (l'étage réglé sur la mire
  du 01), `developpement-ordre` (deux modules réglés : l'ordre d'application
  est gelé par la référence — inverser l'ordre doit rougir).
- Test unit : un module au défaut n'émet aucune passe ; l'ordre du
  `developRegistry` est celui déclaré (test qui gèle la liste, comme
  `lensDistortion.test.ts` gèle la famille des halos).
- Stories : la carte Développement avec 2 modules, section repliée/dépliée,
  Réinitialiser ; `test-storybook` ENTIER.
- CDP : ouvrir une photo, régler Étalonnage dans le panneau → `frameSignature`
  change ; Ctrl+Z → revient ; un calque d'effet ajouté APRÈS ne change pas
  l'ordre (l'étage reste dernier) — prouvé par une référence ou une signature.

- [x] `DevelopSettings` sur `LayerStack` (`src/layers/developSettings.ts`, à côté de `cadre`, cloné frais) + `DocumentSession` (`developpement`, `reglerDeveloppement`, `replaceLiveDevelop`) → undo par le même `History`. Presets : `presetDocument.capture`/`apply` capturent/restaurent, module inconnu → avertissement, preset ancien → défauts ; câblé jusqu'à `usePresets`/`usePresetWorkflow`/`applyPreset`.
- [x] `developRegistry.ts` ordonné (ordre d'APPLICATION ≠ d'AFFICHAGE), `etalonnage` retiré d'`effects/registry.ts` et `catalog.ts`, résolu par `getEffect` comme `PASSTHROUGH_EFFECT`. Compte 27 → **26**. Test `developRegistry.test.ts` gèle la liste/l'ordre/le saut au défaut.
- [x] Étage dans `FramePipelineExecutor.run` après la boucle des calques, avant l'overlay, par `runEffectPass(applyMask:false)` ; modules au défaut SAUTÉS (aucune passe) → `test:render` **zéro écart sur 131**. `exportFrame` porte l'étage (paramètre), et le vrai chemin d'export (`exportImage.ts`) aussi.
- [x] Carte « Développement » (`DevelopPanel`) dans le dock à droite, onglet du groupe Presets/Propriétés, `ParamPanel` par module via calque synthétique (non forké), bouton « Réinitialiser » par module (inerte au défaut). Voie vivante `replaceLiveDevelop` appairée `setDevelop`+`requestRender`, commit au relâcher.
- [x] Références `developpement-etalonnage` (identiqueA `effet-etalonnage-bleu`, byte-identique prouvé) + `developpement-apres-pile` (contre `grain-graine-fixe`, ordre gelé — inversion vérifiée = 90358 canaux d'écart) + ATTENDU (133) ; stories (3) ; harnais étendu (`develop`, `identiqueA`) ; gates complets (tsc, lint, test 2284, test-storybook 382, gpu-shader-check, test:render 133, lint:tokens, lint:css-comments).
- [ ] Validé en gestes par Antoine : ouvrir une photo, régler l'étalonnage à droite, poser un effet en calque, l'étalonnage reste appliqué par-dessus. **(Auto-vérifié par CDP le 2026-09-11 — S1≠S0 étage appliqué, étage intact après ajout d'un Grain, Ctrl+Z ×2 → S4 == S0 au bit près ; reste le JUGEMENT esthétique d'Antoine côte à côte avec son Lightroom.)**

## Décisions et écarts d'exécution (2026-09-11)

- **Placement dock : onglet du groupe Presets/Propriétés** (1ère colonne, côté toile), PAS un groupe séparé ni le groupe Pile. Raison : Lightroom met Develop à droite, séparé de toute notion de calque ; l'étage est GLOBAL (visible sans sélection) ; un onglet n'ajoute aucune hauteur (ADR-0001 interdit le défilement de colonne, et un 3ᵉ groupe toujours ouvert risquait le débordement).
- **`ParamPanel` non forké** : nourri d'un calque SYNTHÉTIQUE (`effectId` = id du module, résolu par `getEffect`). Corollaire assumé : le panneau montre son propre repli « Effet » interne au-dessus des sections du module — cosmétique, à polir si l'étage grossit.
- **Bug RÉEL trouvé et corrigé (hors périmètre strict du ticket)** : le vrai chemin d'export (`exportImage.ts` → `FrameRenderer.exportFrame`) et le pont debug `frameSignature` appelaient `exportFrame` SANS l'étage — un fichier exporté n'aurait pas porté le développement. Port et appelants câblés.
- **État vivant de l'étage** : `DocumentSession.replaceLiveDevelop` (jumeau de `replaceLiveLayers`), appairé avec `renderer.setDevelop` + `requestRender` côté App ; commit par `handleParamCommit` (le point de commit unique de tous les curseurs vivants).
- Reste (tranches suivantes du chantier) : Réglages de base + courbe (ticket 02), HSL, Color Grading, Détail, Vignettage — chacun s'ajoute à SA place dans les deux ordres de `developRegistry`. Le repli « Effet » interne du `ParamPanel` et un éventuel accordéon multi-modules à revoir quand l'étage portera plusieurs modules.
