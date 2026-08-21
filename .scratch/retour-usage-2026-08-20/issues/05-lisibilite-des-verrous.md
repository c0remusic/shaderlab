Type: prototype
Status: open

## Question

« L'icône pinceau dans le screen ne fait rien. Pareil pour la transparence »
(retour d'Antoine). Diagnostic : ces icônes de la barre de contrôles des calques
(`LayerControls`, `LayerPanel.tsx:624-665`) NE SONT PAS mortes — ce sont les
**verrous de masque et de transparence** (câblés via `handleToggleLock`,
`App.tsx:1285`). Le défaut est de LISIBILITÉ :

1. Le glyphe `Brush` sert DEUX fois : verrou de masque au dock ET vrai outil
   pinceau dans la `ToolPalette` (bord gauche). Antoine clique en attendant de
   peindre, bascule un verrou.
2. Leur seul retour visuel est un discret changement de teinte + un cadenas ;
   l'effet est nul tant qu'aucun masque n'est peint. Contraste avec Move/Lock/
   Copy/Trash, dont l'effet est immédiat.
3. Pire : le verrou de transparence sur un masque VIDE bloque tout dépôt du
   pinceau → se lit comme « le pinceau est cassé ».

À prototyper/décider :
- Changer les glyphes ambigus (le pinceau-verrou ≠ le pinceau-outil).
- Renforcer le feedback des verrous (état plus lisible).
- Rapprocher de la convention Photoshop/Lightroom (référence imposée du projet).

Se lit avec `hybride-lightroom-photoshop/` (lisibilité). Prototype d'UI → réaction
d'Antoine.
