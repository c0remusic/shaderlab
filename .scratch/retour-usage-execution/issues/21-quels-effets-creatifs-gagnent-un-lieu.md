# 21: Quels effets créatifs gagnent un lieu (décision LIVE)

**What to build:** Trancher AVEC Antoine quels effets doivent acquérir un ancrage
sur la toile (`canvasControls`), effet par effet. C'est le vrai facteur limitant
de sa demande : **21 effets sur 26 n'ont aucun lieu aujourd'hui**, donc même une
fois l'outil Déplacer branché (ticket 20), ils resteront immobiles.

Distinction posée par Antoine le 2026-08-21 : les **outils de retouche** (courbes,
niveaux, netteté, mélangeur de couches…) s'appliquent à tout et n'ont pas à
bouger — conforme à Photoshop ; les **effets créatifs** doivent pouvoir se poser
quelque part.

État mesuré au 2026-08-21 — déclarent `canvasControls` : `aplat`, `lensFlare`,
`lightLeak`, `motionBlur`, `pixelStretch`. Les 21 autres n'ont aucun ancrage,
dont plusieurs franchement créatifs : `glow`, `halation`, `glass`, `warp`,
`gooeyMerge`, `sliceShift`, `texture`, `halftone`, `hatching`, `dither`.

⚠️ Ce trou est déjà noté dans `CLAUDE.md` (« 5 effets sur 27 seulement portent un
outil sur la toile, en trois genres ») — ce ticket lui donne enfin sa décision.

À trancher pour chaque candidat :
- A-t-il un LIEU qui a un sens ? (un `glow` naît des hautes lumières de l'image :
  lui donner un centre change sa nature, ce n'est pas qu'un ajout de contrôle.)
- Quel GENRE d'ancrage — `point`, `disk`, `box`, `axis` ? Le vocabulaire est
  fermé et déclaratif (`spatialParams.ts`).
- Ce qui se passe pour les presets existants : un ancrage neuf est un paramètre
  neuf, donc un index de plus en FIN de `params[]` (jamais inséré au milieu).

**Blocked by:** None pour la décision. Le ticket 20 la rend UTILE (sans lui, un
ancrage neuf ne se déplace toujours pas au geste).

**Status:** ready-for-human
**HITL — Antoine tranche effet par effet. L'agent ne décide pas à sa place.**

- [ ] Liste arrêtée des effets qui gagnent un ancrage, avec le genre de chacun.
- [ ] Les effets qui restent SANS lieu sont nommés, avec la raison (retouche, ou lieu sans objet).
- [ ] Coût en références de pixels chiffré avant de coder (un paramètre neuf en fin de `params[]` ne déplace aucun index existant).
