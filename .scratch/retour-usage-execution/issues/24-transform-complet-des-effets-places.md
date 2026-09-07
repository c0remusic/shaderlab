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

**Status:** ready-for-human (tranches 1-2-3 LIVRÉES ; reste la validation en gestes d'Antoine — voir « Livré » ci-dessous)
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
- [x] Tranche 1 (modèle) + tranche 2 (moteur) livrées — commit `2c6ab1c`.
- [x] Tranche 3 (poignées) livrée — voir « Livré » ci-dessous.
- [ ] Validation en gestes par Antoine (protocole ci-dessous).

---

**Livré tranches 1-2 (commit `2c6ab1c`, voie B)** — `LayerState.effectTransform`
{scaleX, scaleY}, mutateur `setEffectTransform` gardé par le verrou position
(LayerStack + porte `replaceLiveLayers`), moteur binding 8 sur la seule passe de
compositing (UV d'entrée déformé autour de l'ancre `resolveEffectAnchor`), exclu
des presets. Identité au bit près, référence neuve `effet-transform-lightleak`.

**Livré tranche 3 — poignées (ce commit `feat(outils): étirer et aplatir un
calque d'effet aux poignées (ticket 24, tranche 3)`)**

- `src/ui/effectStretch.ts` — géométrie PURE du geste (13 tests unit,
  `test/ui/effectStretch.test.ts`). `stretchScale(poignée, ancre, échelle de
  départ, dx, dy)` : delta cumulé DEPUIS L'APPUI (pas de saut à la prise, pas de
  dérive aux bornes), pivot sur l'ANCRE et non le côté opposé — c'est ce que fait
  le moteur, une poignée doit montrer la déformation qu'elle commande. Bornes
  `[0.05, 8]` par axe, jamais de négatif (miroir non demandé). `transformedFrame`
  / `handlePoint` : la boîte est le cadre [0,1]² étiré autour de l'ancre
  (identité = épouse la toile, peut déborder).
- `src/components/EffectTransformHandles.tsx` (+ `.css`, `.stories.tsx`) — huit
  pastilles + cadre focusable. Monté APRÈS `EffectMoveSurface` et
  `AutoSelectMoveSurface` (donc au-dessus dans l'ordre de prise) et fonctionne
  dans les DEUX modes de Sélection auto : le reste de l'overlay est
  `pointer-events: none`, donc la translation reste à la surface du dessous et
  seul l'étirement passe par les pastilles — pas de `!autoSelect` dans sa
  condition. Clavier : le cadre (flèches = étirer/aplatir, commit au keyup),
  seule route clavier car `effectTransform` n'a pas de champ de panneau.
- `src/App.tsx` — `handleEffectTransformChange` (chemin vivant : map ciblé +
  `replaceLiveLayers` appairé avec `requestRender`, commit via `handleParamCommit`
  qui ne commite que si `paramDirtyRef` a été salie). Montage gardé par le verrou
  position et par `effetDeplacable` (même population que le déplacement).

**Écart au brief, sur pièce** — la « note du moteur » (rapport tranche 2)
demandait de faire entrer `effectTransform` dans l'epoch/clé du guide de
`computeGuideEpochs`, un masque edge-aware au-dessus d'un calque transformé
pouvant sinon servir une SAT périmée au glissement vivant. **La prémisse est
fausse dans le code** : `guideChainKey`/`layerContentKey` (`contentKey.ts`)
sérialisent la `LayerState` par PARCOURS STRUCTUREL, donc `effectTransform` entre
DÉJÀ dans la clé (vérifié à l'exécution : deux échelles distinctes → deux clés
distinctes). `computeGuideEpochs` lit cette clé pour périmer le guide d'un calque
au-dessus, donc la SAT est reconstruite quand l'étirement change — aucun code
d'epoch neuf à ajouter (ce serait du code mort). Traité par un TEST de
non-régression au lieu d'une implémentation :
`test/layers/contentKey.test.ts` (« distingue l'étirement (effectTransform) d'un
calque d'effet ») fige le comportement — un futur passage à une liste énumérée de
champs le casserait là avant de le casser en silence à l'écran.

**Gates** (03:19, worktree master) : `npx tsc --noEmit` vert · `npm run test`
145 fichiers / 2137 tests verts (+1 fichier, +14 tests) · `npm run lint` 0
warning (pas de rafale `Unused eslint-disable` → compilateur React toujours actif
sur App.tsx) · `npm run lint:tokens` 0 finding / 282 fichiers · `npm run
test-storybook` EN ENTIER 34 fichiers / 347 tests verts (+1 fichier de stories).
`test:render` NON lancé : cette tranche ne touche AUCUN fichier de rendu (shader,
`shaderCompose`, `effectPassRunner`, `render-check.mjs`, scénarios, références) —
zéro écart structurel, aucun scénario exercé n'a changé ; et le lancer aurait
exigé de piloter CDP 9222, la fenêtre d'Antoine, que le brief interdit de toucher
(dev:debug tuerait aussi sa fenêtre par nom).

**Validation du geste (à faire par la session principale / Antoine)** — non
lancée ici : piloter les poignées par CDP sur la fenêtre d'Antoine changerait son
document. Protocole en gestes : outil Déplacer, sélectionner un calque d'effet à
ancrage (ex. Fuite de lumière, Aplat, Reflet d'objectif) → un cadre à huit
pastilles épouse la toile ; tirer la pastille du BAS vers le haut → le champ de
l'effet s'APLATIT autour de son ancre, la photo dessous ne bouge pas ; tirer un
COIN → étirement sur les deux axes ; relâcher → une seule entrée d'historique,
Ctrl+Z revient à l'état d'avant le geste ; cocher « Sélection auto » → les
pastilles restent attrapables et étirent, un glissement AILLEURS sur la toile
sélectionne/déplace (surface du dessous) ; un calque verrouillé en position →
aucune pastille ; au clavier, Tab jusqu'au cadre puis flèches → étire/aplatit par
petits pas (Maj = plus grand).
