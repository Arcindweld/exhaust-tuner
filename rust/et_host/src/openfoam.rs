//! OpenFoamRunner.cs: runs an OpenFOAM case the page wrote (cfd/intake_cfd.js: system/, constant/, 0/,
//! intake_report.py, case_info.json) the way the case's own Allrun does, without bash: blockMesh
//! [surfaceFeatureExtract, snappyHexMesh -overwrite], checkMesh, topoSet, then the solver named in
//! system/controlDict while the convergence watchdog (intake_report.py --watch, in Rust: cfd_report::watch) watches
//! the monitors and asks for a clean stop once they have settled, then the report (intake_report.py, in Rust:
//! cfd_report::report) for results.json. A 3-D design arrives as design.json + intake_cfd.py (the browser does not
//! write snappyHexMesh cases); the case is generated here first, with the same generator, which needs Python.
//! Serial runs only: the packaged OpenFOAM is built without MPI.

use crate::case_files::{self, CaseFile};
use crate::proc;
use crate::{num, obj, round_even, Cancel, Events, HResult, HostError};
use regex::Regex;
use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use crate::cfd_report;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The programs the packaged build has (tools/openfoam/build_mingw.sh).
pub const PROGRAMS: &[&str] = &["blockMesh", "snappyHexMesh", "surfaceFeatureExtract", "checkMesh", "topoSet", "foamDictionary", "simpleFoam", "rhoSimpleFoam"];

/// What .NET's WriteLine puts after a line in the log files.
const NL: &str = if cfg!(windows) { "\r\n" } else { "\n" };

pub struct OpenFoamRunner {
    foam_dir: PathBuf,
    python: String,
}

struct Step {
    exit_code: i32,
    log: String,
    tail: String,
    last_iteration: i64,
    json: Value,
}

fn on_path(exe: &str) -> bool {
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path).any(|d| !d.as_os_str().is_empty() && (d.join(exe).is_file() || d.join(format!("{}.exe", exe)).is_file()))
}

impl OpenFoamRunner {
    pub fn new(foam_dir: PathBuf, python: String) -> OpenFoamRunner {
        OpenFoamRunner { foam_dir, python }
    }

    pub fn exe(&self, app: &str) -> PathBuf {
        self.foam_dir.join("bin").join(if cfg!(windows) { format!("{}.exe", app) } else { app.to_string() })
    }

    pub fn foam_available(&self) -> bool {
        PROGRAMS.iter().all(|p| self.exe(p).is_file()) && self.foam_dir.join("etc").is_dir()
    }

    pub fn python_available(&self) -> bool {
        Path::new(&self.python).is_file() || (!self.python.contains(std::path::MAIN_SEPARATOR) && on_path(&self.python))
    }

    /// OpenFOAM is enough for the cases the page writes; Python is only needed to generate a 3-D case.
    pub fn available(&self) -> bool {
        self.foam_available()
    }

    /// The command, with what OpenFOAM's etc/bashrc would set that the programs read (etc/ files come from
    /// WM_PROJECT_DIR) and the Python reports in UTF-8.
    fn command(&self, exe: &str, args: &[&str], dir: &Path) -> Command {
        let mut c = Command::new(exe);
        c.args(args).current_dir(dir);
        c.env("WM_PROJECT", "OpenFOAM").env("WM_PROJECT_VERSION", "v2412").env("WM_PROJECT_DIR", &self.foam_dir);
        let mut path = std::ffi::OsString::from(self.foam_dir.join("bin"));
        if let Some(p) = std::env::var_os("PATH") {
            path.push(if cfg!(windows) { ";" } else { ":" });
            path.push(p);
        }
        c.env("PATH", path).env("PYTHONIOENCODING", "utf-8");
        c
    }

