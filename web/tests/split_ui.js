const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1280,height:900}}); const out=[];
  pg.on('pageerror',e=>out.push('PAGEERROR '+e.message));
  await pg.goto('file://'+process.cwd()+'/index.html#sound'); await pg.click('#m-expert');
  const setv=async(id,v)=>{ await pg.fill('#'+id,String(v)); await pg.dispatchEvent('#'+id,'input'); };
  // CBX-like: Honda CBX preset, then a split system
  await pg.selectOption('#v-class','bike'); await pg.waitForTimeout(100);   // presets are split into cars and bikes (V30)
  const v=await pg.$$eval('#v-pick option',os=>os.find(o=>/CBX/.test(o.textContent)).value); await pg.selectOption('#v-pick',v);
  await pg.selectOption('#s-lay','secs'); await pg.selectOption('#s-nsec','6');
  const rows=[['main','pipe',30,1.25],['main','pipe',10,2.52],['a','pipe',12,2.09],['a','box',14,4],['b','pipe',14,2.09],['b','box',14,4]];
  for(let i=0;i<rows.length;i++){ const [part,kind,L,D]=rows[i], n=i+1; await pg.selectOption('#s-p'+n,part); await pg.selectOption('#s-k'+n,kind); await setv('s-L'+n,L); await pg.selectOption('#s-sh'+n,'round'); await setv('s-W'+n,D); }
  await pg.waitForTimeout(300);
  const key=async()=>(await pg.innerText('#sound-key')).replace(/\n+/g,' | ');
  out.push('CBX split key: '+await key());
  let t=await pg.innerText('#panel-sound');
  out.push('caption: '+((t.match(/Worked out for your[^\n]*/)||['?'])[0]).slice(0,330));
  out.push('drone: '+((t.match(/(Change the last section of both branches[^\n]*|No tone crosses[^\n]*|No equal change[^\n]*)/)||['(none)'])[0]).slice(0,220));
  out.push('resonances: '+((t.match(/PIPE RESONANCES[\s\S]{0,260}/)||['?'])[0]).replace(/\s+/g,' ').slice(0,260));
  await setv('s-ttip',400); await pg.waitForTimeout(250); t=await pg.innerText('#panel-sound');
  out.push('with tip temp: label="'+await pg.textContent('#s-egt-lab')+'" '+((t.match(/Each section uses its own gas temperature[^\n]*/)||['?'])[0]).slice(0,260));
  out.push('key with cooling: '+await key());
  // Mufflers tab placement using the Sound sections
  await pg.evaluate(()=>location.hash='mufflers'); await pg.waitForTimeout(200);
  await pg.selectOption('#m-lay','secs'); await pg.waitForTimeout(250);
  t=await pg.innerText('#panel-muf');
  out.push('muf placement: '+((t.match(/PLACEMENT ALONG THE PIPE[\s\S]{0,520}/)||['?'])[0]).replace(/\s+/g,' ').slice(0,520));
  // error: branch A only
  await pg.evaluate(()=>location.hash='sound'); await pg.waitForTimeout(150);
  await pg.selectOption('#s-p5','a'); await pg.selectOption('#s-p6','a'); await pg.waitForTimeout(200);
  out.push('A only: '+await key());
  await pg.selectOption('#s-p1','a'); await pg.selectOption('#s-p2','b'); await pg.waitForTimeout(150);
  out.push('no main: '+await key());
  await pg.screenshot({path:'split-sound.png',fullPage:false});
  console.log(out.join('\n')); await b.close();
})();
