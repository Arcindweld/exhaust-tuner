// How a page test says that it, or a part of it, did not run (a program, a solver or a data file is not here), so
// that tools/run_all_tests.py counts it as a skip with its reason instead of a quiet pass. Not a test itself.
//   skip(reason)     the whole test did not run: prints "TEST SKIPPED: <reason>" and exits 0 (run on its own, a skip
//                    is not a failure; REQUIRE_ALL=1 in the tests that honour it turns it into one)
//   skipPart(reason) one part did not run, the rest did: prints "SKIP: <reason>" and returns
//   openwam()        the OpenWAM build the tests run: EXHAUST_TUNER_OPENWAM, else ext/OpenWAM's build in the checkout
// The Python tests print the same "TEST SKIPPED: " line (fusion-addin/tests/test_native.py, cfd/*_rs_vs_py.py).
const path = require('path');
const MARK = 'TEST SKIPPED: ';
const one = r => String(r).replace(/\s+/g, ' ').trim();
function skip(reason) { console.log(MARK + one(reason)); process.exit(0); }
function skipPart(reason) { console.log('SKIP: ' + one(reason)); }
function openwam() { return process.env.EXHAUST_TUNER_OPENWAM || path.resolve(__dirname, '..', '..', 'ext', 'OpenWAM', 'build', 'bin', 'release', 'OpenWAM'); }
module.exports = { MARK, skip, skipPart, openwam };
