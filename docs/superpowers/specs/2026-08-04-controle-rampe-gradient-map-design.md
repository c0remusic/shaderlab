# Contrôle de rampe Gradient Map — design

## Intention

Remplacer l'interface principale de neuf sliders HSL et trois sliders de
position par une rampe compacte, lisible comme le résultat qu'elle produit.
Le contrôle reste conforme au dock neutre existant : mêmes tokens, même densité,
même sélecteur de couleur, aucune palette décorative supplémentaire.

## Anatomie

```text
  ●────────────●──────────────────●   arrêts sombre / moyen / clair
  [██████████████████████████████]   rampe calculée avec les couleurs réelles
   △                            △    points noir / blanc de l'entrée
```

- Trois arrêts fixes au niveau du modèle GPU : sombre, moyen, clair.
- Les arrêts sombre et clair restent aux extrémités de la rampe de sortie.
- L'arrêt moyen se déplace horizontalement entre 5 % et 95 %.
- Les poignées inférieures règlent les points noir et blanc de l'entrée sans
  pouvoir se croiser.
- Un clic sur une pastille ouvre le `ColorPickerPanel` existant.
- Le pointeur produit des changements live et un seul commit au relâchement ;
  `pointercancel` restaure la valeur de départ sans commit.
- Chaque poignée est un bouton nommé, focusable et pilotable aux flèches ;
  Maj+flèche utilise un pas large.

## Déclaration

`EffectModule.colorRampControls` décrit les paramètres par rôle. Le panneau ne
branche jamais `gradientMap` par identifiant. `validateEffect` refuse un rôle
absent, dupliqué ou un arrêt qui ne contient pas exactement teinte, saturation
et luminosité.

La première version assume exactement trois arrêts, conformément au tableau de
paramètres GPU fixe. Les arrêts arbitraires restent hors périmètre.

## Critères

- Les douze paramètres pilotés ne sont plus rendus une seconde fois.
- Les couleurs affichées correspondent aux HSL réellement envoyés au shader.
- Historique et presets conservent exclusivement les nombres existants.
- Verrouillage, clavier, focus et annulation de geste fonctionnent.
- Une fenêtre normale ne recrée pas de double scroll dans le dock.

