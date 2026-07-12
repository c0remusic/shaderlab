import { invoke } from "@tauri-apps/api/core";

export async function getLaunchPath(): Promise<string | null> {
  return invoke<string | null>("get_launch_path");
}

export async function writeImageFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_image_file", { path, bytes: Array.from(bytes) });
}
