//! MessageRouter.cs: turns the page's messages ({id, action, data}) into dispatcher calls and posts back
//! {id, ok, result | error} plus {id, event, ...} progress messages. "cancel" with data {id} stops that one request
//! (the page's bridge sends it from the promise's .cancel()); "cancel" without an id stops every running request.

use crate::dispatcher::Dispatcher;
use crate::{version, Cancel, HostError};
use serde_json::{Map, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The script the window runs in the page before it loads: window.exhaustTunerHost.call(action, data, onEvent).
/// The C# program's HostBridge.js, extended to the Rust window's channel (window.ipc), so the page sees the same API.
pub fn bridge_script() -> String {
    include_str!("host_bridge.js").replace("__VERSION__", version())
}

pub type Post = Arc<dyn Fn(String) + Send + Sync>;

/// How long a stop for an id that is not running yet is kept: each message is handled on its own thread, so a stop
/// sent right after its request can be handled before that request has started.
const EARLY_STOP: Duration = Duration::from_secs(2);

#[derive(Default)]
struct Running {
    serial: u64,
    runs: Vec<(String, u64, Cancel)>, // (request id, serial, its stop)
    early: Vec<(String, Instant)>,    // stops for ids that were not running when they came
}

/// The request id as a key: "5" for both 5 and "5".
fn key(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        o => o.to_string(),
    }
}

pub struct MessageRouter {
    dispatcher: Arc<Dispatcher>,
    post: Post,
    running: Mutex<Running>,
}

impl MessageRouter {
    pub fn new(dispatcher: Arc<Dispatcher>, post: Post) -> MessageRouter {
        MessageRouter { dispatcher, post, running: Mutex::new(Running::default()) }
    }

    /// "cancel": with an id only that request (an id that is not running stops nothing else), without one all of them.
    fn stop(&self, id: Option<&Value>) {
        let mut r = self.running.lock().unwrap();
        match id.filter(|v| !v.is_null()) {
            None => r.runs.iter().for_each(|(_, _, c)| c.cancel()),
            Some(v) => {
                let k = key(v);
                let mut hit = false;
                for (_, _, c) in r.runs.iter().filter(|(i, _, _)| *i == k) {
                    c.cancel();
                    hit = true;
                }
                if !hit {
                    r.early.retain(|(_, t)| t.elapsed() < EARLY_STOP);
                    r.early.push((k, Instant::now()));
                }
            }
        }
    }

    /// Handles one message (the JSON the window hands over). Returns when the request is finished; run each on its
    /// own thread so a long run does not hold up the next request.
    pub fn handle(&self, json: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(json) else { return };
        let (Some(id), Some(action)) = (msg.get("id").filter(|v| !v.is_null()).cloned(), msg.get("action").and_then(|a| a.as_str()).map(|s| s.to_string()))
        else {
            return;
        };
        if action == "cancel" {
            self.stop(msg.get("data").and_then(|d| d.get("id")));
            return;
        }
        let cancel = Cancel::new();
        let k = key(&id);
        let serial = {
            let mut r = self.running.lock().unwrap();
            r.serial += 1;
            let n = r.serial;
            r.runs.push((k.clone(), n, cancel.clone()));
            r.early.retain(|(_, t)| t.elapsed() < EARLY_STOP);
            if let Some(i) = r.early.iter().position(|(e, _)| *e == k) {
                r.early.remove(i);
                cancel.cancel();
            }
            n
        };
        let post = Arc::clone(&self.post);
        let send = move |mut o: Map<String, Value>| {
            o.insert("id".into(), id.clone()); // last, as the C# program adds it
            post(Value::Object(o).to_string());
        };
        let ev = |e: Value| {
            if let Value::Object(m) = e {
                send(m);
            }
        };
        let data = msg.get("data").cloned().unwrap_or(Value::Null);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.dispatcher.dispatch(&action, &data, &ev, &cancel)))
            .unwrap_or_else(|_| Err(HostError::Msg("The request failed inside the program.".into())));
        self.running.lock().unwrap().runs.retain(|(_, n, _)| *n != serial);
        let mut o = Map::new();
        match r {
            Ok(result) => {
                o.insert("ok".into(), true.into());
                o.insert("result".into(), result);
            }
            Err(e) => {
                o.insert("ok".into(), false.into());
                o.insert("error".into(), e.to_string().into());
            }
        }
        send(o);
    }
}
