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

// ── Cache management ─────────────────────────────────────────────────────────

#[napi(object)]
pub struct CacheInfo {
    /// Total size of all files in bytes
    pub total_size: f64,
    /// Number of files
    pub file_count: u32,
}

#[napi(object)]
pub struct CacheEvictionPlan {
    /// Paths to delete (oldest files first, enough to bring total under max_size)
    pub files_to_delete: Vec<String>,
    /// Total bytes that would be freed
    pub bytes_to_free: f64,
    /// Current total cache size before eviction
    pub current_size: f64,
}

/// Scan a cache directory and return total size and file count.
#[napi]
pub fn get_cache_info(dir_path: String) -> CacheInfo {
    let mut total_size: u64 = 0;
    let mut file_count: u32 = 0;

    if let Ok(entries) = std::fs::read_dir(&dir_path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total_size += meta.len();
                    file_count += 1;
                }
            }
        }
    }

    CacheInfo {
        total_size: total_size as f64,
        file_count,
    }
}

/// Plan cache eviction: scan directory, sort by mtime (oldest first),
/// return files to delete to bring total size under max_size_bytes.
#[napi]
pub fn plan_cache_eviction(dir_path: String, max_size_bytes: f64) -> CacheEvictionPlan {
    use std::time::UNIX_EPOCH;

    let max_bytes = max_size_bytes as u64;
    let mut files: Vec<(String, u64, u64)> = Vec::new(); // (path, size, mtime_ms)
    let mut total_size: u64 = 0;

    if let Ok(entries) = std::fs::read_dir(&dir_path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let size = meta.len();
                    total_size += size;
                    let mtime = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    files.push((
                        entry.path().to_string_lossy().into_owned(),
                        size,
                        mtime,
                    ));
                }
            }
        }
    }

    if total_size <= max_bytes {
        return CacheEvictionPlan {
            files_to_delete: Vec::new(),
            bytes_to_free: 0.0,
            current_size: total_size as f64,
        };
    }

    // Sort by mtime ascending (oldest first)
    files.sort_by_key(|f| f.2);

    let mut bytes_to_free: u64 = 0;
    let target_free = total_size - max_bytes;
    let mut to_delete: Vec<String> = Vec::new();

    for (file_path, size, _) in &files {
        if bytes_to_free >= target_free {
            break;
        }
        to_delete.push(file_path.clone());
        bytes_to_free += size;
    }

    CacheEvictionPlan {
        files_to_delete: to_delete,
        bytes_to_free: bytes_to_free as f64,
        current_size: total_size as f64,
    }
}

/// Delete files from a list of paths. Returns number of files successfully deleted.
#[napi]
pub fn delete_files(file_paths: Vec<String>) -> u32 {
    let mut deleted: u32 = 0;
    for p in &file_paths {
        if std::fs::remove_file(p).is_ok() {
            deleted += 1;
        }
    }
    deleted
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

// ── Image thumbnail generation ──────────────────────────────────────────────
//
// Native image thumbnail pipeline using the `image` crate + rayon.
// Replaces per-worker sharp calls with a single batched, natively parallel call.

#[napi(object)]
pub struct ThumbnailRequest {
    pub file_path: String,
    pub thumb_path: String,
    pub max_size: u32,
}

#[napi(object)]
pub struct ThumbnailResult {
    pub file_path: String,
    pub thumb_path: String,
    pub success: bool,
}

fn generate_one_thumbnail(src: &str, dst: &str, max_size: u32) -> bool {
    use std::path::Path;

    // If the cached thumb already exists, we're done.
    if Path::new(dst).exists() {
        return true;
    }

    // Ensure the parent directory exists.
    if let Some(parent) = Path::new(dst).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }

    // Decode the image. `image::open` sniffs format from extension + magic bytes.
    let img = match image::open(src) {
        Ok(i) => i,
        Err(_) => return false,
    };

    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return false;
    }

    // Resize if larger than max_size on the longest edge.
    let longest = w.max(h);
    let resized = if longest <= max_size {
        img
    } else {
        let scale = max_size as f32 / longest as f32;
        let new_w = ((w as f32 * scale).round() as u32).max(1);
        let new_h = ((h as f32 * scale).round() as u32).max(1);
        // `thumbnail` uses a fast filter (Triangle/box) optimized for downscaling.
        img.thumbnail(new_w, new_h)
    };

    // Save as PNG (to match existing cache key convention: `.png` extension).
    match resized.save(dst) {
        Ok(()) => true,
        Err(_) => {
            let _ = std::fs::remove_file(dst);
            false
        }
    }
}

