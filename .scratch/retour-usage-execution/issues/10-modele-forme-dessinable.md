# 10 — Modèle de la forme dessinable (décision LIVE)

**What to build:** Trancher AVEC Antoine ce qu'est une forme dessinée avec l'outil
Forme : un **calque** à part (comme un shape layer PS), une **source de masque
géométrique** dans `mask/sources` remplie par une couleur, ou `aplat` gardé sous
le capot comme moteur non listé. Décide aussi le sort de l'entrée `aplat` du
registre et le périmètre du geste (rectangle / ellipse / polygone déjà livré ;
dégradé linéaire/radial déjà livré). Recoupe l'arbitrage du 2026-08-17 (« une
forme SÉLECTIONNE, elle ne se pose pas ») et le trou de sélection géométrique de
`mask/sources`.

Concept cadrant : `docs/wireframes/aplat-outil-forme.html`.

**Blocked by:** None — can start immediately.

**Status:** ready-for-human
**Type:** grilling
**HITL — Antoine tranche live. L'agent ne décide pas à sa place.**

- [ ] Modèle de la forme arrêté (calque / source de masque géométrique / hybride).
- [ ] Sort de l'entrée `aplat` du registre décidé (retirée / moteur non listé).
- [ ] Périmètre du geste arrêté (tracés supportés, dégradé, où vivent les réglages).
