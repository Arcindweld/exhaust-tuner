// Injected by the Exhaust Tuner desktop program before the page loads. Gives the page
// window.exhaustTunerHost.call(action, data, onEvent) -> Promise, over WebView2's message channel.
(function () {
  if (!window.chrome || !window.chrome.webview || window.exhaustTunerHost) return;
  var wv = window.chrome.webview, seq = 0, pending = {}, listeners = {};
  wv.addEventListener('message', function (e) {
    var m = e.data; if (!m || m.id == null) return;
    if (m.event) { var l = listeners[m.id]; if (l) { try { l(m); } catch (err) { console.error(err); } } return; }
    var p = pending[m.id]; if (!p) return;
    delete pending[m.id]; delete listeners[m.id];
    if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'The request failed.'));
  });
  window.exhaustTunerHost = {
    version: '__VERSION__',
    call: function (action, data, onEvent) {
      var id = ++seq;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        if (onEvent) listeners[id] = onEvent;
        wv.postMessage({ id: id, action: action, data: data || {} });
      });
    },
    cancel: function () { wv.postMessage({ id: 0, action: 'cancel', data: {} }); }
  };
})();
