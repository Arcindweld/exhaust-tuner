// Injected by the Exhaust Tuner desktop program before the page loads. Gives the page
// window.exhaustTunerHost.call(action, data, onEvent) -> Promise (with .id and .cancel()) and cancel([id]), over the program's message channel: window.ipc in
// the Rust window (rust/et_app, which answers through window.__exhaustTunerHostReceive), or WebView2's
// window.chrome.webview as the C# program had it (and as the browser tests stand it in).
(function () {
  if (window.exhaustTunerHost) return;
  var wv = window.chrome && window.chrome.webview;
  var hasIpc = function () { return window.ipc && typeof window.ipc.postMessage === 'function'; };
  if (!wv && !hasIpc()) return;
  var seq = 0, pending = {}, listeners = {};
  function receive(m) {
    if (!m || m.id == null) return;
    if (m.event) { var l = listeners[m.id]; if (l) { try { l(m); } catch (err) { console.error(err); } } return; }
    var p = pending[m.id]; if (!p) return;
    delete pending[m.id]; delete listeners[m.id];
    if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'The request failed.'));
  }
  if (wv) wv.addEventListener('message', function (e) { receive(e.data); });
  window.__exhaustTunerHostReceive = receive;
  // window.ipc, when the program has one, is decided at each call: its script may run after this one
  function post(o) { if (hasIpc()) window.ipc.postMessage(JSON.stringify(o)); else wv.postMessage(o); }
  function cancel(id) { post({ id: 0, action: 'cancel', data: id == null ? {} : { id: id } }); }
  window.exhaustTunerHost = {
    version: '__VERSION__',
    call: function (action, data, onEvent) {
      var id = ++seq;
      var p = new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        if (onEvent) listeners[id] = onEvent;
        post({ id: id, action: action, data: data || {} });
      });
      p.id = id;
      p.cancel = function () { cancel(id); };   // stops this request only
      return p;
    },
    // cancel(id) stops that request; cancel() stops every running request, as before
    cancel: function (id) { cancel(id); },
    cancelsById: true
  };
})();
