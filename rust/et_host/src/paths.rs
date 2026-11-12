//! AppPaths.cs: where the program's own files are, where runs go, and where Fusion looks for add-ins.

use crate::case_files::safe_name;
use std::env;
use std::path::{Path, PathBuf};

pub struct AppPaths {
    /// The folder the program is installed in (holds web/, fusion-addin/, engines/).
    pub app_root: PathBuf,
    /// Per-user data: %LOCALAPPDATA%\ExhaustTuner (runs, settings).
    pub data_root: PathBuf,
    /// Fusion's add-in folder: %APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns.
    pub fusion_addins_root: PathBuf,
    /// Whether EXHAUST_TUNER_OPENWAM / _OPENFOAM / _ENGINESIM may replace the solvers under engines/ (true unless
    /// without_engine_env() was called: tests with stand-in solvers there must not pick up a developer's real build).
    pub engine_env: bool,
}

fn nonempty_env(k: &str) -> Option<String> {
    env::var(k).ok().filter(|v| !v.is_empty())
}

/// An absolute, tidied path (Path.GetFullPath without touching the disk).
pub fn full_path(p: &Path) -> PathBuf {
    let abs = if p.is_absolute() { p.to_path_buf() } else { env::current_dir().unwrap_or_default().join(p) };
    let mut out = PathBuf::new();
    for c in abs.components() {
        match c {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// .NET's Environment.SpecialFolder.LocalApplicationData: %LOCALAPPDATA%, or $XDG_DATA_HOME / ~/.local/share.
pub fn local_app_data() -> PathBuf {
    if cfg!(windows) {
        if let Some(v) = nonempty_env("LOCALAPPDATA") {
            return PathBuf::from(v);
        }
    } else if let Some(v) = nonempty_env("XDG_DATA_HOME") {
        return PathBuf::from(v);
    }
    home().join(if cfg!(windows) { "AppData\\Local" } else { ".local/share" })
}

/// .NET's Environment.SpecialFolder.ApplicationData: %APPDATA%, or $XDG_CONFIG_HOME / ~/.config.
pub fn app_data() -> PathBuf {
    if cfg!(windows) {
        if let Some(v) = nonempty_env("APPDATA") {
            return PathBuf::from(v);
        }
    } else if let Some(v) = nonempty_env("XDG_CONFIG_HOME") {
        return PathBuf::from(v);
    }
    home().join(if cfg!(windows) { "AppData\\Roaming" } else { ".config" })
}

fn home() -> PathBuf {
    PathBuf::from(nonempty_env(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap_or_default())
}

impl AppPaths {
    pub fn new(app_root: Option<&str>, data_root: Option<&str>, fusion_root: Option<&str>) -> AppPaths {
        let exe_dir = env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())).unwrap_or_default();
        AppPaths {
            app_root: full_path(&app_root.map(PathBuf::from).unwrap_or(exe_dir)),
            data_root: full_path(&data_root.map(PathBuf::from).unwrap_or_else(|| local_app_data().join("ExhaustTuner"))),
            fusion_addins_root: full_path(&fusion_root.map(PathBuf::from).unwrap_or_else(|| {
                app_data().join("Autodesk").join("Autodesk Fusion 360").join("API").join("AddIns")
            })),
            engine_env: true,
        }
    }

    /// The same paths, with the solvers always taken from app_root/engines (the environment overrides ignored).
    pub fn without_engine_env(mut self) -> AppPaths {
        self.engine_env = false;
        self
    }

    fn engine_override(&self, k: &str) -> Option<String> {
        if self.engine_env {
            nonempty_env(k)
        } else {
            None
        }
    }

    pub fn web_dir(&self) -> PathBuf {
        self.app_root.join("web")
    }
    pub fn page_file(&self) -> PathBuf {
        self.web_dir().join("index.html")
    }
    pub fn addin_source_dir(&self) -> PathBuf {
        self.app_root.join("fusion-addin")
    }
    pub fn engines_dir(&self) -> PathBuf {
        self.app_root.join("engines")
    }
    pub fn runs_dir(&self) -> PathBuf {
        self.data_root.join("runs")
    }
    pub fn addin_target_dir(&self) -> PathBuf {
        self.fusion_addins_root.join("ExhaustTuner")
    }

    /// OpenWAM. EXHAUST_TUNER_OPENWAM overrides (the real-solver test, developers), unless without_engine_env().
    pub fn openwam_exe(&self) -> PathBuf {
        self.engine_override("EXHAUST_TUNER_OPENWAM")
            .map(PathBuf::from)
            .unwrap_or_else(|| self.engines_dir().join("openwam").join(if cfg!(windows) { "OpenWAM.exe" } else { "OpenWAM" }))
    }

    /// The packaged Engine Simulator fork (bin\engine-sim-headless.exe, es\). EXHAUST_TUNER_ENGINESIM overrides.
    pub fn enginesim_dir(&self) -> PathBuf {
        self.engine_override("EXHAUST_TUNER_ENGINESIM").map(PathBuf::from).unwrap_or_else(|| self.engines_dir().join("engine-sim"))
    }

    /// The packaged OpenFOAM (bin\ with the programs and DLLs, etc\). EXHAUST_TUNER_OPENFOAM overrides.
    pub fn openfoam_dir(&self) -> PathBuf {
        self.engine_override("EXHAUST_TUNER_OPENFOAM")
            .map(PathBuf::from)
            .unwrap_or_else(|| self.engines_dir().join("openfoam").join("OpenFOAM-v2412"))
    }

    /// A new, unique folder for one run: runs\yyyyMMdd-HHmmss_name.
    pub fn new_run_dir(&self, name: &str) -> std::io::Result<PathBuf> {
        let safe = safe_name(name);
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
        let mut dir = self.runs_dir().join(format!("{}_{}", stamp, safe));
        let mut i = 2;
        while dir.exists() {
            dir = self.runs_dir().join(format!("{}_{}_{}", stamp, safe, i));
            i += 1;
        }
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }
}

/// path is root or inside it, ignoring case (HostDispatcher.IsUnder).
pub fn is_under(path: &Path, root: &Path) -> bool {
    let r = full_path(root).to_string_lossy().trim_end_matches(['/', '\\']).to_lowercase();
    let p = path.to_string_lossy().to_lowercase();
    let sep = std::path::MAIN_SEPARATOR;
    p == r || p.starts_with(&format!("{}{}", r, sep))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_and_runs() {
        let tmp = std::env::temp_dir().join(format!("et_paths_{}", std::process::id()));
        // absolute on every OS ("/opt" has no drive on Windows, so it would take the current one)
        let base = full_path(&std::env::temp_dir());
        let p = AppPaths::new(Some(base.join("opt").join("et").join(".").join("x").join("..").to_str().unwrap()), Some(tmp.to_str().unwrap()), Some(base.join("f").to_str().unwrap()));
        assert_eq!(p.app_root, base.join("opt").join("et"));
        assert_eq!(p.addin_target_dir(), base.join("f").join("ExhaustTuner"));
        let a = p.new_run_dir("my run: 1").unwrap();
        let b = p.new_run_dir("my run: 1").unwrap();
        assert!(a.file_name().unwrap().to_string_lossy().ends_with("_my run_ 1"));
        assert_ne!(a, b);
        assert!(is_under(&a, &p.runs_dir()) && !is_under(&tmp, &p.runs_dir()));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
