# Double exposure — design

**Statut** : direction validée par Antoine (brainstorming 2026-07-25). Prêt
pour `writing-plans`/`architect` selon l'ordre choisi.

## Contexte et origine

Cadré via `interview` le 2026-07-24/25 (`PRD.md` racine, section "Double
exposure"). Motivé par des références Instagram (style "serifa") : silhouette
d'une photo superposée sur une autre. shaderlab suppose aujourd'hui un
document = une seule photo source ; cette feature introduit une deuxième
source d'image dans le modèle de calque, sans dupliquer l'architecture
existante.

Scope v1 (déjà tranché au PRD, rappelé ici) : 2 photos sources max (silhouette
+ fond), isolation du sujet au pinceau manuel (`MaskPainter` existant, pas de
segmentation ML), pas de round-trip Lightroom en présence de cette feature.

## Architecture

`LayerState` gagne deux champs optionnels :

```ts
interface LayerState {
  // ... champs existants (effectId, params, enabled, opacity, blendMode, maskData) inchangés
  imageSource?: {
    bitmap: GPUTexture; // ou équivalent GPU, hors state React (cf. invariant OOM)
    sourceId: string;   // identifiant stable de la photo importée
  };
  transform?: {
    x: number;      // position, coordonnées photo de fond
    y: number;
    scale: number;
    rotation: number; // radians
  };
}
```

Un calque sans `imageSource` se comporte exactement comme aujourd'hui — zéro
régression sur le pipeline effet/masque/blend existant.

**3 approches pesées, (C) retenue** :

- **(A) Nouveau module d'effet "photoOverlay" dans le registry** — écarté :
  casse l'invariant "un effet = pure transform de couleur, zéro modif moteur"
  (`CONTEXT.md`), puisqu'il faudrait quand même faire porter au renderer une
  texture + un transform hors du contrat `params: array<f32, 11>` standard.
- **(B) Union discriminée `LayerState = EffectLayer | PhotoLayer`** — écarté :
  oblige à retoucher chaque endroit qui pattern-matche la forme d'un calque
  (`LayerPanel`, `History`, `ParamPanel`) pour un gain net faible face à (C).
- **(C) Champs optionnels sur `LayerState` existant + extension ciblée du
  renderer** — retenu. Cohérent avec l'annexe technique du PRD. Le coût est
  concentré dans le renderer, pas diffusé dans toute la couche calques.

## Pipeline de rendu

Aujourd'hui (`src/render/shaderCompose.ts:79-95`), chaque passe de calque :
1. échantillonne `srcTexture` = composite accumulé des calques du dessous,
2. applique l'effet (`fs_main`) à cette couleur,
3. mélange `blend(color, effected)` pondéré par `masque * opacité` dans le
   composite.

Pour un calque portant `imageSource` :
1. la passe bind EN PLUS la texture de la photo A + un sampler + un uniform
   `transform` (4 floats : x, y, scale, rotation),
2. l'UV d'échantillonnage de la photo A se calcule depuis l'UV du composite
   via l'inverse du transform (zone hors des bornes de la photo A =
   transparent, pas de répétition/clamp visible),
3. `effected` devient cet échantillon de photo A (passé dans l'effet du
   calque s'il y en a un — `fs_main` reste appelable sur ce contenu, glow/
   duotone/etc. restent utilisables sur une silhouette),
4. le mélange final (`blend`/masque/opacité dans le composite) reste
   **identique au code existant** — aucune duplication de la logique de
   compositing, seule la source de `effected` change de nature.

`composeShader` (`shaderCompose.ts`) gagne un binding conditionnel
(`hasImageSource: boolean`) sur le même modèle que `hasPrevPass`/`applyMask`
aujourd'hui — la clé de cache de pipeline existante (chaîne WGSL déterministe)
couvre cette nouvelle variation sans changement de mécanisme.

## Interaction transform

Bounding box à poignées (type Photoshop) : poignées aux 4 coins + 4 côtés
pour l'échelle (uniforme, pas de déformation non-uniforme — hors-scope v1,
non demandé), poignée dédiée au-dessus de la box pour la rotation. Nouveau
composant overlay canvas (`src/components/TransformHandles.tsx`, nom
provisoire), même famille de gestion pointer que `MaskPainter`/pan-zoom
existants (`pointerdown`/`pointermove`/`pointerup`, `setPointerCapture`) —
pas de nouvelle librairie de manipulation.

