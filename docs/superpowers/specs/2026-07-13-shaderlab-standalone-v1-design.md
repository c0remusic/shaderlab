# Shaderlab standalone v1

> Statut : validé pour implémentation le 2026-07-13.
> Source de vérité produit courante. Cette spec remplace le scope du MVP du
> 2026-07-12, conservé comme document historique. Lightroom devient une phase 2.

## Pourquoi

Shaderlab doit d'abord devenir un outil Windows standalone local, spécialisé
dans les effets shader créatifs sur photo. La v1 vise un niveau professionnel
de performance, de fiabilité et de contrôle pour ce workflow ciblé, sans
chercher la parité fonctionnelle générale avec Photoshop.

La priorité est le moteur : quatre effets aboutis, calques composables,
masquage manuel GPU et export fiable. Le polish UI vient après les fonctions,
sauf les contrôles nécessaires pour les utiliser.

## Périmètre v1

### Espace de travail

- L'application MUST fonctionner localement sous Windows, sans installateur,
  signature ni distribution publique.
- L'utilisateur MUST pouvoir ajouter des JPEG avec **Ouvrir** ou par
  glisser-déposer.
- Chaque photo MUST posséder un document indépendant avec sa pile de calques,
  ses masques, son historique et son état modifié.
- Une pellicule de session MUST permettre de changer de document, filtrer
  Toutes / Modifiées / Non modifiées et être repliée.
- La pellicule MUST être limitée à la session. Aucun catalogue ni restauration
  après relance n'est inclus.

Scénarios :

- WHEN plusieurs JPEG sont ouverts THEN chacun apparaît dans la pellicule et
  retrouver une photo restaure son état intact.
- WHEN la pellicule est filtrée sur Modifiées THEN seules les photos ayant des
  changements non exportés sont affichées.
- WHEN l'application est relancée THEN la session précédente n'est pas
  restaurée.

### Modèle de document

Chaque photo est un `EditorDocument` autonome contenant :

- chemin source éventuel, dimensions et état modifié ;
- pile ordonnée de calques ;
- paramètres, opacité, mode de fusion et masque de chaque calque ;
- historique undo/redo limité ;
- ressources GPU appartenant au document.

Un `WorkspaceSession` contient les documents ouverts, le document actif et
l'état de la pellicule. L'UI consomme ces modèles sans porter leur logique.

### Effets et calques

La bibliothèque v1 reste limitée à :

1. Glow : bloom multi-passes doux et étendu.
2. Chromatic bleed : aberration radiale croissante vers les bords.
3. Warp : déplacement organique par FBM.
4. Grain : grain spatial, réglable et dépendant de la luminance.

- Les effets MUST rester des modules autonomes enregistrés dans le registre.
- Un calque MUST pouvoir être ajouté, supprimé, activé, désactivé et
  réordonné par glisser-déposer.
- La réorganisation MUST être annulable et conserver le calque déplacé
  sélectionné avec son masque.
- Chaque calque MUST avoir une opacité de 0 à 100 %, égale à 100 % par défaut.
- Chaque calque MUST proposer Normal, Écran, Produit, Incrustation, Lumière
  tamisée et Addition.
- Réinitialiser MUST restaurer les paramètres du shader sans modifier le masque.

Composition d'un calque :

```text
résultatFusion = fusion(imageEntrante, résultatShader, mode)
sortie = mix(imageEntrante, résultatFusion, masque × opacité)
```

Les modes de fusion sont calculés en linéaire. Shaderlab assume une identité
créative cohérente avec son moteur plutôt qu'une copie de Photoshop.

Scénarios :

- WHEN deux calques sont permutés THEN le rendu suit le nouvel ordre et Undo
  restaure l'ordre précédent.
- WHEN l'opacité vaut 0 % THEN le calque ne modifie pas l'image.
- WHEN l'opacité vaut 100 %, sans masque, en mode Normal THEN le résultat du
  shader est appliqué intégralement.
