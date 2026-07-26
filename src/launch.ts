import { invoke } from "@tauri-apps/api/core";

export async function getLaunchPath(): Promise<string | null> {
  return invoke<string | null>("get_launch_path");
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
