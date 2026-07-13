use std::fs;

#[tauri::command]
fn get_launch_path() -> Option<String> {
  // args[0] is the executable path; a launch path (from Lightroom's
  // External Editing, or Windows "Open with") is args[1] if present.
  std::env::args().nth(1)
}

#[tauri::command]
fn write_image_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
  fs::write(&path, &bytes).map_err(|e| format!("Écriture échouée sur {path}: {e}"))
}

#[tauri::command]
fn read_image_file(path: String) -> Result<Vec<u8>, String> {
  fs::read(&path).map_err(|e| format!("Lecture échouée sur {path}: {e}"))
}

// `tauri-plugin-dialog`'s `open()` IPC command hangs indefinitely on this
// setup (confirmed via CDP: the invoke never resolves or rejects, and no
// native dialog window ever appears — a known class of Tauri IPC deadlock,
// see tauri-apps/plugins-workspace#571). `get_launch_path`/`read_image_file`
// above prove our own custom commands work fine over the same IPC channel,
// so this bypasses the plugin entirely and calls `rfd` directly — the exact
// workaround the community settled on for this bug.
#[tauri::command]
fn pick_image_file() -> Option<String> {
  rfd::FileDialog::new()
    .add_filter("Images", &["jpg", "jpeg"])
    .pick_file()
    .map(|p| p.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      get_launch_path,
      write_image_file,
      read_image_file,
      pick_image_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
