# Contrôles d'effets — design

> Statut : **design prêt à exécuter**, écrit le 2026-08-03 à partir du cahier
> `2026-08-03-references-postproduction.md` et du registre réel de vingt effets.
> Première tranche volontairement étroite : **manipulations spatiales directes**.
> Les courbes, plages tonales et rampes de dégradé sont cadrées ici comme suites,
> mais ne bloquent pas cette tranche.

## 1. Problème

Le panneau Réglages sait rendre trois formes utiles : un curseur numérique, une
liste de choix nommés et un groupe HSL avec pastille. Ce vocabulaire est trop
petit pour les paramètres qui décrivent une géométrie dans l'image. Une source
de flare, un axe de mouvement ou un centre optique sont aujourd'hui présentés
comme plusieurs nombres indépendants alors que l'utilisateur pense en point,
direction, longueur ou zone.

`EffectModule.canvasRegion` a prouvé la valeur du geste direct sur `pixelStretch`
et `lensFlare`, mais il fige une seule géométrie — centre + rayon — dans une
propriété spéciale, un composant spécial et un branchement spécial d'`App.tsx`.
Étendre ce modèle avec `canvasAxis`, `canvasPoint`, etc. multiplierait les chemins
parallèles et les incompatibilités.

Le cahier de postproduction confirme que le manque est transversal : les looks
visés se construisent avec des points, axes, zones, masques, courbes et dégradés,
pas avec une liste plate de valeurs techniques.

## 2. Objectifs

1. Permettre de poser et régler sur la toile les géométries déjà portées par les
   paramètres des effets, sans modifier leur shader ni leurs clés persistées.
2. Faire d'`EffectModule` la seule déclaration de l'intention UI : le panneau et
   la toile ne devinent jamais une géométrie à partir du nom d'un paramètre.
3. Conserver l'accès numérique précis dans Réglages et la règle d'historique :
   mises à jour live pendant un geste, une seule entrée au relâchement.
4. Rendre les manipulateurs utilisables à la souris et au clavier, lisibles sur
   n'importe quelle image et exacts avec zoom, pan et rapport d'aspect.
5. Établir une extension stable pour les futurs outils éditoriaux sans prétendre
   recréer en postproduction ce qui appartient à la prise de vue.

## 3. Non-objectifs de la tranche 1

- Aucun nouveau shader, effet ou paramètre métier.
- Aucun changement du format de preset ou de `LayerState.params`.
- Pas d'éditeur de courbes, de plage tonale ou de rampe de dégradé dans cette
  tranche ; ce sont les tranches 2 et 3.
- Pas d'overlay photographique, typographie, crop, extension de toile ou liquify.
- Pas de segmentation automatique ni de carte de profondeur.
- Pas de suppression générale des curseurs : ils restent le réglage précis et
  l'alternative accessible au geste direct.

## 4. Modèle déclaratif

`canvasRegion` devient une liste optionnelle de manipulateurs :

```ts
type CanvasControl =
  | {
      kind: "point";
      id: string;
      label: string;
      x: string;
      y: string;
    }
  | {
      kind: "disk";
      id: string;
      label: string;
      centerX: string;
      centerY: string;
      radius: string;
    }
  | {
      kind: "axis";
      id: string;
      label: string;
      centerX?: string;
      centerY?: string;
      angle: string;
      length: string;
    };

interface EffectModule {
  canvasControls?: CanvasControl[];
}
```

Les noms désignent les `EffectParam` existants. `validateEffect` refuse au
chargement : identifiant dupliqué, paramètre absent, rôle répété dans un même
contrôle, ou unité incompatible. Le rendu ne fait aucune recherche par convention
de nom.

### Unités

- `point.x/y` et `disk.centerX/centerY` utilisent l'unité déjà consommée par le
  shader, généralement l'UV ; les bornes viennent des `EffectParam`.
- `disk.radius` conserve l'espace isotrope actuel de `RegionHandles`.
- `axis.angle` est en degrés, conformément à `EffectParam.unit`.
- `axis.length` reste dans l'unité déclarée par l'effet, généralement les pixels.

La conversion écran ↔ paramètre vit dans des fonctions pures de `src/ui/`, jamais
dans le composant React. Une future unité spatiale doit être déclarée, pas déduite.

## 5. Rendu et interactions

Un seul hôte `CanvasControls` lit la liste du calque sélectionné et rend les
contrôles correspondants. Chaque forme peut garder un petit composant DOM, mais
partage la mesure du rectangle affiché de la toile, les conventions visuelles et
le contrat d'événements.

### Point

- Glisser déplace le point sans saut initial.
- Flèches : pas fin ; Maj+flèches : pas large.
- Le point peut sortir du cadre uniquement si les bornes du paramètre l'autorisent.

### Disque

- Centre déplaçable et poignée de rayon.
- La poignée reste attrapable quand le cercle dépasse la zone visible, comme le
  correctif déjà livré dans `radiusHandlePosition`.
- La migration de `canvasRegion` doit être sans changement de géométrie ni de
  comportement pour `pixelStretch` et `lensFlare`.

### Axe

