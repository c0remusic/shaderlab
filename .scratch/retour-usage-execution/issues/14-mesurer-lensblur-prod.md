# 14 — Mesurer lensBlur en production (Antoine)

**What to build:** Lancer le probe préparé en build de PRODUCTION et relever la
cadence de `lensBlur` par rayon × géométrie de champ sur 26 Mpx. **HITL** : le
sandbox de session bloque l'accès à `src-tauri/target/`, donc l'agent ne peut pas
lancer le binaire release — Antoine lance le probe. Prérequis prêts : build
release fait, photo synthétique 26 Mpx générée, protocole complet dans
`../retour-usage-2026-08-20/issues/11-lensblur-perf.md`.

**Blocked by:** None — can start immediately (Antoine lance).

**Status:** ready-for-human
**Type:** task
**HITL — Antoine lance le probe (sandbox bloque `target/` pour l'agent).**

- [ ] Cadences relevées : rayon 8 / 24 / 60 / 120 px × géométrie Uniforme et Radial.
- [ ] Temps GPU par passe croisé (`gpuTiming.capturerTimingGpu`), part de la collecte isolée.
- [ ] Verdict : un levier est-il nécessaire pour tenir la cible 60 souple (qualité d'abord).