// ── Native perceptual hashing (dHash) ──────────────────────────────────────
// Computes 64-bit dHash for each input path in parallel using rayon.
// dHash: greyscale → 9x8 resize → compare adjacent pixels horizontally → 64 bits
// Output hex matches the existing JS worker's format exactly (MSB-first).
//
// Replaces the sharp-based hash worker pool for perceptual hashes. On a
// 16-core machine this is ~4-8× faster than the JS worker pool at 8 workers,
// primarily because rayon scales to all cores + the `image` crate decodes
// faster than sharp once the image is in cache.

#[napi(object)]
pub struct PerceptualHashResult {
    pub path: String,
    pub hash: Option<String>,
}

fn compute_dhash_single(path: &str) -> Option<String> {
    use image::imageops::FilterType;
    let img = image::open(path).ok()?;
    // Sharp uses fit:'fill' which stretches to exact dimensions.
    let resized = img.resize_exact(9, 8, FilterType::Triangle);
    let gray = resized.to_luma8();
    let raw = gray.as_raw();
    if raw.len() < 72 { return None; } // 9 * 8

    let mut hash: u64 = 0;
    for row in 0..8 {
        for col in 0..8 {
            let left  = raw[row * 9 + col];
            let right = raw[row * 9 + col + 1];
            hash <<= 1;
            if left > right { hash |= 1; }
        }
    }
    Some(format!("{:016x}", hash))
}

/// Compute perceptual (dHash) hashes for a batch of image paths in parallel.
/// Returns one result per input path in the same order.
#[napi]
pub fn compute_perceptual_hashes(paths: Vec<String>) -> Vec<PerceptualHashResult> {
    use rayon::prelude::*;
    paths
        .par_iter()
        .map(|p| PerceptualHashResult {
            path: p.clone(),
            hash: compute_dhash_single(p),
        })
        .collect()
}

/// Generate image thumbnails in parallel using rayon's thread pool.
///
/// - Skips items whose thumb already exists on disk.
/// - Decodes + resizes + encodes using the `image` crate (pure Rust, no external deps).
/// - Output format is PNG, matching the existing cache path convention.
#[napi]
pub fn generate_image_thumbnails(requests: Vec<ThumbnailRequest>) -> Vec<ThumbnailResult> {
    use rayon::prelude::*;

    requests
        .par_iter()
        .map(|req| {
            let success = generate_one_thumbnail(&req.file_path, &req.thumb_path, req.max_size);
            ThumbnailResult {
                file_path: req.file_path.clone(),
                thumb_path: req.thumb_path.clone(),
                success,
            }
        })
        .collect()
}

// ── Native CLIP inference (ONNX Runtime via `ort` crate) ───────────────────
//
// Loads CLIP vision + text ONNX sessions directly inside this native addon.
// Inference runs in ONNX Runtime's internal thread pool, so calls from Node.js
// never block the JS event loop while the model is crunching.
//
// Since this is a proper Rust NAPI module (not onnxruntime-node), it can be
// invoked from Node worker_threads without the ABI conflicts that forced the
// original in-process JS path.

use once_cell::sync::Lazy;
use std::sync::Mutex;

struct ClipSessions {
    vision: Option<ort::session::Session>,
    text: Option<ort::session::Session>,
}

static CLIP_SESSIONS: Lazy<Mutex<ClipSessions>> =
    Lazy::new(|| Mutex::new(ClipSessions { vision: None, text: None }));

const CLIP_IMAGE_SIZE: usize = 224;
const CLIP_CHANNELS: usize = 3;
const CLIP_PIXEL_COUNT: usize = CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE * CLIP_CHANNELS;

