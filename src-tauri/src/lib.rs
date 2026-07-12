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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![get_launch_path, write_image_file, read_image_file])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
