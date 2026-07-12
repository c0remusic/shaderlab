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
