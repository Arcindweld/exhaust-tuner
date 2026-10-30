// Type selector: cars/trucks vs motorcycles in both picker modes
const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch(); const fails=[]; const ok=(c,m)=>{ if(!c) fails.push(m); console.log((c?'PASS ':'FAIL ')+m); };
  const p=await b.newPage({viewport:{width:1200,height:900}}); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+__dirname+'/../index.html'); await p.waitForTimeout(600);
  const set=async(id,v)=>p.evaluate(([id,v])=>{ const el=document.getElementById(id); el.value=v; el.dispatchEvent(new Event('change',{bubbles:true})); },[id,v]);
  const opts=async()=>p.$$eval('#v-pick option',os=>os.map(o=>o.textContent).filter((t,i)=>i>0));
  const groups=async()=>p.$$eval('#v-pick optgroup',gs=>gs.map(g=>g.label));
  const makers=async()=>p.$$eval('#v-make option',os=>os.map(o=>o.textContent));
  // default: cars and trucks
  let o=await opts(), g=await groups(), m=await makers();
  ok(o.length>300, 'cars: '+o.length+' presets');
  ok(!g.some(x=>/bike|Motocross|Two-stroke/i.test(x)), 'cars: no bike groups ('+g.length+' groups)');
  ok(!o.some(x=>/Ducati|Yamaha YZF|Kawasaki Ninja|Suzuki GSX/i.test(x)), 'cars: no bikes in the list');
  ok(!m.some(x=>/Ducati|Aprilia|Triumph/.test(x)), 'cars: maker list has no bike makers');
  ok(/Stock car or truck/.test(await p.$eval('#v-pick-lab',e=>e.textContent)), 'cars: label');
  // motorcycles
  await set('v-class','bike'); o=await opts(); g=await groups(); m=await makers();
  ok(o.length>300, 'bikes: '+o.length+' presets');
  ok(g.every(x=>/bike|Motocross|Two-stroke/i.test(x)), 'bikes: only bike groups ('+g.join(' | ')+')');
  ok(o.some(x=>/Ducati/.test(x))&&o.some(x=>/GT750/.test(x))&&!o.some(x=>/Mustang|Corvette/.test(x)), 'bikes: Ducati and GT750 in, Mustang out');
  ok(m.some(x=>/Ducati/.test(x))&&!m.some(x=>/Chevrolet|Ford/.test(x)), 'bikes: maker list is bikes only');
  ok(/Stock motorcycle/.test(await p.$eval('#v-pick-lab',e=>e.textContent)), 'bikes: label');
  // pick a bike and check it applies
  const duc=await p.$$eval('#v-pick option',os=>{ const x=os.find(o=>/Panigale/.test(o.textContent)); return x&&x.value; });
  await set('v-pick',duc);
  ok(/Panigale/.test(await p.$eval('#v-note',e=>e.textContent)), 'bikes: picking a Panigale fills the note');
  ok((await p.inputValue('#m-size'))==='2', 'bikes: muffler size set to bike');
  // maker filter inside bikes
  await set('v-make','Ducati'); o=await opts();
  ok(o.length>5&&o.every(x=>/Ducati/.test(x)), 'bikes: Ducati filter ('+o.length+')');
  // engine-only, bikes
  await set('v-mode','eng'); o=await opts(); g=await groups();
  ok(/Motorcycle engine/.test(await p.$eval('#v-pick-lab',e=>e.textContent)), 'eng bikes: label');
  ok(o.length>100&&g.every(x=>/Ducati|Aprilia|Triumph|Honda|Yamaha|Kawasaki|Suzuki|BMW|KTM|MV Agusta|Harley|Buell|Indian|Moto Guzzi|Royal Enfield|Husqvarna|GasGas|Bimota|Beta|Sherco|Cagiva|Laverda|Benelli|CFMoto|Norton|Vespa|Zero|Can-Am|Victory|Moto Morini|Fantic|TM|Rieju|Stark|Energica|Aprilia/.test(x)), 'eng bikes: '+o.length+' engines, bike makers only ('+g.slice(0,4).join(' | ')+')');
  ok(!o.some(x=>/LS3|Coyote|Hemi/.test(x)), 'eng bikes: no car crate motors');
  // engine-only, cars
  await set('v-class','car'); o=await opts(); g=await groups();
  ok(o.some(x=>/LS3/.test(x))&&!o.some(x=>/Panigale|CBR1000/.test(x)), 'eng cars: LS3 in, bikes out ('+o.length+')');
  ok(/Car or truck engine/.test(await p.$eval('#v-pick-lab',e=>e.textContent)), 'eng cars: label');
  // phone width, no sideways scroll
  await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(200);
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1), 'phone: no sideways scroll');
  ok(errs.length===0, 'no page errors '+errs.join(' | '));
  console.log(fails.length?'FAILS '+fails.length:'all passed'); await b.close();
})();
