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
/// ⚠️ CE FILTRE N'EST PAS UNE LISTE DE CAPACITÉS, et il ne doit jamais le
/// redevenir. Il a porté `&["jpg", "jpeg"]` jusqu'au 2026-08-18, pendant que
/// le glisser-déposer sur la toile n'a AUCUN filtre
/// (`src/components/Canvas.tsx`, `onDrop` passe le fichier tel quel) : deux
/// chemins d'entrée pour la même chose, et le sélecteur refusait ce que la
/// toile acceptait. Un PNG à alpha se composait déjà de bout en bout — vérifié
/// dans la vraie fenêtre le 2026-08-17 — sans une ligne de code, parce que
/// `createImageBitmap` RENIFLE le format et ignore l'étiquette du Blob.
///
/// D'où la forme retenue : les extensions NOMMÉES ne sont que du confort de
/// dialogue, et le second filtre attrape-tout garantit que ce sélecteur ne
/// puisse plus jamais être le chemin le plus étroit. Un format qui ne se décode
/// pas échoue de la même façon sur les deux chemins — `openFile` lève
/// « Image non supportée ou corrompue. » (`src/App.tsx`) — donc ouvrir la liste
/// ne peut pas produire d'état incohérent, seulement un refus honnête.
///
/// Ne sont nommés que les formats MESURÉS chez nous : JPEG (chemin quotidien)
/// et PNG (éprouvé le 2026-08-17, 2400×900 à fond transparent). WebP, AVIF et
/// consorts sont très probablement décodés par WebView2 — ils ne sont pas
/// listés parce que personne ne l'a VÉRIFIÉ ici, et l'attrape-tout les rend
/// déjà atteignables. Les ajouter = une mesure, puis un mot.
///
/// ⚠️ Rien de tout ceci ne touche l'EXPORT, qui reste du JPEG : `is_jpeg_path`
/// refuse d'écrire ailleurs et `exportImage.ts` refuse d'encoder un pixel non
/// opaque. Accepter un PNG transparent en ENTRÉE ne dit rien sur la SORTIE.
#[tauri::command]
fn pick_image_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Images (JPEG, PNG)", &["jpg", "jpeg", "png"])
        .add_filter("Tous les fichiers", &["*"])
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

/// Dialogue "choisir un dossier" pour la bibliothèque de textures, même
/// contournement `rfd` que `pick_export_folder`. `None` si annulé.
///
/// SÉPARÉ de `pick_export_folder` alors que les deux corps sont identiques :
/// ce sont deux gestes utilisateur distincts, et le jour où l'un gagne un
/// filtre ou un dossier de départ, l'autre ne doit pas le suivre par accident.
#[tauri::command]
fn pick_texture_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Bibliothèque de textures par défaut : `Images/shaderlab-textures`, jumelle
/// exacte de `Images/shaderlab-export` (`default_export_dir`). Même famille
/// d'API, même endroit, et surtout : un dossier que l'utilisateur peut ouvrir,
/// remplir et vider sans passer par l'application.
///
/// ⚠️ **C'est ICI que vivent les gros fichiers, PAS dans les ressources
/// empaquetées**, et cette distinction a un coût mesuré derrière elle. Un jeu
/// de 44 matières 8K pèse **2,6 Go** ; posé dans `bundle.resources`, il serait
/// recopié dans l'installateur ET dans le dossier cible à chaque build, y
/// compris en `tauri dev`. Le dossier de ressources reste donc réservé à un
/// jeu de départ MINUSCULE, ou à rien du tout.
///
/// Ordre de résolution, premier existant :
/// 1. `Images/shaderlab-textures` — la bibliothèque de l'utilisateur ;
/// 2. `resource_dir()/textures` — le jeu livré, s'il y en a un.
///
/// Rend `None` si aucun n'existe, et ce cas est NORMAL : les scans ne sont pas
/// versionnés (`src-tauri/textures/README.md`). `None` et dossier vide se
/// traitent pareil côté TS — la bibliothèque invite à désigner un dossier, elle
/// ne prétend pas qu'il n'y a rien à voir.
#[tauri::command]
fn default_texture_dir(app: tauri::AppHandle) -> Option<String> {
    let candidates = [
        app.path().picture_dir().ok().map(|d| d.join("shaderlab-textures")),
        app.path().resource_dir().ok().map(|d| d.join("textures")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|dir| dir.is_dir())
        .map(|dir| dir.to_string_lossy().into_owned())
}

/// Dossier du cache de vignettes de textures, sous le dossier de CACHE de l'app
/// — pas le dossier de config (`presets_dir`). La distinction est réelle :
/// tout ce qui est ici est reconstructible depuis les fichiers sources, donc
/// supprimable sans perte, et le système peut le nettoyer.
fn texture_thumbnail_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Dossier de cache app introuvable: {e}"))?;
    Ok(dir.join("texture-thumbnails"))
}

