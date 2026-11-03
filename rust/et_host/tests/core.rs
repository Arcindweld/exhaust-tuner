//! app/ExhaustTuner.Core.Tests/CoreTests.cs, against the Rust port: the program menu's requests, saving, the
//! router's round trip, OpenWAM with a stand-in solver and the real one against the reference run, and OpenFOAM with
//! stand-in programs (the step order, the watchdog stopping the solver, stopAt put back, the mesh warning).

use et_host::case_files::CaseFile;
use et_host::dispatcher::{Dispatcher, HostUi};
use et_host::openfoam::{OpenFoamRunner, PROGRAMS};
use et_host::openwam::OpenWamRunner;
use et_host::paths::AppPaths;
use et_host::router::{bridge_script, MessageRouter};
use et_host::updater::Updater;
use et_host::Cancel;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap()
}

fn temp() -> PathBuf {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let t = std::env::temp_dir().join(format!("et-test-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
    let _ = std::fs::remove_dir_all(&t);
    std::fs::create_dir_all(&t).unwrap();
    t
}

#[derive(Default)]
struct FakeUi {
    folder: Mutex<Option<PathBuf>>,
    opened: Mutex<Option<PathBuf>>,
    dark: Mutex<Option<bool>>,
    devtools: Mutex<usize>,
}

impl HostUi for FakeUi {
    fn pick_folder(&self, _t: &str) -> Option<PathBuf> {
        self.folder.lock().unwrap().clone()
    }
    fn pick_save_file(&self, _t: &str, s: &str) -> Option<PathBuf> {
        self.folder.lock().unwrap().as_ref().map(|f| f.join(s))
    }
    fn open_folder(&self, p: &Path) {
        *self.opened.lock().unwrap() = Some(p.to_path_buf());
    }
    fn set_theme(&self, d: bool) {
        *self.dark.lock().unwrap() = Some(d);
    }
    fn open_dev_tools(&self) {
        *self.devtools.lock().unwrap() += 1;
    }
}

fn dispatcher(paths: AppPaths, ui: Arc<FakeUi>) -> Dispatcher {
    let paths = Arc::new(paths);
    let up = Updater::new(&paths, "0.1.0", Some("http://127.0.0.1:1"), Some("owner/repo"), None, None);
    Dispatcher::new(paths, ui, up)
}

fn none(_: Value) {}

#[test]
fn runs_folder_is_made_then_opened() {
    let t = temp();
    let paths = AppPaths::new(Some(t.to_str().unwrap()), Some(t.join("data").to_str().unwrap()), Some(t.join("fusion").to_str().unwrap()));
    let runs = paths.runs_dir();
    let ui = Arc::new(FakeUi::default());
    let d = dispatcher(paths, Arc::clone(&ui));
    let r = d.dispatch("openRunsFolder", &Value::Null, &none, &Cancel::new()).unwrap();
    assert!(runs.is_dir());
    assert_eq!(ui.opened.lock().unwrap().as_deref(), Some(runs.as_path()));
    assert_eq!(r["path"], runs.to_string_lossy().as_ref());
}

#[test]
fn open_folder_only_for_runs_and_folders_the_user_saved_into() {
    let t = temp();
    let paths = AppPaths::new(Some(t.to_str().unwrap()), Some(t.join("data").to_str().unwrap()), Some(t.join("fusion").to_str().unwrap()));
    let runs = paths.runs_dir();
    let ui = Arc::new(FakeUi::default());
    let d = dispatcher(paths, Arc::clone(&ui));
    let other = t.join("elsewhere");
    std::fs::create_dir_all(&other).unwrap();
    let c = Cancel::new();
    let r = d.dispatch("openFolder", &json!({"path": other}), &none, &c).unwrap();
    assert_eq!(r["ok"], false);
    assert!(ui.opened.lock().unwrap().is_none());
    let run = runs.join("x_1");
    std::fs::create_dir_all(&run).unwrap();
    let r = d.dispatch("openFolder", &json!({"path": run}), &none, &c).unwrap();
    assert_eq!(r["ok"], true);
    assert_eq!(ui.opened.lock().unwrap().as_deref(), Some(run.as_path()));
    *ui.folder.lock().unwrap() = Some(other.clone()); // the user picks "elsewhere" in the save dialog
    d.dispatch("saveFiles", &json!({"files": [{"name": "a.txt", "text": "x"}]}), &none, &c).unwrap();
    let r = d.dispatch("openFolder", &json!({"path": other}), &none, &c).unwrap();
    assert_eq!(r["ok"], true);
}

#[test]
fn version_comes_from_the_build() {
    // a PC build is 0.1.0; CI stamps EXHAUST_TUNER_VERSION = APP_VERSION = 0.1.<run number>
    let yml = std::fs::read_to_string(root().join(".github/workflows/windows.yml")).unwrap();
    assert!(yml.contains("APP_VERSION: 0.1.${{ github.run_number }}"));
    if std::env::var("EXHAUST_TUNER_VERSION").map(|v| v.is_empty()).unwrap_or(true) {
        assert_eq!(et_host::version(), "0.1.0");
    }
}

#[test]
fn theme_and_devtools_reach_the_window() {
    let t = temp();
    let ui = Arc::new(FakeUi::default());
    let d = dispatcher(AppPaths::new(Some(t.to_str().unwrap()), Some(t.join("data").to_str().unwrap()), Some(t.join("f").to_str().unwrap())), Arc::clone(&ui));
    let c = Cancel::new();
    d.dispatch("uiTheme", &json!({"dark": true}), &none, &c).unwrap();
    assert_eq!(*ui.dark.lock().unwrap(), Some(true));
    d.dispatch("uiTheme", &json!({"dark": false}), &none, &c).unwrap();
    assert_eq!(*ui.dark.lock().unwrap(), Some(false));
    d.dispatch("devTools", &Value::Null, &none, &c).unwrap();
    assert_eq!(*ui.devtools.lock().unwrap(), 1);
    assert!(d.info()["licenses"].as_str().unwrap().ends_with("licenses"));
}

#[test]
fn host_info_round_trip_and_unknown_action() {
    let sent: Arc<Mutex<Vec<Value>>> = Arc::default();
    let s2 = Arc::clone(&sent);
    let paths = AppPaths::new(Some(root().to_str().unwrap()), Some(temp().to_str().unwrap()), Some(temp().to_str().unwrap()));
    let r = MessageRouter::new(Arc::new(dispatcher(paths, Arc::default())), Arc::new(move |s: String| s2.lock().unwrap().push(serde_json::from_str(&s).unwrap())));
    r.handle("{\"id\":7,\"action\":\"hostInfo\",\"data\":{}}");
    r.handle("{\"id\":8,\"action\":\"nope\",\"data\":{}}");
    r.handle("not json");
    let sent = sent.lock().unwrap();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0]["id"], 7);
    assert_eq!(sent[0]["ok"], true);
    assert_eq!(sent[0]["result"]["app"], "Exhaust Tuner");
    assert_eq!(sent[1]["ok"], false);
    assert!(sent[1]["error"].as_str().unwrap().contains("Unknown request"));
    assert!(bridge_script().contains("exhaustTunerHost") && !bridge_script().contains("__VERSION__"));
}

