//! CaseFiles.cs: the files the page makes (an OpenWAM .wam, OpenFOAM dictionaries, a README) or passes on (an STL
//! the user picked), and writing them under a folder without letting a name leave it.

use crate::paths::full_path;
use crate::{HResult, HostError};
use base64::Engine;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Text, or bytes when the page sent base64.
#[derive(Clone, Debug, PartialEq)]
pub struct CaseFile {
    pub name: String,
    pub text: String,
    pub exec: bool,
    pub data: Option<Vec<u8>>,
}

/// [{name, text, exec?}] or [{name, base64}] from the page's JSON; anything else in the list is skipped.
pub fn from_json(files: Option<&Value>) -> HResult<Vec<CaseFile>> {
    let mut list = Vec::new();
    let Some(Value::Array(arr)) = files else { return Ok(list) };
    for f in arr {
        let name = match f.get("name") {
            Some(Value::String(s)) if !s.is_empty() => s.clone(),
            None | Some(Value::Null) | Some(Value::String(_)) => continue,
            Some(_) => return Err(HostError::Msg("A file's name should be text.".into())),
        };
        if let Some(Value::String(b64)) = f.get("base64") {
            let data = base64::engine::general_purpose::STANDARD
                .decode(b64.as_bytes())
                .map_err(|_| HostError::Msg(format!("{} did not arrive as valid base64.", name)))?;
            list.push(CaseFile { name, text: String::new(), exec: false, data: Some(data) });
            continue;
        }
        let text = match f.get("text") {
            Some(Value::String(s)) => s.clone(),
            _ => continue,
        };
        let exec = matches!(f.get("exec"), Some(Value::Bool(true)));
        list.push(CaseFile { name, text, exec, data: None });
    }
    Ok(list)
}

/// C#'s char.IsControl: U+0000-U+001F and U+007F-U+009F.
fn is_control(c: char) -> bool {
    (c as u32) < 0x20 || ((c as u32) >= 0x7f && (c as u32) <= 0x9f)
}

/// A file or folder name with nothing that could leave the folder or upset Windows.
pub fn safe_name(name: &str) -> String {
    const BAD: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'];
    let s: String = name.chars().map(|c| if BAD.contains(&c) || is_control(c) { '_' } else { c }).collect();
    let s = s.trim_matches(|c| c == ' ' || c == '.');
    if s.is_empty() {
        return "case".to_string();
    }
    if s.encode_utf16().count() > 80 {
        // C# counts UTF-16 units; cut at 80 of them without splitting a character
        let mut out = String::new();
        let mut n = 0;
        for c in s.chars() {
            let w = c.len_utf16();
            if n + w > 80 {
                break;
            }
            out.push(c);
            n += w;
        }
        return out;
    }
    s.to_string()
}

/// The relative parts of a name the page gave (a CFD case uses "case/system/controlDict"); empty parts, "." and
/// ".." are dropped so nothing is written outside the chosen folder.
pub fn relative_parts(name: &str) -> Vec<String> {
    name.replace('\\', "/").split('/').filter(|p| !p.is_empty() && *p != "." && *p != "..").map(safe_name).collect()
}

/// Writes the files under folder. Windows batch files, OpenWAM inputs and .txt get CRLF line ends (as the Fusion
/// add-in writes them), everything else LF. Returns the relative names written.
pub fn write(folder: &Path, files: &[CaseFile]) -> HResult<Vec<String>> {
    let root = full_path(folder);
    std::fs::create_dir_all(&root)?;
    let root_s = root.to_string_lossy().trim_end_matches(std::path::MAIN_SEPARATOR).to_string();
    let mut written = Vec::new();
    for f in files {
        let parts = relative_parts(&f.name);
        if parts.is_empty() {
            continue;
        }
        let mut path: PathBuf = root.clone();
        for p in &parts {
            path.push(p);
        }
        let path = full_path(&path);
        if !path.to_string_lossy().starts_with(&format!("{}{}", root_s, std::path::MAIN_SEPARATOR)) {
            return Err(HostError::Msg(format!("A file name tried to leave the case folder: {}", f.name)));
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        if let Some(data) = &f.data {
            std::fs::write(&path, data)?; // bytes as they came (an STL): no line-end conversion
            written.push(parts.join("/"));
            continue;
        }
        let lower = path.to_string_lossy().to_lowercase();
        let nl = if lower.ends_with(".bat") || lower.ends_with(".txt") || lower.ends_with(".wam") { "\r\n" } else { "\n" };
        let text = f.text.replace("\r\n", "\n").replace('\n', nl);
        std::fs::write(&path, text.as_bytes())?;
        #[cfg(unix)]
        if f.exec {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path)?.permissions().mode();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode | 0o111))?;
        }
        written.push(parts.join("/"));
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("et_case_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn writes_subfolders_and_line_ends() {
        // CoreTests.Writes_subfolders_and_line_ends
        let d = tmp("ends");
        let files = from_json(Some(&json!([
            {"name": "run_all.bat", "text": "a\nb\n"},
            {"name": "case/system/controlDict", "text": "x\r\ny\n", "exec": false},
            {"name": "Allrun", "text": "#!/bin/sh\n", "exec": true},
            {"name": "", "text": "skipped"},
            {"name": "no text"}
        ])))
        .unwrap();
        assert_eq!(files.len(), 3);
        let w = write(&d, &files).unwrap();
        assert_eq!(w, vec!["run_all.bat", "case/system/controlDict", "Allrun"]);
        assert_eq!(std::fs::read(d.join("run_all.bat")).unwrap(), b"a\r\nb\r\n");
        assert_eq!(std::fs::read(d.join("case/system/controlDict")).unwrap(), b"x\ny\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert!(std::fs::metadata(d.join("Allrun")).unwrap().permissions().mode() & 0o111 != 0);
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn binary_and_escapes() {
        let d = tmp("bin");
        let files = from_json(Some(&json!([{"name": "part.stl", "base64": "AAEC/w=="}]))).unwrap();
        write(&d, &files).unwrap();
        assert_eq!(std::fs::read(d.join("part.stl")).unwrap(), vec![0u8, 1, 2, 255]);
        // ".." and absolute-looking parts cannot leave the folder
        let f = vec![CaseFile { name: "../../etc/x".into(), text: "t".into(), exec: false, data: None }];
        assert_eq!(write(&d, &f).unwrap(), vec!["etc/x"]);
        assert!(d.join("etc/x").exists());
        assert_eq!(safe_name(" ..a:b*c?.. "), "a_b_c_");
        assert_eq!(safe_name("..."), "case");
        assert_eq!(safe_name(&"x".repeat(100)).len(), 80);
        assert_eq!(relative_parts("a\\b/./c/../d"), vec!["a", "b", "c", "d"]);
        let _ = std::fs::remove_dir_all(&d);
    }
}