fn build_session(path: &str, intra_threads: usize, gpu_enabled: bool) -> Result<ort::session::Session> {
    use ort::session::{Session, builder::GraphOptimizationLevel};
    use ort::execution_providers::ExecutionProviderDispatch;

    // GPU execution provider behaviour is decided by the caller (main.js
    // resolves user setting + sentinel crash guard + CLIP_GPU env override).
    //   - DirectML can crash (segfault) on some quantized ONNX graphs,
    //     bypassing Rust error handling — handled by sentinel in main.js.
    //   - CoreML is usually safe on Apple Silicon but still experimental.
    //   - Quantized (int8) models typically need CPU; fp32 models are
    //     required for reliable GPU inference.

    let mut providers: Vec<ExecutionProviderDispatch> = Vec::new();

    if gpu_enabled {
        // Preference order: CUDA (NVIDIA, fastest) -> DirectML (any Win GPU) -> CoreML (Mac)
        // ORT tries each in order; if CUDA fails to init (missing toolkit, non-NVIDIA GPU)
        // it falls through to DirectML/CoreML, then finally CPU.
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            use ort::execution_providers::CUDAExecutionProvider;
            providers.push(CUDAExecutionProvider::default().with_device_id(0).build());
        }
        #[cfg(target_os = "windows")]
        {
            use ort::execution_providers::DirectMLExecutionProvider;
            providers.push(DirectMLExecutionProvider::default().with_device_id(0).build());
        }
        #[cfg(target_os = "macos")]
        {
            use ort::execution_providers::CoreMLExecutionProvider;
            providers.push(CoreMLExecutionProvider::default().build());
        }
    }

    use ort::execution_providers::CPUExecutionProvider;
    providers.push(CPUExecutionProvider::default().build());

    let mut builder = Session::builder()
        .map_err(|e| Error::from_reason(format!("ort builder: {}", e)))?;

    // DirectML requires memory pattern disabled (it allocates per-call).
    // CUDA doesn't require it but doesn't break with it disabled.
    if gpu_enabled {
        builder = builder
            .with_memory_pattern(false)
            .map_err(|e| Error::from_reason(format!("ort memory pattern: {}", e)))?;
    }

    builder
        .with_execution_providers(providers)
        .map_err(|e| Error::from_reason(format!("ort providers: {}", e)))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| Error::from_reason(format!("ort opt-level: {}", e)))?
        .with_intra_threads(intra_threads)
        .map_err(|e| Error::from_reason(format!("ort threads: {}", e)))?
        .commit_from_file(path)
        .map_err(|e| Error::from_reason(format!("ort load '{}': {}", path, e)))
}

/// Load the CLIP vision + text ONNX sessions from disk.
///
/// Both paths should point to the *.onnx files produced by Hugging Face's
/// Xenova/clip-vit-base-patch32 export (vision_model.onnx / text_model.onnx).
///
/// `gpu_mode` controls GPU execution provider use:
///   - `Some(true)`: try DirectML (Windows) / CUDA (NVIDIA) / CoreML (Mac) before CPU
///   - `Some(false)` or `None`: CPU only (falls back to `CLIP_GPU=1` env for back-compat when None)
///
/// Returns true on success.
#[napi]
pub fn clip_init(
    vision_model_path: String,
    text_model_path: String,
    intra_threads: Option<u32>,
    gpu_mode: Option<bool>,
) -> Result<bool> {
    let threads = intra_threads.unwrap_or(4).max(1) as usize;
    let gpu_enabled = gpu_mode.unwrap_or_else(|| {
        // Backwards-compat: if caller didn't pass gpu_mode, honour CLIP_GPU env
        std::env::var("CLIP_GPU").map(|v| v != "0" && !v.is_empty()).unwrap_or(false)
    });
    let vision = build_session(&vision_model_path, threads, gpu_enabled)?;
    let text = build_session(&text_model_path, threads, gpu_enabled)?;
    let mut state = CLIP_SESSIONS.lock().map_err(|_| Error::from_reason("clip state poisoned"))?;
    state.vision = Some(vision);
    state.text = Some(text);
    Ok(true)
}

