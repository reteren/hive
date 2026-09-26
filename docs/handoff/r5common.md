PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app. R0–R4 done (installer 1.1.5, zone brush). Now R5: nodes that SHOW and CALCULATE (no program execution). You may be a fresh session: read C:\hive\docs\handoff\STATUS.md first.
Stack: Tauri 2 + Svelte 5 (runes) + TypeScript strict + Vite + Vitest. English UI. Dark compact UI, accent = theme yellow.
Read first: C:\hive\ROADMAP.md section R5 (table R5.1–R5.9 + notes below it), C:\hive\NODES.md, C:\hive\FOLLOWUP_QUESTIONS.md H17, H18, H26–H31, C:\hive\QUESTIONS_AND_IDEAS.md N014, N021, N023, N031 and "идея №2" (tierlist, ~line 2670), and the code you touch.

USER DECISIONS (binding):
- H17/H18 Goal: a final task-like node; strong lines from task nodes INTO the Goal. Gold glow automatically when every directly connected task is done (at least one); undoing a task or connecting a new unfinished task removes the gold at once. No manual "done" on the Goal. The rule "B can't be completed while A→B open" is the existing R3/A05 rule — reuse, don't re-walk chains.
- N023 Progress: only tasks count; weight = 1 without Importance, Importance levels basic..absolute = 1..5. Shows done/total weight and percent; empty scope → "—", never divide by zero.
- 26.09: Progress and Statistics choose their SCOPE from a list inside the node: Board, zones by name, beacons by name (beacon = its network as in beacon focus). Default when created: the zone the node stands in, else Board.
- N031 Statistics: words / characters / lines of the notes in scope (images/drawing later). A node reached twice counts once.
- N021/H26/H27 Calculator: plain calculator with permanent history (edit an entry → recompute; an invalid expression never erases other results). Bank mode: a named bank with an initial sum; rows subtract; remaining = initial − Σrows; editing a row amount recomputes at once (H26). 26.09: a row is linked to a node by drawing a STRONG line node → calculator; the row takes the node's name (follows renames) and you type the amount in the calculator. Deleting the node keeps the row and its amount (H27). Manual rows (no node) are allowed too.
- H31 Mirroring: calculator nodes with the SAME NAME (case-insensitive) are mirrors — same history/bank/rows, edits in one appear in the other; different names = independent. Never silently merge two non-empty calculators by renaming (refuse with a clear message; A07 decides later).
- Idea №2 / H28 / H29 / H30 Tierlist: rows (default S A B C D F with colours) you can add, rename, recolour, delete, reorder; cards = free text squares or read-only previews of board nodes; 26.09: the preview shows the LIVE name/text of the original; original deleted → card shows "content missing"; deleting a card never touches the original. Deleting a non-empty row asks first / moves its cards (no silent loss).
- Every user action = ONE Undo step. Modules (Importance/Purpose) on calculator and Tierlist follow H12 (allowed like on notes).

CONTRACTS (committed by the coordinator, commit "R5 contracts"; ask before changing their shape):
- src/model/note.ts: NoteKind adds "goal" | "progress" | "calculator" | "tierlist" | "stats"; R5_KINDS; Note.scope?: NodeScope; Note.tiers?: TierRow[].
- src/model/nodeData.ts: NodeScope, TierCard, TierRow, CalcEntry, BankRow, CalculatorData, emptyCalculatorData, calculatorKey(name), parseScope, parseTiers, parseCalculatorData.
- src/notes/nodeBodies.ts: registerNodeBody(kind, Component<{note}>) — NoteNode renders your body for your kind (no text editor). Register from an init module that the coordinator imports in main.ts — tell the coordinator the file, or add ONE import line to src/main.ts yourself (re-read first, append only).
- src/calculator/calculators.svelte.ts: calculators.byKey (shared contents), calculatorData(name), setCalculatorData, deleteCalculatorData, replaceCalculators.
- board.json: notes persist scope and tiers (index.ts done); ProjectIndex.calculators?: Record<string, CalculatorData> type exists — loading/saving it is worker E's job.
- Create menu (Q) already has Goal/Progress/Calculator/Tierlist/Statistics buttons → createNoteKind(kind) with R5_WIDTHS in noteCommands.ts (tune your width there with a one-line edit if needed).
- Existing: board store + raw mutations, links store (lifecycle listeners), history execute/record, selection API, command registry, note menu registry (src/notes/noteMenu.ts), zones + membership (zoneOf/zoneMembers), beacon coverage (src/beacons/coverage.ts), tasks (src/tasks/**), modules (effectiveImportance).

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours (plus new files in your area and tests in app/tests/). Need anything else → `orca orchestration ask` the coordinator.
- No git commit/config. No new dependencies (write the expression parser yourself — never eval/Function).
- Use your browser port with `npx vite --port <port> --strictPort`, stop it afterwards. Visual checks via headless Edge + CDP with a temp --user-data-dir, fixtures by importing app modules in the page — see C:\hive\docs\handoff\zbsmoke.mjs (it also shows real mouse input via Input.dispatchMouseEvent). Delete temp files you create.
- No fake features/dead buttons; every command mouse-reachable and in F3. Crisp rendering (no will-change/translate3d on board layers).
- Production quality, existing style. Pure logic in .ts with Vitest tests in app/tests/.
- Verify `npm run check` and `npm test` (if an error is clearly in another worker's in-progress file, say so).
- worker_done body in Russian: what you built, how to try it by hand, what's left out, decisions to confirm. Send worker_done ONCE.
