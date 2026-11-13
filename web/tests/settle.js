// Race-free reads of the page for the page tests. Not a test itself (tools/run_all_tests.py NOT_TESTS).
//
// Why: Playwright's page.$eval / page.$$eval find the element(s) in one round trip and run the function on them in a
// second. The page re-renders the active tab on the next animation frame whenever its size changes (a ResizeObserver
// on .wrap calls requestAnimationFrame(renderActive)), and a render replaces the tab's generated nodes. So a read
// right after an input change could land on a replaced, detached node, whose innerText has no layout line breaks
// (docs/BOOST_AUDIT_2026-11-12.md, finding F1; reproduced in turbosize_ui).
//
//   reads(page)   makes page.$eval and page.$$eval atomic and settled for that page: one page.evaluate that first
//                 waits until the page has stopped rendering (window.__renderCount, bumped at the end of every
//                 renderActive, unchanged over two whole frames), then queries and reads in the same task, so the
//                 node read is the one in the page. $eval still throws when nothing matches; $$eval gets [] then.
//                 The function and its one argument must be serialisable, as for Playwright's own $eval.
//   settle(page)  the wait alone (for a page.evaluate that reads several things itself)
//
// The wait is on a condition, not a fixed sleep: it returns as soon as two frames pass with no render. If the page
// keeps rendering for longer than `ms` (default 5000) it gives up waiting and reads anyway, as $eval did before.
const SETTLE = async ms => {
  // a frame: the next animation frame, then a task after it (the ResizeObserver's callback runs in the frame's
  // rendering steps, after the animation-frame callbacks, and the render it asks for lands in the frame after);
  // a page whose frames do not run (hidden) falls back to a 100 ms timer so this never hangs
  const frame = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 0); } };
    requestAnimationFrame(go); setTimeout(go, 100); });
  const t0 = performance.now();
  for (;;) {
    const c = window.__renderCount || 0;
    await frame(); await frame();
    if ((window.__renderCount || 0) === c || performance.now() - t0 > ms) return;
  }
};

function settle(page, ms = 5000) {
  return page.evaluate(([f, ms]) => (0, eval)('(' + f + ')')(ms), [SETTLE.toString(), ms]);
}

function reads(page, ms = 5000) {
  const run = (all, sel, fn, arg) => page.evaluate(async ([all, s, f, a, w, ms]) => {
    await (0, eval)('(' + w + ')')(ms);
    const fun = (0, eval)('(' + f + ')');
    if (all) return fun([...document.querySelectorAll(s)], a);
    const e = document.querySelector(s);
    if (!e) throw new Error('$eval: no element matches ' + s);
    return fun(e, a);
  }, [all, sel, typeof fn === 'function' ? fn.toString() : String(fn), arg, SETTLE.toString(), ms]);
  page.$eval = (sel, fn, arg) => run(false, sel, fn, arg);
  page.$$eval = (sel, fn, arg) => run(true, sel, fn, arg);
  return page;
}

module.exports = { reads, settle };
