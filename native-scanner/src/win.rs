use napi::bindgen_prelude::*;
use std::collections::HashSet;
use std::ffi::OsString;
use std::os::windows::ffi::{OsStrExt, OsStringExt};

use crate::{FileEntry, FolderEntry, SubdirEntry};

// Win32 constants
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const INVALID_HANDLE: isize = -1;
const FIND_FIRST_EX_LARGE_FETCH: u32 = 0x02;

// FindExInfoBasic = 1, FindExSearchNameMatch = 0
const FIND_EX_INFO_BASIC: i32 = 1;
const FIND_EX_SEARCH_NAME_MATCH: i32 = 0;

// Windows FILETIME epoch: Jan 1, 1601 → Jan 1, 1970 = 11644473600 seconds
const FILETIME_EPOCH_DIFF_MS: u64 = 11_644_473_600_000;

#[repr(C)]
struct Win32FindDataW {
    file_attributes: u32,
    creation_time: [u32; 2],
    last_access_time: [u32; 2],
    last_write_time: [u32; 2],
    file_size_high: u32,
    file_size_low: u32,
    reserved0: u32,
    reserved1: u32,
    file_name: [u16; 260],
    alternate_file_name: [u16; 14],
}

extern "system" {
    fn FindFirstFileExW(
        lpFileName: *const u16,
        fInfoLevelId: i32,
        lpFindFileData: *mut Win32FindDataW,
        fSearchOp: i32,
        lpSearchFilter: *const std::ffi::c_void,
        dwAdditionalFlags: u32,
    ) -> isize;
    fn FindNextFileW(hFindFile: isize, lpFindFileData: *mut Win32FindDataW) -> i32;
    fn FindClose(hFindFile: isize) -> i32;
}

/// Convert WIN32_FIND_DATAW.file_name to a Rust String.
fn wchar_to_string(buf: &[u16; 260]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(260);
    OsString::from_wide(&buf[..len])
        .to_string_lossy()
        .into_owned()
}

/// Convert FILETIME (two u32s) to milliseconds since Unix epoch.
fn filetime_to_ms(ft: &[u32; 2]) -> f64 {
    let ticks = (ft[1] as u64) << 32 | (ft[0] as u64);
    if ticks == 0 {
        return 0.0;
    }
    // FILETIME is in 100-nanosecond intervals since Jan 1, 1601
    let ms = ticks / 10_000;
    ms.saturating_sub(FILETIME_EPOCH_DIFF_MS) as f64
}

/// Build a wide null-terminated search pattern like "C:\folder\*"
fn make_search_pattern(folder: &str) -> Vec<u16> {
    let search = if folder.ends_with('\\') || folder.ends_with('/') {
        format!("{}*", folder)
    } else {
        format!("{}\\*", folder)
    };
    let os: OsString = search.into();
    let mut wide: Vec<u16> = os.encode_wide().collect();
    wide.push(0);
    wide
}

/// Build a full path string from folder + name.
fn join_path(folder: &str, name: &str) -> String {
    let sep = if folder.ends_with('\\') || folder.ends_with('/') {
        ""
    } else {
        "\\"
    };
    format!("{}{}{}", folder, sep, name)
}

