//! FusionAddIn.cs: installs or updates the Exhaust Tuner add-in in Fusion's add-in folder.

use crate::paths::AppPaths;
use crate::{obj, palette, HResult, HostError};
use serde_json::Value;
use std::path::Path;

/// The add-in's own files; anything else in the target folder (the user's notes, layouts) is left alone.
pub const FILES: &[&str] = &["ExhaustTuner.py", "ExhaustTuner.manifest", "cadtools.py", "router.py", "templates.py", "jig.py", "hangers.py", "merge.py", "native.py", "hostrun.py", "README.txt"];

/// The Rust core the router loads when it is there (native.py falls back to Python without it). Copied when the
/// bundle has it; a copy left in the add-in folder by an older install is removed when the bundle does not, so a
/// stale library is never loaded.
pub const OPTIONAL_FILES: &[&str] = &["et_core.dll"];

/// Where native.py keeps the copies of et_core.dll it loads (named by their content, so the installed file is never
/// the one a running Fusion holds).
pub const NATIVE_COPIES: &str = "native";

/// Puts from (or nothing, for None) at to. Windows will not overwrite or delete a DLL a running program has loaded,
/// but it will rename one: when Fusion holds the file (native.py loads the installed file itself when it cannot
/// make its own copy), it is moved aside to <name>.<n>.old and the new one written in its place. Fusion keeps using
/// the old one until it restarts; the next install removes it.
fn put_file(from: Option<&Path>, to: &Path) -> std::io::Result<()> {
    clear_aside(to);
    let write = || match from {
        Some(f) => std::fs::copy(f, to).map(|_| ()),
        None if to.symlink_metadata().is_ok() => std::fs::remove_file(to),
        None => Ok(()),
    };
    match write() {
        Ok(()) => Ok(()),
        Err(e) => {
            if to.symlink_metadata().is_err() {
                return Err(e);
            }
            let name = to.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let aside = (1..1000).map(|n| to.with_file_name(format!("{}.{}.old", name, n))).find(|p| p.symlink_metadata().is_err());
            let Some(aside) = aside else { return Err(e) };
            std::fs::rename(to, &aside).map_err(|_| e)?;
            write()
        }
    }
}

/// Removes what put_file moved aside before, where nothing holds it any more (best effort).
fn clear_aside(to: &Path) {
    let (Some(dir), Some(name)) = (to.parent(), to.file_name().map(|n| n.to_string_lossy().into_owned())) else { return };
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let pre = format!("{}.", name);
    for e in rd.flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        if n.starts_with(&pre) && n.ends_with(".old") {
            let p = e.path();
            if std::fs::remove_file(&p).is_err() {
                let _ = std::fs::remove_dir_all(&p);
            }
        }
    }
}

pub fn manifest_version(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("ExhaustTuner.manifest")).ok()?;
    let re = regex::Regex::new(r#""version"\s*:\s*"([^"]+)""#).ok()?;
    re.captures(&text).map(|c| c[1].to_string())
}

fn opt(s: Option<String>) -> Value {
    s.map(Value::String).unwrap_or(Value::Null)
}

pub fn status(paths: &AppPaths) -> Value {
    obj([
        ("bundled", opt(manifest_version(&paths.addin_source_dir()))),
        ("installed", opt(manifest_version(&paths.addin_target_dir()))),
        ("target", Value::String(paths.addin_target_dir().to_string_lossy().into_owned())),
        ("fusionFolderExists", Value::Bool(paths.fusion_addins_root.is_dir())),
    ])
}

