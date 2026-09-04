# 24 — Transform complet des effets placés (déplacer PUIS étirer/aplatir)

**What to build:** Le geste Photoshop universel sur un calque d'effet placé :
après le déplacement (ticket 20, livré), pouvoir l'**étirer et l'aplatir** —
un scale X/Y appliqué au RENDU de l'effet. Demande d'Antoine au grilling du
2026-08-27 : « il faut pouvoir aplatir le calque comme photoshop et donc
pouvoir le déplacer et l'étirer ensuite », « il va falloir pouvoir aplatir
TOUS les calques/effets ».

**Modèle tranché au grilling (option ii)** : un scale **générique du rendu**,
pas du cas-par-cas par paramètre — c'est la lecture de « TOUS les calques ».
Un light leak n'a pas de largeur déclarée : l'étirer étire son CHAMP rendu.

## Cadrage à faire AVANT de coder (la grosse pièce est moteur)

- Où vit le scale : un `transform` sur le calque d'effet est aujourd'hui
  INTERDIT par le modèle (ticket 20 : « aucun transform sur un calque
  d'effet » — le geste écrivait dans les params spatiaux). Un scale générique
  du rendu rouvre cette décision : soit un champ neuf sur `LayerState` lu par
  le pipeline (re-échantillonnage de la sortie de l'effet), soit une
  transformation des UV d'entrée de l'effet (échantillonner l'effet dans un
  repère déformé). Les deux ont des conséquences très différentes sur les
  effets qui LISENT l'image (déformer la sortie ≠ déformer le champ).
- Interaction avec les paramètres spatiaux existants (une box d'aplat étirée
  par ses poignées ET par le scale générique : qui compose avec qui).
- Poignées : `TransformHandles` sait déjà tout faire (huit poignées, rotation)
  — la pièce UI existe, c'est le modèle en dessous qui manque.
- Presets, références de pixels, historique.

**Blocked by:** None pour le cadrage. Le code attend le cadrage.

**Status:** ready-for-human (cadrage écrit, prototype à rendre — verdict d'Antoine sur planche)
**Type:** research

- [x] Cadrage écrit : où vit le scale, ce qu'il compose, ce qu'il coûte —
      `../research/24-transform-cadrage.md` (2026-09-04). Fait central mesuré :
      trois classes d'effets (champ pur / ponctuel / lecteurs d'image, taps
      comptés sur les 26 modules), aucune voie générique parfaite pour les
      trois. Reco : voie B (transformer l'UV d'entrée de `fs_main`), champ
      `effectTransform` neuf sur `LayerState`, identité au bit près.
- [x] Prototype jetable RENDU (2026-09-04) : planche
      `../assets/planche-24-transform.html` — 3 effets × 2 voies × 3 états,
      crops 1:1 glow, mesures par vignette. Voie B parfaite sur champ pur,
      dédoublement voie A visible partout. ⚠️ Prémisse du cadrage corrigée
      sur pièce : `composeShader` enveloppe CHAQUE passe — la voie B réelle
      se gate sur `opts.applyMask` (variant mesuré : halo glow préservé).
      **Reste le verdict d'Antoine sur la planche.**
- [ ] Plan de tranches validé, puis code.
