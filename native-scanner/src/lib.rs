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

/// Recursive directory scan: walks entire folder trees and returns all matching media files.
/// Replaces the JS getSubdirectoriesRecursive + per-folder scanFolderInternal loop.
/// Deduplicates by lowercase path. Returns only files (no folder entries).
#[napi]
pub fn scan_directory_recursive(
    root_paths: Vec<String>,
    image_exts: Vec<String>,
    video_exts: Vec<String>,
) -> Result<Vec<FileEntry>> {
    let image_set: HashSet<String> = image_exts.into_iter().collect();
    let video_set: HashSet<String> = video_exts.into_iter().collect();
    let mut seen: HashSet<String> = HashSet::new();
    let mut media_files: Vec<FileEntry> = Vec::new();

    for root in &root_paths {
        #[cfg(windows)]
        {
            win::scan_dir_recursive_win(root, &image_set, &video_set, &mut seen, &mut media_files);
        }
        #[cfg(not(windows))]
        {
            scan_dir_recursive_posix(root, &image_set, &video_set, &mut seen, &mut media_files);
        }
    }

    Ok(media_files)
}

#[cfg(not(windows))]
fn scan_dir_recursive_posix(
    dir_path: &str,
    image_set: &HashSet<String>,
    video_set: &HashSet<String>,
    seen: &mut HashSet<String>,
    media_files: &mut Vec<FileEntry>,
) {
    use std::collections::VecDeque;
    use std::fs;
    use std::time::UNIX_EPOCH;

    let mut queue = VecDeque::new();
    queue.push_back(dir_path.to_string());

    while let Some(current) = queue.pop_front() {
        let entries = match fs::read_dir(&current) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in entries {
            let entry = match entry { Ok(e) => e, Err(_) => continue };
            let ft = match entry.file_type() { Ok(ft) => ft, Err(_) => continue };
            if ft.is_dir() {
                queue.push_back(entry.path().to_string_lossy().into_owned());
            } else if ft.is_file() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let ext = match name.rfind('.') {
                    Some(pos) => name[pos..].to_ascii_lowercase(),
                    None => continue,
                };
                let is_image = image_set.contains(&ext);
                let is_video = if is_image { false } else { video_set.contains(&ext) };
                if !is_image && !is_video { continue; }

                let file_path = entry.path().to_string_lossy().into_owned();
                let key = file_path.to_lowercase();
                if !seen.insert(key) { continue; }

                let (mtime, size) = match fs::metadata(&file_path) {
                    Ok(meta) => {
                        let mt = meta.modified().ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as f64)
                            .unwrap_or(0.0);
                        (mt, meta.len() as f64)
                    }
                    Err(_) => (0.0, 0.0),
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
    }
}

#[napi(object)]
pub struct HashResult {
    pub path: String,
    pub hash: Option<String>,
    pub error: Option<String>,
}

/// Hash multiple files in parallel using BLAKE3 + rayon threadpool.
/// Returns one HashResult per input path.
#[napi]
pub fn hash_files(file_paths: Vec<String>) -> Vec<HashResult> {
    use rayon::prelude::*;

    file_paths
        .into_par_iter()
        .map(|file_path| match hash_file_blake3(&file_path) {
            Ok(hex) => HashResult {
                path: file_path,
                hash: Some(hex),
                error: None,
            },
            Err(e) => HashResult {
                path: file_path,
                hash: None,
                error: Some(e),
            },
        })
        .collect()
}

fn hash_file_blake3(path: &str) -> std::result::Result<String, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(blake3::hash(&data).to_hex().to_string())
}

// ── Image dimension reading ──────────────────────────────────────────────────