#[test]
fn save_files_uses_the_picked_folder_and_cancel_is_respected() {
    let ui = Arc::new(FakeUi::default());
    let picked = temp();
    *ui.folder.lock().unwrap() = Some(picked.clone());
    let paths = AppPaths::new(Some(root().to_str().unwrap()), Some(temp().to_str().unwrap()), Some(temp().to_str().unwrap()));
    let d = dispatcher(paths, Arc::clone(&ui));
    let c = Cancel::new();
    let res = d.dispatch("saveFiles", &json!({"files": [{"name": "x/a.txt", "text": "1"}], "folder": "case"}), &none, &c).unwrap();
    assert_eq!(res["ok"], true);
    assert!(picked.join("case/x/a.txt").is_file());
    *ui.folder.lock().unwrap() = None;
    let res = d.dispatch("saveFiles", &json!({"files": [{"name": "a.txt", "text": "1"}]}), &none, &c).unwrap();
    assert_eq!(res["msg"], "Not saved.");
    let res = d.dispatch("saveText", &json!({"filename": "n.txt", "text": "t"}), &none, &c).unwrap();
    assert_eq!(res["msg"], "Not saved.");
}

#[cfg(unix)]
fn exec(path: &Path, text: &str) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, text).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[cfg(unix)]
#[test]
fn openwam_runner_logic_with_a_stand_in_solver() {
    let t = temp();
    let fake = t.join("fakewam.sh");
    exec(
        &fake,
        "#!/bin/sh\nn=$(basename \"$1\" .wam)\nif [ \"$n\" = bad ]; then echo crashed; exit 3; fi\nprintf 'Cycle(-)\\n1\\n' > \"${n}AVG.DAT\"\necho 'INFO: *** CMT : SIMULATION FINISHED CORRECTLY ***'\n",
    );
    let files = vec![
        CaseFile { name: "good_3000.wam".into(), text: "x".into(), exec: false, data: None },
        CaseFile { name: "bad.wam".into(), text: "x".into(), exec: false, data: None },
        CaseFile { name: "README.txt".into(), text: "r".into(), exec: false, data: None },
    ];
    let events = Mutex::new(Vec::new());
    let res = OpenWamRunner::new(fake).run(&t.join("case"), &files, &|e| events.lock().unwrap().push(e), &Cancel::new(), 2).unwrap();
    assert_eq!(res.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), vec!["good_3000", "bad"]);
    assert!(res[0].finished && res[0].avg.is_some());
    assert!(!res[1].finished && res[1].exit_code == 3 && res[1].avg.is_none());
    assert!(res[1].log_tail.contains("crashed"));
    assert_eq!(events.lock().unwrap().iter().filter(|e| e["event"] == "done").count(), 2);
}

