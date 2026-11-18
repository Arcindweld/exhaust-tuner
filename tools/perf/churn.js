// how much of each innerHTML write changes between two consecutive edits
const { chromium } = require('playwright'); const serve=require('./serve'); const {settle}=require('../../web/tests/settle');
const [file, tab, id, v1, v2] = process.argv.slice(2);
(async()=>{ const S=await serve(file); const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:900}}); await pg.goto(S.url+'#'+tab); await pg.waitForTimeout(800); await settle(pg);
if (tab === 'intake') { await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
  s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); s('i-ind', 'turbo'); }); await settle(pg); }
const r = await pg.evaluate(async ([id,v1,v2])=>{ const W=[]; const d=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
 Object.defineProperty(Element.prototype,'innerHTML',{configurable:true,get:d.get,set(v){ W.push([this.id||this.className||this.tagName, v, !!this.closest('[role=tabpanel]:not([hidden])')]); d.set.call(this,v);} });
 const ed=v=>{ const el=document.getElementById(id); el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); };
 ed(v1); const a=W.splice(0); ed(v2); const c=W.splice(0); const out=[];
 const kids=s=>{ const t=document.createElement('template'); t.innerHTML=s; return [...t.content.childNodes].map(n=>n.outerHTML||n.textContent); };
 const leaves=s=>{ const t=document.createElement('template'); t.innerHTML=s; const w=document.createTreeWalker(t.content,NodeFilter.SHOW_TEXT); const o=[]; let n; while((n=w.nextNode())) o.push(n.nodeValue); return o; };
 for(let i=0;i<c.length;i++){ const [nm,s,vis]=c[i]; const p=a[i]&&a[i][0]===nm?a[i][1]:null; if(s.length<200) continue;
   const k1=p?kids(p):[], k2=kids(s); let same=0; for(let j=0;j<k2.length;j++) if(k1[j]===k2[j]) same++;
   const l1=p?leaves(p):[], l2=leaves(s); let ls=0; for(let j=0;j<l2.length;j++) if(l1[j]===l2[j]) ls++;
   out.push([nm, vis?'vis':'hid', s.length, p===s?'SAME':'diff', 'kids '+same+'/'+k2.length, 'text '+ls+'/'+l2.length]);
 if(s.length>30000) for(let j=0;j<k2.length;j++){ const t2=document.createElement('template'); t2.innerHTML=k2[j]; const e2=t2.content.firstChild; const lbl=(e2&&e2.querySelector&&((e2.querySelector('h3')||{}).textContent||e2.id||e2.className))||''; let sub=''; if(k1[j]!==k2[j]&&k1[j]){ const t1=document.createElement('template'); t1.innerHTML=k1[j]; const a1=[...(t1.content.firstChild.childNodes||[])].map(n=>n.outerHTML||n.textContent), a2=[...(e2.childNodes||[])].map(n=>n.outerHTML||n.textContent); let ss=0, sb=0; a2.forEach((x,q)=>{ if(a1[q]===x){ss++; sb+=x.length;} }); sub=' sub same '+ss+'/'+a2.length+' bytes '+sb; } out.push(['   ', j, k2[j].length, k1[j]===k2[j]?'same':'DIFF'+sub, String(lbl).slice(0,50)]); } }
 return out; }, [id,v1,v2]);
for (const x of r) console.log(x.join('  ')); await b.close(); S.close(); })();
