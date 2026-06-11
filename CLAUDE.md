# Orville Commander

A browser front-end for the Eventide Orville: WebMIDI in, SysEx out, emulated LCD screen rendered from text dumps. Vanilla ES modules, no framework.

## How to run

```
npm run dev     # Vite dev server, src/ as root
npm test        # Jest + jsdom
npm run combine # Concatenate src/ into combine/ (LLM pasting aid)
npm run zip     # Archive repo into orvilleCommander.zip
```

Open the dev URL in Chrome, Edge, or Opera (WebMIDI requirement — Firefox and Safari will silently fail to connect). Grant MIDI permissions, pick input/output ports, set device ID (default 0).

## Architecture (current, not aspirational)

```
index.html
  └─ main.js          entry point, DOM wiring, connectMidi, registerEventBridge
      ├─ config.js          localStorage load/save/clear
      ├─ controls.js        keypress masks + button → SysEx mapping
      ├─ midi.js            WebMIDI send, SysEx encoding, inbound listener, dump counter
      ├─ parser.js          SysEx byte stream → structured subs & values; emits events
      ├─ event-bridge.js    subscribes to parser/midi events, renders on dumpComplete
      ├─ renderer.js        subs → LCD HTML, event handlers
      ├─ bitmap.js          screen-capture denibble + canvas render
      ├─ navigation.js      toggleDspKey
      ├─ tree.js            persistent device object tree: recordDump, deriveKeyStack, labels (T1b/#105)
      ├─ eager-loader.js    background preset-subtree structure warm-up, one request in flight (#106)
      ├─ events.js          tiny pub/sub bus (emit / on)
      ├─ store.js           setState façade over appState (audited writes)
      ├─ state.js           appState singleton (re-exported from store.js)
      ├─ sysex-commands.js  CMD / KEY protocol constants
      ├─ sysex-split.js     ASCII dump tokenizer (shared by parser + tests)
      ├─ logger.js          gated log() + owns log level/category config (not on appState — see "Where state lives")
      └─ hex-extract.js     debug-file hex parsing
```

