Type: grilling
Status: open

## Question

« Aplat ne sert à rien, il devrait être dans la barre d'outils et pouvoir être
dessiné » (retour d'Antoine). Aujourd'hui `aplat` (couleur unie bornée par un
masque/une primitive) est un EFFET du registre. Il se trace déjà à la souris
(outil Forme, touche `U`) depuis le 2026-08-17, mais reste un effet.

À trancher :
- Antoine veut-il qu'`aplat` DEVIENNE un outil de la barre (comme le pinceau),
  distinct de la liste des effets ? Ou que sa forme se dessine plus directement ?
- Recouvre le ticket 25 de `prochain-palier/` (les poignées de l'aplat, seul
  front bloqué par le chantier des outils sur la toile) et la question « une forme
  SÉLECTIONNE, elle ne se pose pas » (arbitrage 2026-08-17 : une forme vit du côté
  de `mask/sources/`, pas comme effet). Il y a une tension entre « aplat = effet
  couleur unie » et « forme = outil de sélection » à clarifier.
- Lien avec l'outil de SÉLECTION géométrique manquant (`mask/sources/types.ts`
  union fermée sans source géométrique — trou signalé dans le ROADMAP).

Décision de fond sur ce qu'est `aplat` et où il vit → grilling. Peut se scinder.