/// Scan directory using FindFirstFileExW. Returns file info inline (no stat calls).
pub fn scan_dir_win(
    folder_path: &str,
    image_set: &HashSet<String>,
    video_set: &HashSet<String>,
    skip_stats: bool,
    smart_collection_mode: bool,
    folders: &mut Vec<FolderEntry>,
    media_files: &mut Vec<FileEntry>,
) -> Result<()> {
    let pattern = make_search_pattern(folder_path);
    let mut find_data: Win32FindDataW = unsafe { std::mem::zeroed() };

    let handle = unsafe {
        FindFirstFileExW(
            pattern.as_ptr(),
            FIND_EX_INFO_BASIC,
            &mut find_data as *mut _ as *mut Win32FindDataW,
            FIND_EX_SEARCH_NAME_MATCH,
            std::ptr::null(),
            FIND_FIRST_EX_LARGE_FETCH,
        )
    };

    if handle == INVALID_HANDLE {
        return Err(Error::from_reason(format!(
            "FindFirstFileExW failed for: {}",
            folder_path
        )));
    }

    loop {
        let name = wchar_to_string(&find_data.file_name);

        // Skip . and ..
        if name == "." || name == ".." {
            if unsafe { FindNextFileW(handle, &mut find_data) } == 0 {
                break;
            }
            continue;
        }

        let attrs = find_data.file_attributes;
        let is_dir = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
        let is_reparse = (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;

        if is_dir && !is_reparse {
            if !smart_collection_mode {
                let full_path = join_path(folder_path, &name);
                let mtime = if skip_stats {
                    0.0
                } else {
                    filetime_to_ms(&find_data.last_write_time)
                };
                folders.push(FolderEntry {
                    name,
                    path: full_path,
                    mtime,
                });
            }
        } else if !is_dir && !is_reparse {
            // Regular file — check extension
            let ext = match name.rfind('.') {
                Some(pos) => name[pos..].to_ascii_lowercase(),
                None => {
                    if unsafe { FindNextFileW(handle, &mut find_data) } == 0 {
                        break;
                    }
                    continue;
                }
            };

            let is_image = image_set.contains(&ext);
            let is_video = if is_image {
                false
            } else {
                video_set.contains(&ext)
            };

            if is_image || is_video {
                let full_path = join_path(folder_path, &name);
                let (mtime, size) = if skip_stats {
                    (0.0, 0.0)
                } else {
                    let mt = filetime_to_ms(&find_data.last_write_time);
                    let sz =
                        ((find_data.file_size_high as u64) << 32 | find_data.file_size_low as u64)
                            as f64;
                    (mt, sz)
                };

                media_files.push(FileEntry {
                    name,
                    path: full_path,
                    file_type: if is_image {
                        "image".to_string()
                    } else {
                        "video".to_string()
                    },
                    mtime,
                    size,
                });
            }
        }

        if unsafe { FindNextFileW(handle, &mut find_data) } == 0 {
            break;
        }
    }

    unsafe {
        FindClose(handle);
    }
    Ok(())
}

/// List subdirectories using FindFirstFileExW, with hasChildren check.
pub fn list_subdirs_win(
    folder_path: &str,
    skip_names: &HashSet<&str>,
    dirs: &mut Vec<SubdirEntry>,
) -> Result<()> {
    let pattern = make_search_pattern(folder_path);
    let mut find_data: Win32FindDataW = unsafe { std::mem::zeroed() };

    let handle = unsafe {
        FindFirstFileExW(
            pattern.as_ptr(),
            FIND_EX_INFO_BASIC,
            &mut find_data as *mut _ as *mut Win32FindDataW,
            FIND_EX_SEARCH_NAME_MATCH,
            std::ptr::null(),
            FIND_FIRST_EX_LARGE_FETCH,
        )
    };

    if handle == INVALID_HANDLE {
        return Err(Error::from_reason(format!(
            "FindFirstFileExW failed for: {}",
            folder_path
        )));
    }

    loop {
        let name = wchar_to_string(&find_data.file_name);

        if name == "." || name == ".." {
            if unsafe { FindNextFileW(handle, &mut find_data) } == 0 {
                break;
            }
            continue;
        }

        let attrs = find_data.file_attributes;
        let is_dir = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
        let is_reparse = (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;

        if is_dir && !is_reparse {
            if !name.starts_with('.') && !name.starts_with('$') && !skip_names.contains(name.as_str())
            {
                let full_path = join_path(folder_path, &name);
                let has_children = check_has_children_win(&full_path);
                dirs.push(SubdirEntry {
                    name,
                    path: full_path,
                    has_children,
                });
            }
        }

        if unsafe { FindNextFileW(handle, &mut find_data) } == 0 {
            break;
        }
    }

    unsafe {
        FindClose(handle);
    }
    Ok(())
}

/// Check if a directory has any visible subdirectories using FindFirstFileExW.
fn check_has_children_win(dir_path: &str) -> bool {
    let pattern = make_search_pattern(dir_path);
    let mut find_data: Win32FindDataW = unsafe { std::mem::zeroed() };

    let handle = unsafe {
        FindFirstFileExW(
            pattern.as_ptr(),
            FIND_EX_INFO_BASIC,
            &mut find_data as *mut _ as *mut Win32FindDataW,
            FIND_EX_SEARCH_NAME_MATCH,
            std::ptr::null(),
            FIND_FIRST_EX_LARGE_FETCH,
        )
    };

    if handle == INVALID_HANDLE {
        return false; // Permission denied → leaf
    }

    let result = loop {
        let name = wchar_to_string(&find_data.file_name);
        if name != "." && name != ".." {
            let attrs = find_data.file_attributes;
            let is_dir = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
            let is_reparse = (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;

            if is_dir && !is_reparse && !name.starts_with('.') && !name.starts_with('$') {
                break true;
            }
        }

        if unsafe { FindNextFileW(handle, &mut find_data) } == 0 {
            break false;
        }
    };

    unsafe {
        FindClose(handle);
    }
    result
}

/// Recursive directory scan using FindFirstFileExW. Walks entire tree, collects media files.
pub fn scan_dir_recursive_win(
    root_path: &str,
    image_set: &HashSet<String>,
    video_set: &HashSet<String>,
    seen: &mut HashSet<String>,
    media_files: &mut Vec<FileEntry>,
) {
    let mut dir_queue: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    dir_queue.push_back(root_path.to_string());

    while let Some(current_dir) = dir_queue.pop_front() {
        let pattern = make_search_pattern(&current_dir);
        let mut find_data: Win32FindDataW = unsafe { std::mem::zeroed() };

        let handle = unsafe {
            FindFirstFileExW(
                pattern.as_ptr(),
                FIND_EX_INFO_BASIC,
                &mut find_data as *mut _ as *mut Win32FindDataW,
                FIND_EX_SEARCH_NAME_MATCH,
                std::ptr::null(),
                FIND_FIRST_EX_LARGE_FETCH,
            )
        };

        if handle == INVALID_HANDLE {
            continue; // Permission denied, skip this directory
        }

        loop {
            let name = wchar_to_string(&find_data.file_name);

            if name != "." && name != ".." {
                let attrs = find_data.file_attributes;
                let is_dir = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
                let is_reparse = (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;

                if is_dir && !is_reparse {
                    // Queue subdirectory for recursive scanning
                    dir_queue.push_back(join_path(&current_dir, &name));
                } else if !is_dir && !is_reparse {
                    // Check file extension
                    let ext = match name.rfind('.') {
                        Some(pos) => name[pos..].to_ascii_lowercase(),
                        None => {
                            if unsafe { FindNextFileW(handle, &mut find_data) } == 0 {
                                break;
                            }
                            continue;
                        }
                    };

                    let is_image = image_set.contains(&ext);
                    let is_video = if is_image { false } else { video_set.contains(&ext) };

                    if is_image || is_video {
                        let full_path = join_path(&current_dir, &name);
                        let key = full_path.to_lowercase();
                        if seen.insert(key) {
                            let mt = filetime_to_ms(&find_data.last_write_time);
                            let sz = ((find_data.file_size_high as u64) << 32
                                | find_data.file_size_low as u64)
                                as f64;

                            media_files.push(FileEntry {
                                name,
                                path: full_path,
                                file_type: if is_image {
                                    "image".to_string()
                                } else {
                                    "video".to_string()
                                },
                                mtime: mt,
                                size: sz,
                            });
                        }
                    }
                }
            }

            if unsafe { FindNextFileW(handle, &mut find_data) } == 0 {
                break;
            }
        }

        unsafe {
            FindClose(handle);
        }
    }
}
