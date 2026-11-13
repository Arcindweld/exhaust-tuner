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
    src = swap(src, 'const U=(G?cy.m*gasE(G,cy.T,cy.x):cy.m*CV*cy.T)-cy.p*dV+', 'cy._dV=dV; cy._pdV=cy.p*dV; cy._qw=qw; cy._Q=cy.burnQ*dxb; cy._mI=mI; cy._mE=mE; cy._hI=vIn[k].h; cy._hE=vEx[k].h;\n        const U=(G?cy.m*gasE(G,cy.T,cy.x):cy.m*CV*cy.T)-cy.p*dV+');
    src = swap(src, 'qw=hc*Aw*(cy.T-(e.Twall||450))*dt;', 'qw=hc*Aw*(cy.T-(e.Twall||450))*dt; cy._hc=hc; cy._Aw=Aw; cy._wv=wv;');
    src = swap(src, '      st.th+=dth;\n', '      if(opts.hook) opts.hook({st,all,dt,dth,cyls,ins,prims,chambers,outs,eng,th:st.th});\n      st.th+=dth;\n');
  }
  return new Function(src + '\nreturn wsFactory();')();
}
module.exports = { load, ROOT, PAGE };