- WHEN un module est enregistré THEN le moteur et l'UI générique n'exigent
  aucune modification spécifique à cet effet.

### Masquage manuel GPU

Le niveau visé est une parité professionnelle ciblée avec le masquage manuel
raster de Photoshop, pas avec ses outils de sélection avancée.

- Chaque masque MUST être une texture GPU persistante appartenant à son calque.
- Le pinceau MUST peindre directement sur GPU. Le pipeline MUST NOT transférer
  ou recréer le masque complet à chaque événement du pointeur.
- Les points MUST être interpolés pour produire un trait continu sans trous.
- Le pinceau MUST proposer taille, dureté, opacité et débit.
- L'utilisateur MUST pouvoir peindre, gommer, remplir, vider, inverser et
  supprimer un masque.
- L'overlay rouge MUST être disponible en v1.
- Zoom et déplacement MUST rester disponibles pendant la peinture.
- Un trait complet MUST produire une seule entrée undo/redo.

États : aucun masque applique l'effet partout ; un masque vide le masque
entièrement ; un masque plein permet de gommer depuis une application globale ;
Supprimer revient explicitement à l'absence de masque.

Scénarios :

- WHEN le pointeur se déplace rapidement THEN le trait reste continu.
- WHEN le masque est vide THEN le calque ne modifie aucun pixel.
- WHEN le masque est supprimé THEN le calque retrouve une application globale.
- WHEN un trait est terminé THEN un seul Undo annule tout le trait.
- WHEN un calque est réordonné THEN son masque se déplace sans altération.

### Historique

- Une interaction continue de slider MUST créer une seule entrée.
- Un trait de pinceau MUST créer une seule entrée.
- L'historique MUST être plafonné à 512 Mo par document.
- WHEN le budget est dépassé THEN les entrées les plus anciennes sont évincées
  en premier et l'état courant est toujours conservé.
- L'historique reste en mémoire et disparaît à la fermeture.

L'implémentation ne doit pas copier sur CPU chaque masque 26 MP à chaque
mouvement. Le format des deltas ou checkpoints reste un détail à mesurer.

### Export standalone

- **Exporter sous…** MUST ouvrir une boîte de dialogue native.
- Le nom proposé MUST être `<nom-source>-edited.jpg`.
- Un fichier existant MUST NOT être remplacé sans confirmation explicite.
- L'export MUST utiliser le même pipeline et la résolution native du document.
- Le JPEG MUST être encodé avec une qualité de 95 %.
- Les pixels MUST être exportés dans leur orientation visuelle.
- EXIF et ICC ne sont pas conservés ; cette limitation MUST être documentée.
- Une progression MUST toujours afficher Rendu, Encodage, Écriture et Terminé,
  sans inventer un faux pourcentage continu.
- Un export réussi MUST marquer le document non modifié jusqu'au changement
  suivant.

Scénarios :

- WHEN une photo glissée-déposée est exportée THEN le dialogue permet de choisir
  un chemin réel.
- WHEN la destination existe THEN l'écriture attend une confirmation.
- WHEN l'écriture échoue THEN document, calques et historique restent intacts et
  le document reste marqué modifié.

## Refactor ciblé

La v1 conserve les shaders WGSL, le registre, le renderer ping-pong et
multi-passes, le contexte WebGPU, le contrat sRGB, l'export JPEG et les parties
réutilisables du modèle de calques et de ses tests.

Le refactor porte sur :

- l'état mono-image, remplacé par `EditorDocument` + `WorkspaceSession` ;
- le masque CPU, remplacé par une texture GPU persistante peinte par shader ;
- l'historique, rendu borné et adapté aux gros masques ;
- la composition finale, étendue avec opacité et modes de fusion ;
- l'UI, organisée autour du canvas, d'un inspecteur droit et de la pellicule.

Une réécriture totale du renderer est hors scope.

## Contrat colorimétrique

