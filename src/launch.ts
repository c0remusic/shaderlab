import { invoke } from "@tauri-apps/api/core";

/**
 * Chemin passé en argument de lancement — « Ouvrir avec » de Windows, double-clic
 * sur un JPEG associé. `null` si l'app a été lancée sans argument.
 *
 * Ce n'était PAS son seul rôle : jusqu'à l'abandon du round-trip Lightroom
 * ([ADR-0002](../.claude/decisions/ADR-0002-abandon-round-trip-lightroom.md)),
 * un document ouvert par ce chemin était marqué `isLaunchFile` et son export
 * ÉCRASAIT ce fichier précis. Cette sémantique-là est déposée ; ouvrir reste
 * ouvrir, et l'export d'un tel document suit la règle copie-seulement comme
 * tous les autres.
 */
export async function getLaunchPath(): Promise<string | null> {
  return invoke<string | null>("get_launch_path");
}

/** Fichier prêt à ouvrir, résolu depuis l'argument de lancement. */
export type LaunchFile = { file: File; path: string };

/**
 * Les deux commandes IPC dont `resolveLaunchFile` a besoin, injectées plutôt
 * qu'importées : c'est ce qui rend la résolution testable hors WebView (aucun
 * `invoke` disponible sous Vitest). Le câblage réel est fait par l'appelant
 * (`App.tsx`) avec `getLaunchPath`/`readImageFile` juste au-dessus.
 */
export type LaunchFileDeps = {
  getPath: () => Promise<string | null>;
  readFile: (path: string) => Promise<Uint8Array>;
};

/**
 * Résolution du chemin « Ouvrir avec » en fichier ouvrable, extraite de
 * `App.tsx` pour être couverte par des tests — audit pré-release 2026-07-30,
 * finding R3 : ce chemin n'avait aucun filet automatisé, la convention du
 * projet (pas de rendu de composant, vérification visuelle par CDP) laissant
 * tout `App.tsx` hors tests. Même remède que le resync du painter de masque
 * (`mask/maskPainterSync.ts`, finding 3 de l'audit 2026-07-17) : sortir la
 * logique du composant, pas assouplir la convention.
 *
 * Rend `null` quand l'app a été lancée sans argument — le seul cas non
 * exceptionnel où il n'y a rien à ouvrir. Tout le reste (transport IPC cassé,
 * fichier illisible) REJETTE : l'appelant a un unique canal d'erreur à
 * brancher, et aucun rejet ne peut lui échapper.
 */
export async function resolveLaunchFile(deps: LaunchFileDeps): Promise<LaunchFile | null> {
  const path = await deps.getPath();
  if (!path) return null;
  const bytes = await deps.readFile(path);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
  return { file: new File([blob], path, { type: "image/jpeg" }), path };
}

export async function writeImageFile(path: string, bytes: Uint8Array): Promise<void> {
  // Corps binaire brut (InvokeBody::Raw côté Rust) ; le chemin passe en
  // header percent-encodé — les headers IPC sont ASCII-only et les chemins
  // Windows peuvent contenir des accents.
  await invoke("write_image_file", bytes, {
    headers: { "x-target-path": encodeURIComponent(path) },
  });
}

export async function readImageFile(path: string): Promise<Uint8Array> {
  // tauri::ipc::Response::new(bytes) arrive ici en ArrayBuffer, pas en
  // number[] JSON.
  const data = await invoke<ArrayBuffer>("read_image_file", { path });
  return new Uint8Array(data);
}

/**
 * Opens a native "pick a file" dialog via our own `pick_image_file` Rust
 * command (backed by `rfd` directly), not `@tauri-apps/plugin-dialog`'s
 * `open()` — that plugin's IPC command was found to hang indefinitely on
 * this setup (confirmed via CDP: never resolves, no dialog window ever
 * appears), a known class of Tauri IPC deadlock. Returns null if the user
 * cancels.
 */
export async function pickImageFile(): Promise<string | null> {
  return invoke<string | null>("pick_image_file");
}

/**
 * Backs `PathAvailability` (see `export/exportImage.ts`) with a real disk
 * check via the Rust `path_exists` command — the frontend has no filesystem
 * access of its own, so this is the only way `resolveExportTargetAsync` can
 * know whether a candidate export path is actually free.
 */
export async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path });
}

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

/**
 * Debugging-only: writes a durable diagnostic line via Rust (see
 * `log_diagnostic` in lib.rs) instead of console.log, so it survives a
 * renderer crash that happens immediately after this call — the failure
 * mode currently being investigated (a hard WebGPU/allocator OOM abort).
 * Fire-and-forget: never let a diagnostic write itself throw into the
 * caller's hot path.
 *
 * No-op outside dev builds (audit 2026-07-17, finding 2) — `log_diagnostic`
 * itself also no-ops in release on the Rust side, but skipping the IPC
 * round-trip entirely here avoids paying its cost on every frame in a build
 * shipped to a user.
 */
export function logDiagnostic(message: string): void {
  if (!import.meta.env.DEV) return;
  invoke("log_diagnostic", { message }).catch(() => {});
}

/** Bibliothèque locale de presets (design.md §4). `crypto.randomUUID()`
 *  côté TS génère l'id, jamais dérivé du nom affiché (renommer un preset ne
 *  renomme jamais son fichier). */
export async function listPresetIds(): Promise<string[]> {
  return invoke<string[]>("list_preset_ids");
}

export async function readPreset(id: string): Promise<string> {
  return invoke<string>("read_preset", { id });
}

export async function writePreset(id: string, contents: string): Promise<void> {
  await invoke("write_preset", { id, contents });
}

export async function deletePreset(id: string): Promise<void> {
  await invoke("delete_preset", { id });
}

export async function pickPresetExportPath(defaultFileName: string): Promise<string | null> {
  return invoke<string | null>("pick_preset_export_path", { defaultFileName });
}

export async function exportPreset(path: string, contents: string): Promise<void> {
  await invoke("export_preset", { path, contents });
}

export async function pickPresetImportPath(): Promise<string | null> {
  return invoke<string | null>("pick_preset_import_path");
}

export async function importPreset(path: string): Promise<string> {
  return invoke<string>("import_preset", { path });
}
