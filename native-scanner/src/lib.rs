use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashSet;
#[cfg(windows)]
mod win;

#[napi(object)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub file_type: String, // "image" or "video"
    pub mtime: f64,        // ms since epoch
    pub size: f64,
}

#[napi(object)]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub mtime: f64,
}

#[napi(object)]
pub struct ScanResult {
    pub folders: Vec<FolderEntry>,
    pub media_files: Vec<FileEntry>,
}

#[napi(object)]
pub struct SubdirEntry {
    pub name: String,
    pub path: String,
    pub has_children: bool,
}

/// Fast directory scan using Windows FindFirstFileExW (zero separate stat calls).
/// Returns folders and media files separately, filtered by supported extensions.
#[napi]
pub fn scan_directory(
    folder_path: String,
    image_exts: Vec<String>,
    video_exts: Vec<String>,
    skip_stats: bool,
    smart_collection_mode: bool,
) -> Result<ScanResult> {
    let image_set: HashSet<String> = image_exts.into_iter().collect();
    let video_set: HashSet<String> = video_exts.into_iter().collect();

    let mut folders: Vec<FolderEntry> = Vec::new();
    let mut media_files: Vec<FileEntry> = Vec::new();

    #[cfg(windows)]
    {
        win::scan_dir_win(
            &folder_path,
            &image_set,
            &video_set,
            skip_stats,
            smart_collection_mode,
            &mut folders,
            &mut media_files,
        )?;
    }

    #[cfg(not(windows))]
    {
        scan_dir_posix(
            &folder_path,
            &image_set,
            &video_set,
            skip_stats,
            smart_collection_mode,
            &mut folders,
            &mut media_files,
        )?;
    }

    if !smart_collection_mode {
        folders.sort_by(|a, b| natural_cmp(&a.name, &b.name));
        media_files.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    }

    Ok(ScanResult {
        folders,
        media_files,
    })
}

/// List subdirectories with hasChildren flag, filtering system/hidden folders.
#[napi]
pub fn list_subdirectories(folder_path: String) -> Result<Vec<SubdirEntry>> {
    let skip_names: HashSet<&str> = [
        "System Volume Information",
        "$Recycle.Bin",
        "$RECYCLE.BIN",
        "Recovery",
        "Config.Msi",
        "Documents and Settings",
    ]
    .into_iter()
    .collect();

    let mut dirs: Vec<SubdirEntry> = Vec::new();

    #[cfg(windows)]
    {
        win::list_subdirs_win(&folder_path, &skip_names, &mut dirs)?;
    }

    #[cfg(not(windows))]
    {
        list_subdirs_posix(&folder_path, &skip_names, &mut dirs)?;
    }

    dirs.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    Ok(dirs)
}

// ── POSIX fallback (for non-Windows builds) ──────────────────────────────────

#[cfg(not(windows))]
fn scan_dir_posix(
    folder_path: &str,
    image_set: &HashSet<String>,
    video_set: &HashSet<String>,
    skip_stats: bool,
    smart_collection_mode: bool,
    folders: &mut Vec<FolderEntry>,
    media_files: &mut Vec<FileEntry>,
) -> Result<()> {
    use std::fs;
    use std::time::UNIX_EPOCH;

    let entries = fs::read_dir(folder_path)
        .map_err(|e| Error::from_reason(format!("readdir failed: {}", e)))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().into_owned();

        if ft.is_dir() {
            if smart_collection_mode {
                continue;
            }
            let dir_path = entry.path().to_string_lossy().into_owned();
            let mtime = if skip_stats {
                0.0
            } else {
                fs::metadata(&dir_path)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as f64)
                    .unwrap_or(0.0)
            };
            folders.push(FolderEntry {
                name,
                path: dir_path,
                mtime,
            });
        } else if ft.is_file() {
            let ext = match name.rfind('.') {
                Some(pos) => name[pos..].to_ascii_lowercase(),
                None => continue,
            };
            let is_image = image_set.contains(&ext);
            let is_video = if is_image { false } else { video_set.contains(&ext) };
            if !is_image && !is_video {
                continue;
            }
            let file_path = entry.path().to_string_lossy().into_owned();
            let (mtime, size) = if skip_stats {
                (0.0, 0.0)
            } else {
                match fs::metadata(&file_path) {
                    Ok(meta) => {
                        let mt = meta.modified().ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as f64)
                            .unwrap_or(0.0);
                        (mt, meta.len() as f64)
                    }
                    Err(_) => (0.0, 0.0),
                }
            };
            media_files.push(FileEntry {
                name,
                path: file_path,
                file_type: if is_image { "image".to_string() } else { "video".to_string() },
                mtime,
                size,
            });
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn list_subdirs_posix(
    folder_path: &str,
    skip_names: &HashSet<&str>,
    dirs: &mut Vec<SubdirEntry>,
) -> Result<()> {
    use std::fs;

    let entries = fs::read_dir(folder_path)
        .map_err(|e| Error::from_reason(format!("readdir failed: {}", e)))?;

    for entry in entries {
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        let ft = match entry.file_type() { Ok(ft) => ft, Err(_) => continue };
        if !ft.is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name.starts_with('$') { continue; }
        if skip_names.contains(name.as_str()) { continue; }

        let dir_path = entry.path();
        let has_children = match fs::read_dir(&dir_path) {
            Ok(children) => children.filter_map(|e| e.ok()).any(|e| {
                e.file_type().map(|ft| ft.is_dir()).unwrap_or(false)
                    && {
                        let n = e.file_name();
                        let s = n.to_string_lossy();
                        !s.starts_with('.') && !s.starts_with('$')
                    }
            }),
            Err(_) => false,
        };

        dirs.push(SubdirEntry {
            name,
            path: dir_path.to_string_lossy().into_owned(),
            has_children,
        });
    }
    Ok(())
}

// ── Shared utilities ─────────────────────────────────────────────────────────

/// Case-insensitive natural sort comparison (numeric-aware).
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();
    let mut a_chars = a_lower.chars().peekable();
    let mut b_chars = b_lower.chars().peekable();

    loop {
        match (a_chars.peek(), b_chars.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(&ac), Some(&bc)) => {
                if ac.is_ascii_digit() && bc.is_ascii_digit() {
                    let a_num = consume_number(&mut a_chars);
                    let b_num = consume_number(&mut b_chars);
                    match a_num.cmp(&b_num) {
                        std::cmp::Ordering::Equal => continue,
                        other => return other,
                    }
                } else {
                    a_chars.next();
                    b_chars.next();
                    match ac.cmp(&bc) {
                        std::cmp::Ordering::Equal => continue,
                        other => return other,
                    }
                }
            }
        }
    }
}

fn consume_number(chars: &mut std::iter::Peekable<std::str::Chars>) -> u64 {
    let mut n: u64 = 0;
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            n = n.saturating_mul(10).saturating_add(c as u64 - '0' as u64);
            chars.next();
        } else {
            break;
        }
    }
    n
}
