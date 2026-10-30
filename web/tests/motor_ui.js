// Engine-only picker: switch mode, pick a motor, check the fields and note
const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch(), p=await b.newPage({viewport:{width:1200,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+__dirname+'/../index.html');
  const r=await p.evaluate(()=>{
    const out={};
    const set=(id,v)=>{ const el=document.getElementById(id); el.value=v; el.dispatchEvent(new Event('change',{bubbles:true})); };
    set('v-mode','eng');
    out.label=document.getElementById('v-pick-lab').textContent;
    out.makers=[...document.getElementById('v-make').options].map(o=>o.text);
    const opts=[...document.getElementById('v-pick').options];
    out.n=opts.length-1;
    out.groups=[...document.querySelectorAll('#v-pick optgroup')].map(g=>g.label).slice(0,6);
    const ls=opts.find(o=>/LS6|LS3|Coyote/i.test(o.text));
    out.pick=ls&&ls.text;
    set('v-pick',ls.value);
    out.sEng=document.getElementById('s-eng').value;
    out.fDisp=document.getElementById('f-disp').value;
    out.note=document.getElementById('v-note').textContent.slice(0,260);
    // maker filter
    set('v-make','Ford');
    out.fordN=document.getElementById('v-pick').options.length-1;
    out.fordAllFord=[...document.getElementById('v-pick').options].slice(1).every(o=>/Ford|Shelby|Coyote|Boss|SVT|Mustang|Windsor|FE|302|Cobra|Voodoo|Godzilla|EcoBoost|Barra|Trinity|Predator|Modular|Mod|flat/i.test(o.text));
    // back to vehicles
    set('v-mode','veh');
    out.vehLabel=document.getElementById('v-pick-lab').textContent;
    out.vehN=document.getElementById('v-pick').options.length-1;
    out.dups=(()=>{ const s=new Set(); let d=0; [...document.getElementById('v-pick').options].forEach(o=>{ if(s.has(o.text)) d++; s.add(o.text); }); return d; })();
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  console.log('page errors:',errs);
  const ok=errs.length===0&&r.n>50&&r.sEng&&r.note.indexOf('Engine-only')>=0&&r.label==='Car or truck engine'&&r.vehLabel==='Stock car or truck';
  console.log(ok?'PASS':'FAIL');
  await b.close();
})();
