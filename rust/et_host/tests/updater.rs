//! app/ExhaustTuner.Core.Tests/UpdaterTests.cs against the Rust port, with a stand-in for api.github.com and the
//! storage host it redirects release downloads to (two local HTTP servers, so which host gets the token shows).

use et_host::dispatcher::{Dispatcher, HostUi};
use et_host::paths::AppPaths;
use et_host::updater::{Launch, Updater};
use et_host::Cancel;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const TOKEN: &str = "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz";
const REPO: &str = "owner/repo";

fn sha(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{:02x}", x)).collect()
}

struct Gh {
    api: String,
    dl: String,
    seen: Vec<(String, Option<String>)>,
    list_status: u16,
    list_body: String,
    setup: Vec<u8>,
    setup_name: String,
    sums: Option<String>,
    stall: bool,
    expires: Option<String>,
}

enum Reply {
    Full(u16, Vec<(String, String)>, Vec<u8>),
    Stall,
}

/// A tiny HTTP/1.1 server: one request per connection, the reply from handle(path, authorization).
fn server(handle: Arc<dyn Fn(&str, Option<String>) -> Reply + Send + Sync>) -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://127.0.0.1:{}", l.local_addr().unwrap().port());
    std::thread::spawn(move || {
        for s in l.incoming().flatten() {
            let h = Arc::clone(&handle);
            std::thread::spawn(move || {
                let mut r = BufReader::new(s.try_clone().unwrap());
                let mut line = String::new();
                if r.read_line(&mut line).is_err() {
                    return;
                }
                let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
                let mut auth = None;
                loop {
                    let mut hl = String::new();
                    if r.read_line(&mut hl).is_err() || hl.trim().is_empty() {
                        break;
                    }
                    if let Some((k, v)) = hl.split_once(':') {
                        if k.trim().eq_ignore_ascii_case("authorization") {
                            auth = Some(v.trim().to_string());
                        }
                    }
                }
                let mut w = s;
                match h(&path, auth) {
                    Reply::Full(code, headers, body) => {
                        let mut head = format!("HTTP/1.1 {} X\r\nContent-Length: {}\r\nConnection: close\r\n", code, body.len());
                        for (k, v) in headers {
                            head.push_str(&format!("{}: {}\r\n", k, v));
                        }
                        head.push_str("\r\n");
                        let _ = w.write_all(head.as_bytes());
                        let _ = w.write_all(&body);
                    }
                    Reply::Stall => {
                        // headers, then nothing
                        let _ = w.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5000\r\nConnection: close\r\n\r\n");
                        std::thread::sleep(Duration::from_secs(30));
                    }
                }
            });
        }
    });
    base
}

fn release(api: &str, tag: &str, draft: bool, pre: bool, assets: &[(i64, &str, i64)]) -> Value {
    json!({
        "tag_name": tag, "name": format!("Exhaust Tuner {}", tag.trim_start_matches('v')), "draft": draft, "prerelease": pre,
        "body": format!("- what changed in {}", tag), "published_at": "2026-11-01T20:00:00Z",
        "html_url": format!("https://github.com/{}/releases/tag/{}", REPO, tag),
        "assets": assets.iter().map(|(id, name, size)| json!({"id": id, "name": name, "size": size,
            "url": format!("{}/repos/{}/releases/assets/{}", api, REPO, id)})).collect::<Vec<_>>()
    })
}

