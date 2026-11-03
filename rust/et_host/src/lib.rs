//! Exhaust Tuner program in Rust, stage 2 of the move: the request handling behind the calculator page (what
//! app/ExhaustTuner.Core does in C#), written line for line from it so the page sees the same replies. The window
//! that hosts the page and the exhaust-tuner-host command line both drive it.
//!
//! The page sends {id, action, data}; the reply is {id, ok, result} or {id, ok: false, error}, with {id, event, ...}
//! progress messages while a run goes on (router). The actions are in dispatcher.

pub mod case_files;
pub mod cfd_report;
pub mod dispatcher;
pub mod enginesim;
pub mod fusion_addin;
pub mod openfoam;
pub mod openwam;
pub mod palette;
pub mod pyfmt;
pub mod paths;
pub mod proc;
pub mod router;
pub mod start_record;
pub mod updater;

use serde_json::{Map, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Why a request did not finish: the page stopped it, or it failed (the message goes to the page as it is).
#[derive(Debug, Clone, PartialEq)]
pub enum HostError {
    Stopped,
    Msg(String),
}

impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HostError::Stopped => write!(f, "Stopped."),
            HostError::Msg(m) => write!(f, "{}", m),
        }
    }
}

impl From<std::io::Error> for HostError {
    fn from(e: std::io::Error) -> Self {
        HostError::Msg(e.to_string())
    }
}

impl From<String> for HostError {
    fn from(m: String) -> Self {
        HostError::Msg(m)
    }
}

impl From<&str> for HostError {
    fn from(m: &str) -> Self {
        HostError::Msg(m.to_string())
    }
}

pub type HResult<T> = Result<T, HostError>;

/// The page's Stop: every request running when it comes is told to stop (router).
#[derive(Clone, Default, Debug)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn new() -> Cancel {
        Cancel(Arc::new(AtomicBool::new(false)))
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
    /// Err(Stopped) once stopped.
    pub fn check(&self) -> HResult<()> {
        if self.is_cancelled() {
            Err(HostError::Stopped)
        } else {
            Ok(())
        }
    }
}

/// Progress messages to the page ({event, ...}); called from whichever thread a run is on.
pub type Events<'a> = &'a (dyn Fn(Value) + Sync);

/// The program's version: 0.1.0 on a PC, 0.1.<run number> from CI (EXHAUST_TUNER_VERSION when it is built), as the
/// C# program's Directory.Build.props and windows.yml set it.
pub fn version() -> &'static str {
    option_env!("EXHAUST_TUNER_VERSION").filter(|v| !v.is_empty()).unwrap_or("0.1.0")
}

/// A JSON object from (key, value) pairs, in that order.
pub fn obj<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

/// C#'s Math.Round(x, digits): to the nearest, halves to even.
pub fn round_even(x: f64, digits: i32) -> f64 {
    let m = 10f64.powi(digits);
    let y = x * m;
    let f = y.floor();
    let d = y - f;
    // up past a half, and at exactly a half only to an even number
    let r = if d > 0.5 || (d == 0.5 && f % 2.0 != 0.0) { f + 1.0 } else { f };
    r / m
}

/// A JSON number from a double, written as the C# program writes it (3, not 3.0, for a whole number).
pub fn num(x: f64) -> Value {
    if x.is_finite() && x == x.trunc() && x.abs() < 9.0e15 {
        Value::from(x as i64)
    } else {
        serde_json::Number::from_f64(x).map(Value::Number).unwrap_or(Value::Null)
    }
}

/// The last n non-empty lines of a log (trailing carriage returns dropped), joined with \n.
pub fn tail(text: &str, n: usize, trim_cr: bool) -> String {
    let lines: Vec<&str> = text
        .split('\n')
        .map(|l| if trim_cr { l.trim_end_matches('\r') } else { l })
        .filter(|l| !l.trim().is_empty())
        .collect();
    let from = lines.len().saturating_sub(n);
    lines[from..].join("\n")
}

/// data[key] as a string: None when it is missing or null, an error when it is something else (the C# program's
/// GetValue<string> throws there).
pub fn get_str(data: &Value, key: &str) -> HResult<Option<String>> {
    match data.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(HostError::Msg(format!("'{}' should be text.", key))),
    }
}

pub fn get_f64(data: &Value, key: &str) -> HResult<Option<f64>> {
    match data.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(n.as_f64()),
        Some(_) => Err(HostError::Msg(format!("'{}' should be a number.", key))),
    }
}

pub fn get_bool(data: &Value, key: &str) -> HResult<Option<bool>> {
    match data.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(_) => Err(HostError::Msg(format!("'{}' should be true or false.", key))),
    }
}

/// UTC now as C#'s DateTime.UtcNow.ToString("o"): 2026-11-02T14:41:00.1234567Z.
pub fn utc_now_o() -> String {
    let t = chrono::Utc::now();
    format!("{}.{:07}Z", t.format("%Y-%m-%dT%H:%M:%S"), chrono::Timelike::nanosecond(&t) % 1_000_000_000 / 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_and_numbers() {
        assert_eq!(round_even(2.25, 1), 2.2);
        assert_eq!(round_even(2.35, 1), 2.4);
        assert_eq!(round_even(2.5, 0), 2.0);
        assert_eq!(round_even(3.5, 0), 4.0);
        assert_eq!(round_even(1.26, 1), 1.3);
        assert_eq!(num(3.0).to_string(), "3");
        assert_eq!(num(3.5).to_string(), "3.5");
        assert_eq!(tail("a\r\n\r\nb\r\nc\n", 2, true), "b\nc");
        assert!(utc_now_o().ends_with('Z') && utc_now_o().len() == 28);
    }
}
