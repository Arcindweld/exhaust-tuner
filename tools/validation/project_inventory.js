// Every input on the page against the project file (docs/SPEC_PARITY_AUDIT_2026-11-16.md, addendum A4): a page put in a
// state that renders the generated inputs (expert mode, a turbo build with a turbo picked, the Headers tab at unequal
// lengths, every tab visited), every input, select and textarea with an id enumerated, and each one either saved in the
// project's vals, or found to survive a save and a load through one of the project's section objects (changed in page A,
// A's project loaded into a fresh page B, the same element read there), or not. Prints the three lists; the permanent
// check with the commented "not saved on purpose" list is web/tests/staleness_ui.js.
//   node tools/validation/project_inventory.js
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const T = require(path.join(ROOT, 'web', 'tests', 'staleness_lib.js'));
(async () => {
  const b = await chromium.launch(), ctx = await b.newContext();
  const r = await T.inventory(ctx, { verbose: true });
  console.log('saved in vals: ' + r.vals.length);
  console.log('saved through a section object (survives save and load): ' + r.via.length + '\n  ' + r.via.join(' '));
  console.log('a saved field moved by the load: ' + JSON.stringify(r.moved));
  console.log('untested (the probe could not change them): ' + r.untested.join(' '));
  console.log('not saved: ' + r.lost.length + '\n  ' + r.lost.map(x => x.id + ' [' + x.tab + '] ' + x.why).join('\n  '));
  await b.close();
})();