#[test]
fn openwam_real_solver_reproduces_the_reference_run() {
    let exe = AppPaths::new(Some(root().to_str().unwrap()), None, None).openwam_exe();
    if !exe.is_file() {
        assert!(std::env::var("REQUIRE_ALL").as_deref() != Ok("1"), "OpenWAM solver not found (REQUIRE_ALL=1)");
        eprintln!("OpenWAM not found; skipped");
        return;
    }
    let fx = root().join("app/ExhaustTuner.Core.Tests/fixtures");
    let t = temp();
    let files = vec![CaseFile { name: "single450.wam".into(), text: std::fs::read_to_string(fx.join("single450.wam")).unwrap(), exec: false, data: None }];
    let res = OpenWamRunner::new(exe).run(&t, &files, &none, &Cancel::new(), 0).unwrap();
    assert!(res[0].finished, "{}", res[0].log_tail);
    // the last cycle's net torque, volumetric efficiency and NMEP against the reference (the Linux build of the same
    // source); a different compiler may move the last digits, not the physics
    let col = |avg: &str, name: &str| -> f64 {
        let lines: Vec<&str> = avg.split('\n').map(|l| l.trim_end_matches('\r')).filter(|l| !l.is_empty()).collect();
        let head: Vec<&str> = lines[0].split('\t').collect();
        let i = head.iter().position(|h| *h == name).unwrap_or_else(|| panic!("{} column missing", name));
        lines[lines.len() - 1].split('\t').nth(i).unwrap().trim().parse().unwrap()
    };
    let reference = std::fs::read_to_string(fx.join("single450AVG.DAT")).unwrap();
    for c in ["Net_Torque(Nm)", "Volumetric_Efficiency(-)", "NMEP(bar)"] {
        let (a, b) = (col(res[0].avg.as_ref().unwrap(), c), col(&reference, c));
        assert!((a - b).abs() <= 0.005 * b.abs() + 1e-9, "{}: {} vs reference {}", c, a, b);
    }
}

