//! ExhaustTuner.exe in Rust (app/ExhaustTuner.Desktop's MainWindow.xaml.cs and App.xaml.cs): the calculator page
//! in a WebView2 window, served from the install folder at https://app.exhaust-tuner/ (the C# program's origin, so
//! the page's saved state carries over), its requests handled by et_host. Links to outside pages open in the
//! normal browser; only the bundled page may drive the solvers.

#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(not(windows))]
fn main() {
    eprintln!(
        "The Exhaust Tuner window is built for Windows (it hosts the page in WebView2). Here, run exhaust-tuner-host: \
         the same requests over stdin and stdout."
    );
    std::process::exit(2);
}

#[cfg(windows)]
fn main() {
    win::main();
}

#[cfg(windows)]
mod win {
    use et_host::dispatcher::{Dispatcher, HostUi};
    use et_host::paths::AppPaths;
    use et_host::router::{bridge_script, MessageRouter};
    use et_host::start_record::{self, PREVIOUS_VERSION};
    use et_host::updater::Updater;
    use et_host::{utc_now_o, version};
    use std::borrow::Cow;
    use std::path::{Path, PathBuf};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use tao::dpi::{LogicalSize, PhysicalPosition};
    use tao::event::{Event, WindowEvent};
    use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
    use tao::window::{Theme, WindowBuilder};
    use wry::http::{header, Request, Response, StatusCode};
    use wry::{NewWindowResponse, PageLoadEvent, WebContext, WebViewBuilder, WebViewBuilderExtWindows};

    /// The page's origin: wry serves its "app" protocol at https://app.<host>/ on Windows, the same origin the C#
    /// program maps its folder to, so browser storage (saved designs) is shared.
    const ORIGIN: &str = "https://app.exhaust-tuner/";
    const ORIGIN_RAW: &str = "app://exhaust-tuner/";

    // The page's surface colours (web/index.html --bg), so the frame and the page meet without a white flash.
    const DARK_BG: (u8, u8, u8) = (0x10, 0x16, 0x1B);
    const LIGHT_BG: (u8, u8, u8) = (0xE6, 0xEB, 0xEE);

    enum Ev {
        Post(String),
        SelfTest(String),
        Theme(bool),
        DevTools,
        PickFolder(String, mpsc::Sender<Option<PathBuf>>),
        PickSave(String, String, mpsc::Sender<Option<PathBuf>>),
        Quit,
        Exit,
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// The self-test's result file (--selftest): set, a problem is written there instead of shown in a box.
    static SELFTEST: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

    fn message_box(text: &str) {
        if let Some(f) = SELFTEST.get() {
            let _ = std::fs::write(f, format!("failed {}\n", text.replace('\n', " ")));
            return;
        }
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
        let (t, c) = (wide(text), wide("Exhaust Tuner"));
        unsafe { MessageBoxW(std::ptr::null_mut(), t.as_ptr(), c.as_ptr(), MB_OK | MB_ICONWARNING) };
    }

    /// Opens an outside link in the normal browser (only http and https).
    fn open_external(uri: &str) {
        let l = uri.to_lowercase();
        if !(l.starts_with("https://") || l.starts_with("http://")) {
            return;
        }
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let (op, u) = (wide("open"), wide(uri));
        unsafe { ShellExecuteW(std::ptr::null_mut(), op.as_ptr(), u.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
    }

    /// Windows' app theme (Settings, Personalisation, Colours): AppsUseLightTheme = 0 means dark.
    fn system_prefers_dark() -> bool {
        use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
        let (key, val) = (wide("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"), wide("AppsUseLightTheme"));
        let mut data: u32 = 1;
        let mut size = std::mem::size_of::<u32>() as u32;
        let r = unsafe {
            RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), val.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(), &mut data as *mut u32 as *mut _, &mut size)
        };
        r == 0 && data == 0
    }

    struct WindowUi {
        proxy: Mutex<EventLoopProxy<Ev>>,
    }