- Toutes les textures couleur MUST utiliser `rgba8unorm-srgb`.
- WebGPU assure la conversion stockage sRGB vers calcul linéaire et retour.
- Les shaders MUST NOT appliquer de gamma manuel.
- Les textures de masque restent linéaires, par exemple `r8unorm`.
- Les JPEG entrants sont traités comme sRGB.
- La lecture et la conversion de profils ICC restent hors scope.

Ce contrat remplace l'ancienne formulation f16 + conversions explicites du
document du 2026-07-12, incompatible avec l'architecture validée.

## Performance et robustesse

Référence : NVIDIA GeForce RTX 2060, JPEG 6240 × 4160, quatre calques actifs.

- Slider vers image : cible < 100 ms, maximum acceptable 200 ms.
- Pinceau vers image : cible < 50 ms, maximum acceptable 100 ms.
- Export : cible < 3 s, maximum acceptable 5 s.
- Dix minutes d'édition MUST rester stables, sans crash ni croissance mémoire
  non bornée.

- WHEN une image dépasse `device.limits.maxTextureDimension2D` THEN elle est
  refusée avant allocation avec un message indiquant la limite.
- WHEN WebGPU est indisponible ou que le device est perdu THEN une erreur
  explicite remplace le canvas figé.
- WHEN le décodage échoue THEN aucun document partiel n'est ajouté.

Si les seuils échouent, le pipeline doit être profilé avant de reconsidérer la
résolution native permanente.

## Validation visuelle

Le corpus local contient : portrait avec peau et hautes lumières ; nuit avec
sources lumineuses ; architecture ou paysage avec lignes droites ; scène riche
en aplats, ombres et tons moyens.

Chaque effet MUST passer un checkpoint humain sur les quatre images :

- Glow : halo large et doux, sans noyau carré ni hautes lumières cassées.
- Chromatic bleed : centre propre et séparation croissante vers les bords.
- Warp : mouvement organique sans motif périodique évident.
- Grain : structure non numérique, surtout dans les tons moyens, taille
  perceptible et réglable.

Un effet techniquement fonctionnel mais visuellement pauvre n'est pas terminé.

## Interface v1 minimale

- Canvas principal occupant l'essentiel de la fenêtre.
- Inspecteur unique à droite avec sections repliables Calques, Paramètres et
  Masque, de largeur ajustable.
- Pellicule repliable en bas.

Ce contrat spatial ne demande pas de polish avant le moteur.

## Post-v1 documenté

Raffinements UI : comparaison avant/après par appui maintenu, finition visuelle
de la progression, raccourcis avancés, personnalisation, catalogue persistant,
installateur, signature et distribution.

Masquage avancé : pression et inclinaison du stylet, sélections géométriques,
détection et raffinement des contours, Select and Mask, IA et profondeur.

Effets futurs, dans l'ordre : Gooey merge, Channel mixer, Outlines, Pixel
stretch, Slice shift, Gradient map.

## Phase 2 : Lightroom

Lightroom est une phase séparée, pas un plugin Adobe natif. Elle reproduira le
workflow External Editing : Lightroom crée une copie, lance Shaderlab avec son
chemin, puis Shaderlab écrit au même chemin.

Gate empirique obligatoire :

1. Lightroom lance Shaderlab avec le chemin attendu.
2. Shaderlab ouvre automatiquement la copie.
3. L'export remplace cette copie, jamais l'original de la bibliothèque.
4. La fermeture permet la réimportation automatique.
5. Le résultat apparaît correctement dans le catalogue Lightroom.

Le contrat reste une hypothèse jusqu'à ce test complet. Aucun code Lightroom ne
bloque la livraison standalone.

## Hors scope v1

- parité générale avec Photoshop ;
- formats autres que JPEG ;
- profils ICC et conservation EXIF ;
- preview basse résolution distincte de l'export ;
- catalogue persistant ;
- système de plugins tiers ;
- effets au-delà des quatre effets de base ;
- masquage avancé listé ci-dessus ;
- macOS et autres plateformes ;
- packaging et distribution publique ;
- intégration Lightroom, traitée en phase 2.
