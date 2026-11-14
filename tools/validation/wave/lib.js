// Loads the page's 1-D wave model (wsFactory in web/index.html) into Node, the way web/tests/wave_wasm.js does, with
// optional, read-only instrumentation for the validation scripts in this folder:
//   load({fanning})          the model; fanning overrides the constant Fanning friction factor (0 = no friction and
//                            no wall heat transfer, which the model ties to friction by Reynolds' analogy)
//   load({gamma})            the constant gas's ratio of specific heats (default 1.35; it matters only with spec.e.gas
//                            'const', since 2026-11-12 the model's default gas has its own gamma(T, x)), for the gamma experiments
//   load({hook: true})       runSpeed calls opts.hook(ctx) after every time step with the step's state (pipes, cylinders,
//                            the step's dt and the cylinder's heat release, wall heat (with Woschni's coefficient, area and velocity) and p dV), for the conservation
//                            and trace scripts. The replacements only expose values; they do not change any arithmetic.
// The page itself is never modified. PAGE=path picks another copy of the page.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const PAGE = process.env.PAGE || path.join(ROOT, 'web', 'index.html');

function source() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const a = html.indexOf('function wsFactory(){'), z = html.indexOf('\nconst WS=wsFactory();');
  if (a < 0 || z < 0) throw new Error('wsFactory not found in ' + PAGE);
  return html.slice(a, z);
}
function swap(src, from, to) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error('instrumentation: expected one "' + from.slice(0, 60) + '", found ' + n);
  return src.replace(from, to);
}
function load(o) {
  o = o || {};
  let src = source();
  if (o.gamma != null) src = swap(src, 'const GAM=1.35,', 'const GAM=' + Number(o.gamma) + ',');
  if (o.fanning != null) src = swap(src, 'const FANNING=0.005;', 'const FANNING=' + Number(o.fanning) + ';');
  if (o.hook) {
    src = swap(src, 'const U=(G?cy.m*gasE(G,cy.T,cy.x):cy.m*CV*cy.T)-cy.p*dV+', 'cy._dV=dV; cy._pdV=cy.p*dV; cy._qw=qw; cy._Q=cy.burnQ*dxb; cy._mI=mI; cy._mE=mE; cy._hI=vIn[k].h; cy._hE=vEx[k].h; cy._fuel=(vInC[k].fuel||0)*dt; cy._rev=(vInC[k]!==vIn[k]&&vInC[k].m<0)?(vIn[k].m*vIn[k].h-vInC[k].m*vInC[k].h)*dt:0;\n        const U=(G?cy.m*gasE(G,cy.T,cy.x):cy.m*CV*cy.T)-cy.p*dV+');
    // the wall heat each pipe cell actually took this step (J; + into the gas), accumulated in P._qc (read-only: the same
    // expression the step adds, evaluated again). Both the page before the exhaust-port law (2026-11-13, part 7) and after.
    src = swap(src, 'function stepPipe(P,dt){', 'function stepPipe(P,dt){ if(!P._qc) P._qc=new Float64Array(P.n);');
    const oldQ = '    q3[i]+=-k*(f3[i+1]-f3[i])+dt*fr*cp[i]*(P.Tw-Ti);\n';
    const newQ = '    q3[i]+=-k*(f3[i+1]-f3[i])+(i<np?dt*P.hp*Math.PI*D[i]*(P.Twp-Ti):dt*fr*cp[i]*(P.Tw-Ti));\n';
    if (src.indexOf(newQ) >= 0) src = swap(src, newQ, newQ + '    P._qc[i]+=(i<np?dt*P.hp*Math.PI*D[i]*(P.Twp-Ti):dt*fr*cp[i]*(P.Tw-Ti))*dx;\n');
    else src = swap(src, oldQ, oldQ + '    P._qc[i]+=dt*fr*cp[i]*(P.Tw-Ti)*dx;\n');
    src = swap(src, 'qw=hc*Aw*(cy.T-(e.Twall||450))*dt;', 'qw=hc*Aw*(cy.T-(e.Twall||450))*dt; cy._hc=hc; cy._Aw=Aw; cy._wv=wv;');
    src = swap(src, '      st.th+=dth;\n', '      if(opts.hook) opts.hook({st,all,dt,dth,cyls,ins,prims,chambers,outs,eng,th:st.th,TB,PL});\n      st.th+=dth;\n');
  }
  return new Function(src + '\nreturn wsFactory();')();
}
module.exports = { load, ROOT, PAGE };
