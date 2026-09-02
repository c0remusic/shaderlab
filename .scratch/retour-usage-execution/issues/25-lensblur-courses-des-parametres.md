# 25 — lensBlur : « les autres paramètres ne font virtuellement rien »

**What to build:** Retour d'Antoine au grilling du 2026-08-27, sens VISUEL
confirmé (pas la cadence) : à l'usage, seul le rayon de `lensBlur` compte —
les autres curseurs paraissent inertes.

Se trie AU PIXEL avant toute correction (même méthode que `warp` D11 et
`sliceShift`) : balayer chaque paramètre de son min à son max à rayon 8, 24
et 60, compter les canaux d'écart de chacun. Trois issues possibles par
paramètre, et la mesure décide : course morte réelle (corriger le shader),
course écrasée par le rayon (remapper ou conditionner), paramètre vivant mais
subtil (rien à corriger, peut-être un défaut mal calibré).

Rappel outillage : `--applicabilite` ne mesure que les déclarations de la
table ; ici c'est un balayage ad hoc (scénarios temporaires render-check ou
mesure directe par l'app + signature). `lensBlur` porte 12 params dont
`bladeCurvature` (défaut 0) et le couple highlightThreshold/Boost.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent
**Type:** research

- [ ] Table mesurée : param × rayon → % de canaux d'écart sur mireBokeh.
- [ ] Tri : mort / écrasé / vivant-subtil, avec la correction proposée par cas.
- [ ] Corrections appliquées (courses, défauts), `test:render` en conséquence.
- [ ] Re-jugé par Antoine à l'usage.

Note : le probe de cadence en production (ticket 14) reste PRÊT mais n'est
plus l'urgence — la préoccupation exprimée est l'ergonomie, pas la vitesse.
