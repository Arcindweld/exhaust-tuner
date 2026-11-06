//! HostDispatcher.cs: the page's requests: {action, data} in, a JSON result out, progress events while it runs.
//! Kept free of the window, so the tests and exhaust-tuner-host run it directly on any system.

use crate::case_files;
use crate::enginesim::EngineSimRunner;
use crate::fusion_addin;
use crate::openfoam::OpenFoamRunner;
use crate::openwam::{self, OpenWamRunner};
use crate::paths::{full_path, is_under, AppPaths};
use crate::updater::Updater;
use crate::{get_bool, get_f64, get_str, obj, version, Cancel, Events, HResult, HostError};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

/// What the dispatcher needs from the window (dialogs, opening folders). The program's window implements it.
pub trait HostUi: Send + Sync {
    /// Asks for a folder; None when the user cancels.
    fn pick_folder(&self, title: &str) -> Option<PathBuf>;
    /// Asks where to save one file; None when the user cancels.
    fn pick_save_file(&self, title: &str, suggested: &str) -> Option<PathBuf>;
    fn open_folder(&self, path: &Path);
    /// The page's colour theme, so the window frame can match it.
    fn set_theme(&self, _dark: bool) {}
    /// Opens the browser developer tools.
    fn open_dev_tools(&self) {}
    /// Closes the program (after starting an update's installer, which waits for that).
    fn quit(&self) {}
}

pub struct Dispatcher {
    paths: Arc<AppPaths>,
    ui: Arc<dyn HostUi>,
    updater: Arc<Updater>,
    active_runs: AtomicUsize, // solver runs going on: an update is not installed while one is
    // folders the user picked when saving: "openFolder" opens these and anything under the runs folder, nothing else
    chosen: Mutex<HashSet<String>>,
}

struct RunGuard<'a>(&'a AtomicUsize);
impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn s(p: &Path) -> Value {
    Value::String(p.to_string_lossy().into_owned())
}

impl Dispatcher {
    pub fn new(paths: Arc<AppPaths>, ui: Arc<dyn HostUi>, updater: Arc<Updater>) -> Dispatcher {
        Dispatcher { paths, ui, updater, active_runs: AtomicUsize::new(0), chosen: Mutex::new(HashSet::new()) }
    }

    fn run<T>(&self, f: impl FnOnce() -> HResult<T>) -> HResult<T> {
        self.active_runs.fetch_add(1, Ordering::SeqCst);
        let _g = RunGuard(&self.active_runs);
        f()
    }

    pub fn info(&self) -> Value {
        let p = &self.paths;
        obj([
            ("app", "Exhaust Tuner".into()),
            ("version", version().into()),
            (
                "engines",
                obj([
                    ("openwam", OpenWamRunner::new(p.openwam_exe()).available().into()),
                    ("openfoam", OpenFoamRunner::new(p.openfoam_dir()).available().into()),
                    ("enginesim", EngineSimRunner::new(p.enginesim_dir()).available().into()),
                ]),
            ),
            ("runsFolder", s(&p.runs_dir())),
            ("licenses", s(&p.app_root.join("licenses"))),
            ("fusionAddIn", fusion_addin::status(p)),
            ("update", self.updater.status()),
        ])
    }

    fn remember(&self, folder: &Path) {
        self.chosen.lock().unwrap().insert(full_path(folder).to_string_lossy().to_lowercase());
    }

    pub fn dispatch(&self, action: &str, data: &Value, ev: Events, cancel: &Cancel) -> HResult<Value> {
        let p = &self.paths;
        match action {
            "hostInfo" => Ok(self.info()),

            "runOpenWAM" => self.run(|| {
                let files = case_files::from_json(data.get("files"))?;
                let name = get_str(data, "name")?.unwrap_or_else(|| "openwam".into());
                let dir = p.new_run_dir(&name)?;
                ev(obj([("event", "folder".into()), ("folder", s(&dir))]));
                let results = OpenWamRunner::new(p.openwam_exe()).run(&dir, &files, ev, cancel, 0)?;
                Ok(openwam::to_json(&dir, &results))
            }),

            "runOpenFOAM" => self.run(|| {
                let files = case_files::from_json(data.get("files"))?;
                if files.is_empty() {
                    return Err(HostError::Msg("No case files.".into()));
                }
                let name = get_str(data, "name")?.unwrap_or_else(|| "openfoam".into());
                let dir = p.new_run_dir(&name)?;
                ev(obj([("event", "folder".into()), ("folder", s(&dir))]));
                OpenFoamRunner::new(p.openfoam_dir()).run(&dir, &files, ev, cancel)
            }),

            "runEngineSim" => self.run(|| {
                let text = get_str(data, "text")?.ok_or_else(|| HostError::Msg("No engine file.".into()))?;
                let fname = get_str(data, "filename")?.unwrap_or_else(|| "engine.mr".into());
                let rpms: Vec<f64> = data.get("rpms").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|n| n.as_f64()).filter(|r| *r > 0.0).collect()).unwrap_or_default();
                let secs = get_f64(data, "seconds")?.unwrap_or(6.0);
                let gain = get_f64(data, "gain")?.unwrap_or(0.35);
                let stem = Path::new(&fname).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                let dir = p.new_run_dir(&stem)?;
                EngineSimRunner::new(p.enginesim_dir()).run(&dir, &fname, &text, &rpms, secs, gain, ev, cancel)
            }),

