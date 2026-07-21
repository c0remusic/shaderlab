# Remédiation de l'audit clean-code — Design

**Objectif :** Corriger l'ensemble des constats P0 à P3 de l'audit du 2026-07-21 sans modifier le rendu couleur ni le contrat Lightroom.

## Découpage

Le travail est séparé en trois plans indépendants, dans cet ordre :

1. **Mask integrity** — corrige les sources paramétriques de masque, leur cache de fold et leur activation individuelle.
2. **Document and export safety** — rend l'ouverture transactionnelle, garantit que l'export manuel ne remplace jamais un fichier existant et unifie les contrats de domaine et les erreurs UI.
3. **UI runtime hygiene** — stabilise drag, timers/rAF, historique no-op, raccourcis, composants morts et commentaires périmés.

## Invariants non négociables

- Une source paramétrique activée est pliée dans le masque avec les mêmes règles `add`/`subtract`/`intersect` qu'une source pinceau.
- Toute modification pertinente d'une source invalide le cache de masque plié : activation, ordre, mode, raster, type ou paramètres.
- L'export manuel produit un nouveau chemin réellement disponible ; seul le round-trip Lightroom peut remplacer son chemin d'entrée.
- Une ouverture qui échoue laisse le document précédent intégralement utilisable.
- Une interaction qui ne change aucune valeur ne crée pas d'entrée d'historique.
- Les textures, timers et rAF transitoires sont nettoyés après leur dernière utilisation ou à l'unmount.

## Architecture

`MaskSource` devient une union discriminée : `BrushMaskSource` porte un raster obligatoire, `ParametricMaskSource` porte des paramètres obligatoires et aucun raster. Le plan de fold et son snapshot opèrent sur toutes les sources activées ; le snapshot encode la donnée pertinente à l'invalidation.

L'export reçoit une frontière asynchrone de résolution de destination, capable d'interroger l'existence de fichiers depuis Rust. L'ouverture prépare un nouveau renderer avant de remplacer l'instance active. Les frontières UI convertissent toute valeur rejetée en message exploitable.

Les correctifs UI restent localisés : le drag conserve son état courant au moment du relâchement, chaque temporisation/rAF a un cleanup, et le modèle expose un résultat de mutation pour éviter les commits d'historique vides.

## Validation

Chaque règle de domaine est couverte par Vitest. Les flux Tauri sont vérifiés par `cargo check`; frontend par `npx tsc --noEmit`, `npm run test`, `npm run lint:tokens` et `npm run build`.

Le plan Mask integrity se termine par le checkpoint humain existant dans la vraie WebView2 : sources gradient, luminosité et plage couleur, combinaisons, activation individuelle, inverse, refine edge et absence d'erreur console/GPU. Playwright headless n'est pas une preuve de rendu WebGPU.

## Hors scope

- Vrai color picker canvas pour la plage couleur, déjà différé à Tranche 4.
- Persistance de document et refonte du modèle d'identifiants au-delà de la session.
- Nouveaux effets, nouveaux modes de fusion et export impression.