/// The stand-in GitHub: a list with a draft, a pre-release, a release still missing its checksum file, an older
/// complete release and the newest complete one (0.1.45; its SHA256SUMS asset id ends in 9).
fn fake_github() -> Arc<Mutex<Gh>> {
    let st = Arc::new(Mutex::new(Gh {
        api: String::new(),
        dl: String::new(),
        seen: Vec::new(),
        list_status: 200,
        list_body: "[]".into(),
        setup: format!("pretend installer {}", "x".repeat(5000)).into_bytes(),
        setup_name: "ExhaustTuner-Setup-0.1.45.exe".into(),
        sums: None,
        stall: false,
        expires: None,
    }));
    let serve = |st: Arc<Mutex<Gh>>, is_api: bool| -> Arc<dyn Fn(&str, Option<String>) -> Reply + Send + Sync> {
        Arc::new(move |path: &str, auth: Option<String>| {
            let mut g = st.lock().unwrap();
            let host = if is_api { g.api.clone() } else { g.dl.clone() };
            g.seen.push((format!("{}{}", host, path), auth));
            if is_api && path == format!("/repos/{}/releases?per_page=20", REPO) {
                let mut h = vec![("Content-Type".to_string(), "application/json".to_string())];
                if let Some(e) = &g.expires {
                    h.push(("GitHub-Authentication-Token-Expiration".into(), e.clone()));
                }
                return Reply::Full(g.list_status, h, g.list_body.clone().into_bytes());
            }
            if is_api && path.starts_with(&format!("/repos/{}/releases/assets/", REPO)) {
                let id = path.rsplit('/').next().unwrap_or("");
                // asset 45 redirects within the API host, the others to the storage host: neither hop may carry the token
                let to = if id == "45" { format!("{}/storage", g.api) } else { g.dl.clone() };
                return Reply::Full(302, vec![("Location".into(), format!("{}/asset/{}?X-Amz-Signature=abc", to, id))], Vec::new());
            }
            if (!is_api && path.starts_with("/asset/")) || (is_api && path.starts_with("/storage/asset/")) {
                let id = path.split("/asset/").nth(1).unwrap_or("").split('?').next().unwrap_or("").to_string();
                if id.ends_with('9') {
                    let body = g.sums.clone().unwrap_or_else(|| format!("{}  {}", sha(&g.setup), g.setup_name));
                    return Reply::Full(200, vec![], body.into_bytes());
                }
                if g.stall {
                    return Reply::Stall;
                }
                return Reply::Full(200, vec![], g.setup.clone());
            }
            Reply::Full(404, vec![], Vec::new())
        })
    };
    let api = server(serve(Arc::clone(&st), true));
    let dl = server(serve(Arc::clone(&st), false));
    {
        let mut g = st.lock().unwrap();
        g.api = api.clone();
        g.dl = dl;
        let n = g.setup.len() as i64;
        let sn = g.setup_name.clone();
        g.list_body = Value::Array(vec![
            release(&api, "v0.1.50", true, false, &[(50, "ExhaustTuner-Setup-0.1.50.exe", 10), (59, "SHA256SUMS.txt", 90)]),
            release(&api, "v0.1.48", false, true, &[(48, "ExhaustTuner-Setup-0.1.48.exe", 10), (489, "SHA256SUMS.txt", 90)]),
            release(&api, "v0.1.47", false, false, &[(47, "ExhaustTuner-Setup-0.1.47.exe", 10)]),
            release(&api, "v0.1.45", false, false, &[(45, &sn, n), (459, "SHA256SUMS.txt", 90)]),
            release(&api, "v0.1.40", false, false, &[(40, "ExhaustTuner-Setup-0.1.40.exe", 10), (409, "SHA256SUMS.txt", 90)]),
        ])
        .to_string();
    }
    st
}

