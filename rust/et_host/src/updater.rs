//! Updater.cs: updates the program from the GitHub releases its Windows build publishes (windows.yml, job
//! "release"): every push to the program branch that passes the tests becomes release v0.1.<run number> with the
//! installer and SHA256SUMS.txt, and the notes list the commits since the previous release.
//!
//! The repository is public, so the check and the download need no token: without one the program asks GitHub as
//! anyone may (60 API requests an hour from one address; a check makes one and a download two). A token is only
//! needed if the repository is made private again: GitHub then answers 404 to a request without one, and the state
//! becomes "not-configured" so the page asks for a fine-grained token with Contents: read-only on that repository.
//! A saved token is kept encrypted for the Windows user (DPAPI) in the data folder, is never handed back to the
//! page, and is sent only to the GitHub API host: the download host the API redirects to gets a plain request.
//!
//! Check: the newest published release (not a draft or pre-release) that carries both files and a higher version
//! than this program. Download: in the background to updates\ in the data folder; it counts as ready only when its
//! size and SHA-256 match the release. Install: the installer runs silently over this install (same folder and
//! tasks, the Fusion add-in too when it is installed), waits for this program to close, and starts it again.

use crate::paths::{full_path, local_app_data, AppPaths};
use crate::{obj, utc_now_o, Cancel, HResult, HostError};
use regex::Regex;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const DEFAULT_API: &str = "https://api.github.com";
pub const DEFAULT_REPO: &str = "Arcindweld/exhaust-tuner";
pub const SUMS_NAME: &str = "SHA256SUMS.txt";

/// System.Version: two to four numbers, a missing one below 0 (so 0.1 < 0.1.0).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Ver([i64; 4]);

impl std::fmt::Display for Ver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let parts: Vec<String> = self.0.iter().filter(|v| **v >= 0).map(|v| v.to_string()).collect();
        write!(f, "{}", parts.join("."))
    }
}

/// "v0.1.43" or "0.1.43" -> 0.1.43; None for anything else.
pub fn parse_version(s: Option<&str>) -> Option<Ver> {
    let mut s = s?.trim();
    if s.is_empty() {
        return None;
    }
    if s.starts_with('v') || s.starts_with('V') {
        s = &s[1..];
    }
    if let Some(i) = s.find(['+', '-']) {
        s = &s[..i];
    }
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() < 2 || parts.len() > 4 {
        return None;
    }
    let mut v = [-1i64; 4];
    for (i, p) in parts.iter().enumerate() {
        let n: i64 = p.trim().parse().ok()?;
        if !(0..=i32::MAX as i64).contains(&n) {
            return None;
        }
        v[i] = n;
    }
    Some(Ver(v))
}

