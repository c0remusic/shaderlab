# Design QA — dock plat et plan de travail

> Archivé depuis le rapport racine `design-qa.md` lorsque celui-ci a été
> remplacé par la QA plus récente du contrôle Gradient Map.

## Evidence

- **Source visual truth:** `C:\Users\LEETJ\AppData\Local\Temp\codex-clipboard-f8a8bad9-c3cf-409a-9ecd-25d38ce5b794.png`
- **Implementation screenshot:** `C:\dev\shaderlab\.dev-logs\dock-contrast.png`
- **Viewport/state:** bureau sombre, aucun fichier chargé, dock Calques/Réglages ouvert.
- **Runtime check:** `.canvas-stage` et `.workspace` ont la même largeur et hauteur (`fillsWorkspace: true`) dans la vraie WebView2 via CDP.

## Comparison note

La référence Photoshop est un état chargé, avec trois cellules de dock (Historique, Calques, Propriétés) et une image ouverte. La capture Shaderlab est un état vide, avec deux cellules seulement. Ces états ne sont pas comparables pour la densité, la hiérarchie complète du dock, l'image ou les interactions de resize; aucune conclusion de fidélité ne peut être tirée sur ces surfaces.

## Required fidelity surfaces

- **Fonts and typography:** texte d'interface compact en Segoe UI Variable, hiérarchie titre de panneau/texte de contrôle lisible. L'état chargé manque pour évaluer les libellés denses de calques et d'historique.
- **Spacing and layout rhythm:** le dock reste ancré à droite et les séparateurs discrets structurent les cellules sans cadre. Le canvas remplit le plan de travail sous la toolbar, mais l'absence d'état chargé empêche de comparer les proportions avec la référence.
- **Colors and visual tokens:** canvas `--surface-window` (`#1b1b1b`) et dock `--panel-bg` (`#2c2c2c`) sont désormais distincts. Aucun contournement de token détecté par `npm run lint:tokens`.
- **Image quality and asset fidelity:** l'image de référence n'est pas ouverte dans Shaderlab; comparaison bloquée.
- **Copy and content:** Calques/Réglages restent cohérents, mais Historique et Propriétés n'ont pas de composants correspondants dans l'état actuel.

## Findings

- **[P1] États de comparaison incompatibles**
  - Location: référence Photoshop vs WebView2 Shaderlab.
  - Evidence: la référence contient une image, Historique, Calques et Propriétés; Shaderlab est vide et ne rend que Calques/Réglages.
  - Impact: le rendu ne peut pas être validé contre la référence à propos des proportions du canvas, du dock en colonnes, des cellules redimensionnables et du contenu dense.
  - Fix: ouvrir une image dans Shaderlab et fournir ou implémenter les cellules attendues avant de refaire la capture au même viewport.

- **[P1] Sens de « plein écran » non déterminé**
  - Location: plan de travail / fenêtre Shaderlab.
  - Evidence: le canvas remplit déjà son conteneur disponible; le rendu ne laisse aucune marge interne à supprimer.
  - Impact: forcer la fenêtre native en plein écran ou agrandir l'image avec recadrage sont deux comportements différents, dont l'un peut masquer les contrôles système ou altérer l'image.
  - Fix: confirmer lequel des deux comportements est souhaité avant une mutation de layout ou de fenêtre.

## Comparison history

1. Le canvas et le dock avaient une différence insuffisante (`#222222` contre `#2c2c2c`).
2. Le canvas a été déplacé sur `--surface-window` (`#1b1b1b`); la capture `dock-contrast.png` confirme une séparation visible sans bordure.

## Final result

blocked