    pub fn run(&self, run_dir: &Path, files: &[CaseFile], progress: Events, cancel: &Cancel) -> HResult<Value> {
        if !self.foam_available() {
            return Err(HostError::Msg(format!("OpenFOAM is not installed where the program expects it: {}", self.foam_dir.display())));
        }
        case_files::write(run_dir, files)?;
        let mut steps: Vec<Value> = Vec::new();
        let mut case_dir = run_dir.to_path_buf();
        if !run_dir.join("system").join("controlDict").is_file() {
            if !run_dir.join("design.json").is_file() || !run_dir.join("intake_cfd.py").is_file() {
                return Err(HostError::Msg(
                    "Neither an OpenFOAM case (system/controlDict) nor a design to generate one from (design.json + intake_cfd.py).".into(),
                ));
            }
            if !self.python_available() {
                return Err(HostError::Msg(format!("Python (for generating a 3-D case) is not installed where the program expects it: {}", self.python)));
            }
            case_dir = run_dir.join("case");
            let g = self.step("generate", &self.python, &["intake_cfd.py", "design.json", "case"], run_dir, progress, cancel, 0, None, None)?;
            let (code, t) = (g.exit_code, g.tail.clone());
            steps.push(g.json);
            if code != 0 {
                return Ok(failed(run_dir, &case_dir, steps, &format!("intake_cfd.py could not write the case: {}", t)));
            }
        }
        let control_dict = case_dir.join("system").join("controlDict");
        let cd = std::fs::read_to_string(&control_dict)?;
        let solver = Regex::new(r"(?m)^application\s+(\w+)\s*;").unwrap().captures(&cd).map(|c| c[1].to_string()).unwrap_or_default();
        if solver != "simpleFoam" && solver != "rhoSimpleFoam" {
            return Err(HostError::Msg(format!("The case asks for '{}'; the packaged OpenFOAM has simpleFoam and rhoSimpleFoam.", solver)));
        }
        let end_time: i64 =
            Regex::new(r"(?m)^endTime\s+(\d+)\s*;").unwrap().captures(&cd).and_then(|c| c[1].parse::<i32>().ok()).map(|v| v as i64).unwrap_or(0);

        let mut mesh: Vec<(&str, Vec<&str>)> = vec![("blockMesh", vec![])];
        if case_dir.join("system").join("snappyHexMeshDict").is_file() {
            mesh.push(("surfaceFeatureExtract", vec![]));
            mesh.push(("snappyHexMesh", vec!["-overwrite"]));
        }
        for (app, args) in mesh {
            let s = self.step(app, &self.exe(app).to_string_lossy(), &args, &case_dir, progress, cancel, 0, None, None)?;
            let (code, t) = (s.exit_code, s.tail.clone());
            steps.push(s.json);
            if code != 0 {
                return Ok(failed(run_dir, &case_dir, steps, &format!("{} failed: {}", app, t)));
            }
        }
        let check = self.step("checkMesh", &self.exe("checkMesh").to_string_lossy(), &[], &case_dir, progress, cancel, 0, None, None)?;
        // checkMesh counts cells with an aspect ratio over 1000 as a failed check. The generated meshes grade the wall
        // cells down to y+ of about 1, so long thin wall cells are intended there; only other failed checks
        // (non-orthogonality, skewness, negative volumes ...) are reported as a warning.
        let failed_checks = Regex::new(r"Failed (\d+) mesh checks").unwrap().captures(&check.log).map(|c| c[1].to_string());
        let flagged: Vec<String> = check.log.split('\n').filter(|l| l.contains("***")).map(|l| l.trim().to_string()).collect();
        let (mut mesh_warning, mut mesh_note) = (Value::Null, Value::Null);
        if failed_checks.is_some() && !flagged.is_empty() && flagged.iter().all(|l| l.to_lowercase().contains("aspect ratio")) {
            let max = Regex::new(r"Max aspect ratio\s*[=:]\s*([0-9.eE+]+)")
                .unwrap()
                .captures(&check.log)
                .and_then(|c| c[1].parse::<f64>().ok())
                .map(|v| format!(" (max {})", round_even(v, 0)))
                .unwrap_or_default();
            mesh_note =
                format!("checkMesh flags high-aspect-ratio cells{}: the thin wall cells that resolve the boundary layer, as intended", max).into();
        } else if let Some(n) = &failed_checks {
            mesh_warning = format!("checkMesh reports {} failed checks: {}", n, flagged.iter().take(6).cloned().collect::<Vec<_>>().join("; ")).into();
        }
        steps.push(check.json);
        let topo = self.step("topoSet", &self.exe("topoSet").to_string_lossy(), &[], &case_dir, progress, cancel, 0, None, None)?;
        let (code, t) = (topo.exit_code, topo.tail.clone());
        steps.push(topo.json);
        if code != 0 {
            return Ok(failed(run_dir, &case_dir, steps, &format!("topoSet failed: {}", t)));
        }

        // the solver, with the case's own convergence watchdog beside it; the watchdog's lines go to log.watch as they
        // come, so a run that does not stop leaves a record of what the watchdog saw
        let watch_log = Arc::new(Mutex::new((String::new(), Some(std::fs::File::create(case_dir.join("log.watch"))?))));
        let solver_running = Arc::new(AtomicBool::new(false));
        let mut watcher: Option<std::thread::JoinHandle<()>> = None;
        let solver_exe = self.exe(&solver).to_string_lossy().into_owned();
        let mut start_watch = |pid: u32| {
            solver_running.store(true, Ordering::SeqCst);
            let (wl, running, dir) = (Arc::clone(&watch_log), Arc::clone(&solver_running), case_dir.clone());
            watcher = Some(std::thread::spawn(move || {
                let mut say = |line: &str| {
                    let mut g = wl.lock().unwrap();
                    let (text, file) = &mut *g;
                    if let Some(f) = file {
                        text.push_str(line);
                        text.push('\n');
                        let _ = write!(f, "{}{}", line, NL);
                        let _ = f.flush();
                    }
                };
                let alive = || running.load(Ordering::SeqCst);
                let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| cfd_report::watch(&dir, pid, &alive, &mut say)));
                match r {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => say(&format!("watch failed: {}", e)),
                    Err(_) => say("watch failed: an internal error"),
                }
            }));
        };
        let run = self.step(&solver, &solver_exe, &[], &case_dir, progress, cancel, end_time, Some(&mut start_watch), None);
        solver_running.store(false, Ordering::SeqCst);
        if let Some(w) = watcher.take() {
            let deadline = Instant::now() + Duration::from_secs(5);
            while !w.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(20));
            }
            if w.is_finished() {
                let _ = w.join();
            }
        }
        let mut run = run?;
        let watch_text = {
            let mut g = watch_log.lock().unwrap();
            g.1 = None; // late lines are dropped, not written to a closed file
            g.0.clone()
        };
        if let Value::Object(m) = &mut run.json {
            m.insert("stoppedBy".into(), (if watch_text.contains("watch: converged") { "convergence" } else { "endTime" }).into());
        }
        let (run_code, run_tail, last_it) = (run.exit_code, run.tail.clone(), run.last_iteration);
        steps.push(run.json);
        // restore stopAt so that a restarted run continues normally (as Allrun does)
        let cd2 = std::fs::read_to_string(&control_dict)?;
        std::fs::write(&control_dict, cd2.replace("stopAt          writeNow;", "stopAt          endTime;"))?;
        if run_code != 0 {
            return Ok(failed(run_dir, &case_dir, steps, &format!("{} failed: {}", solver, run_tail)));
        }

        // the report reads postProcessing/ and writes results.json and results.txt, as intake_report.py does
        let (rep_code, rep_tail, results) = self.report(&case_dir, progress, &mut steps)?;
        let results_txt = case_dir.join("results.txt");
        Ok(obj([
            ("ok", (rep_code == 0 && !results.is_null()).into()),
            ("folder", run_dir.to_string_lossy().into_owned().into()),
            ("case", case_dir.to_string_lossy().into_owned().into()),
            ("solver", solver.into()),
            ("iterations", last_it.into()),
            ("endTime", end_time.into()),
            ("meshWarning", mesh_warning),
            ("meshNote", mesh_note),
            ("results", results),
            ("resultsText", if results_txt.is_file() { std::fs::read_to_string(&results_txt)?.into() } else { Value::Null }),
            ("steps", Value::Array(steps)),
            ("msg", if rep_code == 0 { Value::Null } else { format!("intake_report.py failed: {}", rep_tail).into() }),
        ]))
    }

    /// The "report" step: intake_report.py's main() in Rust. Its printed text goes to log.report as the script's did;
    /// a failure (exit code 1) leaves its reason there and in the step's logTail.
    fn report(&self, case_dir: &Path, progress: Events, steps: &mut Vec<Value>) -> HResult<(i32, String, Value)> {
        progress(obj([("event", "step".into()), ("step", "report".into())]));
        let t0 = Instant::now();
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| cfd_report::report(case_dir)))
            .unwrap_or_else(|_| Err("an internal error in the report".to_string()));
        let (code, text, results) = match r {
            Ok(rep) => (0, rep.text, rep.results),
            Err(e) => (1, e, Value::Null),
        };
        let mut log = std::fs::File::create(case_dir.join("log.report"))?;
        for line in text.split('\n') {
            write!(log, "{}{}", line, NL)?;
        }
        let secs = num(round_even(t0.elapsed().as_secs_f64(), 1));
        let tail = {
            let lines: Vec<&str> = text.split('\n').filter(|l| !l.trim().is_empty()).collect();
            lines[lines.len().saturating_sub(12)..].join("\n")
        };
        let mut json = obj([("step", "report".into()), ("exitCode", code.into()), ("seconds", secs.clone())]);
        if code != 0 {
            if let Value::Object(m) = &mut json {
                m.insert("logTail".into(), tail.clone().into());
            }
        }
        progress(obj([("event", "stepDone".into()), ("step", "report".into()), ("exitCode", code.into()), ("seconds", secs)]));
        steps.push(json);
        Ok((code, tail, results))
    }

    // Runs one program in the case folder. Its output goes to log.<name> as it comes (the solver's log can be watched,
    // and a step that hangs leaves its log behind); with a timeout the process tree is stopped once it is exceeded and
    // the step returns exit code -1.
    #[allow(clippy::too_many_arguments)]
    fn step(
        &self,
        name: &str,
        exe: &str,
        args: &[&str],
        dir: &Path,
        progress: Events,
        cancel: &Cancel,
        end_time: i64,
        started: Option<&mut dyn FnMut(u32)>,
        timeout: Option<Duration>,
    ) -> HResult<Step> {
        progress(obj([("event", "step".into()), ("step", name.into())]));
        let cmd = self.command(exe, args, dir);
        let mut log_file = std::io::BufWriter::new(std::fs::File::create(dir.join(format!("log.{}", name)))?);
        let mut log = String::new();
        let mut last_flush = Instant::now();
        let mut iteration: i64 = 0;
        let mut last_report: Option<Instant> = None;
        let t0 = Instant::now();
        let o = proc::run_lines(cmd, cancel, timeout, started, &mut |s| {
            log.push_str(s);
            log.push('\n');
            let _ = write!(log_file, "{}{}", s, NL);
            if last_flush.elapsed() >= Duration::from_secs(1) {
                let _ = log_file.flush();
                last_flush = Instant::now();
            }
            if let Some(rest) = s.strip_prefix("Time = ") {
                if let Ok(it) = rest.trim().parse::<i32>() {
                    iteration = it as i64;
                    if last_report.is_none_or(|t| t.elapsed() >= Duration::from_secs(2)) {
                        last_report = Some(Instant::now());
                        progress(obj([
                            ("event", "progress".into()),
                            ("step", name.into()),
                            ("iteration", it.into()),
                            ("of", end_time.into()),
                            ("seconds", num(round_even(t0.elapsed().as_secs_f64(), 0))),
                        ]));
                    }
                }
            }
        });
        let o = match o {
            Ok(o) => o,
            Err(e) => {
                let _ = log_file.flush();
                return Err(e);
            }
        };
        if o.timed_out {
            let m = format!("{} did not finish within {} min and was stopped", name, timeout.map(|t| t.as_secs_f64() / 60.0).unwrap_or(0.0));
            log.push_str(&m);
            log.push('\n');
            let _ = write!(log_file, "{}{}", m, NL);
        }
        let _ = log_file.flush();
        let secs = num(round_even(o.seconds, 1));
        let tail = {
            let lines: Vec<&str> = log.split('\n').filter(|l| !l.trim().is_empty()).collect();
            lines[lines.len().saturating_sub(12)..].join("\n")
        };
        let mut json = obj([("step", name.into()), ("exitCode", o.code.into()), ("seconds", secs.clone())]);
        if o.code != 0 {
            if let Value::Object(m) = &mut json {
                m.insert("logTail".into(), tail.clone().into());
            }
        }
        progress(obj([("event", "stepDone".into()), ("step", name.into()), ("exitCode", o.code.into()), ("seconds", secs)]));
        Ok(Step { exit_code: o.code, log, tail, last_iteration: iteration, json })
    }
}

fn failed(run_dir: &Path, case_dir: &Path, steps: Vec<Value>, msg: &str) -> Value {
    obj([
        ("ok", false.into()),
        ("folder", run_dir.to_string_lossy().into_owned().into()),
        ("case", case_dir.to_string_lossy().into_owned().into()),
        ("steps", Value::Array(steps)),
        ("msg", msg.into()),
    ])
}
