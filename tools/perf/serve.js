// serve(file, inject) -> {url, close}: the page from memory with a debug hook (window.__dbg(code,arg): direct eval in the page's IIFE)
const http = require('http'), fs = require('fs');
module.exports = function serve(file, hook = true) {
  let src = fs.readFileSync(file, 'utf8');
  if (hook) { const tail = '\nshowTab();\n})();\n</script>'; const i = src.lastIndexOf(tail); if (i < 0) throw new Error('no tail');
    src = src.slice(0, i) + '\nwindow.__dbg=function(__c,__a){ return eval(__c); };' + src.slice(i); }
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(src); });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ url: 'http://127.0.0.1:' + srv.address().port + '/index.html', close: () => srv.close() })));
};