/// GitHub's token expiry header: "2026-12-01 00:00:00 UTC" (or with a numeric offset), as UTC.
pub fn parse_expiry(s: Option<&str>) -> Option<chrono::DateTime<chrono::Utc>> {
    use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
    let s = s?.trim();
    if s.is_empty() {
        return None;
    }
    if let Some(t) = s.strip_suffix(" UTC").or_else(|| s.strip_suffix(" utc")) {
        return NaiveDateTime::parse_from_str(t, "%Y-%m-%d %H:%M:%S").ok().map(|n| Utc.from_utc_datetime(&n));
    }
    for f in ["%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d %H:%M:%S%z", "%Y-%m-%d %H:%M:%S %:z"] {
        if let Ok(d) = DateTime::parse_from_str(s, f) {
            return Some(d.with_timezone(&Utc));
        }
    }
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

/// The SHA-256 SHA256SUMS.txt gives for one file ("hash  name" or "hash *name" lines).
pub fn sum_for(sums: &str, name: &str) -> Option<String> {
    let re = Regex::new(r"^([0-9a-fA-F]{64})\s+\*?(.+)$").ok()?;
    for raw in sums.split('\n') {
        let line = raw.trim();
        if let Some(c) = re.captures(line) {
            if c[2].trim().eq_ignore_ascii_case(name) {
                return Some(c[1].to_lowercase());
            }
        }
    }
    None
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

#[derive(Clone, Debug)]
pub struct Release {
    pub version: Ver,
    pub tag: String,
    pub name: String,
    pub notes: String,
    pub published: String,
    pub html_url: String,
    pub setup_name: String,
    pub setup_url: String,
    pub setup_size: i64,
    pub sums_url: String,
}

#[derive(Default)]
struct State {
    state: String, // idle | not-configured | checking | up-to-date | available | downloading | ready | error
    error: Option<String>,
    ready_file: Option<PathBuf>,
    checked: Option<String>,
    token_expires: Option<chrono::DateTime<chrono::Utc>>,
    latest: Option<Release>,
    done: i64,
    total: i64,
}

/// Starts the installer: (file, the argument string, the folder to start it in). Tests record it instead.
pub type Launch = Box<dyn Fn(&Path, &str, &Path) -> std::io::Result<()> + Send + Sync>;

pub struct Updater {
    data_root: PathBuf,
    app_root: PathBuf,
    current: Ver,
    current_text: String,
    api: String,
    repo: String,
    launch: Launch,
    tokens: TokenStore,
    st: Mutex<State>,
    busy: AtomicBool,
    previous: Option<String>,
    download: Mutex<Option<std::thread::JoinHandle<()>>>,
    /// A download is given up when no data comes for this long (the next check starts it again).
    stall_seconds: AtomicU64,
}

/// The update failed for a reason the page shows as it is.
enum Fail {
    Msg(String),
    Net(String),
    Io(String),
    Stall,
    /// GitHub does not show the repository without a token: it is private (again)
    Private,
}

/// GitHub's answer when the requests without a token from this address are used up for the hour.
fn resp_limited(body: &str) -> bool {
    body.to_lowercase().contains("rate limit")
}

impl From<std::io::Error> for Fail {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::TimedOut || e.kind() == std::io::ErrorKind::WouldBlock {
            Fail::Stall
        } else {
            Fail::Io(e.to_string())
        }
    }
}

impl Updater {
    pub fn new(paths: &AppPaths, current_version: &str, api: Option<&str>, repo: Option<&str>, launch: Option<Launch>, previous_version: Option<&str>) -> Arc<Updater> {
        let current = parse_version(Some(current_version)).unwrap_or(Ver([0, 0, 0, -1]));
        let tokens = TokenStore::new(&paths.data_root);
        let st = State { state: "idle".into(), ..Default::default() };
        let previous = match parse_version(previous_version) {
            Some(pv) if pv < current => previous_version.map(|s| s.trim().to_string()),
            _ => None,
        };
        Arc::new(Updater {
            data_root: paths.data_root.clone(),
            app_root: paths.app_root.clone(),
            current,
            current_text: current_version.to_string(),
            api: api.unwrap_or(DEFAULT_API).trim_end_matches('/').to_string(),
            repo: repo.unwrap_or(DEFAULT_REPO).to_string(),
            launch: launch.unwrap_or_else(|| {
                Box::new(|file: &Path, args: &str, dir: &Path| {
                    let mut c = std::process::Command::new(file);
                    #[cfg(windows)]
                    {
                        use std::os::windows::process::CommandExt;
                        c.raw_arg(args);
                    }
                    #[cfg(not(windows))]
                    c.args(args.split(' '));
                    c.current_dir(dir).spawn().map(|_| ())
                })
            }),
            tokens,
            st: Mutex::new(st),
            busy: AtomicBool::new(false),
            previous,
            download: Mutex::new(None),
            stall_seconds: AtomicU64::new(60),
        })
    }

    /// How long a download may go without data before it is given up (60 s; the tests use 1).
    pub fn set_stall_seconds(&self, s: u64) {
        self.stall_seconds.store(s.max(1), Ordering::SeqCst);
    }

    fn stall(&self) -> u64 {
        self.stall_seconds.load(Ordering::SeqCst)
    }

    pub fn updates_dir(&self) -> PathBuf {
        self.data_root.join("updates")
    }

    /// This copy was installed by the installer (Inno Setup leaves unins000.exe in the program folder); a copy run
    /// from a build folder cannot update itself.
    pub fn installed(&self) -> bool {
        self.app_root.join("unins000.exe").is_file()
    }

    /// Installed for this Windows user only (under %LOCALAPPDATA%), the installer's default.
    pub fn per_user_install(&self) -> bool {
        let local = full_path(&local_app_data()).to_string_lossy().trim_end_matches(std::path::MAIN_SEPARATOR).to_lowercase();
        !local.is_empty() && self.app_root.to_string_lossy().to_lowercase().starts_with(&format!("{}{}", local, std::path::MAIN_SEPARATOR))
    }

    pub fn status(&self) -> Value {
        let st = self.st.lock().unwrap();
        let mut o = Map::new();
        o.insert("version".into(), self.current_text.clone().into());
        o.insert("configured".into(), self.tokens.has().into());
        o.insert("state".into(), st.state.clone().into());
        o.insert("error".into(), st.error.clone().map(Value::String).unwrap_or(Value::Null));
        o.insert("checked".into(), st.checked.clone().map(Value::String).unwrap_or(Value::Null));
        o.insert("repo".into(), self.repo.clone().into());
        o.insert("installed".into(), self.installed().into());
        if let Some(r) = &st.latest {
            o.insert(
                "latest".into(),
                obj([
                    ("version", r.version.to_string().into()),
                    ("tag", r.tag.clone().into()),
                    ("name", r.name.clone().into()),
                    ("notes", r.notes.clone().into()),
                    ("published", r.published.clone().into()),
                    ("url", r.html_url.clone().into()),
                    ("size", r.setup_size.into()),
                    ("newer", (r.version > self.current).into()),
                ]),
            );
        }
        if st.state == "downloading" {
            o.insert("progress".into(), obj([("done", st.done.into()), ("total", st.total.into())]));
        }
        if let Some(x) = st.token_expires {
            o.insert("tokenExpires".into(), x.format("%Y-%m-%d").to_string().into());
            let days = (x - chrono::Utc::now()).num_milliseconds() as f64 / 86_400_000.0;
            o.insert("tokenDaysLeft".into(), (days.floor() as i64).into());
        }
        if let Some(prev) = &self.previous {
            // this start follows an update: what changed, as the release said when it was downloaded
            let notes = self.updates_dir().join(format!("ExhaustTuner-Setup-{}.exe.notes.txt", self.current_text));
            let text = std::fs::read_to_string(notes).ok();
            o.insert(
                "updated".into(),
                obj([
                    ("from", prev.clone().into()),
                    ("to", self.current_text.clone().into()),
                    ("notes", text.map(Value::String).unwrap_or(Value::Null)),
                ]),
            );
        }
        Value::Object(o)
    }

    fn set(&self, state: &str, error: Option<String>) {
        let mut st = self.st.lock().unwrap_or_else(|e| e.into_inner());
        st.state = state.into();
        st.error = error;
    }

    /// Saves the token (an empty one removes it). Not checked against GitHub here: the next check does that.
    pub fn set_token(&self, token: Option<&str>) -> HResult<Value> {
        let token = token.unwrap_or("").trim().to_string();
        if token.is_empty() {
            self.tokens.clear()?;
            {
                let mut st = self.st.lock().unwrap();
                st.state = "idle".into(); // the next check asks GitHub without a token
                st.error = None;
                st.latest = None;
                st.token_expires = None;
            }
            return Ok(self.status());
        }
        if token.encode_utf16().count() < 20 || token.chars().any(char::is_whitespace) || token.chars().any(|c| c as u32 > 126) {
            let mut bad = self.status();
            if let Value::Object(m) = &mut bad {
                m.insert("ok".into(), false.into());
                m.insert("msg".into(), "That does not look like a GitHub token (they start with github_pat_ or ghp_).".into());
            }
            return Ok(bad);
        }
        self.tokens.write(&token)?;
        {
            let mut st = self.st.lock().unwrap();
            st.state = "idle".into();
            st.error = None;
            st.token_expires = None;
        }
        Ok(self.status())
    }

    fn agent(&self, timeout: Option<Duration>, read: Option<Duration>) -> ureq::Agent {
        let mut b = ureq::AgentBuilder::new().redirects(0).timeout_connect(Duration::from_secs(20)).user_agent(&format!("ExhaustTuner/{}", self.current_text));
        if let Some(t) = timeout {
            b = b.timeout(t);
        }
        if let Some(r) = read {
            b = b.timeout_read(r);
        }
        b.build()
    }

    /// GET with redirects followed by hand: the token goes only with the first request, and only to the API host; a
    /// redirect never carries it, whatever host it names (GitHub sends release downloads to a signed storage URL that
    /// must not get it).
    fn send(&self, agent: &ureq::Agent, url: &str, token: &str, accept: &str) -> Result<ureq::Response, Fail> {
        let mut url = url.to_string();
        let first = url.clone();
        for hop in 0.. {
            let mut req = agent.get(&url).set("Accept", accept);
            if hop == 0 && !token.is_empty() && url.to_lowercase().starts_with(&format!("{}/", self.api.to_lowercase())) {
                req = req.set("Authorization", &format!("Bearer {}", token)).set("X-GitHub-Api-Version", "2022-11-28");
            }
            let resp = match req.call() {
                Ok(r) => r,
                Err(ureq::Error::Status(_, r)) => r,
                Err(ureq::Error::Transport(t)) => {
                    let text = t.to_string();
                    if text.to_lowercase().contains("timed out") {
                        return Err(Fail::Stall);
                    }
                    return Err(Fail::Net(text));
                }
            };
            let code = resp.status();
            if matches!(code, 301 | 302 | 303 | 307 | 308) {
                if let Some(loc) = resp.header("Location").map(|s| s.to_string()) {
                    if hop >= 5 {
                        return Err(Fail::Msg("Too many redirects from GitHub.".into()));
                    }
                    let next = resolve(&url, &loc);
                    if !next.to_lowercase().starts_with("https://") && !first.to_lowercase().starts_with("http://") {
                        return Err(Fail::Msg("GitHub redirected the download to a plain http address; not followed.".into()));
                    }
                    url = next;
                    continue;
                }
            }
            return Ok(resp);
        }
        unreachable!()
    }

    fn latest(&self, token: &str) -> Result<Option<Release>, Fail> {
        let agent = self.agent(Some(Duration::from_secs(45)), None);
        let resp = self.send(&agent, &format!("{}/repos/{}/releases?per_page=20", self.api, self.repo), token, "application/vnd.github+json")?;
        let code = resp.status();
        let exp = resp.header("GitHub-Authentication-Token-Expiration").map(|s| s.to_string());
        let body = resp.into_string().map_err(Fail::from)?;
        if code == 200 {
            self.st.lock().unwrap().token_expires = parse_expiry(exp.as_deref()); // none: a token without an expiry date
        }
        let api_msg = || serde_json::from_str::<Value>(&body).ok().and_then(|v| v["message"].as_str().map(|s| s.to_string())).unwrap_or_default();
        match code {
            200 => {}
            401 => return Err(Fail::Msg("GitHub did not accept the token (expired or revoked?). Make a new one and save it here, or save an empty field to check without one.".into())),
            404 if token.is_empty() => return Err(Fail::Private),
            404 => {
                return Err(Fail::Msg(format!(
                    "GitHub does not show {r} to this token. A fine-grained token needs {r} under Repository access and Contents: Read-only under Permissions.",
                    r = self.repo
                )))
            }
            403 | 429 if token.is_empty() && resp_limited(&body) => {
                return Err(Fail::Msg("GitHub's limit for requests without a token (60 an hour from this address) is used up for now; the program tries again later.".into()))
            }
            403 => return Err(Fail::Msg(format!("GitHub refused the request: {}", api_msg()))),
            c => {
                let m = api_msg();
                return Err(Fail::Msg(format!("GitHub answered HTTP {}{}", c, if m.is_empty() { ".".to_string() } else { format!(": {}", m) })));
            }
        }
        let Ok(Value::Array(list)) = serde_json::from_str::<Value>(&body) else {
            return Err(Fail::Msg("GitHub's release list was not readable.".into()));
        };
        let setup_re = Regex::new(r"(?i)^ExhaustTuner-Setup-(\d+(?:\.\d+){1,3})\.exe$").unwrap();
        let mut best: Option<Release> = None;
        for r in &list {
            if r["draft"] == Value::Bool(true) || r["prerelease"] == Value::Bool(true) {
                continue;
            }
            let tag = r["tag_name"].as_str().unwrap_or("").to_string();
            let Some(v) = parse_version(Some(&tag)) else { continue };
            let (mut setup_name, mut setup_url, mut sums_url, mut size) = (None, None, None, 0i64);
            if let Some(assets) = r["assets"].as_array() {
                for a in assets {
                    let name = a["name"].as_str().unwrap_or("");
                    let url = a["url"].as_str().unwrap_or("");
                    if name.eq_ignore_ascii_case(SUMS_NAME) {
                        sums_url = Some(url.to_string());
                    } else if let Some(c) = setup_re.captures(name) {
                        if parse_version(Some(&c[1])) == Some(v) {
                            setup_name = Some(name.to_string());
                            setup_url = Some(url.to_string());
                            size = a["size"].as_i64().unwrap_or(0);
                        }
                    }
                }
            }
            let (Some(sn), Some(su), Some(ss)) = (setup_name, setup_url, sums_url) else { continue }; // still uploading, or not a program release
            if best.as_ref().is_none_or(|b| v > b.version) {
                best = Some(Release {
                    version: v,
                    tag: tag.clone(),
                    name: r["name"].as_str().unwrap_or(&tag).to_string(),
                    notes: r["body"].as_str().unwrap_or("").to_string(),
                    published: r["published_at"].as_str().unwrap_or("").to_string(),
                    html_url: r["html_url"].as_str().unwrap_or("").to_string(),
                    setup_name: sn,
                    setup_url: su,
                    setup_size: size,
                    sums_url: ss,
                });
            }
        }
        Ok(best)
    }

    /// An installer for this release downloaded and verified earlier (checked again here).
    fn ready_file(&self, rel: &Release) -> Option<PathBuf> {
        let f = self.updates_dir().join(&rel.setup_name);
        let h = PathBuf::from(format!("{}.sha256", f.display()));
        if !f.is_file() || !h.is_file() {
            return None;
        }
        if rel.setup_size > 0 && std::fs::metadata(&f).ok()?.len() as i64 != rel.setup_size {
            return None;
        }
        (sha256_file(&f).ok()? == std::fs::read_to_string(&h).ok()?.trim()).then_some(f)
    }

    fn message(&self, f: Fail) -> String {
        match f {
            Fail::Msg(m) => m,
            Fail::Net(m) => format!("Could not reach GitHub ({}).", m),
            Fail::Io(m) => format!("The download failed ({}). The next check tries again.", m),
            Fail::Stall => format!("The download stopped: no data came for {} s (or it ran past 30 min). The next check tries again.", self.stall()),
            Fail::Private => format!("GitHub does not show {} without a token, so it is private: save a token below.", self.repo),
        }
    }

    /// Looks for a newer release; when there is one and download is set, starts downloading it in the background and
    /// returns at once (status() then reports the progress).
    pub fn check(self: &Arc<Self>, download: bool, cancel: &Cancel) -> HResult<Value> {
        let token = self.tokens.read().unwrap_or_default(); // none: GitHub is asked without one (a public repository)
        if self.busy.swap(true, Ordering::SeqCst) {
            return Ok(self.status()); // a check or a download is already running
        }
        // however this ends (a panic included), the updater is free again and not left "checking"
        struct Free<'a>(&'a Updater, bool);
        impl Drop for Free<'_> {
            fn drop(&mut self) {
                if !self.1 {
                    let mut st = self.0.st.lock().unwrap_or_else(|e| e.into_inner());
                    if st.state == "checking" {
                        st.state = "error".into();
                        st.error = Some("The update check stopped unexpectedly.".into());
                    }
                    drop(st);
                    self.0.busy.store(false, Ordering::SeqCst);
                }
            }
        }
        let mut free = Free(self, false);
        self.set("checking", None);
        let rel = match self.latest(&token) {
            Ok(r) => r,
            Err(f) => {
                if cancel.is_cancelled() {
                    self.set("idle", None); // the page stopped the request
                    return Err(HostError::Stopped);
                }
                let m = match f {
                    Fail::Stall => "GitHub did not answer within 45 s.".to_string(),
                    Fail::Private => {
                        let m = self.message(Fail::Private);
                        self.set("not-configured", Some(m));
                        return Ok(self.status());
                    }
                    other => self.message(other),
                };
                self.set("error", Some(m));
                return Ok(self.status());
            }
        };
        if cancel.is_cancelled() {
            self.set("idle", None);
            return Err(HostError::Stopped);
        }
        {
            let mut st = self.st.lock().unwrap();
            st.latest = rel.clone();
            st.checked = Some(utc_now_o());
        }
        let Some(rel) = rel.filter(|r| r.version > self.current) else {
            self.set("up-to-date", None);
            return Ok(self.status());
        };
        if let Some(ready) = self.ready_file(&rel) {
            self.st.lock().unwrap().ready_file = Some(ready);
            self.set("ready", None);
            return Ok(self.status());
        }
        if !download {
            self.set("available", None);
            return Ok(self.status());
        }
        {
            let mut st = self.st.lock().unwrap();
            st.done = 0;
            st.total = rel.setup_size;
        }
        self.set("downloading", None);
        // not tied to the request: the page's Stop (which cancels every running request) must not end a download
        let me = Arc::clone(self);
        free.1 = true; // the download frees the updater when it ends
        let h = std::thread::spawn(move || {
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| me.download_release(&token, &rel)));
            match r {
                Ok(Ok(file)) => {
                    me.st.lock().unwrap_or_else(|e| e.into_inner()).ready_file = Some(file);
                    me.set("ready", None);
                }
                Ok(Err(f)) => {
                    me.drop_partial();
                    let m = me.message(f);
                    me.set("error", Some(m));
                }
                Err(_) => {
                    me.drop_partial();
                    me.set("error", Some("The download stopped unexpectedly. The next check tries again.".into()));
                }
            }
            me.busy.store(false, Ordering::SeqCst);
        });
        *self.download.lock().unwrap() = Some(h);
        Ok(self.status())
    }

    /// Waits for a background download (tests).
    pub fn wait(&self) {
        if let Some(h) = self.download.lock().unwrap().take() {
            let _ = h.join();
        }
    }

    fn drop_partial(&self) {
        if let Ok(rd) = std::fs::read_dir(self.updates_dir()) {
            for e in rd.flatten() {
                if e.file_name().to_string_lossy().ends_with(".part") {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
    }

    fn download_release(&self, token: &str, rel: &Release) -> Result<PathBuf, Fail> {
        // no data for stall_seconds, or 30 minutes in all, ends the download: a stalled connection must not keep the
        // updater busy (and later checks waiting) for good
        let t0 = Instant::now();
        let agent = self.agent(None, Some(Duration::from_secs(self.stall())));
        std::fs::create_dir_all(self.updates_dir())?;
        let r = self.send(&agent, &rel.sums_url, token, "application/octet-stream")?;
        if !(200..300).contains(&r.status()) {
            return Err(Fail::Msg(format!("Downloading {} failed (HTTP {}).", SUMS_NAME, r.status())));
        }
        let sums = r.into_string()?;
        let expected = sum_for(&sums, &rel.setup_name).ok_or_else(|| Fail::Msg(format!("{} in {} has no line for {}.", SUMS_NAME, rel.tag, rel.setup_name)))?;
        let part = self.updates_dir().join(format!("{}.part", rel.setup_name));
        let r = self.send(&agent, &rel.setup_url, token, "application/octet-stream")?;
        if !(200..300).contains(&r.status()) {
            return Err(Fail::Msg(format!("Downloading the installer failed (HTTP {}).", r.status())));
        }
        let total = r.header("Content-Length").and_then(|v| v.parse::<i64>().ok()).unwrap_or(rel.setup_size);
        self.st.lock().unwrap().total = total;
        let mut src = r.into_reader();
        let mut h = Sha256::new();
        let mut done: i64 = 0;
        {
            let mut dst = std::fs::File::create(&part)?;
            let mut buf = vec![0u8; 1 << 16];
            loop {
                if t0.elapsed() > Duration::from_secs(30 * 60) {
                    return Err(Fail::Stall);
                }
                let n = src.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                dst.write_all(&buf[..n])?;
                h.update(&buf[..n]);
                done += n as i64;
                self.st.lock().unwrap().done = done;
            }
        }
        let got = hex(&h.finalize());
        if rel.setup_size > 0 && done != rel.setup_size {
            let _ = std::fs::remove_file(&part);
            return Err(Fail::Msg(format!("The download stopped early ({} of {} bytes). The next check tries again.", done, rel.setup_size)));
        }
        if got != expected {
            let _ = std::fs::remove_file(&part);
            return Err(Fail::Msg(format!("The downloaded installer does not match the SHA-256 published with {}; it was deleted.", rel.tag)));
        }
        let fin = self.updates_dir().join(&rel.setup_name);
        std::fs::rename(&part, &fin).or_else(|_| {
            let _ = std::fs::remove_file(&fin);
            std::fs::rename(&part, &fin)
        })?;
        std::fs::write(format!("{}.sha256", fin.display()), &got)?;
        std::fs::write(format!("{}.notes.txt", fin.display()), &rel.notes)?; // shown once after the update (status "updated")
        let fin_s = fin.to_string_lossy().to_lowercase();
        if let Ok(rd) = std::fs::read_dir(self.updates_dir()) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().into_owned();
                if n.to_lowercase().starts_with("exhausttuner-setup-") && !e.path().to_string_lossy().to_lowercase().starts_with(&fin_s) {
                    let _ = std::fs::remove_file(e.path()); // older installers, checksums, notes
                }
            }
        }
        Ok(fin)
    }

    /// Starts the downloaded installer for a silent update over this install. The caller closes the program when ok
    /// is true (the installer waits for that, then starts the program again).
    pub fn install(&self, addin_installed: bool, active_runs: usize) -> HResult<Value> {
        let (file, rel, state) = {
            let st = self.st.lock().unwrap();
            (st.ready_file.clone(), st.latest.clone(), st.state.clone())
        };
        let fail = |m: String| Ok(obj([("ok", false.into()), ("msg", m.into())]));
        let (Some(file), Some(rel)) = (file, rel) else { return fail("No update is downloaded yet.".into()) };
        if state != "ready" || !file.is_file() {
            return fail("No update is downloaded yet.".into());
        }
        if !self.installed() {
            return fail(format!(
                "This copy of the program was not set up by the installer (no unins000.exe in {}), so it cannot update itself. Install {} from {} instead.",
                self.app_root.display(),
                rel.setup_name,
                rel.html_url
            ));
        }
        if active_runs > 0 {
            return fail("A run is still going. Install the update when it has finished.".into());
        }
        let h = PathBuf::from(format!("{}.sha256", file.display()));
        let ok = h.is_file() && matches!((sha256_file(&file), std::fs::read_to_string(&h)), (Ok(a), Ok(b)) if a == b.trim());
        if !ok {
            self.set("available", None);
            return fail("The downloaded installer changed on disk since it was checked, so it was not started. Check again to download it anew.".into());
        }
        let log = self.updates_dir().join(format!("install-{}.log", rel.version));
        let mut args = vec![
            "/VERYSILENT".to_string(),
            "/SUPPRESSMSGBOXES".into(),
            "/NORESTART".into(),
            "/CLOSEAPPLICATIONS".into(),
            (if self.per_user_install() { "/CURRENTUSER" } else { "/ALLUSERS" }).into(), // the same install mode as now
            "/RELAUNCH=1".into(),
            format!("/WAITPID={}", std::process::id()),
            format!("/LOG=\"{}\"", log.display()),
        ];
        if addin_installed {
            args.push("/MERGETASKS=addin".into()); // updates the add-in in Fusion as well
        }
        let args = args.join(" ");
        (self.launch)(&file, &args, &self.updates_dir())?;
        Ok(obj([
            ("ok", true.into()),
            ("version", rel.version.to_string().into()),
            ("args", args.into()),
            ("msg", format!("Installing {}. The program closes now and opens again when the update is in (about a minute).", rel.version).into()),
        ]))
    }
}