fn install(installed: bool) -> (AppPaths, PathBuf) {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let t = std::env::temp_dir().join(format!("et-upd-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
    let _ = std::fs::remove_dir_all(&t);
    let app = t.join("app");
    std::fs::create_dir_all(&app).unwrap();
    if installed {
        std::fs::write(app.join("unins000.exe"), "").unwrap();
    }
    (AppPaths::new(Some(app.to_str().unwrap()), Some(t.join("data").to_str().unwrap()), Some(t.join("fusion").to_str().unwrap())), t)
}

type Launched = Arc<Mutex<Vec<(PathBuf, String)>>>;

fn make(p: &AppPaths, gh: &Arc<Mutex<Gh>>, version: &str, launched: Option<Launched>, previous: Option<&str>) -> Arc<Updater> {
    let api = gh.lock().unwrap().api.clone();
    let launch: Launch = Box::new(move |f: &Path, a: &str, _d: &Path| {
        if let Some(l) = &launched {
            l.lock().unwrap().push((f.to_path_buf(), a.to_string()));
        }
        Ok(())
    });
    Updater::new(p, version, Some(&api), Some(REPO), Some(launch), previous)
}

fn check(u: &Arc<Updater>) -> Value {
    u.check(true, &Cancel::new()).unwrap()
}

#[test]
fn without_a_token_a_public_repository_is_checked_and_downloaded_without_one() {
    let (p, _) = install(true);
    let gh = fake_github();
    let u = make(&p, &gh, "0.1.43", None, None);
    assert_eq!((u.status()["state"].clone(), u.status()["configured"].clone()), (json!("idle"), json!(false)));
    let s = check(&u);
    assert_eq!((s["state"].clone(), s["latest"]["version"].clone()), (json!("downloading"), json!("0.1.45")));
    u.wait();
    assert_eq!(u.status()["state"], "ready", "{}", u.status());
    let seen = gh.lock().unwrap().seen.clone();
    assert!(seen.len() >= 3 && seen.iter().all(|x| x.1.is_none()), "no request carries a token: {:?}", seen);
    assert!(u.status().get("tokenDaysLeft").map_or(true, |v| v.is_null()));
}

#[test]
fn without_a_token_a_private_repository_asks_for_one() {
    let (p, _) = install(true);
    let gh = fake_github();
    {
        let mut g = gh.lock().unwrap();
        g.list_status = 404; // what GitHub answers a request without a token for a private repository
        g.list_body = r#"{"message":"Not Found"}"#.into();
    }
    let u = make(&p, &gh, "0.1.43", None, None);
    let s = check(&u);
    assert_eq!((s["state"].clone(), s["configured"].clone()), (json!("not-configured"), json!(false)));
    assert!(s["error"].as_str().unwrap().contains("without a token"), "{}", s);
    let seen = gh.lock().unwrap().seen.clone();
    assert_eq!(seen.len(), 1);
    assert!(seen[0].1.is_none());
}

#[test]
fn newest_complete_release_is_downloaded_and_verified_and_the_token_stays_on_the_api_host() {
    let (p, _) = install(true);
    let gh = fake_github();
    let u = make(&p, &gh, "0.1.43", None, None);
    assert_eq!(u.set_token(Some(TOKEN)).unwrap()["configured"], true);
    let s = check(&u);
    assert_eq!(s["state"], "downloading");
    assert_eq!(s["latest"]["version"], "0.1.45"); // not the draft, the pre-release or the one without SHA256SUMS
    u.wait();
    let s = u.status();
    assert_eq!(s["state"], "ready", "{}", s);
    let (setup, name, api) = {
        let g = gh.lock().unwrap();
        (g.setup.clone(), g.setup_name.clone(), g.api.clone())
    };
    let file = u.updates_dir().join(&name);
    assert_eq!(std::fs::read(&file).unwrap(), setup);
    assert_eq!(std::fs::read_to_string(format!("{}.sha256", file.display())).unwrap(), sha(&setup));
    assert!(s["latest"]["notes"].as_str().unwrap().contains("what changed in v0.1.45"));
    // the token went with every API request and with no redirect, not even one back to the API host
    let seen = gh.lock().unwrap().seen.clone();
    let stored: Vec<_> = seen.iter().filter(|x| x.0.contains("/asset/")).collect();
    for x in seen.iter().filter(|x| !x.0.contains("/asset/")) {
        assert_eq!(x.1.as_deref(), Some(format!("Bearer {}", TOKEN).as_str()), "{}", x.0);
    }
    assert_eq!(stored.len(), 2);
    assert!(stored.iter().any(|x| x.0.starts_with(&format!("{}/storage/", api))));
    assert!(stored.iter().all(|x| x.1.is_none()));
    assert!(!s.to_string().contains(TOKEN)); // the token is never handed back
    // a second check finds the verified download and does not fetch it again
    let before = gh.lock().unwrap().seen.len();
    assert_eq!(check(&u)["state"], "ready");
    assert_eq!(gh.lock().unwrap().seen.len(), before + 1);
}

#[test]
fn up_to_date_when_nothing_newer_is_published() {
    let (p, _) = install(true);
    let gh = fake_github();
    let u = make(&p, &gh, "0.1.45", None, None);
    u.set_token(Some(TOKEN)).unwrap();
    let s = check(&u);
    assert_eq!(s["state"], "up-to-date");
    assert_eq!(s["latest"]["newer"], false);
    assert!(!u.updates_dir().is_dir() || std::fs::read_dir(u.updates_dir()).unwrap().next().is_none());
}

#[test]
fn a_download_that_does_not_match_its_checksum_is_deleted() {
    let (p, _) = install(true);
    let gh = fake_github();
    {
        let mut g = gh.lock().unwrap();
        g.sums = Some(format!("{}  {}", "0".repeat(64), g.setup_name));
    }
    let u = make(&p, &gh, "0.1.43", None, None);
    u.set_token(Some(TOKEN)).unwrap();
    check(&u);
    u.wait();
    let s = u.status();
    assert_eq!(s["state"], "error");
    assert!(s["error"].as_str().unwrap().contains("SHA-256"));
    assert_eq!(std::fs::read_dir(u.updates_dir()).unwrap().count(), 0);
}

#[test]
fn a_stalled_download_gives_up_and_the_next_check_starts_it_again() {
    let (p, _) = install(true);
    let gh = fake_github();
    gh.lock().unwrap().stall = true;
    let u = make(&p, &gh, "0.1.43", None, None);
    u.set_stall_seconds(1);
    u.set_token(Some(TOKEN)).unwrap();
    check(&u);
    let t0 = std::time::Instant::now();
    u.wait();
    assert!(t0.elapsed() < Duration::from_secs(20), "it does not hang");
    let s = u.status();
    assert_eq!(s["state"], "error");
    assert!(s["error"].as_str().unwrap().contains("no data came for 1 s"), "{}", s["error"]);
    assert!(std::fs::read_dir(u.updates_dir()).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".part")));
    gh.lock().unwrap().stall = false;
    check(&u);
    u.wait();
    assert_eq!(u.status()["state"], "ready");
}

