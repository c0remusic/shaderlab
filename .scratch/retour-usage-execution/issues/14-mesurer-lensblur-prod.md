# 14 — Mesurer lensBlur en production (Antoine)

**What to build:** Lancer le probe préparé en build de PRODUCTION et relever la
cadence de `lensBlur` par rayon × géométrie de champ sur 26 Mpx. **HITL** : le
sandbox de session bloque l'accès à `src-tauri/target/`, donc l'agent ne peut pas
lancer le binaire release — Antoine lance le probe. Prérequis prêts : build
release fait, photo synthétique 26 Mpx générée, protocole complet dans
`../retour-usage-2026-08-20/issues/11-lensblur-perf.md`.

**Blocked by:** None — can start immediately (Antoine lance).

**Status:** ready-for-human (déprioritisé le 2026-08-27) — au grilling, la préoccupation réelle d'Antoine sur lensBlur est l'ERGONOMIE (« les autres paramètres ne font virtuellement rien » → ticket 25), pas la cadence. Le probe reste prêt, à lancer quand il veut, sans relance.
**Type:** task
**HITL — Antoine lance le probe (sandbox bloque `target/` pour l'agent).**

- [ ] Cadences relevées : rayon 8 / 24 / 60 / 120 px × géométrie Uniforme et Radial.
- [ ] Temps GPU par passe croisé (`gpuTiming.capturerTimingGpu`), part de la collecte isolée.
- [ ] Verdict : un levier est-il nécessaire pour tenir la cible 60 souple (qualité d'abord).