/// A redirect's Location against the URL that gave it.
fn resolve(base: &str, loc: &str) -> String {
    let l = loc.to_lowercase();
    if l.starts_with("http://") || l.starts_with("https://") {
        return loc.to_string();
    }
    let scheme_end = base.find("://").map(|i| i + 3).unwrap_or(0);
    let host_end = base[scheme_end..].find('/').map(|i| scheme_end + i).unwrap_or(base.len());
    if let Some(rest) = loc.strip_prefix("//") {
        return format!("{}{}", &base[..scheme_end], rest);
    }
    if loc.starts_with('/') {
        return format!("{}{}", &base[..host_end], loc);
    }
    let path_end = base.find(['?', '#']).unwrap_or(base.len());
    let dir_end = base[..path_end].rfind('/').filter(|&i| i >= host_end).map(|i| i + 1).unwrap_or(path_end);
    format!("{}{}", &base[..dir_end.max(host_end)], if dir_end <= host_end { format!("/{}", loc) } else { loc.to_string() })
}

/// The GitHub token, encrypted for the current Windows user (DPAPI, with the C# program's entropy, so a token it
/// saved still reads). On other systems (the tests) a file only the user can read.
pub struct TokenStore {
    file: PathBuf,
}

#[cfg_attr(not(windows), allow(dead_code))]
const ENTROPY: &[u8] = b"ExhaustTuner update token v1";