#[test]
fn github_refusals_are_explained() {
    for (code, text) in [(401u16, "did not accept the token"), (404, "Contents: Read-only"), (500, "HTTP 500"), (403, "refused the request: Bad credentials")] {
        let (p, _) = install(true);
        let gh = fake_github();
        {
            let mut g = gh.lock().unwrap();
            g.list_status = code;
            g.list_body = "{\"message\":\"Bad credentials\"}".into();
        }
        let u = make(&p, &gh, "0.1.43", None, None);
        u.set_token(Some(TOKEN)).unwrap();
        let s = check(&u);
        assert_eq!(s["state"], "error");
        assert!(s["error"].as_str().unwrap().contains(text), "{}: {}", code, s["error"]);
    }
}

fn ready(p: &AppPaths) -> (Arc<Updater>, Arc<Mutex<Gh>>, Launched) {
    let gh = fake_github();
    let launched: Launched = Arc::default();
    let u = make(p, &gh, "0.1.43", Some(Arc::clone(&launched)), None);
    u.set_token(Some(TOKEN)).unwrap();
    check(&u);
    u.wait();
    assert_eq!(u.status()["state"], "ready");
    (u, gh, launched)
}

#[test]
fn install_starts_the_installer_silently_over_this_install_and_waits_for_the_program() {
    let (p, _) = install(true);
    let (u, gh, launched) = ready(&p);
    let r = u.install(true, 0).unwrap();
    assert_eq!(r["ok"], true, "{}", r);
    let (f, a) = launched.lock().unwrap()[0].clone();
    assert_eq!(f, u.updates_dir().join(&gh.lock().unwrap().setup_name));
    for want in ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/RELAUNCH=1", &format!("/WAITPID={}", std::process::id()), "/MERGETASKS=addin"] {
        assert!(a.contains(want), "{} in {}", want, a);
    }
    assert!(a.contains(if u.per_user_install() { "/CURRENTUSER" } else { "/ALLUSERS" }));
    // without the add-in in Fusion the installer is not asked to put it there
    launched.lock().unwrap().clear();
    u.install(false, 0).unwrap();
    assert!(!launched.lock().unwrap()[0].1.contains("/MERGETASKS"));
}

#[test]
fn install_waits_for_runs_refuses_build_folders_and_files_changed_on_disk() {
    let (p, _) = install(true);
    let (u, gh, launched) = ready(&p);
    assert_eq!(u.install(false, 1).unwrap()["ok"], false);
    let f = u.updates_dir().join(&gh.lock().unwrap().setup_name);
    let mut fh = std::fs::OpenOptions::new().append(true).open(&f).unwrap();
    fh.write_all(b"tampered").unwrap();
    let r = u.install(false, 0).unwrap();
    assert_eq!(r["ok"], false);
    assert!(r["msg"].as_str().unwrap().contains("changed on disk"));
    assert!(launched.lock().unwrap().is_empty());

    let (p2, _) = install(false);
    let (u2, _, launched2) = ready(&p2);
    let r2 = u2.install(false, 0).unwrap();
    assert_eq!(r2["ok"], false);
    assert!(r2["msg"].as_str().unwrap().contains("not set up by the installer"));
    assert!(launched2.lock().unwrap().is_empty());
}