#[napi(object)]
pub struct DimensionResult {
    pub path: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Read image dimensions from file headers in parallel.
/// Parses PNG, JPEG, GIF, WebP, BMP headers directly (no external library).
/// Returns one DimensionResult per input path. SVGs and unsupported formats get None.
#[napi]
pub fn read_image_dimensions(file_paths: Vec<String>) -> Vec<DimensionResult> {
    use rayon::prelude::*;

    file_paths
        .into_par_iter()
        .map(|file_path| {
            let dims = read_dims_from_header(&file_path);
            DimensionResult {
                path: file_path,
                width: dims.map(|(w, _)| w),
                height: dims.map(|(_, h)| h),
            }
        })
        .collect()
}

/// Read the first 32KB of a file and parse image dimensions from header bytes.
fn read_dims_from_header(path: &str) -> Option<(u32, u32)> {
    use std::fs::File;
    use std::io::Read;

    let mut file = File::open(path).ok()?;
    let file_len = file.metadata().ok()?.len() as usize;
    let read_len = file_len.min(131072); // Read up to 128KB (covers large EXIF headers)
    let mut buf = vec![0u8; read_len];
    let n = file.read(&mut buf).ok()?;
    if n < 12 {
        return None;
    }
    let data = &buf[..n];

    // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR at offset 8, width@16 height@20 (BE u32)
    if n >= 24 && data[0] == 0x89 && data[1] == b'P' && data[2] == b'N' && data[3] == b'G' {
        let w = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
        let h = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
        return Some((w, h));
    }

    // GIF: "GIF87a" or "GIF89a", width@6 height@8 (LE u16)
    if n >= 10 && data[0] == b'G' && data[1] == b'I' && data[2] == b'F' {
        let w = u16::from_le_bytes([data[6], data[7]]) as u32;
        let h = u16::from_le_bytes([data[8], data[9]]) as u32;
        return Some((w, h));
    }

    // BMP: "BM", width@18 height@22 (LE i32, height can be negative for top-down)
    if n >= 26 && data[0] == b'B' && data[1] == b'M' {
        let w = i32::from_le_bytes([data[18], data[19], data[20], data[21]]);
        let h = i32::from_le_bytes([data[22], data[23], data[24], data[25]]);
        return Some((w.unsigned_abs(), h.unsigned_abs()));
    }

    // JPEG: FF D8 FF, scan for SOF0-SOF15 markers (C0-CF, skip C4 DHT and C8 reserved)
    if n >= 4 && data[0] == 0xFF && data[1] == 0xD8 {
        return parse_jpeg_dimensions(data);
    }

    // WebP: "RIFF" + 4 bytes size + "WEBP"
    if n >= 30
        && data[0] == b'R'
        && data[1] == b'I'
        && data[2] == b'F'
        && data[3] == b'F'
        && data[8] == b'W'
        && data[9] == b'E'
        && data[10] == b'B'
        && data[11] == b'P'
    {
        return parse_webp_dimensions(data);
    }

    None
}

fn parse_jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let len = data.len();
    let mut i = 2; // skip FF D8

    while i + 1 < len {
        if data[i] != 0xFF {
            i += 1;
            continue;
        }

        let marker = data[i + 1];
        i += 2;

        // Skip padding FF bytes
        if marker == 0xFF || marker == 0x00 {
            continue;
        }

        // SOF markers: C0-CF except C4 (DHT), C8 (reserved), CC (DAC)
        if (marker >= 0xC0 && marker <= 0xCF) && marker != 0xC4 && marker != 0xC8 && marker != 0xCC
        {
            if i + 7 <= len {
                let h = u16::from_be_bytes([data[i + 3], data[i + 4]]) as u32;
                let w = u16::from_be_bytes([data[i + 5], data[i + 6]]) as u32;
                if w > 0 && h > 0 {
                    return Some((w, h));
                }
            }
            return None;
        }

        // SOS marker: start of scan data, stop searching
        if marker == 0xDA {
            return None;
        }

        // Skip segment: read 2-byte length and advance
        if i + 1 < len {
            let seg_len = u16::from_be_bytes([data[i], data[i + 1]]) as usize;
            i += seg_len;
        } else {
            break;
        }
    }
    None
}

fn parse_webp_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let len = data.len();
    let mut offset = 12; // skip RIFF + size + WEBP

    while offset + 8 <= len {
        let fourcc = &data[offset..offset + 4];
        let chunk_size =
            u32::from_le_bytes([data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]])
                as usize;
        let chunk_data = offset + 8;

        match fourcc {
            // VP8 lossy: dimensions at chunk_data+6 (after frame tag)
            b"VP8 " => {
                if chunk_data + 10 <= len {
                    // Skip 3-byte frame tag + 3-byte start code (9D 01 2A)
                    let base = chunk_data + 6;
                    if base + 4 <= len {
                        let w = (u16::from_le_bytes([data[base], data[base + 1]]) & 0x3FFF) as u32;
                        let h =
                            (u16::from_le_bytes([data[base + 2], data[base + 3]]) & 0x3FFF) as u32;
                        if w > 0 && h > 0 {
                            return Some((w, h));
                        }
                    }
                }
                return None;
            }
            // VP8L lossless: width/height packed in first 4 bytes after signature byte
            b"VP8L" => {
                if chunk_data + 5 <= len && data[chunk_data] == 0x2F {
                    let bits = u32::from_le_bytes([
                        data[chunk_data + 1],
                        data[chunk_data + 2],
                        data[chunk_data + 3],
                        data[chunk_data + 4],
                    ]);
                    let w = (bits & 0x3FFF) + 1;
                    let h = ((bits >> 14) & 0x3FFF) + 1;
                    return Some((w, h));
                }
                return None;
            }
            // VP8X extended: canvas width/height at chunk_data+4 (24-bit LE each)
            b"VP8X" => {
                if chunk_data + 10 <= len {
                    let w = (data[chunk_data + 4] as u32)
                        | ((data[chunk_data + 5] as u32) << 8)
                        | ((data[chunk_data + 6] as u32) << 16);
                    let h = (data[chunk_data + 7] as u32)
                        | ((data[chunk_data + 8] as u32) << 8)
                        | ((data[chunk_data + 9] as u32) << 16);
                    return Some((w + 1, h + 1)); // VP8X stores (width-1, height-1)
                }
                return None;
            }
            _ => {}
        }

        // Next chunk (padded to even boundary)
        offset = chunk_data + chunk_size + (chunk_size & 1);
    }
    None
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
