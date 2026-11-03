//! The program's request handling without the window (HostCli/Program.cs): one JSON message per line on stdin
//! ({id, action, data}), replies and progress events one per line on stdout. The browser tests drive the real page
//! through it, and it can run the solvers from a script. Dialogs: EXHAUST_TUNER_PICK_FOLDER answers folder and save
//! prompts (unset = the user cancelled). Updates, for the tests only (the program's window has no such switches):
//! EXHAUST_TUNER_UPDATE_API points the update check at a stand-in for api.github.com, EXHAUST_TUNER_UPDATE_REPO
//! names the repository, EXHAUST_TUNER_UPDATE_DRYRUN=1 prints the installer command instead of starting it,
//! EXHAUST_TUNER_UPDATE_PREVIOUS plays the version the last start recorded (the window reads it from
//! last-start.txt). Folders: EXHAUST_TUNER_APPROOT, EXHAUST_TUNER_DATA, EXHAUST_TUNER_FUSION_ADDINS.
//! Other switches: --info (hostInfo), --bridge (the page's bridge script), --install-addin (the installer's),
//! --token-sha256 (the saved update token's SHA-256, never the token).

use et_host::dispatcher::{Dispatcher, HostUi};
use et_host::paths::AppPaths;
use et_host::router::{bridge_script, MessageRouter};
use et_host::updater::{Launch, Updater};
use et_host::{fusion_addin, version};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

struct CliUi;

impl HostUi for CliUi {
    fn pick_folder(&self, _title: &str) -> Option<PathBuf> {
        env("EXHAUST_TUNER_PICK_FOLDER").map(PathBuf::from)
    }
    fn pick_save_file(&self, _title: &str, suggested: &str) -> Option<PathBuf> {
        env("EXHAUST_TUNER_PICK_FOLDER").map(|f| Path::new(&f).join(suggested))
    }
    fn open_folder(&self, path: &Path) {
        eprintln!("open folder: {}", path.display());
    }
    fn quit(&self) {
        eprintln!("quit requested (an update is installing)");
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let paths = Arc::new(AppPaths::new(env("EXHAUST_TUNER_APPROOT").as_deref(), env("EXHAUST_TUNER_DATA").as_deref(), env("EXHAUST_TUNER_FUSION_ADDINS").as_deref()));
    let launch: Option<Launch> = if env("EXHAUST_TUNER_UPDATE_DRYRUN").as_deref() == Some("1") {
        Some(Box::new(|file: &Path, a: &str, _dir: &Path| {
            eprintln!("update installer (not started): {} {}", file.display(), a);
            Ok(())
        }))
    } else {
        None
    };
    let updater = Updater::new(
        &paths,
        version(),
        env("EXHAUST_TUNER_UPDATE_API").as_deref(),
        env("EXHAUST_TUNER_UPDATE_REPO").as_deref(),
        launch,
        env("EXHAUST_TUNER_UPDATE_PREVIOUS").as_deref(),
    );
    let dispatcher = Arc::new(Dispatcher::new(Arc::clone(&paths), Arc::new(CliUi), updater));
    if args.iter().any(|a| a == "--info") {
        println!("{}", dispatcher.info());
        return;
    }
    if args.iter().any(|a| a == "--token-sha256") {
        // the SHA-256 of the saved update token as this program reads it, or "none" (the Windows build checks that a
        // token the C# program saved still reads; the token itself is never printed)
        use sha2::Digest;
        match et_host::updater::TokenStore::new(&paths.data_root).read() {
            Some(t) => println!("{}", sha2::Sha256::digest(t.as_bytes()).iter().map(|b| format!("{:02x}", b)).collect::<String>()),
            None => println!("none"),
        }
        return;
    }
    if args.iter().any(|a| a == "--bridge") {
        print!("{}", bridge_script());
        return;
    }
    if args.iter().any(|a| a == "--install-addin") {
        // the installer calls this when "Install the Fusion add-in" is ticked
        match fusion_addin::install(&paths) {
            Ok(r) => {
                println!("{}", r["msg"].as_str().unwrap_or(""));
                return;
            }
            Err(e) => {
                eprintln!("{}", e);
                std::process::exit(1);
            }
        }
    }
    let out = Arc::new(Mutex::new(std::io::stdout()));
    let post = {
        let out = Arc::clone(&out);
        Arc::new(move |json: String| {
            let mut o = out.lock().unwrap();
            let _ = writeln!(o, "{}", json);
            let _ = o.flush();
        })
    };
    let router = Arc::new(MessageRouter::new(dispatcher, post));
    let mut running = Vec::new();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let r = Arc::clone(&router);
        running.push(std::thread::spawn(move || r.handle(&line)));
    }
    for t in running {
        let _ = t.join();
    }
}
