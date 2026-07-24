# Dossier d'export dédié — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'export manuel écrit par défaut dans `Images/shaderlab-export` (nom
de fichier nu, sans suffixe) au lieu d'à côté de la photo source, avec un
bouton "Exporter sous..." pour choisir un autre dossier au cas par cas
(toujours `-edited` en premier, comportement conservateur). Le round-trip
Lightroom reste inchangé.

**Architecture:** Deux résolveurs de chemin cible distincts dans
`src/export/exportImage.ts` : `resolveExportTargetAsync` (existant, inchangé —
round-trip + "Exporter sous...") et `resolveDefaultExportTarget` (nouveau,
bare-first — bouton "Exporter" par défaut uniquement). Trois nouvelles
commandes Rust (`default_export_dir`, `pick_export_folder`,
`join_export_target`) suivent le pattern déjà établi de `pick_image_file`
(contournement `rfd` direct, jamais `tauri-plugin-dialog`). `write_image_file`
crée son dossier parent automatiquement.

**Tech Stack:** Tauri v2 (Rust, `rfd`, `std::path`), React 19 + TS, Vitest,
`cargo test`, Storybook (interaction tests `play`).

## Global Constraints

- Round-trip Lightroom (`isLaunchFile=true`) : toujours écraser le launch path
  exact, jamais probe disque, jamais affecté par le dossier choisi. (PRD,
  design doc § Architecture)