#[derive(Default)]
struct QuitUi {
    quits: Mutex<usize>,
}
impl HostUi for QuitUi {
    fn pick_folder(&self, _t: &str) -> Option<PathBuf> {
        None
    }
    fn pick_save_file(&self, _t: &str, _s: &str) -> Option<PathBuf> {
        None
    }
    fn open_folder(&self, _p: &Path) {}
    fn quit(&self) {
        *self.quits.lock().unwrap() += 1;
    }
}

#[test]
fn dispatcher_closes_the_program_only_when_the_installer_started() {
    let (p, _) = install(true);
    let (u, _, launched) = ready(&p);
    let ui = Arc::new(QuitUi::default());
    let d = Dispatcher::new(Arc::new(AppPaths::new(Some(p.app_root.to_str().unwrap()), Some(p.data_root.to_str().unwrap()), Some(p.fusion_addins_root.to_str().unwrap()))), ui.clone(), u);
    let none = |_: Value| {};
    let r = d.dispatch("updateInstall", &Value::Null, &none, &Cancel::new()).unwrap();
    assert_eq!(r["ok"], true);
    assert_eq!(*ui.quits.lock().unwrap(), 1);
    assert_eq!(launched.lock().unwrap().len(), 1);
    assert_eq!(d.dispatch("updateStatus", &Value::Null, &none, &Cancel::new()).unwrap()["state"], "ready");
    assert_eq!(d.info()["update"]["state"], "ready");

    let (p2, _) = install(false);
    let ui2 = Arc::new(QuitUi::default());
    let gh = fake_github();
    let u2 = make(&p2, &gh, "0.1.43", None, None);
    let d2 = Dispatcher::new(Arc::new(p2), ui2.clone(), u2);
    let r2 = d2.dispatch("updateInstall", &Value::Null, &none, &Cancel::new()).unwrap();
    assert_eq!(r2["ok"], false);
    assert_eq!(*ui2.quits.lock().unwrap(), 0);
}

#[test]
fn the_token_expiry_github_reports_is_passed_on() {
    let (p, _) = install(true);
    let gh = fake_github();
    let when = chrono::Utc::now() + chrono::Duration::milliseconds((10.5 * 86_400_000.0) as i64);
    gh.lock().unwrap().expires = Some(format!("{} UTC", when.format("%Y-%m-%d %H:%M:%S")));
    let u = make(&p, &gh, "0.1.45", None, None);
    u.set_token(Some(TOKEN)).unwrap();
    let s = check(&u);
    assert_eq!(s["tokenExpires"], when.format("%Y-%m-%d").to_string());
    assert_eq!(s["tokenDaysLeft"], 10);
    gh.lock().unwrap().expires = None; // a token without an expiry date
    let s = check(&u);
    assert!(s.get("tokenExpires").is_none());
}

#[test]
fn after_an_update_the_first_start_shows_what_changed() {
    let (p, _) = install(true);
    let (u, gh, _) = ready(&p); // downloads 0.1.45 while 0.1.43 runs
    assert!(u.status().get("updated").is_none());
    let name = gh.lock().unwrap().setup_name.clone();
    assert!(std::fs::read_to_string(u.updates_dir().join(format!("{}.notes.txt", name))).unwrap().contains("what changed in v0.1.45"));
    // the installer ran; the next start is 0.1.45 and the start record still says 0.1.43
    let after = make(&p, &gh, "0.1.45", None, Some("0.1.43"));
    let upd = after.status()["updated"].clone();
    assert_eq!((upd["from"].clone(), upd["to"].clone()), (json!("0.1.43"), json!("0.1.45")));
    assert!(upd["notes"].as_str().unwrap().contains("what changed in v0.1.45"));
    // an ordinary start (same version), or a start after going back to an older version: nothing to show
    assert!(make(&p, &gh, "0.1.45", None, Some("0.1.45")).status().get("updated").is_none());
    assert!(make(&p, &gh, "0.1.43", None, Some("0.1.45")).status().get("updated").is_none());
}