/// Probe whether a GPU execution provider can initialise on this machine.
///
/// Loads a tiny embedded Identity ONNX model with DirectML/CUDA/CoreML
/// providers. Returns:
///   - "directml" / "cuda" / "coreml" — a GPU provider initialised successfully
///   - "cpu" — no GPU provider was available, CPU fallback works
///   - Err(...) — ORT failed entirely (unusual)
///
/// Note: DirectML can still segfault during real session work even if the
/// probe passes. Callers should layer a sentinel file guard on top.
#[napi]
pub fn probe_gpu() -> Result<String> {
    use ort::execution_providers::ExecutionProviderDispatch;

    static PROBE_MODEL: &[u8] = include_bytes!("gpu_probe.onnx");

    // Try each GPU provider in isolation so we can report which one worked.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        use ort::execution_providers::CUDAExecutionProvider;
        let providers: Vec<ExecutionProviderDispatch> =
            vec![CUDAExecutionProvider::default().with_device_id(0).build()];
        if try_probe_with(providers, PROBE_MODEL).is_ok() {
            return Ok("cuda".into());
        }
    }
    #[cfg(target_os = "windows")]
    {
        use ort::execution_providers::DirectMLExecutionProvider;
        let providers: Vec<ExecutionProviderDispatch> =
            vec![DirectMLExecutionProvider::default().with_device_id(0).build()];
        if try_probe_with(providers, PROBE_MODEL).is_ok() {
            return Ok("directml".into());
        }
    }
    #[cfg(target_os = "macos")]
    {
        use ort::execution_providers::CoreMLExecutionProvider;
        let providers: Vec<ExecutionProviderDispatch> =
            vec![CoreMLExecutionProvider::default().build()];
        if try_probe_with(providers, PROBE_MODEL).is_ok() {
            return Ok("coreml".into());
        }
    }

    // CPU probe — sanity check that ORT itself works
    use ort::execution_providers::CPUExecutionProvider;
    let providers: Vec<ExecutionProviderDispatch> =
        vec![CPUExecutionProvider::default().build()];
    try_probe_with(providers, PROBE_MODEL)
        .map_err(|e| Error::from_reason(format!("ort cpu probe failed: {}", e)))?;
    Ok("cpu".into())
}

fn try_probe_with(
    providers: Vec<ort::execution_providers::ExecutionProviderDispatch>,
    model_bytes: &[u8],
) -> std::result::Result<(), String> {
    use ort::session::{Session, builder::GraphOptimizationLevel};
    let mut builder = Session::builder().map_err(|e| e.to_string())?;
    builder = builder.with_memory_pattern(false).map_err(|e| e.to_string())?;
    let session = builder
        .with_execution_providers(providers)
        .map_err(|e| e.to_string())?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| e.to_string())?
        .commit_from_memory(model_bytes)
        .map_err(|e| e.to_string())?;
    // Drop immediately — we only wanted to verify provider init
    drop(session);
    Ok(())
}

/// True if both CLIP sessions have been loaded.
#[napi]
pub fn clip_is_loaded() -> bool {
    CLIP_SESSIONS
        .lock()
        .map(|s| s.vision.is_some() && s.text.is_some())
        .unwrap_or(false)
}

/// Returns diagnostic info about the loaded CLIP vision session including the
/// execution providers ORT actually registered. Use this to confirm whether
/// CUDA/DirectML/CoreML is being used vs. falling back to CPU.
#[napi]
pub fn clip_diagnostics() -> Result<String> {
    let state = CLIP_SESSIONS.lock().map_err(|_| Error::from_reason("clip state poisoned"))?;
    let session = state.vision.as_ref().ok_or_else(|| Error::from_reason("clip vision model not loaded"))?;

    // ORT's session tracks which providers got registered
    let mut info = String::new();
    info.push_str(&format!("inputs: {:?}\n", session.inputs.iter().map(|i| &i.name).collect::<Vec<_>>()));
    info.push_str(&format!("outputs: {:?}\n", session.outputs.iter().map(|o| &o.name).collect::<Vec<_>>()));
    // Note: ort 2.0-rc.10 doesn't expose a direct "active providers" API, but
    // the session creation would have failed or warned if providers were rejected.
    // We rely on ORT's own stderr logging (enabled below) to report this.
    let gpu_env = std::env::var("CLIP_GPU").unwrap_or_else(|_| "(unset)".to_string());
    info.push_str(&format!("CLIP_GPU env: {}\n", gpu_env));
    Ok(info)
}

