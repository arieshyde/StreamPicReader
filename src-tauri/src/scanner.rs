use std::fs;
use std::path::{Component, Path};

const IMAGE_EXTS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

pub fn is_image(name: &str) -> bool {
    let ext = match name.rsplit_once('.') {
        Some((_, ext)) => ext.to_ascii_lowercase(),
        None => return false,
    };
    IMAGE_EXTS.contains(&ext.as_str())
}

/// 压缩档话判定：仅 CBZ / ZIP（大小写不敏感）。CBZ 本质是 ZIP。
pub fn is_archive(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".cbz") || lower.ends_with(".zip")
}

/// 提取首个连续数字段：返回（数值, 数位长度）。
fn first_digit_run(name: &str) -> (Option<u64>, usize) {
    let mut num = String::new();
    let mut started = false;
    for c in name.chars() {
        if c.is_ascii_digit() {
            num.push(c);
            started = true;
        } else if started {
            break;
        }
    }
    let len = num.len();
    (num.parse().ok(), len)
}

/// 话名排序键：与 image_key 一致，数值相同时数位短者（无前导零）在前。
fn natural_key(name: &str) -> (u64, usize, String) {
    let (num, digits) = first_digit_run(name);
    (num.unwrap_or(u64::MAX), digits, name.to_string())
}

/// 图片排序键：以“文件名（最后一段路径）内数字”为主键；数值相同时数位短者（无前导零）在前；
/// 最后以 basename 作次序键。压缩档条目可能带目录前缀（如 sub/01.png），需取最后一段做比较。
fn image_key(name: &str) -> (u64, usize, String) {
    let base = name.rsplit('/').next().unwrap_or(name);
    let (num, digits) = first_digit_run(base);
    (num.unwrap_or(u64::MAX), digits, base.to_string())
}

/// 名称必须是“单个普通路径分量”：非空、不含分隔符、不是 `.`/`..` 等，
/// 用于防止 IPC 传入的 chapter/name 逃逸出作品/话目录。
pub fn is_single_component(name: &str) -> bool {
    let mut components = Path::new(name).components();
    matches!(components.next(), Some(Component::Normal(_)))
        && components.next().is_none()
}

/// ZIP 条目名：允许用 '/' 分隔的多级普通分量（如 sub/01.png），逐段校验防穿越。
pub fn is_safe_zip_entry(name: &str) -> bool {
    name.split('/').all(is_single_component)
}

/// 话列表：作品目录下含图片的子目录 + cbz/zip 压缩档，自然排序。
pub fn list_chapters(work_path: &Path) -> Vec<String> {
    let entries = match fs::read_dir(work_path) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut chapters: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            let path = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                has_images(&path)
            } else {
                is_archive(&name)
            }
        })
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    chapters.sort_by_key(|n| natural_key(n));
    chapters
}

fn has_images(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .any(|e| e.path().is_file() && is_image(&e.file_name().to_string_lossy()))
        })
        .unwrap_or(false)
}

/// 话内图片列表：过滤非图片文件，按文件名自然排序。
pub fn list_images(work_path: &Path, chapter: &str) -> Result<Vec<String>, String> {
    let path = work_path.join(chapter);
    if path.is_dir() {
        let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
        let mut images: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| is_image(n))
            .collect();
        images.sort_by_key(|n| image_key(n));
        Ok(images)
    } else if path.is_file() && is_archive(chapter) {
        list_archive_images(&path)
    } else {
        Err("chapter not found".into())
    }
}

fn list_archive_images(path: &Path) -> Result<Vec<String>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut images: Vec<String> = Vec::new();
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if !entry.is_dir() && is_image(entry.name()) {
            images.push(entry.name().to_string());
        }
    }
    images.sort_by_key(|n| image_key(n));
    Ok(images)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_sort_orders_by_embedded_number() {
        let mut names = vec!["第10话".to_string(), "第2话".to_string(), "第1话".to_string()];
        names.sort_by_key(|n| natural_key(n));
        assert_eq!(names, vec!["第1话", "第2话", "第10话"]);
    }

    #[test]
    fn image_filter_matches_whitelist_case_insensitively() {
        assert!(is_image("001.jpg"));
        assert!(is_image("002.JPEG"));
        assert!(is_image("003.png"));
        assert!(is_image("004.webp"));
        assert!(!is_image("notes.txt"));
        assert!(!is_image(".streamreader.json"));
        assert!(!is_image("noext"));
    }

    #[test]
    fn archive_detection_is_case_insensitive() {
        assert!(is_archive("vol1.cbz"));
        assert!(is_archive("vol2.ZIP"));
        assert!(!is_archive("notes.txt"));
    }

    #[test]
    fn natural_sort_prefers_no_leading_zero_on_tie() {
        let mut names = vec!["第01话".to_string(), "第1话".to_string()];
        names.sort_by_key(|n| natural_key(n));
        assert_eq!(names, vec!["第1话", "第01话"]);
    }

    #[test]
    fn single_component_rejects_traversal() {
        assert!(is_single_component("1.png"));
        assert!(is_single_component("第4话.cbz"));
        assert!(!is_single_component("../secret.png"));
        assert!(!is_single_component("sub/1.png"));
        assert!(!is_single_component(""));
        assert!(!is_single_component("."));
    }

    #[test]
    fn safe_zip_entry_allows_subdirs_but_blocks_traversal() {
        assert!(is_safe_zip_entry("01.png"));
        assert!(is_safe_zip_entry("sub/01.png"));
        assert!(!is_safe_zip_entry("../evil.png"));
        assert!(!is_safe_zip_entry("sub//x.png"));
    }

    #[test]
    fn image_key_sorts_by_basename_number() {
        let mut names = vec![
            "sub/10.png".to_string(),
            "1.png".to_string(),
            "sub/2.png".to_string(),
            "sub/02.JPG".to_string(),
        ];
        names.sort_by_key(|n| image_key(n));
        assert_eq!(
            names,
            vec![
                "1.png",
                "sub/2.png",
                "sub/02.JPG",
                "sub/10.png"
            ]
        );
    }
}
