TASK H — configurable external-video threshold. Common rules: C:\hive\docs\handoff\d31common.md (you built the storage in d31_a.md).

User (Russian, binding): «порог для файлов 20мб можно изменить в настройках до бесконечности при желании».

Today LARGE_VIDEO_EXTERNAL_BYTES = 20 MB in Rust decides whether a dropped video is copied into the project or referenced by media.externalPath.
- Settings panel (src/ui/SettingsPanel.svelte, Storage section): "Keep videos outside the project when larger than" — number input in MB (min 1) + an "Unlimited" option (= always copy into the project, never external). Default 20 MB. Persist with the existing view/app settings (src/settings/*, validated on load like the history limit; bad values → default). Show a one-line hint: "Larger videos are linked, not copied, so the project folder stays small."
- The frontend passes the current threshold to the Rust import commands (attachment_import_path / bytes / whatever decides external) as an optional argument (None = default 20 MB, a sentinel or Option for unlimited); Rust keeps the hard 2 GB media limit. Changing the setting affects only new imports — existing nodes are untouched.
- Tests: settings parse/validate (number, unlimited, garbage), Rust decision function (below/above/equal threshold, unlimited).
YOUR FILES: src-tauri/src/attachments.rs, src/attachments/service.ts, src/settings/*, src/ui/SettingsPanel.svelte (Storage section only), tests. Another agent is NOT active now, but the coordinator is editing src-tauri/src/lib.rs, Cargo.toml, tauri.conf.json, capabilities and App.svelte for the auto-updater — don't touch those.
npm run check + npm test + cargo test (CARGO_TARGET_DIR=C:/hive/app/src-tauri/target-alt) green; worker_done in Russian; do NOT commit.
