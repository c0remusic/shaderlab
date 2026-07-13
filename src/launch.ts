import { invoke } from "@tauri-apps/api/core";

export async function getLaunchPath(): Promise<string | null> {
  return invoke<string | null>("get_launch_path");
}

export async function writeImageFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_image_file", { path, bytes: Array.from(bytes) });
}

export async function readImageFile(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("read_image_file", { path });
  return new Uint8Array(bytes);
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
