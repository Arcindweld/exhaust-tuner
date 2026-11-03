//! StartRecord.cs: last-start.txt in the data folder: which version started last, as which process, when, from which
//! folder (one per line). The program writes it as it starts and adds a "page loaded" line once the page is up; the
//! version it held before this start tells the updater that an update was just installed.

use crate::paths::AppPaths;
use std::sync::Mutex;

pub const FILE_NAME: &str = "last-start.txt";

/// The version the previous start recorded, read before this start overwrote it (set by the program).
pub static PREVIOUS_VERSION: Mutex<Option<String>> = Mutex::new(None);

/// Records this start and returns the version the previous one recorded (None if none).
pub fn write(paths: &AppPaths, version: &str) -> std::io::Result<Option<String>> {
    let f = paths.data_root.join(FILE_NAME);
    let prev = std::fs::read_to_string(&f).ok().and_then(|t| t.lines().next().map(|l| l.trim().to_string()));
    std::fs::create_dir_all(&paths.data_root)?;
    let base = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| format!("{}{}", d.display(), std::path::MAIN_SEPARATOR)))
        .unwrap_or_default();
    std::fs::write(&f, format!("{}\n{}\n{}\n{}\n", version, std::process::id(), crate::utc_now_o(), base))?;
    Ok(prev.filter(|p| !p.is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_record_returns_the_previous_version() {
        // UpdaterTests.Start_record_returns_the_previous_version
        let d = std::env::temp_dir().join(format!("et_start_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let p = AppPaths::new(Some("/opt/et"), Some(d.to_str().unwrap()), Some("/f"));
        assert_eq!(write(&p, "0.1.44").unwrap(), None);
        assert_eq!(write(&p, "0.1.45").unwrap(), Some("0.1.44".to_string()));
        let t = std::fs::read_to_string(d.join(FILE_NAME)).unwrap();
        let lines: Vec<&str> = t.lines().collect();
        assert_eq!(lines[0], "0.1.45");
        assert_eq!(lines[1], std::process::id().to_string());
        let _ = std::fs::remove_dir_all(&d);
    }
}