#[cfg(unix)]
#[test]
fn openfoam_runner_logic_with_stand_in_programs() {
    let t = temp();
    let foam = t.join("foam");
    std::fs::create_dir_all(foam.join("bin")).unwrap();
    std::fs::create_dir_all(foam.join("etc")).unwrap();
    for p in PROGRAMS {
        exec(&foam.join("bin").join(p), "#!/bin/sh\necho \"$(basename \"$0\") $*\" >> ../steps.txt\necho \"WM_PROJECT_DIR=$WM_PROJECT_DIR\"\n");
    }
    exec(
        &foam.join("bin/checkMesh"),
        "#!/bin/sh\necho checkMesh >> ../steps.txt\necho ' ***High aspect ratio cells found, Max aspect ratio: 1368.87, number of cells 40'\necho ' ***Number of severely non-orthogonal (> 70 degrees) faces: 12.'\necho 'Failed 2 mesh checks.'\n",
    );
    // the solver runs until the watchdog switches stopAt to writeNow (or 400 iterations), writing the monitors'
    // rows as OpenFOAM's function objects do: steady mass flows and plane pressure, so the watchdog (cfd_report, in
    // the program) stops it once conv_window iterations past the ramp have the same numbers
    exec(
        &foam.join("bin/simpleFoam"),
        concat!(
            "#!/bin/sh\necho simpleFoam >> ../steps.txt\n",
            "for f in mdot_atmosphere mdot_outlet p_x1; do mkdir -p postProcessing/$f/0; echo '# Time          sum(phi)' > postProcessing/$f/0/surfaceFieldValue.dat; done\n",
            "i=0\nwhile [ $i -lt 400 ]; do i=$((i+1)); echo \"Time = $i\"\n",
            " echo \"$i -0.01\" >> postProcessing/mdot_atmosphere/0/surfaceFieldValue.dat; echo \"$i 0.01\" >> postProcessing/mdot_outlet/0/surfaceFieldValue.dat\n",
            " echo \"$i 101000\" >> postProcessing/p_x1/0/surfaceFieldValue.dat\n",
            " grep -q writeNow system/controlDict && exit 0; sleep 0.03; done\n"
        ),
    );
    let info = r#"{"name": "stand-in", "solver": "simpleFoam", "gamma": 1.4, "R_air": 287.05, "p_amb": 101325.0, "T_amb": 298.15,
        "compressible": true, "rho_amb": 1.184, "flow_scale": 1, "planes": [{"name": "x1", "point": [0.1, 0, 0], "normal": [1, 0, 0]}],
        "reference_plane": "x1", "conv_window": 5, "ramp": 0, "stop_mdot_rel": 1e-3, "stop_dp_rel": 1e-3}"#;
    let files = vec![
        CaseFile { name: "system/controlDict".into(), text: "application     simpleFoam;\nstopAt          endTime;\nendTime         400;\n".into(), exec: false, data: None },
        CaseFile { name: "case_info.json".into(), text: info.into(), exec: false, data: None },
    ];
    let events = Mutex::new(Vec::new());
    let runner = OpenFoamRunner::new(foam.clone(), "python3".into());
    let res = runner.run(&t.join("run"), &files, &|e| events.lock().unwrap().push(e), &Cancel::new()).unwrap();
    assert_eq!(res["ok"], true, "{}", res);
    assert_eq!(std::fs::read_to_string(t.join("steps.txt")).unwrap().lines().collect::<Vec<_>>(), vec!["blockMesh ", "checkMesh", "topoSet ", "simpleFoam"]);
    let w = res["meshWarning"].as_str().unwrap();
    assert!(w.contains("2 failed checks") && w.contains("non-orthogonal"), "{}", w);
    let solver = res["steps"].as_array().unwrap().iter().find(|s| s["step"] == "simpleFoam").unwrap();
    assert_eq!(solver["stoppedBy"], "convergence");
    assert!(res["iterations"].as_i64().unwrap() < 400);
    assert!(std::fs::read_to_string(t.join("run/system/controlDict")).unwrap().contains("stopAt          endTime;"));
    // the report (cfd_report, intake_report.py's main in Rust) from the monitors
    let r = &res["results"];
    assert_eq!((r["mdot_outlet_kg_s"].as_f64(), r["mdot_atmosphere_kg_s"].as_f64(), r["converged"].as_bool()), (Some(0.01), Some(0.01), Some(true)), "{}", r);
    assert!(res["resultsText"].as_str().unwrap().starts_with("Case stand-in  solver simpleFoam  iterations "));
    assert!(std::fs::read_to_string(t.join("run/log.watch")).unwrap().contains("watch: converged at iteration "));
    assert!(events.lock().unwrap().iter().any(|e| e["event"] == "progress"));
    assert!(std::fs::read_to_string(t.join("run/log.blockMesh")).unwrap().contains(&format!("WM_PROJECT_DIR={}", foam.display())));

    // only high-aspect-ratio wall cells flagged: an informational note, no warning
    exec(
        &foam.join("bin/checkMesh"),
        "#!/bin/sh\necho ' ***High aspect ratio cells found, Max aspect ratio: 1368.87, number of cells 40'\necho '    Max aspect ratio = 1368.874892 OK.'\necho 'Failed 1 mesh checks.'\n",
    );
    let ar = runner.run(&t.join("run3"), &files, &none, &Cancel::new()).unwrap();
    assert_eq!(ar["ok"], true);
    assert!(ar["meshWarning"].is_null());
    assert!(ar["meshNote"].as_str().unwrap().contains("max 1369"));

    // a failing step stops the run and says which one
    exec(&foam.join("bin/topoSet"), "#!/bin/sh\necho 'FOAM FATAL ERROR: no cellZone'\nexit 1\n");
    let bad = runner.run(&t.join("run2"), &files, &none, &Cancel::new()).unwrap();
    assert_eq!(bad["ok"], false);
    let m = bad["msg"].as_str().unwrap();
    assert!(m.starts_with("topoSet failed") && m.contains("no cellZone"), "{}", m);
}
