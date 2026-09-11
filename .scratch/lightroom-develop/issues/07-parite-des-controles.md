# 07 — Parité de qualité et de layout des contrôles avec Lightroom

Type: task
Status: ready-for-agent
Blocked by: 05 (HSL) et 06 (Color Grading, qui apporte la roue) — le panneau et ses contrôles sont retouchés ici APRÈS que les modules existent, pas avant

**What to build :** Antoine, 2026-09-11 : « Il faut aussi que la qualité et le
layout des contrôles soit de qualité identique. » Le panneau « Développement »
doit se lire et se manipuler comme le module Développement de Lightroom
Classic 14.5 — même densité, mêmes gestes, mêmes formes de contrôle. Référence
MESURÉE (captures 1:1 de la colonne de droite de Lightroom 14.5, 346 px de large,
prises par `PrintWindow` sur sa fenêtre — versionnées, ce sont des références) :
`assets/reference-ui/lightroom-14.5-reglages-de-base-1x.png` (Histogramme,
bandeau Auto/N&B/HDR, Profil, Balance des blancs, Tonalité, Présence, puis les
en-têtes repliés Courbe / Mélangeur / Color Grading) et
`lightroom-14.5-color-grading-et-detail-1x.png` (les roues de Color Grading
— vue trois roues, Fusion, Balance — et le panneau Détail : Réduire le bruit,
aperçu 1:1, Netteté Quantité/Rayon/Détail/Masquage, puis les en-têtes
Corrections / Transformation / Flou / Effets / Étalonnage). ⚠️ Courbe des
tonalités, Mélangeur de couleurs (les deux vues) et Étalonnage dépliés NE SONT
PAS capturés : piloter la fenêtre de Lightroom par messages postés ne marche
pas (clics inertes, mesuré), et la piloter par souris réelle prend la main sur
la machine d'Antoine — à capturer quand il ouvre lui-même ces panneaux, ou par
un `LrView`… non : le SDK ne capture pas l'interface. Les libellés, eux, sont
tous dans `assets/lr-fr-develop-strings.txt`. Les chaînes françaises de tous
ses libellés sont dans `assets/lr-fr-develop-strings.txt`.

## Sa propre fenêtre (Antoine, 2026-09-11)

