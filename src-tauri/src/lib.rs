use percent_encoding::percent_decode_str;
use std::fs;
use tauri::ipc::{InvokeBody, Request, Response};

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
/// (même volume garanti), puis rename — sous Windows, `std::fs::rename`
/// remplace une cible existante (`MoveFileExW` + `MOVEFILE_REPLACE_EXISTING`).
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

/// Les headers IPC sont ASCII-only : le chemin cible (chemins Windows
/// accentués inclus) transite percent-encodé (encodeURIComponent côté TS).
fn decode_target_path(encoded: &str) -> Result<String, String> {
    percent_decode_str(encoded)
        .decode_utf8()
        .map(std::borrow::Cow::into_owned)
        .map_err(|_| "Chemin cible invalide (UTF-8 attendu après décodage).".to_string())
}

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
    write_atomic(&path, bytes)
}

/// Pure disk check backing the `path_exists` command — split out so
/// `#[cfg(test)]` can exercise it without going through Tauri's IPC layer.
fn path_exists_on_disk(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

/// Lets the frontend's export path resolver (`resolveExportTargetAsync` in
/// `src/export/exportImage.ts`) probe real disk state before picking a
/// write target — the frontend itself has no filesystem access. Backs the
/// manual-export copy-only safety rule: without this, "does this path
/// exist" could only ever be answered from an in-memory set the caller had
/// to keep in sync, which is how a manual export could silently overwrite
/// an existing file.
#[tauri::command]
fn path_exists(path: String) -> bool {
    path_exists_on_disk(&path)
}

#[tauri::command]
fn read_image_file(path: String) -> Result<Response, String> {
    // Response::new(bytes) = corps binaire brut côté WebView (ArrayBuffer),
    // au lieu d'un Vec<u8> sérialisé en tableau JSON de millions de nombres.
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Lecture échouée sur {path}: {e}"))
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

/// Debugging-only: appends a timestamped line to `.dev-logs/gpu-diag.log` in
/// the project root. Writing through Rust (not console.log) means the line
/// is durably on disk before this IPC call even returns to the renderer —
/// unlike browser-console output, it survives a renderer crash that happens
/// immediately after, which is exactly the failure mode being diagnosed
/// (the renderer's own devtools/console pipe can die mid-flush on a hard
/// OOM abort). Temporary: remove once the GPU OOM crash is root-caused.
/// Gated to debug builds (audit 2026-07-17, finding 2): un build release
/// livré à un utilisateur écrirait sinon indéfiniment dans ce fichier, sans
/// rotation ni troncature.
#[tauri::command]
fn log_diagnostic(message: String) {
    if !cfg!(debug_assertions) {
        return;
    }
    use std::io::Write;
    let log_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".dev-logs")
        .join("gpu-diag.log");
    let line = format!(
        "[{}] {}\n",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis()),
        message
    );
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let _ = f.write_all(line.as_bytes());
    }
}

/// # Panics
/// Panics if the Tauri application fails to launch (e.g. the webview runtime
/// can't initialize) — this is a fatal startup failure with no recovery
/// path, so an `expect` abort is the correct behavior, not a bug.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_launch_path,
            write_image_file,
            read_image_file,
            pick_image_file,
            log_diagnostic,
            path_exists
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
    fn decode_target_path_handles_percent_encoded_windows_paths() {
        // encodeURIComponent("C:\\photos\\été.jpg") côté TS
        let decoded = decode_target_path("C%3A%5Cphotos%5C%C3%A9t%C3%A9.jpg").unwrap();
        assert_eq!(decoded, "C:\\photos\\été.jpg");
    }

    #[test]
    fn decode_target_path_rejects_invalid_utf8() {
        assert!(decode_target_path("%FF%FE").is_err());
    }

    #[test]
    fn path_exists_on_disk_true_for_a_real_file() {
        let path = std::env::temp_dir().join("shaderlab-test-path-exists.jpg");
        std::fs::write(&path, b"x").unwrap();
        assert!(path_exists_on_disk(path.to_str().unwrap()));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn path_exists_on_disk_false_for_a_missing_file() {
        let path = std::env::temp_dir().join("shaderlab-test-path-exists-missing.jpg");
        let _ = std::fs::remove_file(&path); // ensure it's actually absent
        assert!(!path_exists_on_disk(path.to_str().unwrap()));
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