- Une ligne porte une poignée d'origine et une poignée terminale.
- Glisser l'origine translate l'ensemble quand un centre est déclaré.
- Glisser l'extrémité règle angle et longueur en une interaction.
- Pour un effet qui ne porte pas de centre, l'axe est dessiné autour du centre de
  la toile et seule son orientation/longueur est modifiable.
- Au clavier, la poignée terminale règle l'angle ; Maj augmente le pas. La valeur
  numérique du panneau reste le chemin exact pour une grande longueur.

### Concurrence avec les outils de toile

- Les poignées ne sont visibles que pour le calque sélectionné et quand aucun
  outil exclusif incompatible n'est actif, notamment la peinture de masque.
- Un geste commencé sur une poignée arrête sa propagation : il ne pan pas la vue,
  ne peint pas et ne désélectionne pas.
- `pointercancel` abandonne la session sans laisser de geste armé.

## 6. Panneau Réglages

Les paramètres liés à un manipulateur restent visibles. Le contrôle direct les
complète ; il ne les duplique pas dans un second état.

Le panneau peut regrouper les paramètres d'un même manipulateur sous un intitulé
humain (`Source`, `Trajectoire`, `Zone`) tout en réutilisant `LabeledSlider`.
Cette présentation dérive de `canvasControls` afin que la toile et le panneau
racontent la même structure.

## 7. Première migration

P0 :

1. `pixelStretch` : migration byte-for-byte de son disque existant.
2. `lensFlare` : migration byte-for-byte du disque de source existant ; son axe
   optique éventuel ne doit être déclaré que si les paramètres réels le portent.
3. `motionBlur` : axe angle + longueur pour la trajectoire directionnelle ; le
   contrôle est masqué ou adapté dans les modes rotation/zoom, selon les paramètres
   réellement actifs, sans inventer de centre absent.

P1 après validation du socle :

- `lensDistortion` : centre optique et direction d'aberration si les paramètres
  correspondants existent réellement.
- `glass` : orientation uniquement si elle représente une géométrie continue ;
  les choix de matière/profil restent des listes nommées.

`gradientMap` et `channelMixer` ne sont pas des migrations spatiales. Ils servent
de premiers clients aux tranches suivantes.

## 8. Suites prévues

### Tranche 2 — courbes et plages tonales

- Courbe maître et canaux RGB pour contraste, noirs relevés, blancs brûlés et
  éclairage coloré.
- Contrôle de plage avec poignées noir/milieu/blanc pour cibler ombres, tons
  moyens et hautes lumières.
- Un geste de courbe = une entrée d'historique.

### Tranche 3 — rampes de couleur

- Rampe visuelle pour `gradientMap`, dont les trois arrêts existent déjà.
- Positions, couleurs et points noir/blanc manipulables sans exposer neuf sliders
  HSL comme interface principale.
- Le format de shader à tableau fixe interdit des arrêts arbitraires sans travail
  de modèle séparé ; la première version reste donc à trois arrêts.

### Tranche 4 — éléments et composition

Textures/scans, light leaks, formes, typographie, crop et extension de toile sont
un chantier de documents/calques, pas une extension de `EffectParam`.

## 9. Critères d'acceptation

- Déclarer un contrôle dans un effet suffit pour le faire apparaître sur la toile ;
  aucun `if (effect.id === ...)` n'est ajouté à `App.tsx` ou `ParamPanel`.
- Une faute de nom de paramètre échoue dans `validateEffect` avec un message qui
  nomme l'effet, le contrôle et le rôle fautif.
- Les disques de `pixelStretch` et `lensFlare` gardent exactement leurs valeurs,
  leurs bornes, leur géométrie écran et leurs raccourcis après migration.
- Un drag produit des changements live et exactement un commit au relâchement ;
  `pointercancel` n'en produit aucun.
- Les poignées restent alignées au rendu après zoom, pan et redimensionnement.
- Chaque poignée a un nom accessible et une interaction clavier documentée.
- Peindre un masque ne déclenche aucun manipulateur spatial, et inversement.
- `npm run test`, `npx tsc --noEmit`, `npm run lint:tokens`, `npm run build` et
  `npm run test:gpu-shaders` restent verts.
- Le checkpoint final se fait sur la vraie WebView2 : placement, lisibilité sur
  image claire/sombre, zoom/pan, undo/redo et absence d'erreur console.

## 10. Mesure de réussite

La tranche réussit si Antoine peut placer la source d'un flare et orienter un
flou de mouvement depuis l'image sans saisir de coordonnées, puis retrouver la
valeur exacte dans Réglages et annuler le geste en une seule fois. Le test n'est
pas le nombre de composants livrés, mais la disparition des allers-retours entre
image et nombres pour ces deux scénarios.

## 11. Questions non bloquantes

- Une bascule globale « afficher les contrôles sur la toile » sera évaluée au
  checkpoint ; ne pas la construire avant d'avoir constaté un encombrement réel.
- La couleur d'accent des différentes formes peut rester commune en tranche 1 ;
  une couleur par contrôle n'est justifiée que si plusieurs contrôles simultanés
  deviennent ambigus.

