# shaderlab — design : dossier d'export dédié (export manuel)

> Cadré via `interview` puis `superpowers:brainstorming` le 2026-07-24. Le QUOI
> et le POURQUOI vivent dans `docs/archive/2026-07-24-PRD-export-folder.md`
> (archivé à la livraison, politique doc-rot) — ce document
> couvre le COMMENT. Suite : `superpowers:writing-plans`.

## Contexte

L'export manuel écrit aujourd'hui à côté de la photo source, avec un suffixe
`-edited`/`-edited-2`/... systématique (`resolveExportTargetAsync` dans
`src/export/exportImage.ts` — voir son doc comment : "ALWAYS returns a fresh
non-colliding path", jamais le chemin original). Ce chantier introduit un
dossier d'export dédié fixe (`Images/shaderlab-export`) pour l'export par
défaut, avec un override ponctuel par dossier via un bouton "Exporter sous...".
Le round-trip Lightroom (`isLaunchFile=true`, écrase le fichier de lancement au
même endroit) reste totalement inchangé.

## Architecture

Deux résolveurs de chemin cible, chacun avec son propre contrat de sécurité,
au lieu d'un seul résolveur paramétré :

- **`resolveExportTargetAsync`** (existant, `src/export/exportImage.ts`,
  **inchangé** — zéro régression sur ses tests actuels) : reste le résolveur du
  round-trip Lightroom (`isLaunchFile=true`, retourne toujours `sourcePath`) ET
  du bouton "Exporter sous..." (`isLaunchFile=false` avec un `sourcePath`
  reconstruit = dossier choisi + nom de fichier — toujours `-edited` en
  premier, jamais le nom nu). Comportement conservateur adapté à un dossier
  arbitraire choisi par l'utilisateur, y compris potentiellement le dossier de
  la photo source elle-même.
- **`resolveDefaultExportTarget`** (nouvelle fonction sœur, même fichier) :
  résolveur dédié au bouton "Exporter" par défaut, appelé uniquement avec
  `Images/shaderlab-export` + nom de fichier comme base. Essaie le nom nu en
  premier, `-edited`/`-edited-N` seulement en cas de collision réelle dans ce
  dossier.

Alternatives écartées :
- Un seul résolveur avec un flag `bareFirst: boolean` — mélangerait deux
  contrats de sécurité différents dans une fonction, plus dur à raisonner/
  tester séparément.
- Résolution de chemin (jointure dossier + nom) côté TS via regex plutôt que
  Rust — réinventerait la jointure de chemin Windows (séparateurs, accents,
  UNC) que `std::path::Path` gère déjà correctement, pour gagner un aller-
  retour IPC local négligeable.

## Composants

### Rust (`src-tauri/src/lib.rs`) — 3 nouvelles commandes, même pattern que `pick_image_file`

- `default_export_dir(app: tauri::AppHandle) -> Result<String, String>` —
  `app.path().picture_dir()` + jointure `shaderlab-export`. Ne crée PAS le
  dossier (la création se fait au moment de l'écriture, voir ci-dessous).
- `pick_export_folder() -> Option<String>` — `rfd::FileDialog::pick_folder()`,
  même contournement du bug `tauri-plugin-dialog` déjà en place pour
  `pick_image_file`. `None` si l'utilisateur annule.
- `join_export_target(source_path: String, dir: String) -> Result<String, String>`
  — extrait le nom de fichier de `source_path` (`Path::file_name()`), le joint
  à `dir` (`Path::join`). Fonction pure, testable comme `decode_target_path`.

`write_image_file` (existant) modifié pour créer le dossier parent
(`fs::create_dir_all`) avant l'écriture atomique — couvre la création
automatique et silencieuse du dossier par défaut ET d'un dossier override qui
viendrait à manquer, en un seul point de code déjà partagé par tous les
chemins d'écriture.

### Frontend — `src/launch.ts`

Trois wrappers fins (`defaultExportDir`, `pickExportFolder`,
`joinExportTarget`), même style qu'existant (`pickImageFile`, `pathExists`) :
une ligne, `invoke(...)`.

### Frontend — `src/export/exportImage.ts`

Ajout de `resolveDefaultExportTarget(basePath, availability)` — nouveau
générateur bare-first, sœur de `candidateCopyPaths`. Aucune modification du
code existant (`buildCopyPath`, `resolveExportTargetAsync`,
`candidateCopyPaths` restent tels quels).

### Frontend — `src/App.tsx`

`handleExport` actuel devient un helper interne `performExport` partagé par
deux handlers :

- `handleExport()` → résout `Images/shaderlab-export` via `defaultExportDir()`
- `handleExportAs()` → résout le dossier via `pickExportFolder()`, annule
  silencieusement si l'utilisateur ferme le dialogue (`null`), même
  convention que `pickImageFile`

```
if (isLaunchFile) {
  target = await resolveExportTargetAsync(sourcePath, true, availability) // inchangé
} else {
  const dir = await resolveDir(); // defaultExportDir() ou pickExportFolder()
  if (dir === null) return; // "Exporter sous..." annulé
  const base = await joinExportTarget(sourcePath, dir);
  target = isDefaultDir
    ? await resolveDefaultExportTarget(base, availability)     // bare-first
    : await resolveExportTargetAsync(base, false, availability) // -edited forcé
}
```

### Frontend — `src/components/Toolbar.tsx`

Un second `DropdownMenuItem` "Exporter sous..." dans le menu Fichier existant,
juste sous "Exporter" — réutilise le `DropdownMenu` déjà en place, pas de
nouveau composant. Désactivé si `!hasImage` (comme "Exporter" aujourd'hui) ET
si `isLaunchFile` (round-trip actif) — le dossier choisi serait de toute façon
ignoré puisque le contrat round-trip écrase toujours le launch path
inconditionnellement ; griser évite la confusion à la source plutôt que
d'ignorer silencieusement le choix ou d'ajouter un message d'avertissement.

## Gestion d'erreurs

`default_export_dir`/`join_export_target` échouent → remontent en
`Result<_, String>`, catchés par le `try/catch` existant de `performExport`,
`setError(messageFromUnknown(e))` — même chemin que tous les échecs d'export
actuels, aucun nouveau cas à créer. `pick_export_folder` annulé (`None`) →
retour silencieux, même convention que `pick_image_file`.

## Tests

- **Rust** (`lib.rs`) : `join_export_target` — nom avec accents, séparateurs,
  extension à points multiples (mêmes styles de cas que `decode_target_path`).
  `write_image_file`/`write_atomic` — dossier parent manquant → créé
  automatiquement (nouveau test).
- **TS** (`test/export/exportImage.test.ts`) : `resolveDefaultExportTarget` —
  dossier vide → nom nu ; collision réelle → `-edited`/`-edited-2` ; jamais le
  comportement de `resolveExportTargetAsync` existant (testé séparément, non
  touché).
- **`App.tsx`/`Toolbar.tsx`** : pas de test unitaire — convention déjà établie
  du projet (orchestration UI vérifiée visuellement, pas par tests). Vérifié
  par le checkpoint visuel humain habituel : export par défaut, "Exporter
  sous...", et round-trip Lightroom (régression) via CDP sur la fenêtre réelle.
