# Contrôles d'effets — courbes et plages tonales

> Tranche 2 de `2026-08-03-controles-effets-design.md`, écrite après validation
> humaine de la tranche spatiale le 2026-08-04.

## Problème

Le panneau sait désormais raconter une géométrie, mais une correction tonale
reste une liste de nombres. Une courbe ne se pense ni comme cinq curseurs Y ni
comme une texture opaque : l'utilisateur place des points sur une relation
entrée → sortie, lit immédiatement noirs, contraste et dominante, puis annule
le geste entier en une fois.

Le type actuel `EffectParam` et les presets restent numériques. Cette contrainte
est utile : un preset JSON doit rester inspectable et validable, et aucun gros
buffer ne doit rejoindre le state React.

## Décision

Introduire un effet autonome **Courbes** et deux déclarations UI génériques :

- `curveControls` décrit quatre canaux : Maître, Rouge, Vert, Bleu ;
- `tonalRangeControl` décrit les quatre bornes de ciblage tonal.

`ParamPanel` rend ces déclarations sans branchement par `effectId`. La toile ne
reçoit aucun manipulateur : une courbe est un contrôle de panneau, pas une
géométrie de l'image.

## Modèle borné

Chaque canal porte au maximum cinq points ordonnés : deux endpoints obligatoires
à X=0 et X=1, plus trois slots intérieurs. Un slot intérieur inactif utilise
`x = -1`; ses autres valeurs restent numériques mais sont ignorées. Cette borne
évite tableau variable, blob et migration spéciale de preset.

Par canal : deux Y d'endpoints + trois couples X/Y = huit floats. Quatre canaux
= 32. La plage tonale ajoute quatre floats et le mélange global un float : 37.
`MAX_EFFECT_PARAMS` passe donc de 32 à 48, marge bornée et nommée. Le buffer
uniform partagé passe de 128 à 192 octets, sans texture ni allocation par frame.

La validation refuse : point intérieur hors 0..1, X non strictement croissants,
endpoint absent, slot actif après un slot inactif, clé réutilisée ou déclaration
qui dépasse la capacité.

## Interaction de courbe

- Cliquer dans le graphe ajoute un point dans le premier slot libre.
- Glisser déplace X/Y sans franchir les voisins.
- Double-clic ou Suppr retire un point intérieur ; les endpoints ne se retirent
  pas.
- Flèches déplacent le point sélectionné ; Maj applique le pas large.
- Un drag ou une répétition clavier produit des mises à jour live et un seul
  commit au relâchement.
- Le canal actif est un choix local d'interface, non persisté. Les quatre courbes
  restent visibles en contexte atténué ; seule l'active est éditable.
- Réinitialiser agit sur le canal actif, avec une action séparée pour les quatre.

Le tracé utilise une interpolation cubique monotone : aucune oscillation ni
overshoot entre deux points. Le CPU et le WGSL partagent la même définition
mathématique, couverte par des vecteurs témoins.

## Plage tonale

Le contrôle réutilise l'anatomie éprouvée de `TonalRangeControl` : quatre
poignées non croisables, graphe de réponse et curseurs numériques. Il cible
l'intensité de la correction : hors plage, l'image originale reste intacte ;
dans la plage, la courbe s'applique entièrement ; les rampes d'entrée/sortie
sont des `smoothstep`.

Le composant visuel est partagé, mais la déclaration métier ne l'est pas avec
une source de masque. Une plage d'effet mélange deux couleurs ; une source de
masque produit un champ scalaire. Confondre leurs modèles rendrait les futurs
formats impossibles à faire évoluer séparément.

## Rendu

L'effet travaille en linéaire, dans le pipeline sRGB automatique existant. La
courbe maître s'applique à la luminance en conservant les rapports chromatiques,
puis les courbes RGB par canal. Une garde epsilon évite la division par zéro
dans les noirs. Le résultat corrigé est mélangé à la source par la réponse de
plage tonale puis par `mix` global.

Une rampe de gris, des patchs RGB et un dégradé sombre constituent la mire :
elle doit montrer monotonie, endpoints, dominante par canal et absence de
banding ou d'inversion locale. La référence de pixels précède tout ajustement
visuel du shader.

## Non-objectifs

- Pas de courbe arbitraire à plus de cinq points par canal.
- Pas de LUT importée/exportée, histogramme GPU ni pipette.
- Pas de rampe de `gradientMap` : tranche 3 séparée.
- Pas de courbe attachée à tous les effets ; **Courbes** est un effet autonome.
- Pas de changement au format de masque ni de buffer dans React.

## Critères d'acceptation

- Ajouter l'effet Courbes suffit à rendre l'éditeur, sans `if (effect.id)`.
- Les presets capturent et réappliquent les points sans photo ni blob.
- Une droite identité est neutre à l'octet sur la mire de référence.
- Toute courbe valide reste monotone et bornée dans 0..1.
- Un geste = une entrée d'historique ; pointercancel n'en crée aucune.
- Les quatre poignées tonales ne se croisent jamais.
- Tests unitaires, stories, build, shaders, rendu de référence, CDP et checkpoint
  humain sont verts.
