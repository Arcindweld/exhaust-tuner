//! OpenWamRunner.cs: runs the .wam models the page wrote, the way its run_all.bat does: each model NAME in its own
//! folder NAME, "OpenWAM NAME.wam" with that folder as the working directory, output NAMEAVG.DAT / NAMEINS.DAT /
//! NAME.log. A model counts as finished only when OpenWAM printed "SIMULATION FINISHED CORRECTLY" (exit code 0
//! alone is not enough: OpenWAM can finish a run whose last cycle is NaN; the page's reader checks for that).

use crate::case_files::{self, CaseFile};
use crate::proc;
use crate::{num, obj, round_even, tail, Cancel, Events, HResult, HostError};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const FINISHED_MARKER: &str = "SIMULATION FINISHED CORRECTLY";

/// One model's outcome.
#[derive(Clone, Debug)]
pub struct ModelResult {
    pub name: String,
    pub finished: bool,
    pub exit_code: i32,
    pub seconds: f64,
    pub folder: PathBuf,
    pub avg: Option<String>,
    pub ins: Option<String>,
    pub log_tail: String,
}

pub struct OpenWamRunner {
    exe: PathBuf,
}

/// What .NET's AppendLine puts after a line.
const NL: &str = if cfg!(windows) { "\r\n" } else { "\n" };

impl OpenWamRunner {
    pub fn new(exe: PathBuf) -> OpenWamRunner {
        OpenWamRunner { exe }
    }

    pub fn available(&self) -> bool {
        self.exe.is_file()
    }

    /// parallel: models run at once; 0 for half the logical processors (OpenWAM is single-threaded).
    pub fn run(&self, case_dir: &Path, files: &[CaseFile], progress: Events, cancel: &Cancel, parallel: usize) -> HResult<Vec<ModelResult>> {
        if !self.available() {
            return Err(HostError::Msg(format!("OpenWAM is not installed where the program expects it: {}", self.exe.display())));
        }
        case_files::write(case_dir, files)?;
        let mut models: Vec<String> = Vec::new();
        for f in files {
            let p = case_files::relative_parts(&f.name);
            if p.len() == 1 && p[0].to_lowercase().ends_with(".wam") {
                let stem = Path::new(&p[0]).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                if !models.contains(&stem) {
                    models.push(stem);
                }
            }
        }
        if models.is_empty() {
            return Err(HostError::Msg("The case has no .wam model files.".into()));
        }
        let parallel = if parallel == 0 {
            (std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2) / 2).max(1)
        } else {
            parallel
        };
        let workers = parallel.min(models.len());
        let next = AtomicUsize::new(0);
        let done = AtomicUsize::new(0);
        let results: Mutex<Vec<Option<HResult<ModelResult>>>> = Mutex::new(vec![None; models.len()]);
        let of = models.len();
        std::thread::scope(|sc| {
            for _ in 0..workers {
                sc.spawn(|| loop {
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    if i >= of {
                        break;
                    }
                    let name = &models[i];
                    let r = if cancel.is_cancelled() {
                        Err(HostError::Stopped)
                    } else {
                        progress(obj([("event", "start".into()), ("model", name.as_str().into()), ("of", of.into())]));
                        let r = self.run_one(case_dir, name, progress, cancel);
                        if let Ok(m) = &r {
                            let n = done.fetch_add(1, Ordering::SeqCst) + 1;
                            progress(obj([
                                ("event", "done".into()),
                                ("model", name.as_str().into()),
                                ("finished", m.finished.into()),
                                ("seconds", num(round_even(m.seconds, 1))),
                                ("count", n.into()),
                                ("of", of.into()),
                            ]));
                        }
                        r
                    };
                    results.lock().unwrap()[i] = Some(r);
                });
            }
        });
        let mut out = Vec::new();
        for r in results.into_inner().unwrap() {
            match r {
                Some(Ok(m)) => out.push(m),
                Some(Err(e)) => return Err(e),
                None => return Err(HostError::Stopped),
            }
        }
        Ok(out)
    }

    fn run_one(&self, case_dir: &Path, name: &str, progress: Events, cancel: &Cancel) -> HResult<ModelResult> {
        let dir = case_dir.join(name);
        std::fs::create_dir_all(&dir)?;
        std::fs::copy(case_dir.join(format!("{}.wam", name)), dir.join(format!("{}.wam", name)))?;
        let mut log = String::new();
        let mut cmd = Command::new(&self.exe);
        cmd.arg(format!("{}.wam", name)).current_dir(&dir);
        let mut last_report: Option<Instant> = None;
        let o = proc::run_lines(cmd, cancel, None, None, &mut |s| {
            log.push_str(s);
            log.push_str(NL);
            if last_report.is_none_or(|t| t.elapsed() >= Duration::from_secs(2)) && !s.trim().is_empty() {
                last_report = Some(Instant::now());
                progress(obj([("event", "output".into()), ("model", name.into()), ("line", s.trim().into())]));
            }
        })?;
        std::fs::write(dir.join(format!("{}.log", name)), log.as_bytes())?;
        let read = |suffix: &str| std::fs::read_to_string(dir.join(format!("{}{}", name, suffix))).ok();
        Ok(ModelResult {
            name: name.to_string(),
            finished: log.contains(FINISHED_MARKER),
            exit_code: o.code,
            seconds: o.seconds,
            folder: dir.clone(),
            avg: read("AVG.DAT"),
            ins: read("INS.DAT").map(|t| ins_tail(&t, INS_KEEP_CYCLES)),
            log_tail: tail(&log, 8, true),
        })
    }
}

