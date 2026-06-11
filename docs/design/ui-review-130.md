# UI Review & Design Direction — "Virtual Rack Unit" (#130, phase 1)

Brief: *"the UI is ugly and needs to match closer to the aesthetic of the device."* Agreed. The app
emulates a professional 2U Eventide processor and currently looks like a form-builder demo. This
document audits what clashes, sets a concrete visual direction grounded in the golden LCD captures
(`tests/fixtures/golden/screen-*.png`, 1:1 of the physical 240×64 display), and plans shippable
phases that do **not** touch the renderer's DOM contract.

## 1. What clashes today

- **White void around a dark panel.** `body` is never styled — the dark `.front-panel`
  (`src/styles.css:2-13`) floats on browser-default white. Instant toy feel.
- **Two competing screens, mismatched scales.** The virtual LCD `#lcd` (40ch HTML,
  `src/styles.css:33-47`) sits above the bitmap canvas (480×128, `src/styles.css:123-130`,
  inline-overridden every render by `src/bitmap.js:38-41` from `CANVAS` in `src/constants.js:68-72`).
  Two different sizes of "the same display" stacked vertically reads as a debug rig, not a device.
- **The LCD scrolls.** `overflow: auto; max-height: 400px` (`src/styles.css:43-44`) puts a browser
  scrollbar *inside* the LCD glass. Hardware LCDs do not scroll.
- **Generic typography on the virtual LCD.** `font-family: monospace` + pure `#0f0` on `#000`
  (`src/styles.css:36-38`). The golden captures show a *bold* ~6×8px-cell bitmap font (2px stems,
  40 cols × 8 rows), inverted title bars, a vertical pane divider, and chamfered softkey tabs
  (`logs/program-screen.png`). Browser monospace at antialiased 16px resembles none of that.
- **Renderer hooks styled as web links.** `.softkey` is an underlined 10ch link
  (`src/styles.css:106-111`); on hardware softkeys are boxed/filled tabs. `.param-value` is bright
  `#0a0` background + underline (`src/styles.css:112-116`); the device highlights via row inversion.
  `.back-link` and `.param-label` have **no styling at all**. `#lcd select` is held together with
  eleven `!important`s (`src/styles.css:131-155`).
- **Default browser widgets in the open.** The connect strip (`src/index.html:65-78`) is bare
  `<select>`/`<input type=number>`/buttons in an unclassed `<div>`. Debug Tools
  (`src/index.html:80-99`) is an unstructured sprawl: 8 buttons, a file input, 3 label/checkbox
  pairs, plus an inline `style="color: green"` (`src/index.html:83`). The log `<textarea>`
  (`src/index.html:101`) is raw, fixed at 500px.
- **Button soup.** All 30+ panel buttons share one generic gray style (`src/styles.css:86-95`).
  `PROGRAM (HOLD)` variants (`src/index.html:21,23,25`) sit as equal-weight siblings — the hardware
  has no such keys; they are a UI affordance for long-press and should look subordinate.
- **Fake meters.** `.meter` divs are static green text labels (`src/styles.css:20-26`,
  `src/index.html:11-16`) — placeholder cosplay, neither hardware-accurate nor functional.
- Minor: `src/main.js:46` looks up `#test-t-rate`, which doesn't exist in `index.html` (dead hook).

## 2. Design direction — the virtual rack unit

**Concept:** the page *is* the unit. A black 2U-style faceplate spanning the viewport on a dark
studio background; rack ears with machined screws (pseudo-elements); the LCD recessed behind a
smoked bezel as the single hero; controls grouped like the hardware (softkeys under the display,
function keys, cursor diamond, keypad, inc/dec as a data-wheel stand-in). Everything diagnostic
lives behind a "service panel" drawer (§3).

### Palette (CSS custom properties on `:root`)

Faceplate, from hardware: near-black with white silkscreen legends.

```
--rack-bg:      #0E0F11;  /* page behind the unit */
--faceplate:    #17181A;  /* main panel */
--faceplate-hi: #232529;  /* raised sections, subtle vertical gradient */
--panel-line:   #2E3136;  /* group separators / silkscreen rules */
--legend:       #D9D7CF;  /* warm-white silkscreen text */
--legend-dim:   #8C8A82;  /* secondary legends */
--btn-cap:      #26282B;  /* key caps */    --btn-edge: #0B0C0D;
--led-green:    #44E05A;  --led-red: #FF4136;  --led-amber: #FFB000;
```

Backlight — the captures are 1bpp so polarity/color is our call. Two plausible options:

- **Option A (recommended): green-phosphor negative mode** — lit pixels `--lcd-px: #3BF06E` on
  `--lcd-bg: #06140B`, dim/inactive `#1E7A3C`, glow `0 0 6px rgba(59,240,110,.45)`. Matches the
  existing canvas rendering and the HIL renders (`logs/hil-shot.png`); reads "Eventide" instantly.
- **Option B: yellow-green STN positive mode** — dark pixels `#1A2306` on a lit
  `#A8C81F → #8FB31A` gradient field. Closer to many period photos of backlit STN panels, but
  inverts every existing render and fights the canvas default.

Ship A unless the maintainer overrules (open question §5).

### Typography for `#lcd`

Strategy: a self-hosted pixel webfont via `@font-face` — a static asset, **not** a runtime dep.
The golden glyphs are a bold 6×8-cell bitmap face; the closest open match is **Pixel Operator
Mono Bold** (CC0/OFL, 8px design size). Stack:

```
font-family: 'OrvilleLCD', ui-monospace, Consolas, monospace;
font-size: 24px; line-height: 24px;   /* 8px cell × 3 */
letter-spacing: 0; -webkit-font-smoothing: none; text-rendering: optimizeSpeed;
```

Render at exact ×3 multiples only — fractional scaling smears pixel fonts. Fallback (zero-asset
interim): keep `monospace` but lock `font-size/line-height` to the same grid so the bezel math holds.

### Scale, bezel, proportion

- **×3 integer scale** for both screens: 240×64 → **720×192**. Update `CANVAS.CSS_WIDTH/HEIGHT` to
  `'720px'/'192px'` (`src/constants.js:69-70`) so canvas and `#lcd` are the *same physical size* —
  one display, two modes. `#lcd` stays 40ch wide (`LAYOUT.LCD_COLUMNS`, `src/constants.js:28`),
  `min-height: 192px`, **no max-height, no overflow scrollbars** — let it grow downward; the virtual
  view legitimately shows more rows (breadcrumb + ancestor softkeys) than the physical 8.
- **Bezel:** 24px smoked-plastic recess (`#0B0C0D`), `border-radius: 6px`, inset shadow
  `inset 0 2px 8px rgba(0,0,0,.8)`, plus a faint radial backlight bloom behind the glass. No CRT
  scanlines — this is an LCD, not a TV.
- **Proportion:** true 2U is ~5.4:1; with a web control surface that's unusably short. Target
  ~2.4:1 (e.g. 1280×~530 faceplate), 8px spacing base unit (one LCD pixel row at ×3), faceplate
  `border-radius: 4px`, rack-ear columns ~40px each side with screw heads at the corners.
- **In-LCD hooks** (the renderer contract, §4): `.softkey` → bordered tab, 1px `--lcd-px` outline,
  inverted (`background: var(--lcd-px); color: var(--lcd-bg)`) when the label is the bracketed
  current key; `.param-value`/`.param-select` → inversion on hover/focus instead of underline/green;
  `.back-link` → leading `◄`-style affordance via `::before`; `.meter-bar` → keep block glyphs, add
  glow; `.dsp-clickable.current` → inverted chip like the title bar in `screen-parameter.png`;
  `#lcd.loading` → dim backlight (`filter: brightness(.55)`) instead of `opacity: .5`.
- **Buttons:** key caps `--btn-cap` with 1px `--btn-edge` border, `border-radius: 3px`,
  `box-shadow: 0 2px 0 var(--btn-edge)` (depress on `:active` by translating 1px and dropping the
  shadow), 11px uppercase `--legend` labels in a grotesque stack
  (`font: 600 11px/1 'Segoe UI', system-ui, sans-serif; letter-spacing: .08em`). Hold-variants
  rendered half-height beneath their parent key, `--legend-dim` label.

## 3. Information architecture

Two audiences, one page today. Split *presentation*, keep every control:

1. **Faceplate (hero):** meters, LCD + canvas, soft1-4 (moved visually to sit directly under the
   display, aligned to the four `.bottom-docked` tabs), function keys, cursor diamond, keypad,
   inc/dec, A/B, bypass.
2. **Connection strip:** `connect`, port selects, `device-id`, `select-ports`, `save-config`,
   `clear-config`, plus a connection LED — styled as a slim utility row at the faceplate's top edge
   (where a power/status section would live). `log-level` moves to the service panel.
3. **Service panel:** a `<details class="service-panel">` drawer *below* the rack — native,
   zero JS — containing all of `src/index.html:80-99` (custom SysEx, sync, bitmap fetch toggles,
   debug-file upload, eager-load) and `#log-area` (restyled `width: 100%`, monospace 12px, dark).
   Styled as a drop-down service hatch: hazard-striped 1px top border, `--legend-dim` "SERVICE"
   summary tab. Nothing is removed; it's all one click away and out of the product shot.