impl TokenStore {
    pub fn new(data_root: &Path) -> TokenStore {
        TokenStore { file: data_root.join("update-token.bin") }
    }

    pub fn has(&self) -> bool {
        self.file.is_file()
    }

    pub fn read(&self) -> Option<String> {
        let b = std::fs::read(&self.file).ok()?;
        let b = dpapi::unprotect(&b)?; // None: written by another Windows user or machine
        let s = String::from_utf8_lossy(&b).trim().to_string();
        (!s.is_empty()).then_some(s)
    }

    pub fn write(&self, token: &str) -> std::io::Result<()> {
        if let Some(d) = self.file.parent() {
            std::fs::create_dir_all(d)?;
        }
        let b = dpapi::protect(token.as_bytes()).ok_or_else(|| std::io::Error::other("Windows could not encrypt the token"))?;
        std::fs::write(&self.file, b)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.file, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    }

    pub fn clear(&self) -> std::io::Result<()> {
        if self.file.is_file() {
            std::fs::remove_file(&self.file)?;
        }
        Ok(())
    }
}

#[cfg(windows)]
mod dpapi {
    use super::ENTROPY;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    fn blob(b: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: b.len() as u32, pbData: b.as_ptr() as *mut u8 }
    }

    fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        // SAFETY: the system allocated cbData bytes at pbData; they are copied, then freed with LocalFree
        let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
        unsafe { LocalFree(out.pbData as _) };
        v
    }

    /// ProtectedData.Protect(data, entropy, CurrentUser)
    pub fn protect(data: &[u8]) -> Option<Vec<u8>> {
        let (inb, ent) = (blob(data), blob(ENTROPY));
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe { CryptProtectData(&inb, std::ptr::null(), &ent, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out) };
        (ok != 0).then(|| take(out))
    }

    /// ProtectedData.Unprotect(data, entropy, CurrentUser)
    pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
        let (inb, ent) = (blob(data), blob(ENTROPY));
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe { CryptUnprotectData(&inb, std::ptr::null_mut(), &ent, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out) };
        (ok != 0).then(|| take(out))
    }
}

