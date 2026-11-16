p='/home/claude/wt-spec/web/index.html'; s=open(p,encoding='utf-8').read()
# D: run key without the fuel
old="const simKey=q=>JSON.stringify(q);"
assert s.count(old)==1
s=s.replace(old,"""// the run key: the inputs, and the Intake tab's fuel, mixture and evaporation that fuelSpec adds to the spec (2026-11-16,
// docs/SPEC_PARITY_AUDIT_2026-11-16.md D3: before, a finished run stayed "current" after the fuel changed)
const simKey=q=>JSON.stringify(q)+(typeof fuelSig==='function'?fuelSig():'');""")
# D: Headers layout's port without the head's port law
old="for(let c=1;c<=N;c++){ per_cyl.push(pos([{L:port,d0:dPort,d1:dPort,primary:true},{L:(eq?d0.prim:by[c].prim)/1000,d0:dp,d1:dp,primary:true}])); phases.push(ang[c]); }"
assert s.count(old)==1
s=s.replace(old,"""// port: true: the head's exhaust port law, as simSpec marks its port (2026-11-16, docs/SPEC_PARITY_AUDIT_2026-11-16.md D2: from
  // part 7, 2026-11-13, the Headers layout's ports ran as plain pipe while the 4-Stroke tab's design had the law)
  for(let c=1;c<=N;c++){ per_cyl.push(pos([{L:port,d0:dPort,d1:dPort,primary:true,port:true},{L:(eq?d0.prim:by[c].prim)/1000,d0:dp,d1:dp,primary:true}])); phases.push(ang[c]); }""")
open(p,'w',encoding='utf-8').write(s)
print('ok')
s=open(p,encoding='utf-8').read()
old="""    per=base.exhaust.segs.slice(); colSegs=base.opt.collector?base.opt.collector.segs.slice():[];"""
assert s.count(old)==1
s=s.replace(old,"""    per=base.exhaust.segs.slice(); colSegs=base.opt.collector?base.opt.collector.segs.slice():[];
    // the 4-Stroke tab's chamber on its primaries comes along with them (2026-11-16, docs/SPEC_PARITY_AUDIT_2026-11-16.md D4: it
    // was left out, so a supercharged or manifold-less turbo run of a header with a chamber ran without it)
    chambers=(base.exhaust.chambers||[]).slice();""")
old="  let per=null, colSegs=null, scrolls=null, man='';"
assert s.count(old)==1
s=s.replace(old,"  let per=null, colSegs=null, scrolls=null, man='', chambers=[];")
old="  const exhaust={segs:per,Tw:Ts};"
assert s.count(old)==1
s=s.replace(old,"  const exhaust=Object.assign({segs:per,Tw:Ts},chambers.length?{chambers}:{});")
old="  let naEx={segs:per.concat(n>1?[]:(turbo?down.segs:[])),Tw:Ts,pOut:p4};"
assert s.count(old)==1
s=s.replace(old,"  let naEx=Object.assign({segs:per.concat(n>1?[]:(turbo?down.segs:[])),Tw:Ts,pOut:p4},chambers.length?{chambers}:{});")
open(p,'w',encoding='utf-8').write(s)
print('ok2')