## 4. Implementation plan

Contract that must survive (verified against `src/main.js:24-51`, `src/controls.js:91-127`,
`src/logger.js:14`, `src/event-bridge.js:190`):

- **IDs:** `lcd`, `lcd-canvas`, `log-area`, `connect`, `output-select`, `input-select`,
  `device-id`, `log-level`, `fetch-bitmap`, `update-bitmap-on-change`, `eager-load`,
  `select-ports`, `save-config`, `clear-config`, `poll-toggle`, `custom-sysex`, `send-custom`,
  `copy-log`, `test-keypress`, `sync-btn`, `get-screen-btn`, `upload-debug-file`,
  `process-debug-file`, `toggle-meter-polling`, `polling-indicator`; and the control keys
  `up/down/left/right-btn`, `enter-btn`, `select-btn`, `program-btn`, `parameter-btn`,
  `levels-btn`, `setup-btn`, `bypass-btn`, `inc-btn`, `dec-btn`, `soft1..4-btn`, `ab-btn`,
  `program/parameter/select-hold-btn`, `0..9-btn`, `dot-btn`, `minus-btn`, `cxl-btn`.
- **Renderer-emitted DOM inside `#lcd`** (style these; never require new markup):
  `.top-docked` / `.main-content` / `.bottom-docked` wrappers (`src/renderer.js:1002`),
  `.dsp-clickable[data-key]` + `.current` (`:454`), `.back-link[data-key]` (`:513`),
  `.softkey[data-key][data-idx]` (`:500,917,944,981,998`), `.param-value[data-key]`
  (`:347,643,652,766`), `select.param-select[data-key]` (`:596-602,728-734`),
  `.param-label` + `.meter-bar` (`:635,758`), `#lcd.loading`.
- **Snapshot tests** pin `#lcd` `outerHTML` (`tests/renderer.snapshot.test.js`) — that includes
  `#lcd`'s *own* class attribute. Pure-CSS phases are invisible to them. Do **not** add classes to
  `#lcd` itself or alter renderer string templates; style from ancestors/descendants only.

**Phase 2a — palette, typography, bezel (pure CSS + one constants tweak + font asset).**
Rewrite `styles.css` around `:root` tokens; `@font-face` for the pixel font (new
`src/fonts/` asset); LCD bezel/glow; ×3 scale; style all renderer hooks above; kill the
`!important` select block with specificity instead. Only non-CSS edits: `CANVAS` dimensions in
`src/constants.js:69-70` (bitmap.js re-inlines them every render, so CSS alone gets clobbered).
Zero `index.html` changes; zero snapshot churn.

**Phase 2b — faceplate layout + button styling (CSS + cosmetic HTML).** Body/rack-frame chrome,
ears, screws; regrouped grid (softkeys under display, keypad telephone-layout 3×5, cursor diamond
kept from `src/styles.css:60-78`); key-cap styling with `:active` travel; hold-buttons restyled
subordinate. `index.html` edits: add wrapper/section classes and shorten visible labels
(e.g. `PROGRAM (HOLD)` → small `HOLD`) — same elements, same IDs, no reordering that changes
behavior. `#lcd` untouched → snapshots still green.

**Phase 2c — service panel (HTML restructuring, still no JS).** Wrap `src/index.html:65-78` as the
connection strip; move `src/index.html:80-99` + `#log-area` into `<details class="service-panel">`;
relocate `log-level` there; replace the `polling-indicator` inline style (`src/index.html:83`) with
an LED class. All listeners bind by ID at module init and `<details>` content stays in the DOM, so
nothing breaks. `#lcd` subtree untouched → snapshots unaffected. (Any *future* phase that edits
renderer templates — e.g. chamfered softkey tabs needing extra spans — is where snapshots churn and
must update fixtures deliberately; out of scope for 2a-2c.)

## 5. Open questions for the maintainer

1. **Backlight:** Option A green-phosphor (recommended) or Option B yellow-green STN positive?
2. **Hero screen:** virtual `#lcd` as primary with the bitmap canvas relegated to the service
   panel, or side-by-side "virtual / actual" as a deliberate feature? (I'd hide the canvas behind
   the service panel by default; it's a verification tool.)
3. **Hold keys:** keep as visible mini-keys (proposed) or fold into a long-press gesture on the
   parent key in a later phase (JS change, out of scope here)?
4. **Chamfered softkey tabs** (the `( load )` shapes in `logs/program-screen.png`): worth a phase-3
   renderer-template change (snapshot churn) or is rectangular-tab fidelity enough?
