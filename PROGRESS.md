# PROGRESS (UI pass two) — delete in final commit
Scratch: /tmp/claude-0/-home-claude/edc59f9c-4fbd-54e8-940b-111545c463b9/scratchpad/ui2/
Decision: collapsibles = button[aria-expanded] + region clipped (height 0, overflow hidden) + inert when collapsed.
 innerText still includes clipped text (probed: yes) -> existing tests unchanged; inert removes focus/AT.
## Steps
- [x] inventory + before shots (scratch)
- [x] folds, hint folds, toc tracking, settings panel, keep scroll: first cut
- [x] inline styles (300 converted), u2 in cells/sentences, Cancel on 3 runs + elapsed, 14 error strings (20 places) rewritten
- [ ] extend ui_ui.js + settle expandAll; full-text check; shots after; docs; full suite
