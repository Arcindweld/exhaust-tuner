// node trace.js FILE TAB : browser-side breakdown of edits (style recalc, layout, parse) from a devtools.timeline trace
const { chromium } = require('playwright'); const {settle}=require('../../web/tests/settle');
const file=process.argv[2], tab=process.argv[3];
const CASES = { hangers: ['hg-od', null], intake: ['i-hp', ['440', '450']], mufflers: ['m-f', null], 'four-stroke': ['f-rpm', ['6400', '6500']], headers: ['h-rpm', ['6400', '6500']], sound: ['s-red', ['6400', '6500']] };
(async()=>{ const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:900}}); await pg.goto('file://'+file+'#'+tab); await pg.waitForTimeout(700);
 await pg.addStyleTag({ content: ":root{--f-ui:'Liberation Sans',Arial,sans-serif!important;--f-display:'Liberation Sans',Arial,sans-serif!important}" }); await settle(pg);
 if (tab === 'intake') { await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); s('i-ind', 'turbo'); }); await settle(pg); }
 const cdp=await pg.context().newCDPSession(pg); const ev=[]; cdp.on('Tracing.dataCollected',d=>ev.push(...d.value));
 const done=new Promise(r=>cdp.on('Tracing.tracingComplete',r));
 await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReportEvents'});
 const [id,vals]=CASES[tab];
 for(let i=0;i<10;i++){ await pg.evaluate(([id,v,i])=>{ const el=document.getElementById(id); el.value = v ? v[i % 2] : String((parseFloat(el.value) || 1) * (i % 2 ? 1 / 1.01 : 1.01)); performance.mark('e0'); el.dispatchEvent(new Event('input',{bubbles:true})); void document.body.offsetHeight; performance.mark('e1'); },[id,vals,i]); await settle(pg); }
 await cdp.send('Tracing.end'); await done;
 const marks=ev.filter(e=>e.cat.includes('user_timing')&&(e.name==='e0'||e.name==='e1')).sort((a,b)=>a.ts-b.ts); const win=[]; for(let i=0;i+1<marks.length;i++) if(marks[i].name==='e0'&&marks[i+1].name==='e1') win.push([marks[i].ts,marks[i+1].ts]);
 const S={}; for(const e of ev){ if(e.ph!=='X'||!e.dur) continue; if(!win.some(([a,b])=>e.ts>=a&&e.ts<=b)) continue; if(!['UpdateLayoutTree','Layout','ParseHTML','RecalculateStyles','PrePaint','HitTest','FunctionCall','EvaluateScript','V8.GC_SCAVENGER','MinorGC','MajorGC'].includes(e.name)) continue; S[e.name]=(S[e.name]||0)+e.dur/1000; }
 const tot=win.reduce((a,[x,y])=>a+(y-x)/1000,0);
 console.log(tab,'edits',win.length,'avg total',(tot/win.length).toFixed(1)); for(const [k,v] of Object.entries(S)) console.log('  ',k.padEnd(18),(v/win.length).toFixed(1));
 await b.close(); })();
