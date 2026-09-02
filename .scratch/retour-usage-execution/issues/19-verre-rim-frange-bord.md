# 19: Rim de bord + frange chromatique de bord (verre Poli)

**What to build:** La finition « verre premium » du patron Apple Liquid Glass
(recherche, idée 4) : un **rim / edge highlight** et une **aberration chromatique
de BORD seulement** (pas globale). Toute l'énergie est au bord, le centre reste
neutre — c'est précisément ce qui sépare « verre » de « plastique 90s ». Le blob
spéculaire dur d'une surface éclairée comme du plastique disparaît au profit d'une
forme déformée et bordée.

**Blocked by:** 18 — dernière couche, posée sur le modèle Poli refondu.
⚠️ **PRÉMISSE À VÉRIFIER DANS LE SHADER AVANT DE CODER** (les tickets 16 et 18
de la même chaîne sont tombés en fantômes, la recherche décrivait le code sans
l'avoir ouvert) : la DISPERSION existante est déjà une frange chromatique de
bord — nulle sur les parties planes, visible sur les seuls flancs inclinés
(`glass.ts`, en-tête § dispersion). Ce ticket doit dire ce qu'il AJOUTE
par-dessus, sinon il se clôt en constat comme les deux autres.

**Status:** ready-for-agent

- [ ] Rim de bord : un liseré lumineux au bord de la forme / du relief.
- [ ] Frange chromatique de bord UNIQUEMENT (aucune aberration globale ajoutée).
- [ ] Les 18 références régénérées et **relues à l'œil**.
- [ ] Jugé devant photo par Antoine — le verdict visé est « verre », plus « 3D des années 90 ».