« Et que cette partie ait sa propre fenêtre/onglet, pas qu'elle soit intégrée
à presets. » Le ticket 03 a posé Développement en ONGLET du groupe
Presets/Propriétés — refusé. Le panneau devient son PROPRE groupe de dock
(`ui/dockLayout.ts` : un `DockGroup` à lui, repliable, dans la colonne de
droite ; si la colonne ne tient pas à 1345 px avec Pile + Propriétés +
Développement, la carte borne sa hauteur et défile DEDANS — ADR-0001, la
colonne ne défile jamais — ou le dock passe à deux colonnes de cartes comme le
ticket 02 de `retour-usage-execution` l'a fait). « Hésite pas à prendre des
screenshots et à comparer » : chaque livraison de ce ticket produit une
capture CDP de notre panneau côte à côte avec la capture Lightroom du même
panneau, à la même échelle, dans `assets/reference-ui/`.

## Ce que la capture montre, à reproduire (mesurer, pas supposer)

1. **Accordéon** : chaque panneau (Histogramme, Réglages de base, Courbe des
   tonalités, Mélangeur de couleurs, Color Grading, Détail, Corrections de
   l'objectif, Transformation, Effets, Étalonnage) est un en-tête pleine
   largeur, titre à droite, triangle de repli, et un **interrupteur (œil)** à
   gauche qui ACTIVE/DÉSACTIVE le panneau entier sans perdre ses valeurs
   (`Enable*` dans les XMP — chez nous : un booléen par module dans
   `DevelopSettings`, module désactivé = sauté comme au défaut). Un seul
   panneau ouvert à la fois en « Solo » (Alt-clic) — ⚠️ le Solo mode a été
   REFUSÉ pour la pile (`hybride-lightroom-photoshop`, ticket 04) ; ici c'est
   le comportement de Lightroom lui-même, à proposer, pas à imposer.
2. **Ligne de curseur** : libellé à gauche, piste fine au centre, valeur
   éditable à droite (largeur fixe, alignée), signe explicite (« + 100 »,
   « − 0,46 »), pas de bouton « − / + ». **Double-clic sur le libellé =
   retour au défaut** ; molette et flèches sur la valeur ; Maj = grands pas.
   Sous-titres de section (« Tonalité », « Présence ») en petites capitales
   grises, sans boîte.
3. **Bandeau du panneau Réglages de base** : « Profil » (hors sujet ici) puis
   les boutons **Auto · N&B · HDR** (chez nous : Auto = hors périmètre sans
   analyse d'image → NON ; N&B = bascule le mode du module HSL ; HDR = non).
   Pipette de balance des blancs (hors sujet en JPEG relatif — non).
4. **Mélangeur de couleurs** : en tête, « Réglages : » avec **Couleur /
   Mélange** (deux vues : par TEINTE — huit pastilles colorées, une couleur à
   la fois avec ses trois curseurs — ou par CANAL : Teinte / Saturation /
   Luminance / Tout, les huit bandes en colonne). Chaque bande porte une
   pastille de sa couleur devant son curseur. L'outil de réglage direct
   (glisser sur la photo, `HueOnTooltip`) : suite, pas ici.
5. **Color Grading** : rangée d'icônes (Ombres · Tons moyens · Hautes lumières
   · Globale · Tout), **une roue** par plage (pourtour teinte, rayon
   saturation, point), curseur Luminance dessous, puis Fusion et Balance.
   Vue « Tout » = trois petites roues côte à côte.
6. **Courbe des tonalités** : région (paramétrique) avec ses quatre curseurs et
   ses trois séparations tirées SOUS la courbe ; courbe à points par canal —
   `curves` a déjà `CurveControl`, à rapprocher visuellement.
7. **Bas du module** : « Précédent » · « Réinitialiser » pleine largeur.
8. Densité : hauteur de ligne, tailles de police, gouttières — LIRE sur le crop
   1:1 (les 346 px de large sont à l'échelle de l'écran 3456 ; notre dock fait
   320 px) et rapporter au token le plus proche de `src/design/` ; ne pas
   inventer une valeur, et ne pas redéfinir un token (lint:tokens).

## Contraintes du dépôt

- ADR-0001 : un contrôle par ligne de liste est interdit → l'œil par PANNEAU
  est un contrôle par panneau, pas par ligne ; OK. La colonne ne défile pas :
  la carte Développement borne sa hauteur et défile DEDANS, ou un seul panneau
  ouvert à la fois (Solo) — mesurer à 1345 px avec les 4 modules.
- Un contrôle se COMPOSE des primitives `src/components/ui/` (curseur,
  bascule, onglets) et habille sa mise en page en CSS BEM (CLAUDE.md § Stack).
  Un curseur maison est interdit : si `LabeledSlider` ne sait pas faire le
  double-clic-défaut ou la valeur signée, on l'étend, on ne le fourche pas.
- Stories pour chaque forme (ligne de curseur, accordéon, roue, mélangeur en
  deux vues), `test-storybook` ENTIER. Capture CDP côte à côte avec le crop
  Lightroom, à la même échelle, pour Antoine.

- [x] Développement = son propre groupe de dock, hors de Presets/Propriétés, mesuré à 1345 px.
- [x] Accordéon avec œil par module (`enabled` dans `DevelopSettings`, sauté si off), Solo proposé.
- [x] Ligne de curseur : valeur signée éditable à droite, double-clic libellé = défaut, sous-titres de section.
- [x] N&B en bandeau (bascule HSL) ; Auto/HDR/Profil/pipette : non, dit dans le ticket.
- [ ] Mélangeur : vues Couleur / Mélange, pastilles. → DIFFÉRÉ (voir Livraison).
- [ ] Color Grading : roues (06) en rangée avec icônes, vue Tout. → HORS 07 (vient au 06).
- [x] Précédent / Réinitialiser en bas. → « Réinitialiser » livré ; « Précédent » écarté (voir Livraison).
- [ ] Capture côte à côte à l'échelle 1, validée par Antoine. → capture produite, validation d'Antoine en attente.

## Livraison 2026-09-11 (agent, sous-agent Opus 4.8)

UN commit. Périmètre : le 07 SAUF la roue chromatique (06) et SAUF le mélangeur
deux-vues (différé, raison ci-dessous). Aucun shader touché.

**Fichiers.** État/logique : `src/layers/developSettings.ts` (clé réservée
`__moduleEnabled` + `isDevelopModuleEnabled`/`setDevelopModuleEnabled`),
`src/render/framePipelineExecutor.ts` (saut d'un module désactivé),
`src/presets/presetDocument.ts` (la clé réservée traverse l'application de
preset). UI : `src/components/ui/labeled-slider.tsx` (layout `inline` + valeur
alignée à droite), `src/ui/formatValue.ts` (`formatSignedValue`/`parseSignedValue`),
`src/components/ParamPanel.tsx` + `.css` (prop `develop` : inline signé, sections
en `liste`, sous-titres centrés), `src/components/ui/collapsible.tsx` (Disclosure
gagne un slot `leading` + `align="end"`, chemin défaut byte-identique),
`src/components/DevelopPanel.tsx` + `.css` (accordéon à œil, bandeau N&B),
`src/App.tsx` (dock : Développement en groupe propre ; handlers œil + reset
d'étage ; pied fixe). Stories : `DevelopPanel.stories.tsx`,
`ui/labeled-slider.stories.tsx`. Tests : `test/layers/developSettings.test.ts`,
`test/ui/formatValueSigned.test.ts`, `test/presets/presetDocument.test.ts` (+1).

**Décisions là où le ticket laissait un choix.**
- **`enabled` par module** : encodé dans une CLÉ RÉSERVÉE de `DevelopSettings`
  (`__moduleEnabled`, `Record<moduleId, 0|1>`), pas un champ séparé. Raison :
  l'objet `develop` traverse déjà renderer/executor, History (clone) et les
  presets (capture) sans plomberie ; un second champ aurait dû être threadé à
  chacun. Absence de clé = tout activé, donc `test:render` byte-identique. Le
  SEUL endroit qui itère les clés comme des modules (application de preset) a un
  cas gardé — sinon la clé aurait déclenché un faux « module inconnu ». Test de
  round-trip ajouté.
- **Solo (Alt-clic)** : PROPOSÉ, non implémenté (le ticket demande de proposer,
  pas d'imposer). C'est le comportement de Lightroom lui-même, mais le Solo a
  été refusé pour la PILE (`hybride-lightroom-photoshop`, ticket 04) car il
  rendait des panneaux mutuellement exclusifs qu'on lit ensemble ; ici les
  modules de l'étage se lisent souvent un à la fois, donc Solo aurait du sens.
  À trancher par Antoine avant de le poser.
- **« Précédent »** : écarté. Chez Lightroom il copie les réglages de la photo
  PRÉCÉDEMMENT sélectionnée — notion absente d'un éditeur à un seul document.
  L'undo global (Ctrl+Z) et le double-clic-défaut par curseur couvrent le
  « revenir en arrière ». Seul « Réinitialiser » (tout l'étage aux défauts, un
  undo) est livré, en pied fixe hors du défilement (ADR-0001).
- **Hauteur de ligne** : Lightroom fait ~20 px/ligne (mesuré sur le crop 1:1,
  346 px de large). Aucun token n'existe à ~20 px ; le plus proche est
  `--control-height-md` (30 px), réutilisé plutôt qu'inventer une valeur (le
  ticket demande « choisis le plus proche, dis-le »). La ligne inline (une
  ligne) reste bien plus dense que l'empilée d'avant (~50 px).
- **Séparateur décimal** : l'app affiche le point (« − 0.46 »), pas la virgule
  française de Lightroom (« − 0,46 ») — cohérence avec tous les curseurs
  d'effet ; le parse tolère la virgule à la saisie. Le SIGNE et l'alignement à
  droite (les traits de parité) sont livrés.

**Mesures sur les captures 1:1 (346 px de large).** Pas de ligne de curseur
≈ 20 px (pistes Exposition y≈490 / Contraste y≈510, écart 20 ; blocs HL/Ombres/
Blancs/Noirs et Présence au même pas). En-tête d'accordéon replié ≈ 32 px
(en-têtes Courbe y≈776 / Mélangeur y≈808 / Color Grading y≈840). Tokens choisis :
ligne = `--control-height-md` (30 px) + `--font-size-sm` (12 px) ; en-tête =
`--section-header-height` (28 px) ; valeur = `--slider-value-width` (9ch),
alignée à droite ; grille de ligne en fractions (`1.1fr / 1fr / 9ch`, aucune
dimension en dur, pistes alignées d'une ligne à l'autre).

**Curseurs des EFFETS (panneau Propriétés) : INCHANGÉS.** L'inline/signé n'est
armé que par la prop `develop` de `ParamPanel`, faux par défaut ; le chemin
empilé de `LabeledSlider` et le chemin par défaut de `Disclosure` sont
byte-identiques (mêmes sorties). Vu en story (les stories d'effet et de curseur
empilé passent inchangées).

**Mélangeur deux-vues (item 5) : DIFFÉRÉ.** C'est une présentation bespoke
(vue par TEINTE avec 8 pastilles + 3 curseurs ; vue par CANAL Teinte/Sat/Lum/
Tout avec 8 bandes), avec ses propres stories et sa roue chromatique liée au 06.
Le module HSL rend aujourd'hui correctement ses 33 params en sections
(Teinte/Saturation/Luminance/Mélange) avec la parité de contrôle (inline signé).
Les pastilles à réutiliser = couleurs de `hslBandes.ts` (`rgb` par bande, dans
l'ordre red…magenta). À faire avec le 06.

**Gates** (verdicts en fin de session, section Rapport de l'agent).