Visible uniquement quand le calque photo actif est sélectionné (même
condition que l'affichage des contrôles de `ParamPanel` sur le calque
sélectionné).

## Isolation du sujet (v1)

Le pinceau `MaskPainter` existant peint le masque du calque photo exactement
comme n'importe quel calque aujourd'hui — **aucun changement** à cet outil.
La segmentation automatique ML reste un différé nommé (`CONTEXT.md`), hors
scope de ce chantier.

## Import de la 2e photo

Réutilise le mécanisme d'ouverture de fichier existant (`pick_image_file`,
commande Rust déjà en place pour contourner le bug connu de
`@tauri-apps/plugin-dialog`, cf. `CLAUDE.md`) — pas de nouveau point d'entrée
IPC. Le fichier choisi devient `imageSource.bitmap` du nouveau calque photo,
transform initial = centré, échelle 1 (ajustable ensuite via les poignées).

## Round-trip Lightroom

Un document contenant un calque avec `imageSource` désactive le round-trip
(export "écrase le fichier de lancement") pour ce document — l'export
classique "Exporter sous" reste disponible. Détection simple : présence d'au
moins un calque `imageSource` dans la pile → bascule le bouton Export vers le
comportement "Exporter sous" même si `hasLaunchFile` est vrai, avec un
message expliquant pourquoi (jamais un silence qui laisse croire que le
round-trip a eu lieu).

## Error handling

- Import photo A échoue (fichier invalide/corrompu/annulé) → erreur visible
  via `ErrorBanner` existant, jamais un calque photo silencieusement vide ou
  un crash.
- VRAM avec 2 photos pleine résolution chargées simultanément : pas de
  garde-fou numérique codé en dur en v1 (risque déjà noté "à mesurer à
  l'usage réel" au PRD — pas de budget théorique figé par avance). Le
  principe qui a résolu le crash OOM du masque (26 Mo de `maskData` en state
  React, `e3c7584`) s'applique ici par construction : `imageSource.bitmap`
  vit en `GPUTexture`/ref, jamais dans le state React qui déclenche des
  re-renders.
- Round-trip désactivé en présence d'un calque photo → message explicite
  (pas un bouton silencieusement grisé sans explication).

## Tests

Logique pure testable sans rendu (convention du projet : aucun test ne rend
un composant React) :
- Calcul de la matrice/UV de transform inverse (fonction pure : `(x, y,
  scale, rotation) → UV photo A depuis UV composite`), cas limites (rotation
  0, échelle 1 = identité ; hors bornes = valeur signalant "transparent").
- Sérialisation `imageSource`/`transform` dans `LayerState` (round-trip via
  l'historique undo/redo — un calque photo doit survivre à un undo/redo comme
  n'importe quel calque).
- Détection "round-trip désactivé si calque photo présent" (fonction pure sur
  `LayerState[]`).
- Clamp des poignées de transform (échelle minimale non-nulle, pas de
  bounding box inversée).

Rendu shader/canvas (composite réel photo A + photo B, poignées visibles,
interaction pointer) : vérifié visuellement via CDP sur la fenêtre réelle
(canvas WebGPU non capturable par Playwright headless, cf. `CLAUDE.md` §
Moyen de preuve), comme le reste du projet.

## Fichiers touchés (estimation, à affiner en `writing-plans`)

- `src/layers/types.ts` — `imageSource`/`transform` optionnels sur
  `LayerState`.
- `src/render/shaderCompose.ts` — binding conditionnel `hasImageSource`.
- `src/render/renderer.ts` — passage de la texture/uniform transform pour les
  calques concernés.
- `src/ui/transform.ts` (nouveau) — fonctions pures de calcul UV/matrice,
  testables en isolation.
- `src/components/TransformHandles.tsx` (+ `.css`, nouveau) — overlay canvas
  à poignées.
- `src/App.tsx` — nouveau point d'entrée "importer une 2e photo", câblage du
  calque photo, détection round-trip désactivé.
- `src/export/exportImage.ts` ou `src/launch.ts` — bascule round-trip →
  "Exporter sous" si calque photo présent.

## Hors-scope explicite (rappel PRD)

Plus de 2 photos sources ; segmentation automatique ; round-trip Lightroom en
présence de la feature ; redimensionnement non-uniforme (déformation) de la
silhouette ; organisation/catalogue de photos importées.