/// Free the CLIP sessions (drops them + their GPU/CPU memory).
#[napi]
pub fn clip_unload() -> bool {
    if let Ok(mut state) = CLIP_SESSIONS.lock() {
        state.vision = None;
        state.text = None;
        true
    } else {
        false
    }
}

fn l2_normalize_row(row: &mut [f32]) {
    let mut mag: f32 = 0.0;
    for &v in row.iter() { mag += v * v; }
    let mag = mag.sqrt().max(1e-12);
    for v in row.iter_mut() { *v /= mag; }
}

/// CLIP preprocessing: load images from disk, resize (cover) + center-crop to 224x224,
/// and normalize to CHW float32 with ImageNet mean/std.
///
/// Runs in parallel via rayon (one thread per image) and produces a single flat
/// Float32Array of length `paths.len() * 3 * 224 * 224` ready for clipEmbedImageBatch.
///
/// Failed images contribute all-zeros; the caller knows its own batch size.
#[napi]
pub fn clip_preprocess_images(paths: Vec<String>) -> napi::bindgen_prelude::Float32Array {
    use rayon::prelude::*;
    use image::imageops::FilterType;

    // CLIP ViT-B/32 ImageNet normalization
    const MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
    const STD:  [f32; 3] = [0.26862954, 0.26130258, 0.27577711];
    const SIZE: u32 = 224;
    const PIXELS_PER_IMAGE: usize = (SIZE * SIZE) as usize;

    let n = paths.len();
    let mut output = vec![0.0f32; n * 3 * PIXELS_PER_IMAGE];

    // Process each image into its slot in the output buffer
    output
        .par_chunks_mut(3 * PIXELS_PER_IMAGE)
        .zip(paths.par_iter())
        .for_each(|(slot, path)| {
            let img = match image::open(path) { Ok(i) => i, Err(_) => return };

            let (w, h) = (img.width(), img.height());
            if w == 0 || h == 0 { return; }

            // "cover" fit: scale so the smaller dim == SIZE, then center-crop
            let scale = (SIZE as f32 / w as f32).max(SIZE as f32 / h as f32);
            let scaled_w = ((w as f32 * scale).ceil() as u32).max(SIZE);
            let scaled_h = ((h as f32 * scale).ceil() as u32).max(SIZE);

            let resized = img.resize_exact(scaled_w, scaled_h, FilterType::Triangle);
            let crop_x = (scaled_w - SIZE) / 2;
            let crop_y = (scaled_h - SIZE) / 2;
            let cropped = image::imageops::crop_imm(&resized, crop_x, crop_y, SIZE, SIZE).to_image();
            // Convert to RGB8 buffer
            let rgb = image::DynamicImage::ImageRgba8(cropped).to_rgb8();
            let bytes = rgb.as_raw();

            // Normalize to float32 CHW layout: [R-plane][G-plane][B-plane]
            let r_plane = 0;
            let g_plane = PIXELS_PER_IMAGE;
            let b_plane = 2 * PIXELS_PER_IMAGE;
            for i in 0..PIXELS_PER_IMAGE {
                let r = bytes[i * 3]     as f32 / 255.0;
                let g = bytes[i * 3 + 1] as f32 / 255.0;
                let b = bytes[i * 3 + 2] as f32 / 255.0;
                slot[r_plane + i] = (r - MEAN[0]) / STD[0];
                slot[g_plane + i] = (g - MEAN[1]) / STD[1];
                slot[b_plane + i] = (b - MEAN[2]) / STD[2];
            }
        });

    napi::bindgen_prelude::Float32Array::new(output)
}

