# 12 — Outil Forme dessine un aplat rempli

**What to build:** On empoigne l'outil Forme (`U`) dans la barre, on trace → une
forme remplie (aplat) apparaît directement, via la source géométrique du ticket
11. `aplat` quitte la liste d'effets choisissable. Modèle d'un calque de forme
Photoshop : un geste crée la forme, on ne la cherche plus dans une liste.

**Blocked by:** 11 — la source de sélection géométrique est le socle du tracé.

**Status:** ready-for-human
**Type:** task

- [x] Tracer avec l'outil Forme pose une forme DIRECTEMENT, hors liste d'effets — REQUALIFIÉ par la décision du ticket 10 (« une forme SÉLECTIONNE »). Sur un calque d'EFFET sélectionné, le tracé pose/actualise une source de masque `shape` (le marquee de Photoshop) ; rien de sélectionné → un nouveau calque `aplat` rempli, comme avant.
- [ ] `aplat` n'est plus une entrée choisissable de la liste d'effets — **NON FAIT, hors périmètre du brief** (le brief cadre le GESTE ; retirer `aplat` du sélecteur est une décision de catalogue qui touche `EffectPicker`/`catalog.ts` et les références de pixels). À trancher/exécuter dans un ticket dédié.
- [x] Dégradé (linéaire/radial) et polygone (3–12 côtés) de l'`aplat` restent accessibles — l'effet `aplat` est inchangé, le tracé « rien sélectionné » le crée toujours.
- [ ] Validé à l'œil par Antoine — le GESTE d'abord (ce qu'on fait pour créer la forme).

## Livré (session 2026-09-07)

Geste étendu : l'outil Forme (`U`) trace une SÉLECTION géométrique sur le calque
d'effet sélectionné.

- Cible du geste (`src/ui/shapeMarquee.ts`, pur, testé) : `planShapeGesture` →
  `marquee` (calque d'effet, masque libre), `aplat` (rien de sélectionné, ou
  calque PHOTO), `refused` (masque verrouillé — le geste ne fait RIEN).
- Aperçu VIVANT pendant le glissement (`replaceLiveLayers` + `requestRender`
  appairés, patron `handleEffectTransformChange`) ; COMMIT d'historique au
  relâcher ; ANNULATION (clic sans ampleur / `pointercancel`) qui restaure
  l'instantané committé. La bande élastique + la mesure en px s'affichent déjà
  pour tout tracé (symétrie des gestes préservée).
- Maj = carré sur la toile (via `rectFromDrag` existant) ; deux coins normalisés
  [0,1] posés tels quels dans `shape.params[0..3]` (`shapeBoxFromRect`).
- Verrou `mask` refusé aux DEUX portes (App via `planShapeGesture`, et
  `replaceLiveLayers`/`fusionnerSousVerrous` en second rideau).

### Décisions / écarts à valider
- Calque PHOTO sélectionné → retombe sur l'aplat (comportement d'avant préservé),
  pas de marquee : un effet ne se pose pas sur une photo (ADR-0008).
- Le marquee REDESSINE la 1re source `shape` existante (il ne l'empile pas) ;
  `feather`/`invert`/`mode` réglés dans le panneau Masque survivent au retracé.
- La barre d'options de l'outil (couleur/dégradé) ne s'applique qu'au tracé
  d'APLAT ; elle n'a pas d'effet sur le marquee (une sélection n'a pas de
  couleur). La cohérence barre↔calque est le ticket 27, hors périmètre ici.

### Gates
`npx tsc --noEmit` vert · `npm run test` 146 fichiers / 2151 tests verts (inclut
`test:wgsl`) · `npm run lint` 0 warning · `test-storybook` 34 / 347 verts.
`test:render` NON lancée et laissée telle quelle : aucun fichier de `src/render/`
touché, le geste n'ajoute aucun pixel par défaut (aucun scénario de référence
n'exécute ce geste).