#[cfg(not(windows))]
mod dpapi {
    pub fn protect(data: &[u8]) -> Option<Vec<u8>> {
        Some(data.to_vec())
    }
    pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
        Some(data.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_and_checksum_lines_parse() {
        // UpdaterTests.Versions_and_checksum_lines_parse
        assert_eq!(parse_version(Some("v0.1.43")).unwrap().to_string(), "0.1.43");
        assert_eq!(parse_version(Some(" 0.1.43+abc ")).unwrap().to_string(), "0.1.43");
        assert_eq!(parse_version(Some("0.1.43-rc1")).unwrap().to_string(), "0.1.43");
        assert!(parse_version(Some("1")).is_none() && parse_version(Some("x.y")).is_none() && parse_version(None).is_none());
        assert!(parse_version(Some("0.1.44")) > parse_version(Some("0.1.43")));
        assert!(parse_version(Some("0.1.10")) > parse_version(Some("0.1.9")));
        assert!(parse_version(Some("0.1")) < parse_version(Some("0.1.0")));
        let h = "a".repeat(64);
        let sums = format!("{}  ExhaustTuner-Setup-0.1.44.exe\n{} *other.txt\n", h.to_uppercase(), "b".repeat(64));
        assert_eq!(sum_for(&sums, "exhausttuner-setup-0.1.44.exe"), Some(h));
        assert_eq!(sum_for(&sums, "other.txt"), Some("b".repeat(64)));
        assert_eq!(sum_for(&sums, "missing.exe"), None);
    }

    #[test]
    fn expiry_parses() {
        use chrono::TimeZone;
        assert_eq!(parse_expiry(Some("2026-12-01 08:00:00 UTC")), Some(chrono::Utc.with_ymd_and_hms(2026, 12, 1, 8, 0, 0).unwrap()));
        assert_eq!(parse_expiry(Some("2026-12-01 08:00:00 -0700")), Some(chrono::Utc.with_ymd_and_hms(2026, 12, 1, 15, 0, 0).unwrap()));
        assert_eq!(parse_expiry(Some("soon")), None);
    }

    #[test]
    fn redirects_resolve() {
        assert_eq!(resolve("http://127.0.0.1:5/a/b?x", "/storage/1?sig=abc"), "http://127.0.0.1:5/storage/1?sig=abc");
        assert_eq!(resolve("https://h/a/b", "https://o/x"), "https://o/x");
        assert_eq!(resolve("https://h/a/b", "c"), "https://h/a/c");
        assert_eq!(resolve("https://h", "c"), "https://h/c");
    }

    #[test]
    fn tokens_are_checked_for_shape_and_can_be_removed() {
        // UpdaterTests.Tokens_are_checked_for_shape_and_can_be_removed
        let d = std::env::temp_dir().join(format!("et_tok_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let p = AppPaths::new(Some("/opt/et"), Some(d.to_str().unwrap()), Some("/f"));
        let u = Updater::new(&p, "0.1.45", Some("http://127.0.0.1:1"), Some("owner/repo"), None, None);
        // no token is fine: the repository is public, so the first check asks GitHub without one
        assert_eq!((u.status()["state"].clone(), u.status()["configured"].clone()), (Value::from("idle"), Value::Bool(false)));
        let bad = u.set_token(Some("short")).unwrap();
        assert_eq!(bad["ok"], false);
        assert!(!u.tokens.has());
        let bad = u.set_token(Some("github_pat_has a space in it 12345")).unwrap();
        assert_eq!(bad["ok"], false);
        let good = u.set_token(Some("  github_pat_0123456789abcdefghij  ")).unwrap();
        assert_eq!((good["configured"].clone(), good["state"].clone()), (Value::Bool(true), Value::from("idle")));
        assert_eq!(u.tokens.read().as_deref(), Some("github_pat_0123456789abcdefghij"));
        let s = u.status().to_string();
        assert!(!s.contains("github_pat_0123"), "the token never goes back to the page");
        let gone = u.set_token(Some("")).unwrap();
        assert_eq!((gone["configured"].clone(), gone["state"].clone()), (Value::Bool(false), Value::from("idle")));
        let _ = std::fs::remove_dir_all(&d);
    }
}
