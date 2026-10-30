const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch(); const fails=[]; const ok=(c,m)=>{ if(!c) fails.push(m); console.log((c?'PASS ':'FAIL ')+m); };
  const ctx=await b.newContext({viewport:{width:1300,height:900}});
  await ctx.addInitScript(()=>{ window.__sent=[]; window.adsk={fusionSendData:(action,data)=>{ window.__sent.push([action,JSON.parse(data)]); return Promise.resolve(JSON.stringify({ok:true,items:[],msg:'stub'})); }}; });
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+__dirname+'/../index.html'); await p.waitForTimeout(800);
  const set=async(id,v)=>p.evaluate(([id,v])=>{ const el=document.getElementById(id); el.value=v; el.dispatchEvent(new Event('change',{bubbles:true})); },[id,v]);
  await set('v-class','car'); await set('v-mode','veh'); await set('v-make','Subaru');
  const r=await p.evaluate(()=>{
    const opts=[...document.getElementById('v-pick').options]; const o=opts.find(o=>/2004 Subaru Outback/.test(o.textContent));
    return {found:!!o, val:o&&o.value, grp:o&&o.parentElement.label, n:opts.length};
  });
  ok(r.found,'Outback preset listed for Subaru ('+r.n+' options)');
  ok(/Everyday cars and trucks/.test(r.grp||''),'group label: '+r.grp);
  await set('v-pick',r.val);
  const a=await p.evaluate(()=>({eng:document.getElementById('s-eng').value, disp:document.getElementById('s-disp').value, idle:document.getElementById('s-idle').value, red:document.getElementById('s-red').value, hp:document.getElementById('s-hp')&&document.getElementById('s-hp').value}));
  ok(a.eng==='f4'&&(Math.round(+a.disp)===2457||Math.abs(+a.disp-149.9)<0.2)&&+a.idle===700&&+a.red===6500,'applies to the engine tab: '+JSON.stringify(a));
  await set('v-class','bike'); await set('v-make','');
  const bike=await p.evaluate(()=>[...document.getElementById('v-pick').options].some(o=>/Outback/.test(o.textContent)));
  ok(!bike,'not in the motorcycle list');
  await set('v-class','car');
  // headers tab button
  await p.evaluate(()=>{ const t=[...document.querySelectorAll('[data-tab]')].find(x=>x.dataset.tab==='headers'&&x.tagName!=='BUTTON'||x.dataset.tab==='headers'); if(t) t.click(); });
  const call=await p.evaluate(async()=>{
    window.__sent.length=0; const got=window.__sent;
    const btn=document.querySelector('button[data-fx="routeBundle180"]'); if(!btn) return {nobtn:true, fx:[...document.querySelectorAll('button[data-fx]')].map(b=>b.dataset.fx).slice(0,12)};
    const eng=document.getElementById('s-eng'); eng.value='f4';
    btn.click(); await new Promise(r=>setTimeout(r,50));
    const msg4=document.getElementById('fx-out-headers').textContent;
    eng.value='ls'; btn.click(); await new Promise(r=>setTimeout(r,150));
    return {got:got.map(x=>[x[0],x[1].mode,String(x[1].order),x[1].title]), msg4, txt:btn.textContent};
  });
  ok(!call.nobtn,'button rendered '+(call.fx?JSON.stringify(call.fx):call.txt));
  ok(/V8/.test(call.msg4||'')&&call.got&&call.got.length===1,'refuses a flat-4, calls Fusion for the LS: '+JSON.stringify(call.got)+' / '+(call.msg4||'').slice(0,70));
  ok(call.got&&call.got[0]&&call.got[0][1]==='bundle180'&&call.got[0][2]==='1,8,7,2,6,5,4,3','payload mode bundle180 with the LS firing order');
  ok(errs.length===0,'no page errors '+errs.join(' | '));
  await b.close(); console.log(fails.length?'FAILS '+fails.length:'all passed'); process.exit(fails.length?1:0);
})();
