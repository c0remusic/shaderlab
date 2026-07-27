# Décisions d'architecture — shaderlab

Une ligne par ADR. `[statut]` reprend le `status:` du frontmatter : un ADR
`superseded` ne doit pas être lu comme une contrainte active.

- [ADR-0001](ADR-0001-densite-ui-controles-repetes.md) [active] — un contrôle répété par ligne devient un contrôle unique en en-tête agissant sur la sélection ; s'applique à tout élément ajouté, au moment où il est ajouté (checklist en 5 points)
- [ADR-0002](ADR-0002-abandon-round-trip-lightroom.md) [active] — le round-trip Lightroom est abandonné, shaderlab devient un éditeur autonome ; libère le statut spécial du document de fond et débloque « toutes les images sont des calques »
- [ADR-0003](ADR-0003-sens-affichage-pile-calques.md) [active] — la liste des calques est le miroir du tableau (sens Photoshop) ; affichage seul, modèle inchangé, conversion dans un module pur unique