            "saveFiles" => {
                let files = case_files::from_json(data.get("files"))?;
                if files.is_empty() {
                    return Ok(obj([("ok", false.into()), ("msg", "Nothing to save.".into())]));
                }
                let title = get_str(data, "title")?.unwrap_or_else(|| "Choose a folder".into());
                let Some(mut folder) = self.ui.pick_folder(&title) else {
                    return Ok(obj([("ok", false.into()), ("msg", "Not saved.".into())]));
                };
                if let Some(sub) = get_str(data, "folder")?.filter(|s| !s.is_empty()) {
                    folder = folder.join(case_files::safe_name(&sub));
                }
                let written = case_files::write(&folder, &files)?;
                self.remember(&folder);
                Ok(obj([
                    ("ok", true.into()),
                    ("path", s(&folder)),
                    ("files", Value::Array(written.iter().map(|w| Value::String(w.clone())).collect())),
                    ("msg", format!("Saved {} files in {}.", written.len(), folder.display()).into()),
                ]))
            }

            "saveText" => {
                let name = case_files::safe_name(&get_str(data, "filename")?.unwrap_or_else(|| "file.txt".into()));
                let Some(text) = get_str(data, "text")? else {
                    return Ok(obj([("ok", false.into()), ("msg", "Nothing to save.".into())]));
                };
                let title = get_str(data, "title")?.unwrap_or_else(|| "Save".into());
                let Some(path) = self.ui.pick_save_file(&title, &name) else {
                    return Ok(obj([("ok", false.into()), ("msg", "Not saved.".into())]));
                };
                std::fs::write(&path, text.as_bytes())?;
                if let Some(dir) = full_path(&path).parent() {
                    self.remember(dir);
                }
                Ok(obj([("ok", true.into()), ("path", s(&path)), ("msg", format!("Saved {}.", path.display()).into())]))
            }

            "saveBase64" => {
                use base64::Engine as _;
                let name = case_files::safe_name(&get_str(data, "filename")?.unwrap_or_else(|| "file.bin".into()));
                let raw = match get_str(data, "b64")?.map(|t| base64::engine::general_purpose::STANDARD.decode(t.as_bytes())) {
                    Some(Ok(b)) if !b.is_empty() => b,
                    _ => return Ok(obj([("ok", false.into()), ("msg", "Nothing to save.".into())])),
                };
                let title = get_str(data, "title")?.unwrap_or_else(|| "Save".into());
                let Some(path) = self.ui.pick_save_file(&title, &name) else {
                    return Ok(obj([("ok", false.into()), ("msg", "Not saved.".into())]));
                };
                std::fs::write(&path, &raw)?;
                if let Some(dir) = full_path(&path).parent() {
                    self.remember(dir);
                }
                Ok(obj([("ok", true.into()), ("path", s(&path)), ("msg", format!("Saved {}.", path.display()).into())]))
            }

            "openFolder" => {
                let Some(pth) = get_str(data, "path")?.filter(|s| !s.is_empty()) else {
                    return Ok(obj([("ok", false.into()), ("msg", "No such folder.".into())]));
                };
                if !Path::new(&pth).is_dir() {
                    return Ok(obj([("ok", false.into()), ("msg", "No such folder.".into())]));
                }
                // only folders the program made (under the runs folder) or the user chose when saving are opened
                let full = full_path(Path::new(&pth));
                let chosen = self.chosen.lock().unwrap().contains(&full.to_string_lossy().to_lowercase());
                if !is_under(&full, &p.runs_dir()) && !chosen {
                    return Ok(obj([
                        ("ok", false.into()),
                        ("msg", "The page can open the runs folder and folders you saved into, not other folders.".into()),
                    ]));
                }
                self.ui.open_folder(&full);
                Ok(obj([("ok", true.into()), ("path", s(&full))]))
            }

            "openRunsFolder" => {
                // the program's menu lives in the page: the runs folder is made on first use, then opened
                std::fs::create_dir_all(p.runs_dir())?;
                self.ui.open_folder(&p.runs_dir());
                Ok(obj([("ok", true.into()), ("path", s(&p.runs_dir()))]))
            }

            "uiTheme" => {
                self.ui.set_theme(get_bool(data, "dark")?.unwrap_or(false));
                Ok(obj([("ok", true.into())]))
            }

            "devTools" => {
                self.ui.open_dev_tools();
                Ok(obj([("ok", true.into())]))
            }

            "fusionAddInStatus" => Ok(fusion_addin::status(p)),

            "installFusionAddIn" => fusion_addin::install(p),

            // updates from the program's GitHub releases (updater): the page shows them in the program menu
            "updateStatus" => Ok(self.updater.status()),

            "updateSetToken" => self.updater.set_token(get_str(data, "token")?.as_deref()),

            "updateCheck" => self.updater.check(get_bool(data, "download")?.unwrap_or(true), cancel),

            "updateInstall" => {
                let addin = !fusion_addin::status(p)["installed"].is_null();
                let r = self.updater.install(addin, self.active_runs.load(Ordering::SeqCst))?;
                if r["ok"] == Value::Bool(true) {
                    self.ui.quit();
                }
                Ok(r)
            }

            _ => Err(HostError::Msg(format!("Unknown request: {}", action))),
        }
    }
}
