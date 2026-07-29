use percent_encoding::percent_decode_str;
use std::fs;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;

#[tauri::command]
fn get_launch_path() -> Option<String> {
    // args[0] est l'exécutable ; le chemin de lancement ("Ouvrir avec" de
    // Windows, double-clic sur un JPEG associé) est args[1] s'il existe.
    // Ce chemin servait aussi l'External Editing de Lightroom, dont le
    // round-trip a été abandonné (ADR-0002) : ouvrir un fichier passé en
    // argument reste supporté, l'écraser à l'export ne l'est plus.
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

/// Crée le dossier parent de `path` s'il n'existe pas encore — couvre la
/// création automatique et silencieuse du dossier d'export dédié
/// (Images/shaderlab-export) ET d'un dossier choisi via "Exporter sous..."
/// qui viendrait à manquer, en un seul point de code partagé par toutes les
/// écritures (round-trip Lightroom inclus, sans effet là où le dossier
/// existe déjà).
fn ensure_parent_dir(path: &str) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Création du dossier {} échouée: {e}", parent.display()))?;
    }
    Ok(())
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
    ensure_parent_dir(&path)?;
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

/// Extrait le nom de fichier de `source_path` et le joint à `dir` — utilisé
/// pour poser le nom de la photo source dans le dossier d'export choisi
/// (dédié par défaut, ou choisi via "Exporter sous..."), sans dépendre d'un
/// découpage de string côté TS pour les séparateurs Windows.
fn join_export_filename(source_path: &str, dir: &str) -> Result<String, String> {
    let file_name = std::path::Path::new(source_path)
        .file_name()
        .ok_or_else(|| format!("Chemin source invalide (pas de nom de fichier): {source_path}"))?;
    Ok(std::path::Path::new(dir)
        .join(file_name)
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
fn join_export_target(source_path: String, dir: String) -> Result<String, String> {
    join_export_filename(&source_path, &dir)
}

/// Dossier d'export dédié fixe pour l'export manuel par défaut (bouton
/// "Exporter") : Images/shaderlab-export. Ne crée PAS le dossier — la
/// création automatique se fait au moment de l'écriture (voir
/// `write_image_file`), un seul point de code pour tous les dossiers cible
/// possibles (celui-ci ou un dossier choisi via "Exporter sous...").
#[tauri::command]
fn default_export_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .picture_dir()
        .map_err(|e| format!("Dossier Images introuvable: {e}"))?;
    Ok(dir.join("shaderlab-export").to_string_lossy().into_owned())
}

/// Dialogue "choisir un dossier" pour le bouton "Exporter sous...", même
/// contournement de `tauri-plugin-dialog` (bug IPC connu, voir
/// `pick_image_file`) via `rfd` directement. `None` si l'utilisateur annule.
#[tauri::command]
fn pick_export_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Dossier de bibliothèque locale des presets, sous le dossier de config
/// app — même famille d'API que `default_export_dir` (`app.path().picture_dir()`).
/// Ne crée pas le dossier lui-même : `write_preset` le fait via
/// `ensure_parent_dir`, un seul point de création comme pour l'export.
fn presets_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Dossier de config app introuvable: {e}"))?;
    Ok(dir.join("presets"))
}

/// Confinement d'id, symétrique à `is_jpeg_path` : rejeté même si l'id vient
/// d'un `crypto.randomUUID()` TS de confiance — défense en profondeur contre
/// un id malformé qui traverserait accidentellement vers ce code (ex. après
/// une désérialisation ratée côté appelant).
fn is_safe_preset_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !id.contains("..")
}

fn preset_path(app: &tauri::AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    if !is_safe_preset_id(id) {
        return Err(format!("Id de preset invalide: {id}"));
    }
    Ok(presets_dir(app)?.join(format!("{id}.json")))
}

#[tauri::command]
fn list_preset_ids(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = presets_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&dir).map_err(|e| format!("Lecture du dossier presets échouée: {e}"))?;
    let mut ids = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Entrée de dossier illisible: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if is_safe_preset_id(stem) {
                    ids.push(stem.to_string());
                }
            }
        }
    }
    Ok(ids)
}

#[tauri::command]
fn read_preset(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let path = preset_path(&app, &id)?;
    fs::read_to_string(&path).map_err(|e| format!("Lecture du preset {id} échouée: {e}"))
}

#[tauri::command]
fn write_preset(app: tauri::AppHandle, id: String, contents: String) -> Result<(), String> {
    let path = preset_path(&app, &id)?;
    let path_str = path.to_string_lossy().into_owned();
    ensure_parent_dir(&path_str)?;
    write_atomic(&path_str, contents.as_bytes())
}

#[tauri::command]
fn delete_preset(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = preset_path(&app, &id)?;
    if !path.exists() {
        return Ok(()); // suppression d'un preset déjà absent = no-op, pas une erreur
    }
    fs::remove_file(&path).map_err(|e| format!("Suppression du preset {id} échouée: {e}"))
}

