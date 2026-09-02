# 06 — Concevoir l'encre procédurale (décision LIVE)

**What to build:** Trancher AVEC Antoine le design d'une encre **procédurale**
(bavure et grain générés en shader) qui remplace l'encre-par-texture pré-baked de
la famille Impression. Elle doit tenir la barre qualité du projet (pas « filtre
Photoshop 2005 ») — diffusion d'encre sur papier, bord rugueux crédible. Méthode
imposée : cross-référencer visuellement avant de figer (une apparence ne se déduit
pas d'une spec). Lien : `affinity/` ticket 02 (langage de texture procédurale).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent (planche) — CADRÉ au grilling du 2026-08-27 : mode SUPPLÉMENTAIRE à côté des scans (l'encre-scan reste, gelée par ses références), famille visée **AQUARELLE** (bavure qui fuse, bord granuleux). Prochain pas : une planche de références RÉELLES sur laquelle Antoine pointe — puis le design du mécanisme, jamais avant.
**Type:** grilling
**HITL — Antoine tranche live. L'agent ne décide pas à sa place.**

- [ ] Modèle d'encre procédurale arrêté (mécanisme de diffusion, bord, paramètres exposés).
- [ ] Jugé crédible devant références/photo par Antoine.
- [ ] Périmètre exact : ce que l'encre procédurale remplace dans `inkTexture` / `encreRang`, et ce qui reste.
