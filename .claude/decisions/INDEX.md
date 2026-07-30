# Décisions d'architecture — shaderlab

Une ligne par ADR. `[statut]` reprend le `status:` du frontmatter : un ADR
`superseded` ne doit pas être lu comme une contrainte active.

- [ADR-0001](ADR-0001-densite-ui-controles-repetes.md) [active] — un contrôle répété par ligne devient un contrôle unique dans une zone fixe (en-tête OU pied, amendement 2026-07-28) agissant sur la sélection ; s'applique à tout élément ajouté, au moment où il est ajouté (checklist en 5 points)
- [ADR-0002](ADR-0002-abandon-round-trip-lightroom.md) [active] — le round-trip Lightroom est abandonné, shaderlab devient un éditeur autonome ; libère le statut spécial du document de fond et débloque « toutes les images sont des calques »
- [ADR-0003](ADR-0003-sens-affichage-pile-calques.md) [superseded by ADR-0004] — la liste des calques est le miroir du tableau (sens Photoshop) ; renversé le lendemain, ne plus lire comme une contrainte active
- [ADR-0004](ADR-0004-sens-causal-pile-calques.md) [active] — la liste se lit dans l'ordre du TRAITEMENT (photo d'abord, puis les effets qui la traitent) ; affichage seul, modèle inchangé, conversion dans le même module pur unique, désormais l'identité
- [ADR-0005](ADR-0005-rattachement-par-proximite.md) [active] — un effet appartient à la photo qui le PRÉCÈDE dans la chaîne (le fond du document compris, passé par son id conventionnel) ; l'écrêtage garde la priorité ; la lisibilité du groupe l'emporte sur l'exactitude littérale, abandonnée le 2026-07-29
- [ADR-0006](ADR-0006-fond-export-blanc.md) [active] — le fond d'un export est BLANC, plus noir (« lecture planche contact ») ; le damier reste inexprimable à l'export par construction ; deux références de rendu régénérées, sept identiques à l'octet
- [ADR-0007](ADR-0007-format-de-toile-a-la-creation.md) [active] — le format de la toile se choisit à la création, la taille de la photo restant le MÊME chemin de code par défaut ; formats relatifs dérivés par contenance et orientés comme la photo, A3 absolu à 300 dpi ; dimension du document issue d'une source unique ; borne `MAX_CANVAS_PIXELS = 64 Mpx` calibrée sur les mesures VRAM