fn is_json_path(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".json")
}

/// Dialogue "enregistrer sous..." filtré .json — même contournement `rfd`
/// que `pick_export_folder` (bug IPC connu de `tauri-plugin-dialog`).
#[tauri::command]
fn pick_preset_export_path(default_file_name: String) -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Preset shaderlab", &["json"])
        .set_file_name(&default_file_name)
        .save_file()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn export_preset(path: String, contents: String) -> Result<(), String> {
    if !is_json_path(&path) {
        return Err(format!("Refus d'écrire {path} : seuls les fichiers .json sont autorisés."));
    }
    ensure_parent_dir(&path)?;
    write_atomic(&path, contents.as_bytes())
}

#[tauri::command]
fn pick_preset_import_path() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Preset shaderlab", &["json"])
        .pick_file()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Lecture brute uniquement — AUCUNE validation de schéma ici (design.md
/// §5.6, §4.2): la structure PresetDocument est validée côté TS
/// (`presetImportValidation.ts`), Rust ne fait que de l'IO texte, même
/// partage des responsabilités que le reste du projet (voir `read_preset`).
#[tauri::command]
fn import_preset(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Lecture du fichier {path} échouée: {e}"))
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
            path_exists,
            default_export_dir,
            pick_export_folder,
            join_export_target,
            list_preset_ids,
            read_preset,
            write_preset,
            delete_preset,
            pick_preset_export_path,
            export_preset,
            pick_preset_import_path,
            import_preset
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_paths_are_accepted_case_insensitively() {
        assert!(is_json_path("C:\\presets\\Mon Preset.JSON"));
        assert!(is_json_path("preset.json"));
    }

    #[test]
    fn non_json_paths_are_rejected() {
        assert!(!is_json_path("C:\\presets\\preset.json.exe"));
        assert!(!is_json_path("preset.txt"));
        assert!(!is_json_path("sans-extension"));
    }

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

    #[test]
    fn join_export_filename_extracts_name_and_joins_dir() {
        let result = join_export_filename(
            "C:\\photos\\été.jpg",
            "C:\\Users\\x\\Pictures\\shaderlab-export",
        )
        .unwrap();
        assert_eq!(result, "C:\\Users\\x\\Pictures\\shaderlab-export\\été.jpg");
    }

    #[test]
    fn join_export_filename_handles_multi_dot_names() {
        let result = join_export_filename("C:\\photos\\sunset.v2.jpg", "C:\\export").unwrap();
        assert_eq!(result, "C:\\export\\sunset.v2.jpg");
    }

    #[test]
    fn join_export_filename_rejects_path_without_filename() {
        assert!(join_export_filename("C:\\", "C:\\export").is_err());
    }

    #[test]
    fn ensure_parent_dir_creates_missing_directories() {
        let base = std::env::temp_dir().join("shaderlab-test-ensure-parent");
        let _ = std::fs::remove_dir_all(&base);
        let nested = base.join("a").join("b").join("file.jpg");

        ensure_parent_dir(nested.to_str().unwrap()).unwrap();

        assert!(nested.parent().unwrap().exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn is_safe_preset_id_accepts_uuid_like_ids() {
        assert!(is_safe_preset_id("a1b2c3d4-e5f6-47a8-89bc-0123456789ab"));
    }

    #[test]
    fn is_safe_preset_id_rejects_path_traversal_and_separators() {
        assert!(!is_safe_preset_id(""));
        assert!(!is_safe_preset_id("../secret"));
        assert!(!is_safe_preset_id("a/b"));
        assert!(!is_safe_preset_id("a\\b"));
        assert!(!is_safe_preset_id("a..b"));
    }

    #[test]
    fn preset_round_trip_write_read_delete() {
        // preset_path() needs an AppHandle, which requires a running Tauri
        // app — exercised here at the level BELOW it (write_atomic +
        // ensure_parent_dir, already unit-tested above) plus a direct
        // is_safe_preset_id check, matching the split already used by
        // path_exists_on_disk/path_exists for the same reason (§ commandes
        // pas testables sans IPC réel, design.md §8 "Testé (Rust)").
        let dir = std::env::temp_dir().join("shaderlab-test-presets");
        let _ = std::fs::remove_dir_all(&dir);
        let id = "test-preset-1";
        assert!(is_safe_preset_id(id));
        let path = dir.join(format!("{id}.json"));
        let path_str = path.to_str().unwrap();

        ensure_parent_dir(path_str).unwrap();
        write_atomic(path_str, b"{\"schemaVersion\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"schemaVersion\":1}");

        write_atomic(path_str, b"{\"schemaVersion\":1,\"name\":\"renamed\"}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"schemaVersion\":1,\"name\":\"renamed\"}");

        std::fs::remove_file(&path).unwrap();
        assert!(!path.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
