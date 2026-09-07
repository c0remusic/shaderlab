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

**Status:** ready-for-human
**Type:** task

- [x] Case « Sélection auto » dans la barre du Déplacer, défaut off.
- [x] Clic toile → sélection du calque couvrant le plus haut (photo par
      couverture, effet par masque non nul, sans masque = couvre partout).
- [x] Clic-glisser enchaîne sélection puis déplacement sans lever le bouton.
- [x] Stories du comportement (case, hit-test pur testé en unit — module pur
      style `effectMove.ts`).
- [ ] Validation en gestes par Antoine.

---

**Livré (commit `feat(outils): sélection automatique du calque au clic (ticket 26)`)**

- `src/ui/autoSelect.ts` — `hitTestAutoSelect`, hit-test PUR (17 tests unit,
  `test/ui/autoSelect.test.ts`). Lit les rasters pinceau COMMITTÉS de la pile
  complète (pas `MaskPainter`, qui ne tient que le calque sélectionné en cours
  de trait — auto-select hit-teste TOUS les calques). Sources paramétriques
  (dégradé/luminosité/plage/forme) non lisibles CPU : traitées comme couvrant
  partout, documenté. Verrous NON consultés (un `locks.all` reste sélectionnable).
- `src/components/AutoSelectMoveSurface.tsx` (+ `.css`) — surface whole-canvas,
  montée derrière les poignées précises, remplace `EffectMoveSurface` tant que
  la Sélection auto est active. Sélection sur l'appui puis déplacement du même
  geste. Le mouvement réutilise `handleTransformChange` (photo) et
  `handleParamChange` (effet) — tous deux appairent `replaceLiveLayers` +
  `requestRender`.
- `ToolOptionsBar` — case composée depuis `ui/checkbox` (ADR-0001), section
  Déplacer, défaut OFF ; état `autoSelect` d'interface dans `App` (pas de
  `LayerState`, pas d'historique).

**Validation du geste (à faire par la session principale / Antoine)** — non
lancée ici : la fenêtre d'Antoine est ouverte avec son document, piloter
l'auto-select par CDP changerait sa sélection / déplacerait ses calques.
Protocole : cocher « Sélection auto » (outil Déplacer) ; clic sur un calque
d'effet masqué au pinceau → il se sélectionne là où le masque est non nul, pas
ailleurs ; clic-glisser sur une photo non sélectionnée → elle se sélectionne et
suit le curseur sans relâcher ; clic dans le vide → désélection ; un calque
`locks.all` se sélectionne mais ne se déplace pas ; case décochée → geste
d'origine inchangé.