Data flow: user clicks → `controls.js` sends SysEx via `midi.js` (every `OBJECTINFO`/`VALUE`/`GET_SCREEN` request joins a **dump wave** — a per-wave outstanding counter with an idle watchdog that rearms on every raw inbound packet; bitmap fetches defer + coalesce behind an open wave because the device drops colliding requests, and meter-poll ticks skip while a wave is open — #107) → Orville responds → `midi.js` listener (`addSysexListener` reassembles multi-packet SysEx from `F0` to `F7` before parsing — see below) → `parser.js` parses, writes state via `store.setState`, and emits events on `events.js` → `event-bridge.js` renders (C1/#37 + R7): a **progressive paint** the moment the current key's `objectinfo:received` lands, a **child-arrival repaint** when a tree-recorded child of the on-screen menu lands (so embeds appear when their data arrives, not on the next unrelated render), and a **settled paint** when the wave ends (`dumpComplete` — drained, or the idle watchdog fired on a stall); `hideLoading` fires only on waves that carried OBJECTINFO or GET_SCREEN requests (#3) or on a watchdog stall, so value-only meter-poll waves cannot clear an unrelated loading state. There are no render timers or debounce; a render that issues new requests (missing values) opens a new wave whose drain triggers the next settled paint — the parser's all-COL fan-out covers embed prefetching. Connect/navigation one-shots live in the bridge too (C2/#38): `selectPorts` resets the view to root and arms `pendingLanding`; the root dump's arrival lands on the active preset, and a `pendingDescend` one-shot (also set by nav clicks) descends once into a COL-only menu's first child when that menu's dump arrives — there is no timer and no sticky `autoLoad` flag. The landing also arms the **eager loader** (#106, gated by `appState.eagerLoad`): on the first clean wave drain after it (`all-received` — watchdog stalls keep the arm, since the landing wave routinely stalls on the bitmap transfer, R5a), `eager-loader.js` walks the active preset's COL subtree breadth-first with exactly ONE OBJECTINFO in flight, skipping tree-cached nodes, so structure is warm for the R3 pre-paint without ever duplicating the parser's fan-out. Bitmap path: `0x17` SysEx → `parser.js` denibbles (`bitmap.js`) → emits `screen:received` → `event-bridge.js` → `renderBitmap` on the canvas.

Inbound SysEx is not necessarily one WebMIDI event per message: a long dump (`0x17` screen, large `0x32` OBJECTINFO like the ~70-name bank list) can be split across packets, so `addSysexListener` buffers from `F0` until `F7` and calls `parseResponse` once per complete message — a pass-through when messages already arrive whole. Applies to every inbound type, not just screens. Re-registration is safe: `addSysexListener` detaches the previously attached listener (from whichever input it was on) before adding a new one, so repeated port selection never stacks listeners. See `docs/protocol.md` §Framing "Inbound reassembly" and tracker FB6/FB7.

## Module structure (refactor complete)

The eight-step decoupling refactor is complete (merged via PR #23). Four of the five original import cycles were broken: parser↔renderer, parser↔main, and renderer↔main via the `events.js` pub/sub bus + `event-bridge.js` (Step 7), and controls↔renderer via the `navigation.js` extraction (Step 8).

Still open and not roadmapped: cycle 1 `midi.js` ↔ `parser.js`, and a residual 2-node `renderer.js` ↔ `main.js` coupling (`renderer` imports `showLoading`; `main` imports `updateScreen`). A later `store` ↔ `logger` ↔ `state` cycle (introduced when log config lived on `appState`) was collapsed in C6 — `logger.js` now owns its log config and no longer imports `state.js`.

State: `appState` (in `state.js`) is a shared mutable object re-exported from `store.js`. Prefer `store.setState(partial, origin)` for an audited write path over mutating `appState` directly. `toggleDspKey` has a single definition in `navigation.js`.

The completed 8-step refactor's design notes were removed from the tree (they live in git history); the active Phase 3 state-model design is in `docs/refactor/phase3-state-model.md`, and `docs/issue-tracker.md` is the live production-readiness ledger.

## Testing

Jest config: `jest.config.cjs` → babel-jest transform, jsdom environment.

- `tests/parser.test.js` — real coverage of `parseResponse` and `parseSubObject`.
- `tests/renderer.test.js` — covers SET change, NUM click, TRG click flows.
- `tests/main.test.js` — removed in roadmap step 1 (it imported functions that didn't exist in main.js and pulled in missing devDependencies). Real coverage for main.js can be added later if needed.

When writing new tests:
- Mock `webmidi`, `./src/midi.js`, and `./src/main.js` per the patterns already in `parser.test.js`.
- Use `jest.useFakeTimers()` for the renderer's device-settle timers and the midi.js wave watchdog.
  Renders themselves are synchronous since C1 (no debounce, no coalesce timers): the bridge renders on
  `objectinfo:received` for the current key, on child-of-current-menu arrivals (R7), and on `dumpComplete`.

## Protocol quick reference

Wire format in [`docs/protocol.md`](docs/protocol.md); how the device behaves (object tree, presets, value semantics, quirks) in [`docs/device-model.md`](docs/device-model.md). All SysEx is framed `F0 1C 70 <deviceId> <cmd> ... F7`. Commands seen in code:

| Cmd | Direction | Meaning |
|---|---|---|
| `0x01` | out | Keypress (4-byte mask nibbled to 8 bytes) |
| `0x17` | in | Screen bitmap (nibbled 12-byte header + 1920 bytes of 240×64 1bpp + 1 trailing byte) |
| `0x18` | out | Request screen bitmap |
| `0x2d` | out | VALUE_DUMP request / VALUE_PUT (with `0x20` separator + value) |
| `0x2e` | in | VALUE_DUMP response |
| `0x31` | out | OBJECTINFO_DUMP request |
| `0x32` | in | OBJECTINFO_DUMP response (ASCII sub-object lines) |

Keypress masks are hex-encoded button state; `system_commands.txt` at the repo root is the canonical source — `controls.js:keypressMasks` must match it. If they diverge, `system_commands.txt` wins.

Sub-object types in the ASCII dump: `COL` (column/menu), `NUM`, `SET`, `CON` (continuous/meter), `TRG`, `INF`, `STR` (string-edit, live-discovered). See `parseSubObject` for field order and `docs/device-model.md` §3 for semantics.

## Conventions

- ES modules only (`"type": "module"`).
- No TypeScript. No JSX. No React.
- `webmidi` is the only runtime dep (`lodash.debounce` left with the C1 render rework) — don't add more without discussion.
- No emoji in code or logs.
- No magic numbers. A literal with semantic meaning gets a named constant (and a comment when its origin is non-obvious) — never a bare number/string scattered at call sites. Protocol values live in `src/sysex-commands.js`; the reverse-engineered SysEx framing is the cautionary example this rule exists for.
- Prefer editing existing files; this repo is small enough that splitting should be deliberate (roadmap Step 6+).
- Keep comments minimal — the JSDoc on existing exports is fine; don't narrate new code unless the *why* is non-obvious.
- When touching render logic, add a renderer snapshot test first (see `tests/renderer.snapshot.test.js`).
- Before claiming a task complete, run `npm test` and report the output. Do not declare success based on reading the diff.
- Commit messages follow conventional commits (`fix:`, `refactor:`, `test:`, `docs:`, `chore:`). Reference the roadmap step in the body when relevant.
- GitHub Issues track the same work as `docs/issue-tracker.md`. When a PR resolves an item that has a matching GitHub issue, put `Closes #N` in the PR body so it auto-closes on merge. Every PR is reviewed by spawned reviewer agents (correctness + docs) before merge — see the issue-tracker workflow.
- If a task grows beyond its stated scope mid-session, stop and ask rather than expanding. Mechanically necessary follow-throughs (e.g., updating a test mock after an import change) are in-scope and do not require asking.
- All work happens on a feature branch merged via PR; never commit directly to `main`. If `git branch --show-current` shows `main`, branch first.

## Build tools (repo root, not src/)

- `build_tools/combine.cjs` — concatenates `src/*.js` (no CSS) into 20KB chunks under `combine/`. Output is for pasting into LLM contexts.
- `build_tools/zip.js` — archives the working tree (minus `.git`, `node_modules`, zips) via `archiver`. Used by `npm run push`.
- `build_tools/apply_diff.js` — applies a named `.diff` with `git apply --reject`; falls back to a hand-rolled hunk parser. Creates a `.bak` before applying.
- `build_tools/live-app.mjs` (`npm run live-app`) — runs the REAL app module graph headless (jsdom + `@julusian/midi` adapters into `setMidiPorts`) against the powered Orville. No browser, no WebMIDI permission, no port contention with Chrome (close any app tab first — WinMM is single-client). The substrate for session-driven live validation.
- `build_tools/tree-audit.mjs` (`npm run tree-audit [depth] [quietMs] [capMs]`) — fetches the device object tree raw (ground truth), then audits every COL node's render against its own dump: child reachability (softkey/embed/unreachable), params rendered exactly once, duplicate softkeys, breadcrumb vs tree parent. Machine-readable report at `logs/tree-audit-report.json`. The acceptance gate for T1b (#105) and the standing render-regression loop.

## Where state lives

Almost all runtime state is on `appState` (state.js). The per-menu cache `currentValues` is cleared in exactly one place — `renderer.js:updateScreen`, which every navigation path funnels through — so don't add per-handler clears (C8/#44). Device STRUCTURE lives in `src/tree.js` (T1b/#105): the parser tree-records every OBJECTINFO dump (`recordDump`), and child lookups (`getNode`, `findParamUnder`), labels (`labelForSub` — every COL child gets an affordance, blank nodes get a child-derived or `...` label), and ancestry all read the tree; the old per-menu `childSubs` cache is deleted. Freshness is per-visit child refetch EXCEPT in stable subtrees (#113, `constants.CACHE.STABLE_SUBTREE_PREFIXES` — the program subtree): there the fan-out skips the STRUCTURE refetch for `tree.js isFresh()` children (param values still refresh every visit). Staleness is per-key: any `sendValuePut` into the subtree, any `sendKeypress`, or Sync/reconnect stales the cached keys, and a key is fresh again only when its own dump re-records. `keyStack` is DERIVED state: every navigation sets it via `tree.js:deriveKeyStack` (tree ancestry, not click history; one deliberate exception — the static bottom-row root jump RESETS it to `[]`, R2), and entries keep the canonical `{key, tag, subs}` shape — never raw strings (C3/#39). The tree is module state like `logger.js`, which owns its own log level and per-category visibility as private module state (defaults from `constants.DEFAULT_LOG_CATEGORIES`), set via `setLogLevel` / `setLogCategories`. This was moved off `appState` (C6) so `logger.js` no longer imports `state.js`, breaking the `store` → `logger` → `state` → `store` import cycle. Everything persistent is in `localStorage.midiConfig` (config.js). There is no other store. If you need durable state, add it to `midiConfig` via `saveConfig`.

## Dev server quirks

`vite.config.js` forces `usePolling: true` and explicit HMR host — this is intentional for WSL2/Windows. Don't remove unless you know the reviewer's OS.

## Smoke test before merging

1. `npm test` passes.
2. `npm run dev` — connect to real Orville (or, if offline, upload a known-good debug file via the "Process Debug File" button and confirm the bitmap renders).
3. Navigate into a preset, change a SET parameter, confirm the LCD updates and the device reflects the change.
4. Toggle A/B; confirm the clicked preset name highlights and both DSPs still render.

## Claude Code session notes

Observations about the Claude Code tooling itself, captured as Step 5.5 shipped. Keep these in mind when reviewing a session's output.

- **Piecewise Write-tool commit-message composition.** Heredoc-based composition (`git commit -m "$(cat <<'EOF' ... EOF)"`) for multi-paragraph commit bodies has produced actual content corruption — duplicate paragraphs and collapsed blank lines — across all three attempts during 7a.3, not display artifacts. Use the piecewise Write-tool protocol instead: write each section (subject, body paragraphs) to its own tempfile under `logs/` (gitignored), `cat -A` the section as plain text in chat for whitespace verification, append to a main commit-message file via `cat section >> main`, `cat -A` the cumulative main, then commit via `git commit -F <main>` (NOT `-m`). Confirmed across two successful end-to-end applications: 7a.3 (adopted after three heredoc-corruption failures in the same commit) and 7c.0 (used as the default approach from the start).

- **Long-file diff viewer duplication.** Claude Code's diff viewer occasionally renders a block of lines twice when displaying a proposed edit (observed around line 200 of multi-hundred-line files). Display artifact only — the actual file content is correct. Reread the file via `Read` if in doubt before editing; do not amend for apparent duplication unless `Read` confirms it.

- **Gate doc updates on verification.** Claude Code may batch documentation updates (marking features "complete", writing past-tense claims about code behavior) before the code behind them is verified. Explicitly require test passage or other evidence before doc changes that assert behavior. "This test pins X" in a doc is a claim that only becomes true after `npm test` confirms it.

- **Require raw output, not self-summary.** For any "is my work correct" verification, require Claude Code to paste raw tool output verbatim into the chat rather than accepting its summary. Claude Code will sometimes read a long output, declare it clean, and move on — which collapses the human review step. Ask for the raw bytes when it matters.

- **Session-blanket approval, when.** For mechanical sequential edits to a single file (e.g., three amendments to the same function), shift+tab session approval is reasonable and saves real time. For structural edits, new files, or the first edit in an unfamiliar area, per-edit approval is the right friction level.

- **`cat -A` text-in-chat is the truth signal for whitespace.** Approval-prompt screenshots and the diff viewer's render are unreliable for verifying blank-line preservation, trailing whitespace, and line-ending characters. Source of truth: paste `cat -A` output as plain text into chat (not screenshot, not diff-viewer dump). The piecewise Write-tool protocol above relies on this for verification at every section boundary. Used heavily in 7a.1, 7a.2, and 7c.0; cumulative experience supports promoting it from per-session habit to documented convention.