/// Nom de fichier de cache pour `path`, dérivé de (chemin, TAILLE, DATE DE
/// MODIFICATION).
///
/// C'est l'invalidation, et elle tient dans la clé : remplacer un scan par un
/// autre sous le même nom change sa taille ou sa date, donc sa clé, donc
/// l'ancienne vignette n'est plus jamais retrouvée. Pas de comparaison, pas de
/// péremption à écrire.
///
/// ⚠️ `DefaultHasher` n'est PAS stable d'une version de Rust à l'autre. C'est
/// acceptable ICI et nulle part où une donnée serait perdue : un changement de
/// hachage rend tout le cache introuvable, donc régénéré au prochain affichage.
/// Il se répare tout seul, il ne se corrompt pas.
fn thumbnail_cache_key(path: &str) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    let meta = fs::metadata(path).map_err(|e| format!("Métadonnées illisibles sur {path}: {e}"))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis());
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    meta.len().hash(&mut hasher);
    modified.hash(&mut hasher);
    Ok(format!("{:016x}.thumb", hasher.finish()))
}

/// Plafond d'entrées du cache. Une vignette pèse quelques dizaines de Ko, donc
/// 3000 tiennent dans ~100 Mo — mais le cache accumule les dossiers visités au
/// fil des sessions, et rien ne le viderait jamais sans ce plafond. Une
/// croissance disque sans borne est le genre de défaut qui ne se remarque
/// qu'une fois le disque plein.
const MAX_THUMBNAIL_CACHE_ENTRIES: usize = 3000;

/// Supprime les entrées les plus ANCIENNES quand le plafond est franchi.
/// Jamais fatal : un cache qu'on n'arrive pas à élaguer reste un cache
/// utilisable, et faire échouer l'écriture d'une vignette pour ça punirait
/// l'utilisateur d'un problème qui ne le concerne pas.
fn prune_thumbnail_cache(dir: &std::path::Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            Some((meta.modified().unwrap_or(std::time::UNIX_EPOCH), e.path()))
        })
        .collect();
    if files.len() <= MAX_THUMBNAIL_CACHE_ENTRIES {
        return;
    }
    files.sort_by_key(|(when, _)| *when);
    // Un cinquième d'un coup plutôt qu'une entrée par écriture : sinon chaque
    // vignette au-delà du plafond relance un tri complet du dossier.
    let excess = files.len() - MAX_THUMBNAIL_CACHE_ENTRIES + MAX_THUMBNAIL_CACHE_ENTRIES / 5;
    for (_, path) in files.into_iter().take(excess) {
        let _ = fs::remove_file(path);
    }
}

/// Largeur de la vignette produite, en pixels. La hauteur suit le rapport
/// d'aspect. Généreux pour une cellule d'environ 72 px : un écran HiDPI affiche
/// deux pixels physiques par pixel CSS, et une vignette de matière floue ne dit
/// rien de la matière.
const TEXTURE_THUMBNAIL_WIDTH: u32 = 128;

/// Plafond de HAUTEUR de la vignette. `thumbnail` tient dans une boîte, donc
/// sans plafond il faudrait `u32::MAX`, dont l'arithmétique interne n'a pas
/// besoin. Huit fois la largeur laisse passer n'importe quel format portrait
/// réel sans jamais mordre sur les scans carrés ou paysage.
const TEXTURE_THUMBNAIL_MAX_HEIGHT: u32 = TEXTURE_THUMBNAIL_WIDTH * 8;

