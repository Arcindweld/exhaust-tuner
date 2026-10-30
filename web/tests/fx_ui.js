const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out=[];
  const ctx = await b.newContext({ viewport:{width:420,height:900}, colorScheme:'light' });
  await ctx.addInitScript(() => {
    window.__sent=[];
    window.adsk={fusionSendData:(action,data)=>{
      window.__sent.push([action,JSON.parse(data)]);
      const replies={
        measure:{ok:true,items:[
          {kind:'path',name:'Runner 1 path',length:72.4,lra:[{L:10.2,R:null,A:null,CLR:null},{L:8.0,R:0,A:90,CLR:7.62},{L:12.5,R:35,A:45,CLR:7.62}],bends:[7.62,7.62]},
          {kind:'path',name:'Runner 2 path',length:71.9},
          {kind:'body',name:'Primary tube',od:[4.7625],id:[4.4323],bends:[7.62],length:70.1,note:'Estimated from cylinder and torus faces.'}]},
        clearance:{ok:true,rows:[{a:'Primary tube',b:'Frame rail',d:0.9},{a:'Primary tube',b:'Oil pan',d:2.5}]},
        setKeepouts:{ok:true,msg:'2 keep-out bodies stored.'},
        pipe:{ok:true,msg:'Built a 1.875 in OD runner along the path (72.4 cm).'},
        build:{ok:true,msg:'Built Header runner.'},
        boom:{ok:true,msg:'Built boom tube along X in a new component.'}
      };
      return Promise.resolve(JSON.stringify(replies[action]||{ok:false,msg:'unknown'}));
    }};
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => out.push('PAGEERROR '+e.message));
  await pg.goto('file://'+process.cwd()+'/index.html#headers');
  out.push('fusionbar visible: '+await pg.isVisible('#fusionbar'));
  out.push('buttons: '+(await pg.$$eval('#fx-headers button[data-fx]',bs=>bs.map(b=>b.textContent))).join(' | '));
  await pg.click('#fx-headers button[data-fx="measure"]'); await pg.waitForTimeout(200);
  let t=await pg.textContent('#fx-out-headers'); out.push('measure out: '+t.replace(/\s+/g,' ').slice(0,420));
  // use button fills runner space and re-render keeps results
  await pg.click('#fx-out-headers button[data-target="h-maxrun"]'); await pg.waitForTimeout(150);
  out.push('h-maxrun after Use: '+await pg.inputValue('#h-maxrun')+' ; results still shown: '+((await pg.textContent('#fx-out-headers')).length>50));
  t=await pg.evaluate(()=>document.querySelector('#h-details').innerText); out.push('fit: '+((t.match(/FIT TO YOUR SPACE\n[^\n]*/)||[''])[0]).replace(/\n/g,' ').slice(0,300));
  await pg.click('#fx-headers button[data-fx="setKeepouts"]'); await pg.waitForTimeout(100);
  await pg.click('#fx-headers button[data-fx="clearance"]'); await pg.waitForTimeout(150);
  out.push('clearance: '+(await pg.textContent('#fx-out-headers')).replace(/\s+/g,' ').slice(0,200));
  await pg.click('#fx-headers button[data-fx="pipe"]'); await pg.waitForTimeout(100);
  const sent=await pg.evaluate(()=>window.__sent.map(([a,d])=>a+':'+Object.keys(d).join(',')));
  out.push('sent: '+sent.join(' ; '));
  const pipePay=await pg.evaluate(()=>window.__sent.find(x=>x[0]==='pipe')[1]);
  out.push('pipe payload: '+JSON.stringify({od:pipePay.od_mm,wall:pipePay.wall_mm,target:pipePay.target_mm,gap:pipePay.gap_cm}));
  // boom tube and cats tabs
  await pg.evaluate(()=>location.hash='boom-tubes'); await pg.waitForTimeout(150);
  out.push('boom buttons: '+(await pg.$$eval('#fx-boom button[data-fx]',bs=>bs.map(b=>b.textContent))).join(' | '));
  await pg.click('#fx-boom button[data-fx="boom"]'); await pg.waitForTimeout(150);
  const bp=await pg.evaluate(()=>window.__sent.filter(x=>x[0]==='boom').pop()[1]);
  out.push('boom payload: '+JSON.stringify({title:bp.title,stations:bp.stations.map(s=>s.map(v=>+v.toFixed(1))),wall:bp.wall_mm}));
  out.push('boom out: '+(await pg.textContent('#fx-out-boom')).replace(/\s+/g,' ').slice(0,120));
  await pg.click('#fx-boom button[data-fx="measure"]'); await pg.waitForTimeout(150);
  out.push('boom use buttons: '+(await pg.$$eval('#fx-out-boom button[data-use]',bs=>bs.map(b=>b.textContent))).join(' | '));
  await pg.evaluate(()=>location.hash='cats'); await pg.waitForTimeout(150);
  out.push('cat buttons: '+(await pg.$$eval('#fx-cat button[data-fx]',bs=>bs.map(b=>b.textContent))).join(' | '));
  await pg.click('#fx-cat button[data-fx="measure"]'); await pg.waitForTimeout(150);
  out.push('cat use buttons: '+(await pg.$$eval('#fx-out-cat button[data-use]',bs=>bs.map(b=>b.textContent))).join(' | '));
  await pg.evaluate(()=>location.hash='headers'); await pg.waitForTimeout(100);
  await pg.click('#m-expert'); await pg.waitForTimeout(100);
  out.push('expert mode, simple box hidden: '+!(await pg.isVisible('.explain')));
  await pg.screenshot({path:'fx-headers.png',fullPage:true});
  await pg.click('#m-simple');
  await pg.screenshot({path:'fx-headers-simple.png',fullPage:true});
  console.log(out.join('\n')); await b.close();
})();
