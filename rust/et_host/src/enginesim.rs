//! EngineSimRunner.cs: plays a design through Engine Simulator (Arcindweld fork, 1-D exhaust) without its window:
//! engine-sim-headless compiles the .mr file the page wrote, holds the engine at a speed and writes the sound to a
//! WAV. The fork's sound is qualitative (it has never been checked against a microphone); the page says so.

use crate::case_files::safe_name;
use crate::proc;
use crate::{num, obj, round_even, tail, Cancel, Events, HResult, HostError};
use base64::Engine;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct EngineSimRunner {
    dir: PathBuf, // the packaged fork: bin\engine-sim-headless.exe and es\
}

/// A number as C#'s double.ToString(InvariantCulture) writes it: 6, 6.5, 0.35.
pub fn invariant(x: f64) -> String {
    format!("{}", x)
}

impl EngineSimRunner {
    pub fn new(dir: PathBuf) -> EngineSimRunner {
        EngineSimRunner { dir }
    }

    pub fn exe(&self) -> PathBuf {
        self.dir.join("bin").join(if cfg!(windows) { "engine-sim-headless.exe" } else { "engine-sim-headless" })
    }

    pub fn available(&self) -> bool {
        self.exe().is_file() && self.dir.join("es").is_dir()
    }

    /// One engine file at each requested speed: one entry per speed (WAV path, run JSON, log tail).
    #[allow(clippy::too_many_arguments)]
    pub fn run(&self, run_dir: &Path, file_name: &str, text: &str, rpms: &[f64], seconds: f64, gain: f64, progress: Events, cancel: &Cancel) -> HResult<Value> {
        if !self.available() {
            return Err(HostError::Msg(format!("Engine Simulator (headless) is not installed with this program: {}", self.exe().display())));
        }
        if rpms.is_empty() {
            return Err(HostError::Msg("Give at least one engine speed.".into()));
        }
        std::fs::create_dir_all(run_dir)?;
        let fname = if file_name.to_lowercase().ends_with(".mr") { file_name.to_string() } else { format!("{}.mr", file_name) };
        let mr = run_dir.join(safe_name(&fname));
        std::fs::write(&mr, text)?;
        // The page's file defines "public node main" like the shipped engines; Engine Simulator's assets/main.mr
        // imports an engine and calls main(). This wrapper does the same for the headless runner.
        let stem = mr.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let wrapper = run_dir.join(format!("{}.main.mr", stem));
        let mr_name = mr.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        std::fs::write(&wrapper, format!("import \"engine_sim.mr\"\nimport \"{}\"\nmain()\n", mr_name))?;
        let mut outs = Vec::new();
        for &rpm in rpms {
            cancel.check()?;
            let tag = invariant(round_even(rpm, 0));
            let wav = run_dir.join(format!("hold_{}.wav", tag));
            let json = run_dir.join(format!("hold_{}.json", tag));
            progress(obj([("event", "start".into()), ("rpm", num(rpm))]));
            let mut cmd = Command::new(self.exe());
            cmd.current_dir(&self.dir)
                .arg(&wrapper)
                .args(["--hold-rpm", &tag, "--sim", &invariant(seconds), "--settle", "1.5", "--gain", &invariant(gain), "--wav"])
                .arg(&wav)
                .arg("--json")
                .arg(&json);
            let (o, so, se) = proc::run_capture(cmd, cancel)?;
            let mut log = String::from_utf8_lossy(&so).into_owned();
            log.push_str(&String::from_utf8_lossy(&se));
            std::fs::write(run_dir.join(format!("hold_{}.log", tag)), log.as_bytes())?;
            let ok = o.code == 0 && wav.is_file();
            let wav_b64 = if ok && std::fs::metadata(&wav).map(|m| m.len() < 20_000_000).unwrap_or(false) {
                Value::String(base64::engine::general_purpose::STANDARD.encode(std::fs::read(&wav)?))
            } else {
                Value::Null
            };
            let run = if json.is_file() {
                serde_json::from_str::<Value>(&std::fs::read_to_string(&json)?).map_err(|e| HostError::Msg(format!("{}: {}", json.display(), e)))?
            } else {
                Value::Null
            };
            outs.push(obj([
                ("rpm", num(rpm)),
                ("ok", ok.into()),
                ("exitCode", o.code.into()),
                ("wav", if ok { wav.to_string_lossy().into_owned().into() } else { Value::Null }),
                // the sound itself for the page to play (a 6 s mono 16-bit clip is about 0.5 MB)
                ("wavBase64", wav_b64),
                ("run", run),
                ("logTail", tail(&log, 6, true).into()),
            ]));
            progress(obj([("event", "done".into()), ("rpm", num(rpm)), ("ok", ok.into())]));
        }
        Ok(obj([
            ("folder", run_dir.to_string_lossy().into_owned().into()),
            ("file", mr.to_string_lossy().into_owned().into()),
            ("holds", Value::Array(outs)),
        ]))
    }
}
