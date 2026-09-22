mod scanner;
mod store;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tauri::AppHandle;
use zip::ZipArchive;

#[derive(Serialize)]
pub struct WorkInfo {
    pub path: String,
    pub name: String,
    pub valid: bool,
}

#[derive(Serialize)]
pub struct ChapterInfo {
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Progress {
    pub version: u32,
    #[serde(rename = "lastChapter")]
    pub last_chapter: Option<String>,
    #[serde(rename = "imageIndex")]
    pub image_index: Option<usize>,
    pub offset: Option<f64>,
}

const PROGRESS_FILE: &str = ".streamreader.json";

/// 已打开压缩档缓存：避免每读一张图都重新解析整个 ZIP central directory（N1）。
/// 以文件修改时间做失效判断，压缩档被替换后自动重开。
struct CachedZip {
    mtime: Option<SystemTime>,
    zip: Arc<Mutex<ZipArchive<fs::File>>>,
}

#[derive(Default)]
struct ZipCache {
    map: Mutex<HashMap<PathBuf, CachedZip>>,
}

fn progress_path(work_path: &str) -> PathBuf {
    PathBuf::from(work_path).join(PROGRESS_FILE)
}

fn empty_progress() -> Progress {
    Progress {
        version: 1,
        last_chapter: None,
        image_index: None,
        offset: None,
    }
}

#[tauri::command]
fn list_works(app: AppHandle) -> Result<Vec<WorkInfo>, String> {
    let settings = store::load_settings(&app)?;
    let works = settings
        .works
        .into_iter()
        .map(|path| {
            let p = PathBuf::from(&path);
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            WorkInfo {
                path,
                name,
                valid: p.is_dir(),
            }
        })
        .collect();
    Ok(works)
}

#[tauri::command]
fn add_work(app: AppHandle, path: String) -> Result<(), String> {
    if !PathBuf::from(&path).is_dir() {
        return Err("not a directory".into());
    }
    let mut settings = store::load_settings(&app)?;
    if !settings.works.contains(&path) {
        settings.works.push(path);
        store::save_settings(&app, &settings)?;
    }
    Ok(())
}

#[tauri::command]
fn remove_work(app: AppHandle, path: String) -> Result<(), String> {
    let mut settings = store::load_settings(&app)?;
    settings.works.retain(|w| w != &path);
    store::save_settings(&app, &settings)
}

#[tauri::command]
fn list_chapters(work_path: String) -> Result<Vec<ChapterInfo>, String> {
    Ok(scanner::list_chapters(&PathBuf::from(work_path))
        .into_iter()
        .map(|name| ChapterInfo { name })
        .collect())
}

#[tauri::command]
fn list_images(work_path: String, chapter: String) -> Result<Vec<String>, String> {
    scanner::list_images(&PathBuf::from(work_path), &chapter)
}

#[tauri::command]
fn read_image(
    work_path: String,
    chapter: String,
    name: String,
    cache: tauri::State<ZipCache>,
) -> Result<tauri::ipc::Response, String> {
    let data = read_image_bytes(&work_path, &chapter, &name, &cache)?;
    Ok(tauri::ipc::Response::new(data))
}

/// 读取图片原始字节：目录话直接读文件；压缩档话按 ZIP 条目名读取（R15）。
/// 以原始字节（tauri::ipc::Response 的 Raw 体）返回，避免 base64 编解码与体积膨胀（N1/R12）。
/// 名称先经白名单与防穿越校验，避免 command 层读取任意文件。
fn read_image_bytes(
    work_path: &str,
    chapter: &str,
    name: &str,
    cache: &ZipCache,
) -> Result<Vec<u8>, String> {
    if !scanner::is_image(name) {
        return Err("not an image".into());
    }
    if !scanner::is_single_component(chapter) {
        return Err("invalid chapter".into());
    }
    let mut p = PathBuf::from(work_path);
    p.push(chapter);
    if p.is_file() {
        // 压缩档话：条目名可含 '/' 目录前缀，逐段校验防穿越
        if !scanner::is_safe_zip_entry(name) {
            return Err("invalid archive entry".into());
        }
        let mtime = fs::metadata(&p).and_then(|m| m.modified()).ok();
        let zip_arc = {
            let mut map = cache.map.lock().map_err(|e| e.to_string())?;
            let need_open = match map.get(&p) {
                Some(c) => c.mtime != mtime,
                None => true,
            };
            if need_open {
                let file = fs::File::open(&p).map_err(|e| e.to_string())?;
                let zip = ZipArchive::new(file).map_err(|e| e.to_string())?;
                map.insert(
                    p.clone(),
                    CachedZip {
                        mtime,
                        zip: Arc::new(Mutex::new(zip)),
                    },
                );
            }
            map.get(&p).expect("just inserted").zip.clone()
        };
        let mut zip = zip_arc.lock().map_err(|e| e.to_string())?;
        let mut entry = zip.by_name(name).map_err(|e| e.to_string())?;
        let mut data = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
        return Ok(data);
    }
    // 目录话：仅允许纯文件名，防止逃逸出话目录
    if !scanner::is_single_component(name) {
        return Err("invalid image name".into());
    }
    p.push(name);
    fs::read(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_progress(work_path: String) -> Result<Progress, String> {
    let path = progress_path(&work_path);
    if !path.exists() {
        return Ok(empty_progress());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).or(Ok(empty_progress()))
}

#[tauri::command]
fn save_progress(work_path: String, progress: Progress) -> Result<(), String> {
    let path = progress_path(&work_path);
    let text = serde_json::to_string_pretty(&progress).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_language(app: AppHandle) -> Result<String, String> {
    let settings = store::load_settings(&app)?;
    Ok(if settings.language == "en" {
        "en".into()
    } else {
        "zh".into()
    })
}

#[tauri::command]
fn set_language(app: AppHandle, language: String) -> Result<(), String> {
    let mut settings = store::load_settings(&app)?;
    settings.language = language;
    store::save_settings(&app, &settings)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ZipCache::default())
        .invoke_handler(tauri::generate_handler![
            list_works,
            add_work,
            remove_work,
            list_chapters,
            list_images,
            read_image,
            get_progress,
            save_progress,
            get_language,
            set_language
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
