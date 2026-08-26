# 20: L'outil Déplacer agit sur les effets qui ont un lieu

**What to build:** Sélectionner un calque d'effet qui déclare un ancrage sur la
toile (`EffectModule.canvasControls`), prendre l'outil **Déplacer** et le tirer :
l'effet se déplace. Aujourd'hui l'outil sort immédiatement sur tout calque sans
`imageSource` — mesuré : `if (!layer?.imageSource || !layer.transform) return;`
(`src/hooks/usePhotoLayer.ts`, deux occurrences). Les cinq effets qui ONT un lieu
ne se déplacent donc qu'en tirant leur poignée propre sur la toile, jamais avec
le geste que l'utilisateur attend.

Concerne les effets qui déclarent `canvasControls` — au 2026-08-21 : `aplat`,
`lensFlare`, `lightLeak`, `motionBlur`, `pixelStretch`. Le geste écrit dans les
paramètres spatiaux de l'effet (`spatialParams.ts` en est l'énumération unique),
il ne crée AUCUN `transform` sur un calque d'effet.

⚠️ **Le critère est `canvasControls`, jamais le nom ni la catégorie de l'effet.**
`spatialParams.ts` dit pourquoi en toutes lettres : deviner par motif « marche
jusqu'au jour où un effet nomme autrement, et ça échoue alors sans rien dire ».
Un effet sans ancrage n'est PAS déplaçable, et c'est correct — un calque de
réglage (courbes, niveaux) n'a pas de position chez Photoshop non plus.

**Origine** : retour d'Antoine du 2026-08-21 devant l'app — « on veut pouvoir
déplacer les calques qui sont des effets créatifs et pas des outils de retouche
photo ». Le diagnostic a d'abord cherché un déplacement de groupe fantôme ; il
n'existe pas (`onTransformChange` ne passe qu'un id, les calques d'effet n'ont
pas de `transform`). Le vrai manque est ce branchement.

**Blocked by:** None (can start immediately).

**Status:** ready-for-human

- [x] Déplacer un calque d'effet à ancrage le déplace réellement, à la souris.
      (`src/ui/effectMove.ts` + `EffectMoveSurface`, montée derrière les poignées.)
- [x] Un effet SANS ancrage reste non déplaçable (pas de faux affordance) —
      `effetDeplacable` dérivé du patch, surface non montée ; couvert aussi :
      `motionBlur` en Directionnel (axe seul) et `aplat` borné par le masque
      (`visibleWhen` non rempli).
- [x] Le geste écrit dans les paramètres spatiaux ; aucun `transform` n'apparaît
      sur un calque d'effet. La translation ne touche que les rôles `x`/`y` —
      les rôles `extentX`/`extentY` ont été séparés de `x`/`y` dans
      `controlFieldRoles` pour que tirer un `aplat` le déplace au lieu de
      l'agrandir.
- [x] Une entrée d'historique par geste (chemin vivant existant
      `handleParamChange`/`handleParamCommit` ; un clic sous 3 px d'écran reste
      la désignation habituelle et n'écrit rien).
- [ ] Validé à l'œil par Antoine.
