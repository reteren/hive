# d43 e3 — delta save Git safety regression

## Finding and fix

The unchanged `a_stale_save_keeps_objects_it_never_knew` test could fail in the parallel Rust suite after `SYNCED_FILES` evicted its project baseline from the bounded cache. With no baseline bytes, `plan_write` treated a known object's existing file as a stale path and returned `BOARD_CHANGED_ON_DISK` before it could preserve the pulled-in object.

When a full save has a known baseline but its cached file manifest is missing, `plan_write` now reloads the split board from disk. Before using that manifest, it checks every known record, collection order, calculator value, and known head field against the save baseline; differences still reject the save, while records absent from the baseline remain untouched. `plan_delta` applies the same check against the active synced document before rebuilding its manifest, so both save paths recover from cache eviction without adopting external edits.

Added `stale_save_recovers_an_evicted_baseline_without_adopting_known_edits` to exercise the cache-miss path: the pulled-in friend remains, the locally deleted known object is removed, and an external edit to a known record is refused. The requested existing safety test remains unchanged.

## Files changed

- `app/src-tauri/src/board_store.rs`
- `docs/handoff/d43_report_e3.md`

## Verification

- `cargo test --lib board_store::tests::a_stale_save_keeps_objects_it_never_knew -- --nocapture` — passed.
- New cache-miss regression test — passed.
- Full `cargo test` with `CARGO_TARGET_DIR=target-b` — 109 passed, 0 failed (including doc tests).
- `npm run check` — 0 errors, 0 warnings.
- `npm test` — 225 files passed; 1,476 tests passed.
- `rustfmt --edition 2021 src/board_store.rs` — passed.

No timing benchmark was taken; this is a correctness fix in the full-save fallback and does not change the delta-save hot path. No e3 items remain open.
