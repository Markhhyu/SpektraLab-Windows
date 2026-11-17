//! Catalog thumbnails: the library view keeps one small JPEG per imported
//! photograph under `<app data>/Catalog/thumbs`, named by the SHA-256 of the
//! original's absolute path. Metadata (paths, ratings, keywords) lives in
//! `<app data>/Catalog/catalog.json` through the generic `store_read`/
//! `store_write` commands. The originals are never touched.

use std::fs;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

fn catalog_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("Catalog"))
}

/// Stable file name for a photograph's cached preview.
pub fn thumb_key(image: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(image.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[tauri::command]
pub fn catalog_thumb_save(app: AppHandle, image: String, data: Vec<u8>) -> Result<String, String> {
    if data.is_empty() || data.len() > 4 * 1024 * 1024 {
        return Err("thumbnail data is empty or too large".into());
    }
    let dir = catalog_dir(&app)?.join("thumbs");
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let key = thumb_key(&image);
    let target = dir.join(format!("{key}.jpg"));
    crate::files::write_atomic(&target, &data)?;
    Ok(key)
}

/// Returns the cached JPEG as base64, or `None` when the photograph was never
/// (or no longer) imported with a preview.
#[tauri::command]
pub fn catalog_thumb_read(app: AppHandle, image: String) -> Result<Option<String>, String> {
    let target = catalog_dir(&app)?
        .join("thumbs")
        .join(format!("{}.jpg", thumb_key(&image)));
    match fs::read(&target) {
        Ok(bytes) => Ok(Some(STANDARD.encode(bytes))),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn catalog_thumb_remove(app: AppHandle, image: String) -> Result<(), String> {
    let target = catalog_dir(&app)?
        .join("thumbs")
        .join(format!("{}.jpg", thumb_key(&image)));
    match fs::remove_file(target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Forget every cached preview (used when the catalog itself is reset).
#[tauri::command]
pub fn catalog_thumb_clear(app: AppHandle) -> Result<(), String> {
    let dir = catalog_dir(&app)?.join("thumbs");
    match fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
