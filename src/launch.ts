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