/// One-shot: load + preprocess + infer in a single native call.
///
/// Combines `clip_preprocess_images` and `clip_embed_image_batch` without any
/// intermediate copy across the NAPI boundary. Preprocessing runs on rayon
/// (parallel across images); inference runs on ORT's execution providers.
/// Returns N L2-normalized embeddings concatenated into one Float32Array.
#[napi]
pub fn clip_preprocess_and_embed(paths: Vec<String>) -> Result<napi::bindgen_prelude::Float32Array> {
    use rayon::prelude::*;
    use image::imageops::FilterType;
    use ndarray::Array4;
    use ort::value::Tensor;

    const MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
    const STD:  [f32; 3] = [0.26862954, 0.26130258, 0.27577711];
    const SIZE: u32 = 224;
    const PIXELS_PER_IMAGE: usize = (SIZE * SIZE) as usize;

    let n = paths.len();
    if n == 0 {
        return Ok(napi::bindgen_prelude::Float32Array::new(Vec::new()));
    }

    // Parallel preprocessing into a flat buffer
    let mut pixels = vec![0.0f32; n * 3 * PIXELS_PER_IMAGE];
    pixels
        .par_chunks_mut(3 * PIXELS_PER_IMAGE)
        .zip(paths.par_iter())
        .for_each(|(slot, path)| {
            let img = match image::open(path) { Ok(i) => i, Err(_) => return };
            let (w, h) = (img.width(), img.height());
            if w == 0 || h == 0 { return; }
            let scale = (SIZE as f32 / w as f32).max(SIZE as f32 / h as f32);
            let scaled_w = ((w as f32 * scale).ceil() as u32).max(SIZE);
            let scaled_h = ((h as f32 * scale).ceil() as u32).max(SIZE);
            let resized = img.resize_exact(scaled_w, scaled_h, FilterType::Triangle);
            let crop_x = (scaled_w - SIZE) / 2;
            let crop_y = (scaled_h - SIZE) / 2;
            let cropped = image::imageops::crop_imm(&resized, crop_x, crop_y, SIZE, SIZE).to_image();
            let rgb = image::DynamicImage::ImageRgba8(cropped).to_rgb8();
            let bytes = rgb.as_raw();
            let r_plane = 0;
            let g_plane = PIXELS_PER_IMAGE;
            let b_plane = 2 * PIXELS_PER_IMAGE;
            for i in 0..PIXELS_PER_IMAGE {
                let r = bytes[i * 3]     as f32 / 255.0;
                let g = bytes[i * 3 + 1] as f32 / 255.0;
                let b = bytes[i * 3 + 2] as f32 / 255.0;
                slot[r_plane + i] = (r - MEAN[0]) / STD[0];
                slot[g_plane + i] = (g - MEAN[1]) / STD[1];
                slot[b_plane + i] = (b - MEAN[2]) / STD[2];
            }
        });

    // Inference
    let mut state = CLIP_SESSIONS.lock().map_err(|_| Error::from_reason("clip state poisoned"))?;
    let session = state.vision.as_mut().ok_or_else(|| Error::from_reason("clip vision model not loaded"))?;
    let arr = Array4::from_shape_vec((n, CLIP_CHANNELS, CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE), pixels)
        .map_err(|e| Error::from_reason(format!("shape: {}", e)))?;
    let tensor = Tensor::from_array(arr)
        .map_err(|e| Error::from_reason(format!("tensor: {}", e)))?;
    let outputs = session.run(ort::inputs!["pixel_values" => tensor])
        .map_err(|e| Error::from_reason(format!("run: {}", e)))?;
    let (_shape, raw) = outputs[0].try_extract_tensor::<f32>()
        .map_err(|e| Error::from_reason(format!("extract: {}", e)))?;
    let mut out = raw.to_vec();
    let embed_dim = out.len() / n;
    for i in 0..n {
        let start = i * embed_dim;
        l2_normalize_row(&mut out[start..start + embed_dim]);
    }

    Ok(napi::bindgen_prelude::Float32Array::new(out))
}

