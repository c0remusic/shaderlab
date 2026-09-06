# 26 — Sélection automatique du calque au clic sur la toile

**What to build:** Avec l'outil Déplacer (V) actif, cliquer la toile sélectionne
le calque le plus haut qui COUVRE ce pixel — le « Sélection auto » de Photoshop.
Togglable : case « Sélection auto » dans la barre d'options de l'outil Déplacer,
défaut **désactivé** (la convention Photoshop, vérifiée — leur Auto-Select est
OFF par défaut). Demande d'Antoine au grilling en gestes du 2026-09-06, design
validé le même jour (« Q3 ok »).

**Ce que « couvre » veut dire, par genre de calque :**
- calque photo : sa couverture (alpha de la pré-passe, hors bornes = ne couvre
  pas) ;
- calque d'effet : masque non nul à ce pixel — le masque EST le canal alpha
  d'un calque d'effet (verrous, 2026-08-19) ; un calque sans masque couvre
  partout ;
- ordre de parcours : du haut de la pile affichée vers le bas (repère
  ADR-0004), premier couvrant gagne.

**Points de code :**
- Le hit-test du masque demande une lecture CPU de la valeur du masque au
  pixel — `MaskPainter` possède les rasters côté CPU (espace de la photo de
  fond), aucun readback GPU nécessaire.
- La sélection est un état d'INTERFACE (`App.tsx`), pas de `LayerState` — pas
  d'historique, pas de preset.
- La case vit dans la barre d'options du Déplacer (même zone que les options
  d'outil existantes) — contrôle composé depuis `ui/`, ADR-0001.
- Ne pas casser le geste actuel : clic-glisser sur le calque déjà sélectionné
  déplace ; avec Sélection auto active, le clic re-sélectionne d'abord puis le
  glissement déplace le nouveau sélectionné (comportement Photoshop).
- Verrous : un calque `locks.all` reste sélectionnable (sélectionner n'est pas
  modifier — le déverrouillage doit rester atteignable).

**Blocked by:** None.

**Status:** ready-for-agent
**Type:** task

- [ ] Case « Sélection auto » dans la barre du Déplacer, défaut off.
- [ ] Clic toile → sélection du calque couvrant le plus haut (photo par
      couverture, effet par masque non nul, sans masque = couvre partout).
- [ ] Clic-glisser enchaîne sélection puis déplacement sans lever le bouton.
- [ ] Stories du comportement (case, hit-test pur testé en unit — module pur
      style `effectMove.ts`).
- [ ] Validation en gestes par Antoine.
