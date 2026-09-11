# 07 — Parité de qualité et de layout des contrôles avec Lightroom

Type: task
Status: ready-for-agent
Blocked by: 05 (HSL) et 06 (Color Grading, qui apporte la roue) — le panneau et ses contrôles sont retouchés ici APRÈS que les modules existent, pas avant

**What to build :** Antoine, 2026-09-11 : « Il faut aussi que la qualité et le
layout des contrôles soit de qualité identique. » Le panneau « Développement »
doit se lire et se manipuler comme le module Développement de Lightroom
Classic 14.5 — même densité, mêmes gestes, mêmes formes de contrôle. Référence
MESURÉE : `assets/reference-ui/lightroom-14.5-developpement-reglages-de-base.png`
(capture 1:1 de sa fenêtre, 3456×1408) et son crop `panneau-droite-1x.png`
(la colonne de droite, 346×1150 à l'échelle 1). Les chaînes françaises de tous
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

- [ ] Développement = son propre groupe de dock, hors de Presets/Propriétés, mesuré à 1345 px.
- [ ] Accordéon avec œil par module (`enabled` dans `DevelopSettings`, sauté si off), Solo proposé.
- [ ] Ligne de curseur : valeur signée éditable à droite, double-clic libellé = défaut, sous-titres de section.
- [ ] N&B en bandeau (bascule HSL) ; Auto/HDR/Profil/pipette : non, dit dans le ticket.
- [ ] Mélangeur : vues Couleur / Mélange, pastilles.
- [ ] Color Grading : roues (06) en rangée avec icônes, vue Tout.
- [ ] Précédent / Réinitialiser en bas.
- [ ] Capture côte à côte à l'échelle 1, validée par Antoine.
