use std::fs;

#[tauri::command]
fn get_launch_path() -> Option<String> {
  // args[0] est l'exécutable ; le chemin de lancement (External Editing de
  // Lightroom, ou "Ouvrir avec" Windows) est args[1] s'il existe.
  // args_os + to_string_lossy : std::env::args() PANIQUE sur un argument
  // Windows non-UTF16 valide — args_os ne panique jamais.
  std::env::args_os()
    .nth(1)
    .map(|arg| arg.to_string_lossy().into_owned())
}

fn is_jpeg_path(path: &str) -> bool {
  let lower = path.to_ascii_lowercase();
  lower.ends_with(".jpg") || lower.ends_with(".jpeg")
}

/// Écriture atomique : tout dans un fichier temporaire À CÔTÉ de la cible
/// (même volume garanti), puis rename — sous Windows, std::fs::rename
/// remplace une cible existante (MoveFileExW + MOVEFILE_REPLACE_EXISTING).
/// Sans ça, un crash mi-écriture sur le chemin round-trip Lightroom laissait
/// un JPEG tronqué à la place de la seule copie du travail.
fn write_atomic(path: &str, bytes: &[u8]) -> Result<(), String> {
  let tmp = format!("{path}.tmp-write");
  fs::write(&tmp, bytes).map_err(|e| format!("Écriture échouée sur {tmp}: {e}"))?;
  fs::rename(&tmp, path).map_err(|e| {
    let _ = fs::remove_file(&tmp);
    format!("Renommage échoué de {tmp} vers {path}: {e}")
  })
}

#[tauri::command]
fn write_image_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
  if !is_jpeg_path(&path) {
    return Err(format!(
      "Refus d'écrire {path} : seuls les fichiers .jpg/.jpeg sont autorisés."
    ));
  }
  write_atomic(&path, &bytes)
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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn jpeg_paths_are_accepted_case_insensitively() {
    assert!(is_jpeg_path("C:\\photos\\IMG_0001.JPG"));
    assert!(is_jpeg_path("C:\\photos\\été.jpeg"));
  }

  #[test]
  fn non_jpeg_paths_are_rejected() {
    assert!(!is_jpeg_path("C:\\photos\\image.png"));
    assert!(!is_jpeg_path("C:\\photos\\piege.jpg.exe"));
    assert!(!is_jpeg_path("C:\\Users\\x\\master.db"));
    assert!(!is_jpeg_path("sans-extension"));
  }

  #[test]
  fn write_atomic_creates_then_overwrites() {
    let path = std::env::temp_dir().join("shaderlab-test-atomic.jpg");
    let path_str = path.to_str().unwrap();
    let _ = std::fs::remove_file(&path);

    write_atomic(path_str, b"first").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"first");

    // Cas round-trip Lightroom : la cible EXISTE et doit être remplacée
    // sans jamais être visible dans un état tronqué.
    write_atomic(path_str, b"second").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"second");

    let _ = std::fs::remove_file(&path);
  }
}