/// Cycles of an INS.DAT handed back to the page. The case writes every cycle into one file (instantaneous results 2)
/// so the page can check the last two against each other; the file grows with the cycle count (about 0.4 MB a cycle
/// for a V8 with its line), and ten 25-cycle runs came to 100 MB of text, more than a page holds. The page reads only
/// the last two complete cycles, so the host passes the last four (at least three complete); the full file stays on disk.
pub const INS_KEEP_CYCLES: usize = 4;

/// The header and the last `keep` cycles of an INS.DAT: a cycle starts where the "Angle(deg)" column drops by more
/// than 180 degrees. The text comes back unchanged when it has no such column or no more than `keep` cycles.
pub fn ins_tail(text: &str, keep: usize) -> String {
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let Some(head) = lines.first() else { return text.to_string() };
    let Some(col) = head.trim_end().split('\t').position(|h| h.trim() == "Angle(deg)") else { return text.to_string() };
    let angle = |l: &str| l.split('\t').nth(col).and_then(|v| v.trim().parse::<f64>().ok());
    let mut starts = Vec::new();
    let mut prev: Option<f64> = None;
    for (i, l) in lines.iter().enumerate().skip(1) {
        if let Some(a) = angle(l) {
            if let Some(p) = prev { if a < p - 180.0 { starts.push(i); } }
            prev = Some(a);
        }
    }
    // starts holds the first line of the 2nd, 3rd, ... cycles; with n of them the file has n + 1 cycles
    if keep == 0 || starts.len() < keep { return text.to_string(); }
    let from = starts[starts.len() - keep];
    let mut out = String::with_capacity(text.len() / 4);
    out.push_str(head);
    for l in &lines[from..] { out.push_str(l); }
    out
}

fn opt(s: &Option<String>) -> Value {
    s.as_ref().map(|t| Value::String(t.clone())).unwrap_or(Value::Null)
}

pub fn to_json(case_dir: &Path, results: &[ModelResult]) -> Value {
    obj([
        ("folder", case_dir.to_string_lossy().into_owned().into()),
        (
            "models",
            Value::Array(
                results
                    .iter()
                    .map(|r| {
                        obj([
                            ("name", r.name.as_str().into()),
                            ("finished", r.finished.into()),
                            ("exitCode", r.exit_code.into()),
                            ("seconds", num(round_even(r.seconds, 1))),
                            ("folder", r.folder.to_string_lossy().into_owned().into()),
                            ("avg", opt(&r.avg)),
                            ("ins", opt(&r.ins)),
                            ("logTail", r.log_tail.as_str().into()),
                        ])
                    })
                    .collect(),
            ),
        ),
    ])
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn ins_tail_keeps_the_last_cycles() {
        let mut t = String::from("Time\tAngle(deg)\tP\r\n");
        for c in 0..6 { for k in 0..8 { t.push_str(&format!("{}\t{}\t{}\r\n", c * 8 + k, 100 + k * 90, c)); } }
        let o = ins_tail(&t, 4);
        let rows: Vec<&str> = o.lines().collect();
        assert_eq!(rows[0], "Time\tAngle(deg)\tP");
        assert_eq!(rows.len(), 1 + 4 * 8);
        assert!(rows[1].starts_with("16\t100\t2"), "{}", rows[1]);
        assert!(o.ends_with("\r\n"));
        assert_eq!(ins_tail(&t, 6), t);            // six cycles: nothing to cut
        assert_eq!(ins_tail("a\tb\n1\t2\n", 4), "a\tb\n1\t2\n");   // no angle column
    }

    #[test]
    fn runner_logic_with_a_stand_in_solver() {
        // CoreTests.Runner_logic_with_a_stand_in_solver: a script that behaves like OpenWAM
        let d = std::env::temp_dir().join(format!("et_wam_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let exe = d.join("fakewam");
        std::fs::write(
            &exe,
            "#!/bin/sh\nn=$(basename \"$1\" .wam)\necho \"model $n\"\nif [ \"$n\" = bad ]; then echo nan; exit 0; fi\necho 1 > ${n}AVG.DAT\necho 2 > ${n}INS.DAT\necho 'SIMULATION FINISHED CORRECTLY'\n",
        )
        .unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        let files = vec![
            CaseFile { name: "a.wam".into(), text: "x\n".into(), exec: false, data: None },
            CaseFile { name: "bad.wam".into(), text: "x\n".into(), exec: false, data: None },
            CaseFile { name: "run_all.bat".into(), text: "x\n".into(), exec: false, data: None },
        ];
        let events = Mutex::new(Vec::new());
        let r = OpenWamRunner::new(exe)
            .run(&d.join("case"), &files, &|e| events.lock().unwrap().push(e), &Cancel::new(), 2)
            .unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!((r[0].name.as_str(), r[0].finished, r[0].avg.as_deref()), ("a", true, Some("1\n")));
        assert_eq!((r[1].name.as_str(), r[1].finished, r[1].avg.as_deref()), ("bad", false, None));
        assert!(r[1].log_tail.contains("nan"));
        let ev = events.lock().unwrap();
        assert_eq!(ev.iter().filter(|e| e["event"] == "done").count(), 2);
        let j = to_json(&d.join("case"), &r);
        assert_eq!(j["models"][0]["name"], "a");
        let _ = std::fs::remove_dir_all(&d);
    }
}