/// Fabrique l'enveloppe d'une vignette : largeur puis hauteur de la SOURCE en
/// 32 bits big-endian, suivies du PNG de l'aperçu. Format lu tel quel par
/// `src/textures/thumbnailEnvelope.ts`.
///
/// L'en-tête existe parce que la grille affiche DEUX choses : l'aperçu, et les
/// dimensions natives du scan, qui décident s'il est seulement importable
/// (`assertImageFitsGpu`, 8192 px). Les dimensions du PNG sont celles de la
/// vignette ; sans cet en-tête il faudrait relire le fichier source pour
/// retrouver celles de la source, c'est-à-dire refaire toute la dépense.
fn build_thumbnail_envelope(path: &str) -> Result<Vec<u8>, String> {
    let image = image::ImageReader::open(path)
        .map_err(|e| format!("Ouverture échouée sur {path}: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("Format illisible sur {path}: {e}"))?
        .decode()
        .map_err(|e| format!("Décodage échoué sur {path}: {e}"))?;
    // Dimensions prises sur l'image DÉCODÉE plutôt que par une seconde lecture
    // d'en-tête : c'est la même valeur, sans rouvrir le fichier.
    let (width, height) = (image.width(), image.height());
    let thumbnail = image.thumbnail(TEXTURE_THUMBNAIL_WIDTH, TEXTURE_THUMBNAIL_MAX_HEIGHT);
    let mut png = Vec::new();
    thumbnail
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| format!("Encodage PNG échoué pour {path}: {e}"))?;
    Ok(thumbnail_envelope_bytes(width, height, &png))
}

/// Assemble l'enveloppe : huit octets d'en-tête (largeur puis hauteur, u32
/// big-endian) suivis du PNG. Séparée de `build_thumbnail_envelope` pour une
/// seule raison, et elle vaut d'être dite : le FORMAT traverse l'IPC, il est
/// relu par `src/textures/thumbnailEnvelope.ts`, et aucun test ne pouvait voir
/// une divergence entre les deux côtés. Le décodeur TS était éprouvé contre un
/// encodeur TS (`encodeThumbnailEnvelope`), qui n'a aucun appelant de
/// production : un aller-retour TS↔TS ne peut pas voir le seul écart possible,
/// Rust↔TS. Cette fonction se confronte donc au même fichier d'octets que le
/// test TS (`test/fixtures/thumbnail-envelope.bin`, écrit par un TIERS et non
/// par l'un des deux côtés). Passer en little-endian ici fait rougir ce test-ci
/// sans toucher au TS, et l'inverse aussi.
fn thumbnail_envelope_bytes(width: u32, height: u32, png: &[u8]) -> Vec<u8> {
    let mut envelope = Vec::with_capacity(8 + png.len());
    envelope.extend_from_slice(&width.to_be_bytes());
    envelope.extend_from_slice(&height.to_be_bytes());
    envelope.extend_from_slice(png);
    envelope
}

/// Vignette d'une texture : celle du cache si elle y est, sinon fabriquée ICI
/// puis mise en cache. Un seul aller-retour IPC, et il ne transporte que
/// quelques dizaines de Ko.
///
/// ⚠️ **C'est la mesure qui a mis cette fonction en Rust, pas une préférence.**
/// Le premier jet fabriquait la vignette dans la WebView. Mesuré le 2026-08-05
/// sur la vraie fenêtre, avec une matière 8K de 60 Mo :
///  - **887 ms** rien que pour faire transiter le fichier par l'IPC ;
///  - **1256 ms** de `createImageBitmap({ resizeWidth: 128 })` ;
///  - 6 ms d'encodage PNG.
///
/// Et le résultat qui tranche : le décodage PLEIN, sans réduction, coûte
/// **1125 ms** — donc `resizeWidth` n'économise RIEN, il coûte même plus cher.
/// Le moteur décode les 67 Mpx puis rétrécit. Total ~2,1 s par fichier, soit
/// 22,9 s pour remplir une grille de 21 cases.
///
/// Ici, le fichier ne traverse jamais l'IPC, et plusieurs appels concurrents
/// occupent plusieurs cœurs — les commandes Tauri tournent sur un pool de
/// threads, là où la WebView est mono-thread pour ce travail.
/// ⚠️ **`async` ET `spawn_blocking`, les deux, et aucun des deux n'est
/// décoratif.** Mesuré le 2026-08-05 :
///  - En Tauri v2, une commande **synchrone s'exécute sur le thread
///    principal**. La version synchrone de cette fonction faisait donc la queue :
///    huit fichiers en parallèle prenaient **14,8 s** pour 2,0 s l'unité, soit
///    presque aucun gain sur le séquentiel. Le parallélisme annoncé n'existait
///    pas.
///  - `async` seul ne suffit pas : le décodage est du calcul serré, et le tenir
///    sur l'exécuteur asynchrone bloquerait les autres commandes. C'est
///    `spawn_blocking` qui le sort sur le pool dédié.
#[tauri::command]
async fn get_texture_thumbnail(app: tauri::AppHandle, path: String) -> Result<Response, String> {
    // Résolu AVANT de franchir la frontière du thread : c'est la seule chose
    // dont la tâche ait besoin de l'`AppHandle`.
    let dir = texture_thumbnail_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let key = thumbnail_cache_key(&path)?;
        let file = dir.join(&key);
        if let Ok(bytes) = fs::read(&file) {
            // Un fichier vide serait une écriture interrompue : le refabriquer
            // plutôt que de rendre une enveloppe que le TS rejetterait.
            if !bytes.is_empty() {
                return Ok(Response::new(bytes));
            }
        }
        let envelope = build_thumbnail_envelope(&path)?;
        // Écriture du cache BEST-EFFORT : une vignette produite mais non mise
        // en cache reste une vignette. Échouer ici punirait l'utilisateur d'un
        // disque plein en lui retirant l'aperçu, alors qu'il est déjà calculé.
        if fs::create_dir_all(&dir).is_ok() && fs::write(&file, &envelope).is_ok() {
            prune_thumbnail_cache(&dir);
        }
        Ok(Response::new(envelope))
    })
    .await
    .map_err(|e| format!("Tâche de vignette interrompue: {e}"))?
}

