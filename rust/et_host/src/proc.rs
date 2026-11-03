//! Running a program the way the C# runners do: its output read as it comes, its stdin closed (a child that shares
//! the program's own stdin can hang on Windows, OpenFoamRunner.cs says how), no console window, and the program
//! stopped, with whatever it started, when the page stops the request or a time limit passes.

use crate::{Cancel, HResult, HostError};
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

/// How a program ended.
#[derive(Debug, Clone, Copy)]
pub struct Outcome {
    /// Its exit code; -1 when it was stopped for running past its time limit.
    pub code: i32,
    pub timed_out: bool,
    pub seconds: f64,
}

/// No console window for the child (C#'s CreateNoWindow).
pub fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Stops the child and everything it started (C#'s Kill(entireProcessTree: true)).
pub fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let mut k = Command::new("taskkill");
        k.args(["/PID", &child.id().to_string(), "/T", "/F"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        no_window(&mut k);
        let _ = k.status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn code_of(st: ExitStatus) -> i32 {
    if let Some(c) = st.code() {
        return c;
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(s) = st.signal() {
            return 128 + s;
        }
    }
    -1
}

fn spawn(cmd: &mut Command) -> HResult<Child> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    no_window(cmd);
    cmd.spawn().map_err(|e| HostError::Msg(format!("{} could not start: {}", cmd.get_program().to_string_lossy(), e)))
}

/// Runs the program with its output, both streams, handed to on_line one line at a time in the order it comes
/// (a line's end is \n; a \r before it is dropped). started gets the process id once it runs. Err(Stopped) when
/// the page stops it; past timeout it is stopped and the outcome says timed_out (code -1). After it exits, output
/// still in the pipes is read for up to 30 s (a stray child holding them cannot hang the request).
pub fn run_lines(
    mut cmd: Command,
    cancel: &Cancel,
    timeout: Option<Duration>,
    started: Option<&mut dyn FnMut(u32)>,
    on_line: &mut dyn FnMut(&str),
) -> HResult<Outcome> {
    let t0 = Instant::now();
    let mut child = spawn(&mut cmd)?;
    let (tx, rx) = mpsc::channel::<String>();
    let mut readers = Vec::new();
    for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
        .into_iter()
        .flatten()
    {
        let tx = tx.clone();
        readers.push(thread::spawn(move || {
            let mut r = BufReader::new(stream);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                match r.read_until(b'\n', &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        while matches!(buf.last(), Some(b'\n') | Some(b'\r')) {
                            buf.pop();
                        }
                        if tx.send(String::from_utf8_lossy(&buf).into_owned()).is_err() {
                            break;
                        }
                    }
                }
            }
        }));
    }
    drop(tx);
    if let Some(f) = started {
        f(child.id());
    }
    let mut status = None;
    let mut timed_out = false;
    while status.is_none() {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(line) => on_line(&line),
            Err(mpsc::RecvTimeoutError::Timeout) | Err(mpsc::RecvTimeoutError::Disconnected) => {}
        }
        if cancel.is_cancelled() {
            kill_tree(&mut child);
            return Err(HostError::Stopped);
        }
        if let Some(t) = timeout {
            if t0.elapsed() > t {
                kill_tree(&mut child);
                timed_out = true;
                break;
            }
        }
        match child.try_wait() {
            Ok(Some(st)) => status = Some(st),
            Ok(None) => {}
            Err(e) => return Err(HostError::Msg(e.to_string())),
        }
    }
    // the rest of the output: the pipes close with the process (or within 30 s)
    let drain_until = Instant::now() + Duration::from_secs(30);
    loop {
        let left = drain_until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        match rx.recv_timeout(left) {
            Ok(line) => on_line(&line),
            Err(_) => break,
        }
    }
    let code = if timed_out { -1 } else { status.map(code_of).unwrap_or(-1) };
    Ok(Outcome { code, timed_out, seconds: t0.elapsed().as_secs_f64() })
}

/// Runs the program and keeps its two streams whole (EngineSimRunner reads them to the end, stdout then stderr).
pub fn run_capture(mut cmd: Command, cancel: &Cancel) -> HResult<(Outcome, Vec<u8>, Vec<u8>)> {
    let t0 = Instant::now();
    let mut child = spawn(&mut cmd)?;
    let read_all = |s: Option<Box<dyn Read + Send>>| {
        thread::spawn(move || {
            let mut v = Vec::new();
            if let Some(mut s) = s {
                let _ = s.read_to_end(&mut v);
            }
            v
        })
    };
    let so = read_all(child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
    let se = read_all(child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
    let st = loop {
        if cancel.is_cancelled() {
            kill_tree(&mut child);
            return Err(HostError::Stopped);
        }
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(HostError::Msg(e.to_string())),
        }
    };
    let out = so.join().unwrap_or_default();
    let err = se.join().unwrap_or_default();
    Ok((Outcome { code: code_of(st), timed_out: false, seconds: t0.elapsed().as_secs_f64() }, out, err))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn lines_cancel_and_timeout() {
        let mut c = Command::new("sh");
        c.args(["-c", "echo one; echo two 1>&2; printf 'three\\r\\n'; exit 3"]);
        let mut got = Vec::new();
        let o = run_lines(c, &Cancel::new(), None, None, &mut |l| got.push(l.to_string())).unwrap();
        assert_eq!(o.code, 3);
        got.sort();
        assert_eq!(got, vec!["one", "three", "two"]);
        let mut c = Command::new("sleep");
        c.arg("30");
        let o = run_lines(c, &Cancel::new(), Some(Duration::from_millis(300)), None, &mut |_| {}).unwrap();
        assert!(o.timed_out && o.code == -1 && o.seconds < 5.0);
        let cancel = Cancel::new();
        let c2 = cancel.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(200));
            c2.cancel();
        });
        let mut c = Command::new("sleep");
        c.arg("30");
        assert_eq!(run_lines(c, &cancel, None, None, &mut |_| {}).unwrap_err(), HostError::Stopped);
        let mut c = Command::new("sh");
        c.args(["-c", "printf 'a\\r\\nb'; printf 'e' 1>&2"]);
        let (o, out, err) = run_capture(c, &Cancel::new()).unwrap();
        assert_eq!((o.code, out, err), (0, b"a\r\nb".to_vec(), b"e".to_vec()));
    }
}
