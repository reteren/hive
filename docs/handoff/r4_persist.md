TASK R4-persist — persist and copy zones, beacons, membership, marks. Browser port: 1443.
YOUR FILES: src/project/** , src/clipboard/** , tests/project*.test.ts, tests/clipboard*.test.ts, src-tauri/src/project.rs only if needed.
Build:
1. board.json v3 (migrate v1/v2): zones (id, name, color, parts, holes, createdAt), notes' color (beacons) and zoneId, and beacon marks order (beaconState.marked — view state that the user expects to keep; focus is NOT persisted). Validate every field (bad colour → default, invalid polygon → drop zone with warning). Replace the store on load via replaceZones; reset beacon focus/marks and zone tool on project switch (extend resetProjectScopedState).
2. Clipboard (M010): copying ONLY a zone pastes only the zone; copying a Ctrl-multi-selection that includes zones and notes pastes everything (new ids, offsets preserved; pasted zones must not overlap existing zones — offset them until free or refuse with a message; propose). Beacons copy like notes (kind beacon + color). ME is never copied.
3. Selection of zones is being added in parallel by the selection worker — read selection ids of zones via the exported selection API; if unclear, ask.
Tests: v2→v3 migration, round-trips, clipboard zone rules.