- Aucun échec d'écriture/résolution de dossier ne doit être silencieux —
  toujours remonter via `setError`. (PRD § Contraintes d'inacceptable)
- `resolveExportTargetAsync`, `candidateCopyPaths`, `buildCopyPath` restent
  **inchangés** — zéro régression sur leurs tests existants
  (`test/export/exportImage.test.ts`). (design doc § Architecture)
- "Exporter sous..." toujours actif hors round-trip, y compris pour choisir le
  dossier de la photo source elle-même. (décision Antoine, brainstorming)
- "Exporter sous..." désactivé (grisé) quand `isLaunchFile` est vrai. (décision
  Antoine, brainstorming)

---

### Task 1: Rust — `join_export_target` (jointure dossier + nom de fichier source)

**Files:**
- Modify: `src-tauri/src/lib.rs` (ajouter après `pick_image_file`, avant le
  bloc `log_diagnostic` — vers la ligne 104)
- Test: `src-tauri/src/lib.rs` (module `#[cfg(test)]` existant en bas du
  fichier)

**Interfaces:**
- Produces: `fn join_export_filename(source_path: &str, dir: &str) -> Result<String, String>`
  (fonction pure testable) ; commande IPC `join_export_target(source_path: String, dir: String) -> Result<String, String>`.

- [ ] **Step 1: Écrire les tests (ils échoueront, la fonction n'existe pas encore)**

Ajouter dans le module `#[cfg(test)]` de `src-tauri/src/lib.rs` (après le test
`write_atomic_creates_then_overwrites`) :

```rust
    #[test]
    fn join_export_filename_extracts_name_and_joins_dir() {
        let result = join_export_filename(
            "C:\\photos\\été.jpg",
            "C:\\Users\\x\\Pictures\\shaderlab-export",
        )
        .unwrap();
        assert_eq!(result, "C:\\Users\\x\\Pictures\\shaderlab-export\\été.jpg");
    }

    #[test]
    fn join_export_filename_handles_multi_dot_names() {
        let result = join_export_filename("C:\\photos\\sunset.v2.jpg", "C:\\export").unwrap();
        assert_eq!(result, "C:\\export\\sunset.v2.jpg");
    }

    #[test]
    fn join_export_filename_rejects_path_without_filename() {
        assert!(join_export_filename("C:\\", "C:\\export").is_err());
    }
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd src-tauri && cargo test join_export_filename`
Expected: FAIL avec `cannot find function 'join_export_filename'`

- [ ] **Step 3: Implémenter**

Ajouter dans `src-tauri/src/lib.rs`, juste après la fonction `pick_image_file`
(après la ligne `}` qui la termine, avant le commentaire `// Debugging-only`) :

```rust
/// Extrait le nom de fichier de `source_path` et le joint à `dir` — utilisé
/// pour poser le nom de la photo source dans le dossier d'export choisi
/// (dédié par défaut, ou choisi via "Exporter sous..."), sans dépendre d'un
/// découpage de string côté TS pour les séparateurs Windows.
fn join_export_filename(source_path: &str, dir: &str) -> Result<String, String> {
    let file_name = std::path::Path::new(source_path)
        .file_name()
        .ok_or_else(|| format!("Chemin source invalide (pas de nom de fichier): {source_path}"))?;
    Ok(std::path::Path::new(dir)
        .join(file_name)
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
fn join_export_target(source_path: String, dir: String) -> Result<String, String> {
    join_export_filename(&source_path, &dir)
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `cd src-tauri && cargo test join_export_filename`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(export): ajouter join_export_target (Rust)"
```

---

### Task 2: Rust — `default_export_dir` + `pick_export_folder`, enregistrement des commandes

**Files:**
- Modify: `src-tauri/src/lib.rs` (imports en haut ; nouvelles commandes après
  `join_export_target` ; `invoke_handler` vers la ligne 150-157)

**Interfaces:**
- Consumes: rien de nouveau (utilise `tauri::Manager`, `rfd::FileDialog`
  — déjà une dépendance du projet).
- Produces: commandes IPC `default_export_dir() -> Result<String, String>`,
  `pick_export_folder() -> Option<String>`, toutes deux enregistrées dans
  `invoke_handler` avec `join_export_target` (Task 1).

- [ ] **Step 1: Ajouter l'import `Manager`**

Modifier la ligne 1 de `src-tauri/src/lib.rs` :

```rust
use percent_encoding::percent_decode_str;
use std::fs;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;
```

- [ ] **Step 2: Implémenter les deux commandes**

Ajouter juste après `join_export_target` (Task 1) :

```rust
/// Dossier d'export dédié fixe pour l'export manuel par défaut (bouton
/// "Exporter") : Images/shaderlab-export. Ne crée PAS le dossier — la
/// création automatique se fait au moment de l'écriture (voir
/// `write_image_file`), un seul point de code pour tous les dossiers cible
/// possibles (celui-ci ou un dossier choisi via "Exporter sous...").
#[tauri::command]
fn default_export_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .picture_dir()
        .map_err(|e| format!("Dossier Images introuvable: {e}"))?;
    Ok(dir.join("shaderlab-export").to_string_lossy().into_owned())
}

/// Dialogue "choisir un dossier" pour le bouton "Exporter sous...", même
/// contournement de `tauri-plugin-dialog` (bug IPC connu, voir
/// `pick_image_file`) via `rfd` directement. `None` si l'utilisateur annule.
#[tauri::command]
fn pick_export_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}
```

- [ ] **Step 3: Enregistrer les trois nouvelles commandes**

Remplacer le bloc `invoke_handler` (vers la ligne 150-157) :

```rust
        .invoke_handler(tauri::generate_handler![
            get_launch_path,
            write_image_file,
            read_image_file,
            pick_image_file,
            log_diagnostic,
            path_exists,
            default_export_dir,
            pick_export_folder,
            join_export_target
        ])
```

- [ ] **Step 4: Vérifier la compilation**

Run: `cd src-tauri && cargo check`
Expected: aucune erreur (`default_export_dir`/`pick_export_folder` ne sont pas
unitairement testables — elles appellent l'API OS/le dialogue natif — validées
plus tard par le checkpoint visuel humain, Task 7).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(export): ajouter default_export_dir et pick_export_folder (Rust)"
```

---

### Task 3: Rust — création automatique du dossier parent à l'écriture

**Files:**
- Modify: `src-tauri/src/lib.rs:44-62` (`write_image_file`)
- Test: `src-tauri/src/lib.rs` (module `#[cfg(test)]`)

**Interfaces:**
- Produces: `fn ensure_parent_dir(path: &str) -> Result<(), String>` (testable
  isolément, même pattern que `path_exists_on_disk`).

- [ ] **Step 1: Écrire le test (il échouera, la fonction n'existe pas encore)**

Ajouter dans le module `#[cfg(test)]` :

```rust
    #[test]
    fn ensure_parent_dir_creates_missing_directories() {
        let base = std::env::temp_dir().join("shaderlab-test-ensure-parent");
        let _ = std::fs::remove_dir_all(&base);
        let nested = base.join("a").join("b").join("file.jpg");

        ensure_parent_dir(nested.to_str().unwrap()).unwrap();

        assert!(nested.parent().unwrap().exists());
        let _ = std::fs::remove_dir_all(&base);
    }
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd src-tauri && cargo test ensure_parent_dir`
Expected: FAIL avec `cannot find function 'ensure_parent_dir'`

- [ ] **Step 3: Implémenter et brancher dans `write_image_file`**

Ajouter juste avant `#[tauri::command]\nfn write_image_file` (ligne 44) :

```rust
/// Crée le dossier parent de `path` s'il n'existe pas encore — couvre la
/// création automatique et silencieuse du dossier d'export dédié
/// (Images/shaderlab-export) ET d'un dossier choisi via "Exporter sous..."
/// qui viendrait à manquer, en un seul point de code partagé par toutes les
/// écritures (round-trip Lightroom inclus, sans effet là où le dossier
/// existe déjà).
fn ensure_parent_dir(path: &str) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Création du dossier {} échouée: {e}", parent.display()))?;
    }
    Ok(())
}
```

Remplacer le corps de `write_image_file` (lignes 44-62) :

```rust
#[tauri::command]
fn write_image_file(request: Request) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("write_image_file attend un corps binaire brut.".into());
    };
    let Some(header) = request.headers().get("x-target-path") else {
        return Err("Header x-target-path manquant.".into());
    };
    let encoded = header
        .to_str()
        .map_err(|_| "Header x-target-path illisible.".to_string())?;
    let path = decode_target_path(encoded)?;
    if !is_jpeg_path(&path) {
        return Err(format!(
            "Refus d'écrire {path} : seuls les fichiers .jpg/.jpeg sont autorisés."
        ));
    }
    ensure_parent_dir(&path)?;
    write_atomic(&path, bytes)
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `cd src-tauri && cargo test`
Expected: PASS (tous les tests existants + les 4 nouveaux des Tasks 1 et 3)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(export): créer le dossier parent automatiquement à l'écriture"
```

---

### Task 4: TS — wrappers `launch.ts`

**Files:**
- Modify: `src/launch.ts` (ajouter après `pathExists`, avant `logDiagnostic` —
  vers la ligne 43)

**Interfaces:**
- Consumes: commandes IPC `default_export_dir`, `pick_export_folder`,
  `join_export_target` (Tasks 1-2).
- Produces: `defaultExportDir(): Promise<string>`,
  `pickExportFolder(): Promise<string | null>`,
  `joinExportTarget(sourcePath: string, dir: string): Promise<string>`.

- [ ] **Step 1: Implémenter les trois wrappers**

Ajouter dans `src/launch.ts`, juste après la fonction `pathExists` (après la
ligne 43, avant le commentaire `/**\n * Debugging-only`) :

```ts
/**
 * Dossier d'export dédié fixe (Images/shaderlab-export) pour le bouton
 * "Exporter" par défaut — voir `default_export_dir` côté Rust.
 */
export async function defaultExportDir(): Promise<string> {
  return invoke<string>("default_export_dir");
}

/**
 * Dialogue "choisir un dossier" pour le bouton "Exporter sous...", même
 * contournement `rfd` que `pickImageFile`. `null` si annulé.
 */
export async function pickExportFolder(): Promise<string | null> {
  return invoke<string | null>("pick_export_folder");
}

/**
 * Joint le nom de fichier de `sourcePath` au dossier `dir` — voir
 * `join_export_target` côté Rust (gère les séparateurs Windows correctement,
 * pas de découpage de string côté TS).
 */
export async function joinExportTarget(sourcePath: string, dir: string): Promise<string> {
  return invoke<string>("join_export_target", { sourcePath, dir });
}
```

- [ ] **Step 2: Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add src/launch.ts
git commit -m "feat(export): wrappers TS pour les commandes de dossier d'export"
```

---

### Task 5: TS — `resolveDefaultExportTarget` (résolveur bare-first)

**Files:**
- Modify: `src/export/exportImage.ts` (ajouter après `resolveExportTargetAsync`,
  fin de fichier vers la ligne 94)
- Test: `test/export/exportImage.test.ts`

**Interfaces:**
- Consumes: `PathAvailability` (interface existante, ligne 44 de
  `exportImage.ts`), le générateur privé `candidateCopyPaths` (ligne 19,
  réutilisé sans modification).
- Produces: `resolveDefaultExportTarget(basePath: string, availability: PathAvailability): Promise<string>`.

- [ ] **Step 1: Écrire les tests (ils échoueront, la fonction n'existe pas encore)**

Ajouter dans `test/export/exportImage.test.ts`, à la fin du fichier (après le
`describe("resolveExportTargetAsync", ...)`), et ajouter
`resolveDefaultExportTarget` à l'import de la ligne 2 :

```ts
import {
  buildCopyPath,
  resolveExportTargetAsync,
  resolveDefaultExportTarget,
  exportImage,
  type PathAvailability,
} from "../../src/export/exportImage";
```

```ts
describe("resolveDefaultExportTarget", () => {
  it("returns the bare filename when nothing occupies it", async () => {
    const target = await resolveDefaultExportTarget(
      "C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg",
      fakeAvailability([])
    );
    expect(target).toBe("C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg");
  });

  it("falls back to -edited when the bare name is occupied", async () => {
    const target = await resolveDefaultExportTarget(
      "C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg",
      fakeAvailability(["C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg"])
    );
    expect(target).toBe("C:\\Users\\x\\Pictures\\shaderlab-export\\sunset-edited.jpg");
  });

  it("falls back to -edited-2 when both the bare name and -edited are occupied", async () => {
    const target = await resolveDefaultExportTarget(
      "C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg",
      fakeAvailability([
        "C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg",
        "C:\\Users\\x\\Pictures\\shaderlab-export\\sunset-edited.jpg",
      ])
    );
    expect(target).toBe("C:\\Users\\x\\Pictures\\shaderlab-export\\sunset-edited-2.jpg");
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run test/export/exportImage.test.ts`
Expected: FAIL — `resolveDefaultExportTarget` n'est pas exporté par
`src/export/exportImage.ts`

- [ ] **Step 3: Implémenter**

Ajouter dans `src/export/exportImage.ts`, juste après la fin de
`resolveExportTargetAsync` (après la ligne 94, avant le commentaire
`/**\n * Renders the current layer stack...`) :

```ts
/** Yields the bare `basePath` first, then falls back to the same
 *  `-edited`/`-edited-2`/... sequence as `candidateCopyPaths` — reused
 *  as-is, not duplicated, so the two naming rules can never drift on what
 *  the Nth fallback candidate actually is. */
function* candidateDefaultExportPaths(basePath: string): Generator<string> {
  yield basePath;
  yield* candidateCopyPaths(basePath);
}

/**
 * Résolveur du bouton "Exporter" par défaut : `basePath` est déjà le chemin
 * complet dans le dossier d'export dédié (dossier + nom de fichier source,
 * voir `joinExportTarget` côté launch.ts). Contrairement à
 * `resolveExportTargetAsync`, essaie le nom nu en premier — sûr ici car le
 * dossier dédié est distinct du dossier de la photo source : une collision
 * ne peut survenir qu'avec un export précédent, jamais avec l'original.
 * `resolveExportTargetAsync` reste le résolveur du round-trip Lightroom ET
 * du bouton "Exporter sous..." (comportement conservateur pour un dossier
 * arbitraire, y compris potentiellement le dossier source lui-même).
 */
export async function resolveDefaultExportTarget(
  basePath: string,
  availability: PathAvailability
): Promise<string> {
  for (const candidate of candidateDefaultExportPaths(basePath)) {
    if (!(await availability.exists(candidate))) return candidate;
  }
  /* istanbul ignore next -- candidateDefaultExportPaths never terminates on
   * its own; see the matching comment in buildCopyPath. */
  throw new Error("unreachable");
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run test/export/exportImage.test.ts`
Expected: PASS (tous les tests existants + les 3 nouveaux)

- [ ] **Step 5: Commit**

```bash
git add src/export/exportImage.ts test/export/exportImage.test.ts
git commit -m "feat(export): ajouter resolveDefaultExportTarget (bare-first)"
```

---

### Task 6: TS/UI — câblage `App.tsx` + bouton "Exporter sous..." dans `Toolbar.tsx`

**Files:**
- Modify: `src/App.tsx:11,13,510-543,595-603`
- Modify: `src/components/Toolbar.tsx` (fichier entier, 69 lignes)
- Modify: `src/components/Toolbar.stories.tsx`

**Interfaces:**
- Consumes: `defaultExportDir`, `pickExportFolder`, `joinExportTarget`
  (Task 4) ; `resolveDefaultExportTarget` (Task 5) ; `resolveExportTargetAsync`
  (existant, inchangé).
- Produces: `Toolbar` prend deux nouvelles props `hasLaunchFile: boolean` et
  `onExportAs: () => void`.

- [ ] **Step 1: Mettre à jour les imports de `App.tsx`**

Remplacer la ligne 11 :

```ts
import { exportImage, resolveExportTargetAsync, resolveDefaultExportTarget } from "./export/exportImage";
```

Remplacer la ligne 13 :

```ts
import {
  getLaunchPath,
  readImageFile,
  pickImageFile,
  logDiagnostic,
  writeImageFile,
  pathExists,
  defaultExportDir,
  pickExportFolder,
  joinExportTarget,
} from "./launch";
```

- [ ] **Step 2: Remplacer `handleExport` (lignes 510-543) par `performExport` + deux handlers**

```ts
  async function performExport(resolveDir: () => Promise<string | null>, bareFirst: boolean) {
    if (!rendererRef.current) return;
    if (!sourcePath) {
      setError(
        "Impossible d'exporter : ouvre le fichier via un vrai chemin (lancement depuis Lightroom, ou une future boîte de dialogue \"Ouvrir\") plutôt que par glisser-déposer."
      );
      return;
    }
    try {
      let target: string;
      if (isLaunchFile) {
        // Contrat round-trip Lightroom : écrase toujours le launch path
        // exact, quel que soit le dossier demandé par l'appelant — voir
        // resolveExportTargetAsync's doc comment pour le contrat complet.
        target = await resolveExportTargetAsync(sourcePath, true, { exists: pathExists });
      } else {
        const dir = await resolveDir();
        if (dir === null) return; // "Exporter sous..." annulé par l'utilisateur
        const base = await joinExportTarget(sourcePath, dir);
        target = bareFirst
          ? await resolveDefaultExportTarget(base, { exists: pathExists })
          : await resolveExportTargetAsync(base, false, { exists: pathExists });
      }
      await exportImage(
        rendererRef.current,
        { write: writeImageFile },
        sessionRef.current.layers(),
        target,
        imageSize.width,
        imageSize.height
      );
      // Même discipline que openFile : un export réussi efface une erreur
      // laissée par une tentative précédente, plutôt que de laisser un
      // bandeau d'erreur périmé affiché au-dessus d'un export qui a marché.
      setError(null);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }

  // Bouton "Exporter" : dossier fixe Images/shaderlab-export, nom nu tant
  // qu'il n'y a pas de collision réelle (resolveDefaultExportTarget).
  async function handleExport() {
    await performExport(defaultExportDir, true);
  }

  // Bouton "Exporter sous..." : dossier choisi par l'utilisateur, toujours
  // -edited en premier (comportement conservateur) — Toolbar le désactive
  // quand isLaunchFile est vrai, donc jamais atteint dans ce cas.
  async function handleExportAs() {
    await performExport(pickExportFolder, false);
  }
```

- [ ] **Step 3: Câbler les nouvelles props sur `<Toolbar>` (lignes 595-603)**

```tsx
      <Toolbar
        canUndo={sessionRef.current.canUndo()}
        canRedo={sessionRef.current.canRedo()}
        hasImage={imageSize.width > 0 && imageSize.height > 0}
        hasLaunchFile={isLaunchFile}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExport={handleExport}
        onExportAs={handleExportAs}
        onOpenFile={handleOpenFile}
      />
```

- [ ] **Step 4: Vérifier le typecheck avant de toucher Toolbar.tsx**

Run: `npx tsc --noEmit`
Expected: erreurs dans `src/components/Toolbar.tsx` (props manquantes) — normal,
corrigé à l'étape suivante.

- [ ] **Step 5: Remplacer `src/components/Toolbar.tsx` en entier**

```tsx
import { Download, FolderOpen, Menu, Redo2, Undo2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  hasImage: boolean;
  hasLaunchFile: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onExportAs: () => void;
  onOpenFile: () => void;
}

export function Toolbar({
  canUndo,
  canRedo,
  hasImage,
  hasLaunchFile,
  onUndo,
  onRedo,
  onExport,
  onExportAs,
  onOpenFile,
}: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Barre d'outils"
      className="flex items-center gap-4 min-h-[var(--toolbar-height)] px-4 py-3 bg-card border-b border-border"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="secondary" size="icon" aria-label="Menu Fichier" title="Fichier">
              <Menu size={16} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={onOpenFile}>
            <FolderOpen className="icon-md icon-stroke" aria-hidden="true" />
            Ouvrir
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExport} disabled={!hasImage}>
            <Download className="icon-md icon-stroke" aria-hidden="true" />
            Exporter
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportAs} disabled={!hasImage || hasLaunchFile}>
            <Download className="icon-md icon-stroke" aria-hidden="true" />
            Exporter sous...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Annuler"
        title="Annuler (Ctrl+Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 className="icon-md icon-stroke" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Rétablir"
        title="Rétablir (Ctrl+Y)"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 className="icon-md icon-stroke" aria-hidden="true" />
      </Button>
      <div className="flex-1" />
    </div>
  );
}
```

- [ ] **Step 6: Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 7: Mettre à jour `Toolbar.stories.tsx`**

Remplacer les `args` du `meta` (lignes 8-16) :

```ts
  args: {
    canUndo: true,
    canRedo: false,
    hasImage: true,
    hasLaunchFile: false,
    onUndo: () => {},
    onRedo: () => {},
    onExport: () => {},
    onExportAs: () => {},
    onOpenFile: () => {},
  },
```

Ajouter à la fin du fichier, après `FileMenuExportDisabledWhenNoImage` :

```ts
export const FileMenuExportAsWhenImage: Story = {
  args: { hasImage: true, hasLaunchFile: false, onExportAs: fn(), onOpenFile: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Menu Fichier" }));
    const exportAsItem = await screen.findByRole("menuitem", { name: "Exporter sous..." });
    await userEvent.click(exportAsItem);
    await expect(args.onExportAs).toHaveBeenCalled();
  },
};

export const FileMenuExportAsDisabledDuringRoundTrip: Story = {
  args: { hasImage: true, hasLaunchFile: true, onExportAs: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Menu Fichier" }));
    const exportAsItem = await screen.findByRole("menuitem", { name: "Exporter sous..." });
    await expect(exportAsItem).toHaveAttribute("aria-disabled", "true");

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(exportAsItem);
    await expect(args.onExportAs).not.toHaveBeenCalled();
  },
};
```

- [ ] **Step 8: Lancer Storybook et vérifier visuellement les nouvelles stories**

Run: `npm run storybook`
Expected: `Components/Toolbar` liste `FileMenuExportAsWhenImage` et
`FileMenuExportAsDisabledDuringRoundTrip`, les deux passent (coche verte dans
le panneau Interactions).

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/Toolbar.tsx src/components/Toolbar.stories.tsx
git commit -m "feat(export): câbler le dossier d'export dédié et Exporter sous..."
```

---

### Task 7: Checkpoint visuel humain (round-trip + export par défaut + Exporter sous...)

**Files:** aucun — vérification uniquement, pas de code.

**Interfaces:** aucune.

- [ ] **Step 1: Lancer l'app en dev avec monitoring**

Run: `npm run dev:debug` puis `npm run dev:monitor`
Expected: `shaderlab.exe` démarre sans erreur Rust/TS dans les logs.

- [ ] **Step 2: Export par défaut**

Ouvrir une photo (glisser-déposer ou lancement), cliquer "Exporter". Vérifier :
- Le fichier apparaît dans `Images/shaderlab-export` sous le nom exact de la
  source (pas de suffixe `-edited`).
- Un second clic sur "Exporter" produit `<nom>-edited.jpg` (collision réelle).

- [ ] **Step 3: "Exporter sous..."**

Cliquer "Exporter sous...", choisir un dossier différent (ex. le Bureau).
Vérifier que le fichier atterrit dans ce dossier, sous le nom `<nom>-edited.jpg`
(toujours suffixé, même sans collision — comportement conservateur voulu).
Annuler le dialogue une fois : vérifier qu'aucune erreur n'apparaît et
qu'aucun fichier n'est écrit.

- [ ] **Step 4: Régression round-trip Lightroom**

Lancer l'app avec un chemin de fichier en argument (simulateur du launch
Lightroom, ou un vrai round-trip si disponible). Vérifier :
- "Exporter sous..." est grisé dans le menu Fichier.
- "Exporter" écrase le fichier de lancement exact, sans passer par
  `Images/shaderlab-export`.

- [ ] **Step 5: Dossier manquant**

Renommer/supprimer temporairement `Images/shaderlab-export` s'il existe déjà,
relancer un export par défaut. Vérifier qu'il est recréé silencieusement et
que l'export réussit.

- [ ] **Step 6: Rapporter le résultat à Antoine**

Décrire ce qui a été vérifié et tout écart observé — pas de commit à cette
étape, c'est un checkpoint humain, pas du code.
