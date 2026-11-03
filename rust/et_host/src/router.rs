//! MessageRouter.cs: turns the page's messages ({id, action, data}) into dispatcher calls and posts back
//! {id, ok, result | error} plus {id, event, ...} progress messages. "cancel" stops every running request.

use crate::dispatcher::Dispatcher;
use crate::{version, Cancel, HostError};
use serde_json::{Map, Value};
use std::sync::{Arc, Mutex};

/// The script the window runs in the page before it loads: window.exhaustTunerHost.call(action, data, onEvent).
/// The C# program's HostBridge.js, extended to the Rust window's channel (window.ipc), so the page sees the same API.
pub fn bridge_script() -> String {
    include_str!("host_bridge.js").replace("__VERSION__", version())
}

pub type Post = Arc<dyn Fn(String) + Send + Sync>;

pub struct MessageRouter {
    dispatcher: Arc<Dispatcher>,
    post: Post,
    cancel: Mutex<Cancel>,
}

impl MessageRouter {
    pub fn new(dispatcher: Arc<Dispatcher>, post: Post) -> MessageRouter {
        MessageRouter { dispatcher, post, cancel: Mutex::new(Cancel::new()) }
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
            let old = std::mem::replace(&mut *self.cancel.lock().unwrap(), Cancel::new());
            old.cancel();
            return;
        }
        let cancel = self.cancel.lock().unwrap().clone();
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