/// Extensions acceptées par la bibliothèque de textures. PNG en plus des JPEG
/// que couvre `is_jpeg_path` : les scans CC0 (ambientCG, Poly Haven) se
/// téléchargent en PNG aussi bien qu'en JPEG, et refuser le PNG rendrait la
/// moitié d'un pack invisible sans rien en dire.
fn is_texture_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".jpg") || lower.ends_with(".jpeg") || lower.ends_with(".png")
}

/// Profondeur de descente dans les sous-dossiers. 3 et pas 1 : les packs réels
/// ne sont PAS plats — un téléchargement ambientCG donne un dossier par
/// matière, et un dossier plat serait le cas particulier, pas la règle. Un
/// panneau vide devant un dossier qui contient visiblement des images serait
/// un échec silencieux.
const MAX_TEXTURE_DEPTH: usize = 3;

/// Plafond de fichiers rapportés. Dépassé, la commande ÉCHOUE au lieu de
/// tronquer : une liste silencieusement coupée se lit exactement comme un
/// dossier complet, et l'utilisateur chercherait longtemps la texture qui n'y
/// est pas.
const MAX_TEXTURE_FILES: usize = 5000;

/// Liste les images d'un dossier de textures, récursivement et à plat.
///
/// Rend des chemins ABSOLUS et rien d'autre : la vignette et les dimensions se
/// produisent côté TS, hors GPU (`src/textures/thumbnailCache.ts`). Cette
/// commande ne lit AUCUN octet d'image — c'est ce qui la rend instantanée sur
/// un pack de 83 fichiers 8K, là où une lecture par fichier coûterait plusieurs
/// centaines de Mo d'IPC pour afficher une grille.
#[tauri::command]
fn list_texture_files(dir: String) -> Result<Vec<String>, String> {
    let root = std::path::PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(format!("Dossier de textures introuvable: {dir}"));
    }
    let mut found = Vec::new();
    // Parcours ITÉRATIF avec pile explicite, pas récursif : la profondeur est
    // bornée, mais c'est la pile qui garde le contrôle de ce qui est visité.
    let mut stack = vec![(root, 0usize)];
    while let Some((current, depth)) = stack.pop() {
        let entries = fs::read_dir(&current)
            .map_err(|e| format!("Lecture du dossier {} échouée: {e}", current.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Entrée de dossier illisible: {e}"))?;
            let path = entry.path();
            // `entry.file_type()` et NON `path.is_dir()` : celui-ci suit les
            // liens, donc une jonction Windows pointant vers un ancêtre ferait
            // boucler le parcours jusqu'au plafond de fichiers. `file_type` ne
            // les suit pas — un lien n'est ni `is_dir` ni `is_file`, il est
            // donc ignoré par les deux branches ci-dessous.
            let file_type = entry
                .file_type()
                .map_err(|e| format!("Type de {} illisible: {e}", path.display()))?;
            if file_type.is_dir() {
                if depth < MAX_TEXTURE_DEPTH {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let as_str = path.to_string_lossy();
            if !is_texture_path(&as_str) {
                continue;
            }
            if found.len() >= MAX_TEXTURE_FILES {
                return Err(format!(
                    "Plus de {MAX_TEXTURE_FILES} images sous {dir} : choisis un dossier plus précis. \
                     Aucune liste tronquée n'est renvoyée — elle se lirait comme un dossier complet."
                ));
            }
            found.push(as_str.into_owned());
        }
    }
    // Ordre STABLE : `read_dir` n'en garantit aucun, et sans tri la grille de
    // vignettes se réordonnerait à chaque ouverture du panneau.
    found.sort();
    Ok(found)
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

/// Fichier unique de la DISPOSITION DE L'ESPACE DE TRAVAIL — colonnes du dock,
/// groupes d'onglets, largeur. À côté des presets, dans le dossier de config de
/// l'app, parce que c'est la même nature de donnée : un choix de l'utilisateur
/// qui n'appartient à aucun document.
///
/// Un SEUL fichier et pas un dossier : il n'y a qu'une disposition à la fois,
/// et lui donner un dossier inviterait à en collectionner alors que rien dans
/// le produit ne le demande.
fn workspace_layout_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Dossier de config app introuvable: {e}"))?;
    Ok(dir.join("workspace-layout.json"))
}

/// `Ok(None)` quand aucune disposition n'a encore été enregistrée — le premier
/// lancement, et le cas le plus courant. Distinct d'une ERREUR de lecture, qui
/// remonte : un fichier présent mais illisible est un incident à signaler, pas
/// un défaut silencieux qui ramènerait l'utilisateur à la disposition d'usine
/// sans rien dire.
#[tauri::command]
fn read_workspace_layout(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = workspace_layout_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Lecture de la disposition échouée: {e}"))
}

#[tauri::command]
fn write_workspace_layout(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let path = workspace_layout_path(&app)?;
    let path_str = path.to_string_lossy().into_owned();
    ensure_parent_dir(&path_str)?;
    // Écriture ATOMIQUE (tmp + rename), comme les presets et l'export : une
    // coupure en pleine écriture laisserait sinon un JSON tronqué, et le
    // prochain lancement retomberait sur la disposition d'usine.
    write_atomic(&path_str, contents.as_bytes())
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
            import_preset,
            pick_texture_folder,
            list_texture_files,
            default_texture_dir,
            get_texture_thumbnail,
            read_workspace_layout,
            write_workspace_layout
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le format d'enveloppe est un CONTRAT ENTRE DEUX LANGAGES. Le fichier
    /// d'octets est le contrat lui-même : il n'est produit par aucun des deux
    /// côtés (il est écrit à part), et les deux s'y confrontent — ce test ici,
    /// `test/textures/thumbnailEnvelope.test.ts` de l'autre côté. Sans lui, le
    /// seul écart possible (Rust écrit, TS lit) n'était éprouvé par rien.
    #[test]
    fn thumbnail_envelope_matches_the_cross_language_fixture() {
        let attendu = std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../test/fixtures/thumbnail-envelope.bin"),
        )
        .expect("fixture d'enveloppe absente");
        let png = &attendu[8..];
        assert_eq!(thumbnail_envelope_bytes(8192, 6144, png), attendu);
        // Et l'en-tête est bien BIG-endian : 8192 = 0x00002000, pas 0x00200000.
        assert_eq!(&attendu[..4], &[0x00, 0x00, 0x20, 0x00]);
        assert_eq!(&attendu[4..8], &[0x00, 0x00, 0x18, 0x00]);
    }

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