/// Run CLIP vision model on a batch of preprocessed pixel tensors.
///
/// `pixel_data` must contain `n * 3 * 224 * 224` f32 values in CHW layout,
/// already normalized with the CLIP mean/std. The result is `n` L2-normalized
/// embeddings concatenated into one Float32Array of length `n * embed_dim`.
#[napi]
pub fn clip_embed_image_batch(pixel_data: napi::bindgen_prelude::Float32Array, n: u32) -> Result<napi::bindgen_prelude::Float32Array> {
    use ndarray::Array4;
    use ort::value::Tensor;

    let n = n as usize;
    if n == 0 {
        return Ok(napi::bindgen_prelude::Float32Array::new(Vec::new()));
    }
    let expected = n * CLIP_PIXEL_COUNT;
    if pixel_data.len() != expected {
        return Err(Error::from_reason(format!(
            "pixel_data length {} does not match expected {}", pixel_data.len(), expected
        )));
    }

    let mut state = CLIP_SESSIONS.lock().map_err(|_| Error::from_reason("clip state poisoned"))?;
    let session = state.vision.as_mut().ok_or_else(|| Error::from_reason("clip vision model not loaded"))?;

    // Copy into a shaped ndarray [n, 3, 224, 224]
    let data_vec: Vec<f32> = pixel_data.as_ref().to_vec();
    let arr = Array4::from_shape_vec((n, CLIP_CHANNELS, CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE), data_vec)
        .map_err(|e| Error::from_reason(format!("shape: {}", e)))?;

    let tensor = Tensor::from_array(arr)
        .map_err(|e| Error::from_reason(format!("tensor: {}", e)))?;

    let outputs = session.run(ort::inputs!["pixel_values" => tensor])
        .map_err(|e| Error::from_reason(format!("run: {}", e)))?;

    // CLIP vision exports a single output: image_embeds (shape [N, D])
    let (_shape, raw) = outputs[0].try_extract_tensor::<f32>()
        .map_err(|e| Error::from_reason(format!("extract: {}", e)))?;
    let mut out = raw.to_vec();

    // L2-normalize per row in place
    let embed_dim = out.len() / n;
    for i in 0..n {
        let start = i * embed_dim;
        l2_normalize_row(&mut out[start..start + embed_dim]);
    }

    Ok(napi::bindgen_prelude::Float32Array::new(out))
}

/// Run CLIP text model on pre-tokenized inputs.
///
/// The Xenova CLIP text model only exposes a single `input_ids` input
/// (attention_mask is baked into the exported graph via an eos-based fallback).
/// `_attention_mask` is accepted for API stability but unused.
/// Tokenization itself is still done in JS via @huggingface/transformers — only
/// the ONNX inference is native.
#[napi]
pub fn clip_embed_text_tokens(
    input_ids: Vec<i64>,
    _attention_mask: Vec<i64>,
    batch_size: u32,
) -> Result<napi::bindgen_prelude::Float32Array> {
    use ndarray::Array2;
    use ort::value::Tensor;

    let n = batch_size as usize;
    if n == 0 || input_ids.is_empty() {
        return Ok(napi::bindgen_prelude::Float32Array::new(Vec::new()));
    }
    let seq_len = input_ids.len() / n;
    if seq_len * n != input_ids.len() {
        return Err(Error::from_reason("input_ids length not a multiple of batch_size"));
    }

    let mut state = CLIP_SESSIONS.lock().map_err(|_| Error::from_reason("clip state poisoned"))?;
    let session = state.text.as_mut().ok_or_else(|| Error::from_reason("clip text model not loaded"))?;

    let ids_arr = Array2::from_shape_vec((n, seq_len), input_ids)
        .map_err(|e| Error::from_reason(format!("ids shape: {}", e)))?;

    let ids_tensor = Tensor::from_array(ids_arr)
        .map_err(|e| Error::from_reason(format!("ids tensor: {}", e)))?;

    let outputs = session.run(ort::inputs!["input_ids" => ids_tensor])
        .map_err(|e| Error::from_reason(format!("run: {}", e)))?;

    let (_shape, raw) = outputs[0].try_extract_tensor::<f32>()
        .map_err(|e| Error::from_reason(format!("extract: {}", e)))?;
    let mut out = raw.to_vec();

    let embed_dim = out.len() / n;
    for i in 0..n {
        let start = i * embed_dim;
        l2_normalize_row(&mut out[start..start + embed_dim]);
    }

    Ok(napi::bindgen_prelude::Float32Array::new(out))
}
