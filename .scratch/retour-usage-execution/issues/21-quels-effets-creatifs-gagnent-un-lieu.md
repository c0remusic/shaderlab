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

**Status:** done — LIVRÉ le 2026-08-27. LISTE ARRÊTÉE par Antoine au grilling du 2026-08-27 (« ok pour tout ») : `warp` → point (centre, hors Bruit fractal), `halftone` → point (origine de trame), `hatching` → point — les trois sur des params EXISTANTS, zéro référence déplacée ; `texture` → box (params neufs en fin de liste). SANS lieu, motivé : `glow`/`halation` (naissent des hautes lumières), `glass` (matière pleine feuille), la retouche (courbes, niveaux, mélangeur…). `gooeyMerge`/`sliceShift`/`dither` : pas retenus à ce tour.
**HITL — Antoine tranche effet par effet. L'agent ne décide pas à sa place.**

- [x] Liste arrêtée (grilling du 2026-08-27) ET LIVRÉE le jour même : `warp` point
      (visible types 1-5, 7, 8 — le Drapeau ne lit pas `centerY`, un point y
      serait à moitié mort), `halftone` point (sans condition, les quatre modes
      lisent le centre), `hatching` point (Cercles seulement, comme sa section),
      `texture` box (5 params neufs en fin de liste — la box BORNE et ANCRE le
      motif, elle ne le dimensionne pas ; hors d'elle l'effet rend son entrée,
      mais le MODE DE FUSION du calque s'applique encore — Incrustation 0,7 par
      défaut contraste le fond hors box, documenté dans l'effet, repli : masque
      ou mode Normal).
- [x] Les effets SANS lieu nommés : `glow`/`halation` (naissent des hautes
      lumières), `glass` (matière pleine feuille), la retouche ;
      `gooeyMerge`/`sliceShift`/`dither` non retenus à ce tour.
- [x] Coût chiffré ET tenu : zéro référence déplacée (3 ancrages sur params
      existants ; `effet-texture` inchangé AU BIT PRÈS aux défauts de la box,
      vérifié par test:render), une référence neuve `effet-texture-box`.
      Geste vivant vérifié par sonde : drag sur halftone → cible
      `effect-move-surface`, 1 commit, undo/redo exacts.
