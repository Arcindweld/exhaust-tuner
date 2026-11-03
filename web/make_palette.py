# Wrap the artifact page into a full HTML document for the Fusion palette.
import sys
src, dst = sys.argv[1], sys.argv[2]
h = open(src, encoding='utf-8').read()
i = h.find('</style>')
assert i > 0 and h.lstrip().startswith('<title>')
head, body = h[:i + len('</style>')], h[i + len('</style>'):]
# runs before the page script: records load errors, and answers the add-in's probe even if the main script never runs
early = ('<script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message||e)+" @"+(e.lineno||"")+":"+(e.colno||""));});'
         'window.fusionJavaScriptHandler={handle:function(a,d){return JSON.stringify({early:true,errs:window.__errs,adsk:typeof window.adsk,'
         'send:window.adsk?typeof window.adsk.fusionSendData:"none",ua:navigator.userAgent});}};</script>\n')
doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
       + early + head + '\n</head>\n<body>' + body.rstrip() + '\n</body>\n</html>\n')
open(dst, 'w', encoding='utf-8', newline='\n').write(doc)   # LF on every OS, as the page itself
print('palette', len(doc))