    impl WindowUi {
        fn send(&self, e: Ev) {
            let _ = self.proxy.lock().unwrap().send_event(e);
        }
    }

    impl HostUi for WindowUi {
        // the dialogs run on the window's thread, owned by the window, as the C# program's ShowDialog(this)
        fn pick_folder(&self, title: &str) -> Option<PathBuf> {
            let (tx, rx) = mpsc::channel();
            self.send(Ev::PickFolder(title.to_string(), tx));
            rx.recv().ok().flatten()
        }
        fn pick_save_file(&self, title: &str, suggested: &str) -> Option<PathBuf> {
            let (tx, rx) = mpsc::channel();
            self.send(Ev::PickSave(title.to_string(), suggested.to_string(), tx));
            rx.recv().ok().flatten()
        }
        fn open_folder(&self, path: &Path) {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("explorer.exe").raw_arg(format!("\"{}\"", path.display())).spawn();
        }
        fn set_theme(&self, dark: bool) {
            self.send(Ev::Theme(dark));
        }
        fn open_dev_tools(&self) {
            self.send(Ev::DevTools);
        }
        /// An update's installer has started and waits for this process to end: close shortly, once the reply has
        /// reached the page.
        fn quit(&self) {
            self.send(Ev::Quit);
        }
    }

    fn content_type(p: &Path) -> &'static str {
        match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
            Some("html") | Some("htm") => "text/html; charset=utf-8",
            Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
            Some("css") => "text/css; charset=utf-8",
            Some("json") => "application/json",
            Some("svg") => "image/svg+xml",
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("ico") => "image/x-icon",
            Some("wasm") => "application/wasm",
            Some("woff2") => "font/woff2",
            Some("txt") | Some("md") => "text/plain; charset=utf-8",
            _ => "application/octet-stream",
        }
    }

    /// A file of the web folder for the page (nothing outside it).
    fn serve(web: &Path, req: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
        let path = req.uri().path();
        let rel: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        let not_found = || Response::builder().status(StatusCode::NOT_FOUND).body(Cow::Borrowed(&b"not found"[..])).unwrap();
        if rel.iter().any(|s| *s == ".." || s.contains('\\') || s.contains(':')) {
            return not_found();
        }
        let mut f = web.to_path_buf();
        for s in &rel {
            f.push(percent_decode(s));
        }
        match std::fs::read(&f) {
            Ok(b) => Response::builder().header(header::CONTENT_TYPE, content_type(&f)).body(Cow::Owned(b)).unwrap(),
            Err(_) => not_found(),
        }
    }

    fn percent_decode(s: &str) -> String {
        let b = s.as_bytes();
        let mut out = Vec::with_capacity(b.len());
        let mut i = 0;
        while i < b.len() {
            if b[i] == b'%' && i + 2 < b.len() {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
            }
            out.push(b[i]);
            i += 1;
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    fn is_app(url: &str) -> bool {
        let l = url.to_lowercase();
        l.starts_with(ORIGIN) || l.starts_with(ORIGIN_RAW) || l.starts_with("about:")
    }

    /// --selftest FILE: open the window, load the page, have it ask the program for hostInfo through the bridge, write
    /// the outcome to FILE and close (the Windows build runs it on the installed program). "ok <version>" when the
    /// page, the bridge and the request handling all worked; "no-webview2 <why>" when WebView2 does not start here.
    fn selftest_file() -> Option<PathBuf> {
        let a: Vec<String> = std::env::args().collect();
        a.iter().position(|x| x == "--selftest").and_then(|i| a.get(i + 1)).map(PathBuf::from)
    }

    const SELFTEST_JS: &str = "(function(){var go=function(){if(!window.exhaustTunerHost||document.readyState!=='complete'){return setTimeout(go,200);}\
window.exhaustTunerHost.call('hostInfo').then(function(r){window.ipc.postMessage(JSON.stringify({id:-1,action:'__selftest',\
data:{ok:true,version:r.version,desktop:document.documentElement.classList.contains('in-desktop')}}));},function(e){\
window.ipc.postMessage(JSON.stringify({id:-1,action:'__selftest',data:{ok:false,error:String(e)}}));});};go();})();";

    pub fn main() {
        let selftest = selftest_file();
        if let Some(f) = &selftest {
            let _ = SELFTEST.set(f.clone());
            // a result even when nothing answers: the build waits for the program to close
            let f = f.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(90));
                let _ = std::fs::write(&f, "timeout: the page did not answer in 90 s\n");
                std::process::exit(1);
            });
        }
        let paths = Arc::new(AppPaths::new(None, None, None));
        // which version started last, as which process, from which folder: after an update this shows the installer
        // opened the new version again (the Windows build checks it)
        if let Ok(prev) = start_record::write(&paths, version()) {
            *PREVIOUS_VERSION.lock().unwrap() = prev;
        }
        if !paths.page_file().is_file() {
            message_box(&format!("The calculator page is missing: {}", paths.page_file().display()));
            return;
        }
        let mut dark = system_prefers_dark();
        let event_loop = EventLoopBuilder::<Ev>::with_user_event().build();
        use tao::platform::windows::IconExtWindows;
        let icon = tao::window::Icon::from_resource(1, None).ok();
        let window = match WindowBuilder::new()
            .with_title("Exhaust Tuner")
            .with_window_icon(icon)
            .with_inner_size(LogicalSize::new(1400.0, 950.0))
            .with_min_inner_size(LogicalSize::new(420.0, 400.0))
            .with_theme(Some(if dark { Theme::Dark } else { Theme::Light }))
            .build(&event_loop)
        {
            Ok(w) => w,
            Err(e) => {
                message_box(&format!("The window could not open: {}", e));
                return;
            }
        };
        if let Some(m) = window.current_monitor() {
            let (ms, ws, mp) = (m.size(), window.outer_size(), m.position());
            window.set_outer_position(PhysicalPosition::new(
                mp.x + (ms.width as i32 - ws.width as i32).max(0) / 2,
                mp.y + (ms.height as i32 - ws.height as i32).max(0) / 2,
            ));
        }

        let ui = Arc::new(WindowUi { proxy: Mutex::new(event_loop.create_proxy()) });
        let previous = PREVIOUS_VERSION.lock().unwrap().clone();
        let updater = Updater::new(&paths, version(), None, None, None, previous.as_deref());
        let dispatcher = Arc::new(Dispatcher::new(Arc::clone(&paths), ui.clone(), updater));
        let post_proxy = Mutex::new(event_loop.create_proxy());
        let router = Arc::new(MessageRouter::new(
            dispatcher,
            Arc::new(move |json: String| {
                let _ = post_proxy.lock().unwrap().send_event(Ev::Post(json));
            }),
        ));

        let web = paths.web_dir();
        // app.html is index.html wrapped in a full document at build time (web/make_palette.py), so the page renders
        // in standards mode; a development folder without it falls back to the bare page
        let start = if web.join("app.html").is_file() { "app.html" } else { "index.html" };
        let mut context = WebContext::new(Some(paths.data_root.join("WebView2")));
        let bg = if dark { DARK_BG } else { LIGHT_BG };
        let data_root = paths.data_root.clone();
        let web_srv = web.clone();
        let r = Arc::clone(&router);
        let test_proxy = Mutex::new(event_loop.create_proxy());
        let testing = selftest.is_some();
        let webview = WebViewBuilder::new_with_web_context(&mut context)
            .with_https_scheme(true)
            .with_custom_protocol("app".into(), move |_id, req| serve(&web_srv, &req))
            .with_initialization_script(bridge_script())
            .with_initialization_script(if testing { SELFTEST_JS } else { "" })
            .with_ipc_handler(move |req: Request<String>| {
                // only the bundled page may drive the solvers
                if !is_app(&req.uri().to_string()) {
                    return;
                }
                let body = req.into_body();
                if testing && body.contains("\"__selftest\"") {
                    let _ = test_proxy.lock().unwrap().send_event(Ev::SelfTest(body));
                    return;
                }
                let r = Arc::clone(&r);
                std::thread::spawn(move || r.handle(&body));
            })
            // links to outside pages (sources, part catalogues) open in the normal browser
            .with_navigation_handler(|url: String| {
                if is_app(&url) {
                    return true;
                }
                open_external(&url);
                false
            })
            .with_new_window_req_handler(|url: String, _f| {
                open_external(&url);
                NewWindowResponse::Deny
            })
            .with_on_page_load_handler(move |ev, _url| {
                if matches!(ev, PageLoadEvent::Finished) {
                    // the start record gets the outcome: the Windows build checks that the installed window loads the page
                    use std::io::Write;
                    if let Ok(mut f) = std::fs::OpenOptions::new().append(true).create(true).open(data_root.join(start_record::FILE_NAME)) {
                        let _ = writeln!(f, "page loaded {}", utc_now_o());
                    }
                }
            })
            .with_devtools(true)
            .with_background_color((bg.0, bg.1, bg.2, 255))
            .with_url(format!("{}{}", ORIGIN_RAW, start))
            .build(&window);
        let webview = match webview {
            Ok(w) => w,
            Err(e) => {
                if let Some(f) = &selftest {
                    let _ = std::fs::write(f, format!("no-webview2 {}\n", e));
                    return;
                }
                message_box(&format!(
                    "This program shows the calculator with Microsoft Edge WebView2, which did not start on this PC ({}).\n\n\
                     Install the Evergreen WebView2 Runtime from Microsoft (go.microsoft.com/fwlink/p/?LinkId=2124703), then start Exhaust Tuner again.",
                    e
                ));
                return;
            }
        };

        let quit_proxy = Mutex::new(event_loop.create_proxy());
        event_loop.run(move |event, _target, control_flow| {
            *control_flow = ControlFlow::Wait;
            let _ = &context; // the web context lives as long as the window
            match event {
                Event::UserEvent(Ev::Post(json)) => {
                    let _ = webview.evaluate_script(&format!("window.__exhaustTunerHostReceive&&window.__exhaustTunerHostReceive({})", json));
                }
                Event::UserEvent(Ev::Theme(d)) => {
                    if d != dark {
                        dark = d;
                        window.set_theme(Some(if d { Theme::Dark } else { Theme::Light }));
                    }
                }
                Event::UserEvent(Ev::DevTools) => webview.open_devtools(),
                Event::UserEvent(Ev::PickFolder(title, tx)) => {
                    let _ = tx.send(rfd::FileDialog::new().set_title(&title).set_parent(&window).pick_folder());
                }
                Event::UserEvent(Ev::PickSave(title, name, tx)) => {
                    let mut d = rfd::FileDialog::new().set_title(&title).set_parent(&window).set_file_name(&name);
                    if let Some(ext) = Path::new(&name).extension().and_then(|e| e.to_str()) {
                        d = d.add_filter(format!("{} file", ext.to_uppercase()), &[ext]);
                    }
                    let _ = tx.send(d.add_filter("All files", &["*"]).save_file());
                }
                Event::UserEvent(Ev::Quit) => {
                    let p = quit_proxy.lock().unwrap().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(600));
                        let _ = p.send_event(Ev::Exit);
                    });
                }
                Event::UserEvent(Ev::SelfTest(body)) => {
                    let v: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
                    let d = &v["data"];
                    let line = if d["ok"] == serde_json::Value::Bool(true) {
                        format!("ok {} desktop={}\n", d["version"].as_str().unwrap_or(""), d["desktop"])
                    } else {
                        format!("failed {}\n", d["error"])
                    };
                    if let Some(f) = &selftest {
                        let _ = std::fs::write(f, line);
                    }
                    *control_flow = ControlFlow::Exit;
                }
                Event::UserEvent(Ev::Exit) => *control_flow = ControlFlow::Exit,
                Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => *control_flow = ControlFlow::Exit,
                _ => {}
            }
        });
    }
}