/// Copies the add-in files and writes palette.html from the bundled page, so the panel inside Fusion is the same
/// version as this program. Fusion keeps a running add-in's code in memory: the user stops and runs it again
/// (Utilities, Add-Ins), or restarts Fusion for a new router core, for the update to take effect.
pub fn install(paths: &AppPaths) -> HResult<Value> {
    let src = paths.addin_source_dir();
    for f in FILES {
        if !src.join(f).is_file() {
            return Err(HostError::Msg(format!("The bundled add-in is incomplete: {} missing in {}", f, src.display())));
        }
    }
    let page = paths.page_file();
    if !page.is_file() {
        return Err(HostError::Msg(format!("The bundled page is missing: {}", page.display())));
    }
    let dst = paths.addin_target_dir();
    std::fs::create_dir_all(&dst)?;
    let before = manifest_version(&dst);
    for f in FILES {
        std::fs::copy(src.join(f), dst.join(f))?;
    }
    let mut core = false;
    for f in OPTIONAL_FILES {
        let (from, to) = (src.join(f), dst.join(f));
        let have = from.is_file();
        core |= have;
        put_file(if have { Some(from.as_path()) } else { None }, &to)?;
    }
    if !core {
        // no Rust core in this bundle: its loaded copies go too (any a running Fusion holds stay until it quits)
        let _ = std::fs::remove_dir_all(dst.join(NATIVE_COPIES));
    }
    let pal = palette::build(&std::fs::read_to_string(&page)?).map_err(HostError::Msg)?;
    std::fs::write(dst.join("palette.html"), pal)?;
    let after = manifest_version(&dst);
    let verb = match (&before, &after) {
        (None, _) => "Installed".to_string(),
        (Some(b), a) if Some(b) == a.as_ref() => "Reinstalled".to_string(),
        (Some(b), _) => format!("Updated {} to", b),
    };
    let msg = format!(
        "{} the Exhaust Tuner add-in {} in {}. In Fusion: Utilities, Add-Ins, select Exhaust Tuner, Stop, then Run (or restart Fusion; a new router core loads only then) to load it.",
        verb,
        after.clone().unwrap_or_default(),
        dst.display()
    );
    Ok(obj([
        ("ok", Value::Bool(true)),
        ("folder", Value::String(dst.to_string_lossy().into_owned())),
        ("from", opt(before)),
        ("to", opt(after)),
        ("msg", Value::String(msg)),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn installs_files_and_palette_and_reports_versions() {
        // CoreTests.Installs_files_and_palette_and_reports_versions, with the Rust core's optional file
        let d = std::env::temp_dir().join(format!("et_addin_{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let app = d.join("app");
        let src = app.join("fusion-addin");
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(app.join("web")).unwrap();
        for f in FILES {
            fs::write(src.join(f), format!("# {}\n", f)).unwrap();
        }
        fs::write(src.join("ExhaustTuner.manifest"), "{\n  \"version\": \"4.13.0\"\n}\n").unwrap();
        fs::write(src.join("et_core.dll"), "dll").unwrap();
        fs::write(app.join("web/index.html"), "<title>T</title>\n<style>s</style>\n<p>x</p>\n").unwrap();
        let fus = d.join("fusion");
        fs::create_dir_all(&fus).unwrap();
        let p = AppPaths::new(Some(app.to_str().unwrap()), Some(d.join("data").to_str().unwrap()), Some(fus.to_str().unwrap()));
        let st = status(&p);
        assert_eq!(st["bundled"], "4.13.0");
        assert!(st["installed"].is_null());
        let r = install(&p).unwrap();
        assert_eq!(r["to"], "4.13.0");
        assert!(r["msg"].as_str().unwrap().starts_with("Installed the Exhaust Tuner add-in 4.13.0 in "));
        let dst = p.addin_target_dir();
        assert!(dst.join("palette.html").is_file() && dst.join("et_core.dll").is_file());
        assert!(fs::read_to_string(dst.join("palette.html")).unwrap().starts_with("<!doctype html>"));
        let r = install(&p).unwrap();
        assert!(r["msg"].as_str().unwrap().starts_with("Reinstalled"));
        // an installed core that cannot be written over (Windows: a running Fusion has it loaded; played here by a
        // folder of that name): moved aside and the new one written, and the next install clears it away
        fs::remove_file(dst.join("et_core.dll")).unwrap();
        fs::create_dir_all(dst.join("et_core.dll").join("held")).unwrap();
        install(&p).unwrap();
        assert_eq!(fs::read_to_string(dst.join("et_core.dll")).unwrap(), "dll");
        assert!(dst.join("et_core.dll.1.old").is_dir());
        install(&p).unwrap();
        assert!(!dst.join("et_core.dll.1.old").exists());
        // a bundle without the Rust core removes a stale copy, and the copies native.py loaded
        fs::create_dir_all(dst.join(NATIVE_COPIES)).unwrap();
        fs::write(dst.join(NATIVE_COPIES).join("et_core-0123456789ab.dll"), "old").unwrap();
        fs::remove_file(src.join("et_core.dll")).unwrap();
        fs::write(src.join("ExhaustTuner.manifest"), "{ \"version\": \"4.14.0\" }").unwrap();
        let r = install(&p).unwrap();
        assert!(r["msg"].as_str().unwrap().starts_with("Updated 4.13.0 to the Exhaust Tuner add-in 4.14.0"));
        assert!(!dst.join("et_core.dll").exists() && !dst.join(NATIVE_COPIES).exists());
        fs::remove_file(src.join("cadtools.py")).unwrap();
        assert!(matches!(install(&p), Err(HostError::Msg(m)) if m.contains("incomplete: cadtools.py")));
        let _ = fs::remove_dir_all(&d);
    }
}
