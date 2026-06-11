// renderer.js
import { appState } from './state.js';
import { CMD, KEY, KEY_PREFIX, ROOT_SOFTKEYS, TYPE_EMPTY } from './sysex-commands.js';
import { TIMING, LAYOUT, RENDER } from './constants.js';
import { setState } from './store.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, sendSysEx } from './midi.js';
import { showLoading } from './main.js';
import {
  getNode,
  deriveKeyStack,
  findParamUnder,
  labelForSub,
  isGangCol,
  bankProgramsFor,
  GANG_MAX_DEPTH,
} from './tree.js';
import { log } from './logger.js';
import { isSyncing } from './library.js';

/**
 * Updates the current screen by requesting OBJECTINFO_DUMP and VALUE_DUMP for the current key.
 * Clears currentValues to refresh data. Optionally clears softkeys at root/top levels.
 *
 * This is the single clear point for currentValues (C8/#44; structure now
 * lives in the persistent tree — T1b): every
 * navigation path (LCD clicks, keypress controls, sync, connect, polling)
 * funnels through here, so per-handler clears are redundant by construction.
 *
 * @param {Function} [logParam=null] - Optional logging function (defaults to global log).
 *
 * @example
 * updateScreen(log); // Refresh current menu
 */
export function updateScreen(logParam = null) {
  const patch = { currentValues: {} };
  if (
    appState.currentKey === KEY.ROOT ||
    [KEY.SETUP, KEY.PROGRAM, KEY.LEVELS, KEY.BYPASS].includes(appState.currentKey)
  ) {
    patch.currentSoftkeys = []; // Clear at root or top-level non-preset menu roots to prevent leakage
  }
  setState(patch, 'renderer:update-screen-clear');
  sendObjectInfoDump(appState.currentKey, logParam);
  sendValueDump(appState.currentKey, logParam);
}

/**
 * Handles clicks on the LCD element for DSP switches, softkeys, and back links.
 * Updates state and triggers screen updates accordingly.
 *
 * @param {Event} e - The click event.
 */
const handleLcdClick = (e) => {
  if (e.target.classList.contains('dsp-clickable')) {
    const newPresetKey = e.target.dataset.key;
    const patch = {
      presetKey: newPresetKey,
      currentKey: newPresetKey,
      pendingDescend: true,
      currentSoftkeys: [], // Clear softkeys on DSP switch
      keyStack: deriveKeyStack(newPresetKey), // T1b: ancestors from the tree
    };
    setState(patch, 'renderer:lcd-click-dsp-toggle');
    updateScreen();
  } else if (e.target.classList.contains('softkey')) {
    const newKey = e.target.dataset.key;
    // Re-clicking the highlighted CURRENT softkey is a no-op: the sibling
    // branch below excludes it, so it used to fall through to the descend
    // branch and push a duplicate self-entry onto the keyStack, rendering
    // the menu "inside itself" (C3 review finding).
    if (newKey === appState.currentKey) return;
    // The static bottom row (program/setup/levels/bypass) is a top-level
    // JUMP, not a descend (R2, live-validated): the bottom row is itself
    // the root affordance, so the jump RESETS the stack instead of deriving
    // it — deriving would yield [root] and re-render root's children (the
    // presets included) as crumb/fallback rows above the identical static
    // row, the exact duplicate-row class R2 removed. This is the one
    // deliberate exception to the T1b derive-everywhere rule.
    if (ROOT_SOFTKEYS.some((s) => s.key === newKey)) {
      log(
        `User clicked root softkey: ${newKey} - ${e.target.textContent.trim()}`,
        'info',
        'general'
      );
      setState(
        {
          keyStack: [],
          currentKey: newKey,
          paramOffset: 0,
          pendingDescend: true,
          currentSoftkeys: [],
        },
        'renderer:lcd-click-root-jump'
      );
      updateScreen();
      return;
    }
    if (appState.keyStack.length > 0) {
      const parentEntry = appState.keyStack[appState.keyStack.length - 1];
      // (newKey === currentKey is impossible here — the early return above.)
      if (parentEntry.subs.some((s) => s.key === newKey && s.type === 'COL')) {
        log(
          `User clicked sibling softkey: ${newKey} - ${e.target.textContent.trim()}`,
          'info',
          'general'
        );
        setState(
          {
            currentKey: newKey,
            paramOffset: 0,
            pendingDescend: true,
            keyStack: deriveKeyStack(newKey), // T1b: same parent, recomputed
          },
          'renderer:lcd-click-softkey-sibling'
        );
        updateScreen();
        return;
      }
    }
    log(
      `User clicked virtual softkey: ${newKey} - ${e.target.textContent.trim()}`,
      'info',
      'general'
    );
    setState(
      {
        keyStack: deriveKeyStack(newKey), // T1b: ancestors from the tree
        currentKey: newKey,
        paramOffset: 0, // Reset offset for new menu
        pendingDescend: true,
      },
      'renderer:lcd-click-softkey-descend'
    );
    updateScreen();
  } else if (e.target.classList.contains('back-link')) {
    const clickedKey = e.target.dataset.key;
    setState(
      {
        keyStack: deriveKeyStack(clickedKey), // T1b: ancestors from the tree
        currentKey: clickedKey,
        pendingDescend: true,
        currentSoftkeys: [],
      },
      'renderer:lcd-click-back'
    );
    updateScreen();
  }
};

/**
 * Handles changes to select elements for SET parameters.
 * Sends VALUE_PUT, updates state, refreshes screen, and handles auto-load for presets.
 *
 * @param {Event} e - The change event.
 */
const handleSelectChange = (e) => {
  // The library scan owns the bank/program selection while it runs — a
  // user put interleaved with it lands in whatever bank the scan happens
  // to be visiting, and the program auto-load would fire there (review).
  if (isSyncing()) {
    log('Value change ignored: library sync in progress', 'error', 'error');
    return;
  }
  const key = e.target.dataset.key;
  const selectedIndex = e.target.value;
  const selectedDesc = e.target.options[e.target.selectedIndex].text;
  log(
    `Selected option for key ${key}: index ${selectedIndex}, desc ${selectedDesc}`,
    'debug',
    'valueChange'
  );
  // Release focus (review): a closed select that keeps focus would park
  // every subsequent repaint (#131 defer guard) until the user happens to
  // click elsewhere — the post-change refresh and gang-sibling updates
  // must paint. Safe ordering: the blur-flush replays one tick later and
  // re-checks the parked slot, and the change's discard listener (runs
  // synchronously after this handler) clears it first — no stale replay.
  e.target.blur();
  showLoading();
  sendValuePut(key, selectedIndex);
  // Optimistic cache in the DEVICE's value shape: puts are parsed decimal
  // but values/echoes report the index in HEX (probed live,
  // logs/probe-bank-radix.mjs) — and renderScreen decodes the first token
  // with parseInt(_, 16). Caching the decimal index mis-selected options
  // >= 10 on every repaint until the echo corrected it.
  const optimisticValue = `${parseInt(selectedIndex, 10).toString(16)} ${selectedDesc}`;
  setState(
    { currentValues: { ...appState.currentValues, [key]: optimisticValue } },
    'renderer:select-change-value-cache'
  ); // Removed immediate renderScreen to avoid old subs with new value
  setTimeout(() => {
    if (key === KEY.BANK_SELECT) {
      // Bank scroll: the ONLY node whose options change is the load menu
      // (both of its SETs re-list for the new bank). The generic
      // updateScreen path refetches EVERY child of the staled program
      // subtree — measured live at 13.3s before the program list updated
      // (#138). One targeted dump is a single wave; the R7 child-arrival
      // repaint (or the progressive paint, if the load menu IS the current
      // key) updates the dropdowns the moment it lands.
      // Prune the load menu's STALE cached values (review blocker): this
      // branch skips updateScreen's full currentValues clear, and a stale
      // cache entry shadows the fresh dump's value in the render
      // precedence (currentValues[key] || s.value) — the program dropdown
      // would keep the OLD bank's selection and never self-correct.
      // The BANK key itself is deliberately KEPT: it holds the user's
      // just-made choice (optimistic hex cache above, confirmed by the
      // echo) — pruning it made the dropdown visibly SNAP BACK to the old
      // bank for the ~5s dump transfer, which the maintainer read as the
      // selection not taking at all (live-reproduced).
      const pruned = { ...appState.currentValues };
      delete pruned[KEY.PROGRAM_SELECT];
      delete pruned[KEY.FAVORITES];
      setState({ currentValues: pruned }, 'renderer:bank-change-prune');
      // Wipe-proof copy of the choice (#141 review): currentValues can be
      // cleared mid-transfer by any updateScreen; programSelectView falls
      // back to this until the load-menu dump converges.
      chosenBankIdx = parseInt(selectedIndex, 10);
      sendObjectInfoDump(KEY.FAVORITES);
      sendValueDump(KEY.FAVORITES);
      // Paint NOW (#141, live finding): puts do not join waves, so without
      // an explicit repaint nothing paints until the targeted dump drains
      // (~4-5s) — the program field's memo (revisited bank, instant) or
      // loading line (unseen bank) must show immediately.
      renderScreen(appState.currentSubs, appState.lastAscii);
    } else if (key === KEY.PROGRAM_SELECT) {
      // Choosing a program only moves the highlight (no load now — the
      // auto-load was removed). It does NOT change the menu, so skip the
      // full updateScreen refetch (the "syncing with the system" lag the
      // maintainer saw): the optimistic hex cache already shows the pick,
      // so repaint immediately and just confirm the value on the wire.
      renderScreen(appState.currentSubs, appState.lastAscii);
      sendValueDump(KEY.PROGRAM_SELECT);
    } else {
      updateScreen();
    }
    if (appState.updateBitmapOnChange) {
      sendSysEx(CMD.GET_SCREEN, []);
      log('Triggered bitmap update after value change.', 'debug', 'bitmap');
    }
    setTimeout(() => {
      const newValue = appState.currentValues[key];
      if (newValue && newValue.includes(selectedDesc)) {
        log(`Value update successful for key ${key}: ${newValue}`, 'debug', 'valueChange');
      } else {
        log(
          `Value update failed for key ${key}. Expected desc: ${selectedDesc}, got: ${newValue}`,
          'debug',
          'valueChange'
        );
      }
    }, TIMING.VALUE_DUMP_WAIT_MS); // Wait for VALUE_DUMP to arrive
    // NOTE: choosing a program from the dropdown only HIGHLIGHTS it (sets
    // the device's selected slot) — it does NOT load it. Loading is the
    // explicit '<- load program in A/B' TRG (handleParamClick), matching
    // the hardware: scroll picks, SELECT/<load>/ENT applies (manual p.21,
    // maintainer request). The old auto-load fired the trigger here.
  }, TIMING.MIDI_SETTLE_MS); // Delay to allow MIDI update
};

/**
 * Handles clicks on parameter values for editing NUM or triggering TRG types.
 * Prompts for NUM changes, validates, sends VALUE_PUT, and updates screen.
 *
 * @param {Event} e - The click event.
 */
// Commit a NUM/STR edit: the shared post-edit flow (cache, immediate
// repaint, settled refresh) the prompt-era branches both carried.
function commitParamEdit(key, newValue, origin) {
  showLoading();
  sendValuePut(key, newValue);
  setState({ currentValues: { ...appState.currentValues, [key]: newValue } }, origin);
  renderScreen(appState.currentSubs, appState.lastAscii); // Immediate local update
  setTimeout(() => {
    updateScreen();
    if (appState.updateBitmapOnChange) {
      sendSysEx(CMD.GET_SCREEN, []);
      log('Triggered bitmap update after value change.', 'debug', 'bitmap');
    }
  }, TIMING.MIDI_SETTLE_MS);
}

// In-LCD inline editor (maintainer ask: no browser prompt/alert boxes).
// Clicking a NUM/STR value swaps the span for a phosphor-styled <input>
// IN the glass: Enter validates + commits, Escape cancels, invalid input
// flashes inverse and stays for correction (no alert). While the editor
// is focused the #131 defer guard parks repaints, exactly like an open
// dropdown, so a mid-edit wave cannot destroy the field.
function beginInlineEdit(span, sub, { validate, maxLength }) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'lcd-edit';
  input.dataset.key = sub.key;
  const current = String(appState.currentValues[sub.key] ?? sub.value ?? '');
  input.value = current;
  if (maxLength) input.maxLength = maxLength;
  // ch tracks the LCD advance exactly (zero letter-spacing, 6x8 face), so
  // the field occupies the columns the value did, plus room to type.
  input.style.width = `${Math.max(current.length + 2, 8)}ch`;
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    input.blur(); // release the #131 guard (the Escape path keeps focus otherwise)
    // currentSubs is always the latest pin (the parser updates it before
    // emitting), so any paint parked during the edit is never newer than
    // a fresh render — discard it rather than double-painting.
    discardDeferredPaint();
    // Remove the editor synchronously (review: a click that opens ANOTHER
    // editor would otherwise park the cleanup repaint behind the new
    // editor's #131 guard, stranding this one live in the glass).
    input.remove();
    // Next tick (the SF4 pattern): a synchronous repaint inside the blur
    // of a click elsewhere would destroy that click's target.
    setTimeout(() => {
      if (!lcdSelectFocused(document.getElementById('lcd'))) {
        renderScreen(appState.currentSubs, appState.lastAscii);
      }
    }, 0);
  };
  input.addEventListener('keydown', (ev) => {
    if (done) return; // a finished editor must never commit (review)
    if (ev.key === 'Enter') {
      const value = validate(input.value);
      if (value === null) {
        input.classList.add('lcd-edit-invalid');
        return;
      }
      done = true;
      input.blur(); // release the #131 guard BEFORE the commit's immediate repaint
      // The commit's own repaint supersedes anything parked mid-edit —
      // discard it here too, or the next dropdown blur replays it (review).
      discardDeferredPaint();
      commitParamEdit(sub.key, value, 'renderer:inline-edit-commit');
    } else if (ev.key === 'Escape') {
      finish();
    } else {
      input.classList.remove('lcd-edit-invalid');
    }
  });
  input.addEventListener('blur', finish);
}

const handleParamClick = (e) => {
  if (isSyncing()) {
    log('Edit ignored: library sync in progress', 'error', 'error');
    return;
  }
  if (e.target.classList.contains('param-value')) {
    const key = e.target.dataset.key;
    // Find the sub for title and limits (tree lookup for embedded children)
    const sub =
      appState.currentSubs.find((s) => s.key === key) || findParamUnder(appState.currentKey, key);
    if (sub) {
      if (sub.type === 'NUM') {
        beginInlineEdit(e.target, sub, {
          validate: (raw) => {
            const parsed = parseFloat(raw);
            const min = parseFloat(sub.min) || -Infinity;
            const max = parseFloat(sub.max) || Infinity;
            return !isNaN(parsed) && parsed >= min && parsed <= max ? raw.trim() : null;
          },
        });
      } else if (sub.type === 'TRG') {
        showLoading();
        if (key === KEY.LOAD_TRIGGER_A || key === KEY.LOAD_TRIGGER_B) {
          log('Started loading preset.', 'info', 'general');
        }
        sendValuePut(key, '1');
        log(`Triggered TRG for key ${key}: ${sub.statement}`, 'info', 'general');
        renderScreen(appState.currentSubs, appState.lastAscii); // Immediate local update
        setTimeout(() => {
          updateScreen();
          if (key === KEY.LOAD_TRIGGER_A || key === KEY.LOAD_TRIGGER_B) {
            // Fetch root to update preset names after loading a new program
            sendObjectInfoDump(KEY.ROOT);
            log('Fetched root after preset load.', 'debug', 'general');
          }
          if (appState.updateBitmapOnChange) {
            sendSysEx(CMD.GET_SCREEN, []);
            log('Triggered bitmap update after TRG.', 'debug', 'bitmap');
          }
        }, TIMING.DEVICE_LOAD_MS); // Increased delay for device to process load
      } else if (sub.type === 'STR') {
        // String-edit (R8): free-text put, confirmed live (the device echoes
        // the new value as a 0x2e). Multi-word strings confirmed on hardware
        // too — the device quotes them in the echo, so readback is safe
        // (#104). Validation rules carried over from the prompt era:
        // empty rejected (the device ignores empty-string puts — probed
        // live, #104), 7-bit printable ASCII only (SysEx data bytes),
        // clamped to the declared field width (e.g. %-22s).
        const widthMatch = (sub.statement || '').match(/%-?(\d+)s/);
        beginInlineEdit(e.target, sub, {
          maxLength: widthMatch ? parseInt(widthMatch[1], 10) : undefined,
          validate: (raw) => {
            if (raw === '' || !/^[\x20-\x7e]*$/.test(raw)) return null;
            return widthMatch ? raw.slice(0, parseInt(widthMatch[1], 10)) : raw;
          },
        });
      }
    }
  }
};

/**
 * Formats a value according to a statement string (e.g., '%3.0f' for floats, '%-10s' for strings).
 * Supports HTML wrapping for clickable/editable values.
 *
 * @param {string} statement - Format string (e.g., '%-10.2f').
 * @param {string|number} value - Value to format.
 * @param {boolean} [isHtml=false] - If true, wraps in HTML span for params.
 * @param {string} [key=''] - Key for data-key attribute in HTML.
 * @returns {string} Formatted string (text or HTML).
 *
 * @example
 * formatValue('%3.0f dB', 5.5); // '  6 dB'
 * formatValue('%-10s', 'test', true, 'key123'); // '<span class="param-value" data-key="key123">test      </span>'
 */
// Every value format specifier the device's statement strings use (%f and %s
// families plus the literal '%%', which collapses to a single '%' — the
// leading alternative, so the device's percent-suffix statements like
// 'diff/time : %3.0f %%' render '60 %' and not '60 %%' on EVERY param
// path (R10 review: only the CON branch used to collapse, post-hoc).
// Shared by formatValue and the R3 pre-paint placeholder substitution.
const FORMAT_SPEC_RE = /%%|%(-)?(\d*)(\.\d*)?f|%(-)?(\d*)s|%/g;

// Does a string contain a REAL value format spec ('%[-][width][.prec]f' or
// '%[-][width]s')? Used to decide whether a CON's statement/tag is a format
// (R10) — deliberately tighter than FORMAT_SPEC_RE's bare-'%' alternative,
// so a hypothetical literal like '% of files' is not misread as a format.
// No /g flag: .test() on a global regex is lastIndex-stateful.
const CON_FORMAT_RE = /%-?\d*(\.\d*)?f|%-?\d*s/;

// Device text goes into #lcd via innerHTML, and device labels DO contain
// HTML metacharacters — e.g. the multitap delay's 'fb<tap1' feedback
// label. Unescaped, the browser parsed '<tap1' as a tag: it ate the rest
// of the label (rendered just 'fb') and, never closing, wrapped every line
// below it so one hover lit the whole screen. Escape all device-supplied
// text at every HTML interpolation point (live bug).
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatValue(statement, value, isHtml = false, key = '') {
  // When building HTML, escape the statement's LITERAL text up front; the
  // format specs ('%4.0f' etc.) contain no HTML metacharacters, so the
  // regex still matches, and the spans we inject below stay intact.
  const stmt = isHtml ? escapeHtml(statement) : statement;
  return stmt.replace(
    FORMAT_SPEC_RE,
    (match, fLeftFlag, fWidthStr, precStr, sLeftFlag, sWidthStr) => {
      if (match === '%%' || match === '%') return '%';
      if (fLeftFlag !== undefined || fWidthStr !== undefined || precStr !== undefined) {
        // %[-]width[.prec]f
        const leftAlign = fLeftFlag === '-';
        const width = parseInt(fWidthStr || '0');
        const prec = parseInt(precStr ? precStr.slice(1) : '0');
        let valStr = parseFloat(value).toFixed(prec);
        if (width) {
          valStr = leftAlign ? valStr.padEnd(width) : valStr.padStart(width);
        }
        if (isHtml) {
          // valStr is numeric (no metacharacters); the data-key is an app
          // hex key — both safe.
          return `<span class="param-value" data-key="${key}">${valStr}</span>`;
        }
        return valStr;
      } else if (sLeftFlag !== undefined || sWidthStr !== undefined) {
        // %[-]widths — a STRING value, which CAN carry metacharacters.
        const leftAlign = sLeftFlag === '-';
        const width = parseInt(sWidthStr || '0');
        const v = isHtml ? escapeHtml(value) : value;
        if (width === 0) return v;
        return leftAlign ? v.padEnd(width) : v.padStart(width);
      }
      return match;
    }
  );
}

/**
 * Renders the screen to the LCD element using subs.
 * Builds text/HTML lines for titles, params (NUM/SET/CON/TRG/INF), softkeys (current, parent, grandparent, static).
 * Handles embedding child subs, auto-fetching, event listeners, and auto-load.
 *
 * @param {Object[]} subs - Parsed sub-objects (required).
 * @param {string} [ascii] - Raw ASCII dump string.
 * @param {Function} [logParam] - Logging function.
 *
 * @example
 * renderScreen(parsedSubs, asciiDump, log);
 */
// R3 (#106): true while renderScreen is repainting from the tree cache
// because the navigated-to key's live dump has not landed yet. The pre-paint
// pass renders structure (title, breadcrumb, COL softkeys) but inert
// placeholder lines for params — no clickable values, no value refetches
// (the real render issues those), and NO currentSubs render-pin, so
// currentSubs stays device-confirmed (and the tree audit settles on the
// real dump, never on a cache paint).
let prePainting = false;

// Open-dropdown repaint guard (#131): replacing #lcd's innerHTML while the
// user has a SET dropdown open destroys the select mid-interaction — and
// progressive paints land throughout a wave, so the dropdown "constantly
// closes until loading finishes" (maintainer report). While a select inside
// #lcd is focused, repaints are DEFERRED: the latest paint's arguments park
// here and replay when the select blurs. A change DISCARDS the parked paint
// instead — handleSelectChange's own updateScreen supersedes it.
let deferredPaint = null;

// Which #lcd select currently has its native popup OPEN — inferred, since
// Chrome exposes no API. mousedown on a select toggles its popup; change
// and blur always close it. Inference matters (live bug, reproduced in
// logs/probe-bank-focus.mjs): a select RETAINS focus after its popup
// closes (after picking, after Esc, after a look), and parking on mere
// focus froze every repaint indefinitely — the user watched the program
// list never refilter after a bank change. Known gap: a keyboard-opened
// popup (Alt+Down) is not inferred and may be closed by a repaint.
let openLcdSelect = null;
const handleSelectMousedown = (e) => {
  const wasOpen = openLcdSelect === e.target;
  openLcdSelect = wasOpen ? null : e.target;
  if (wasOpen) flushDeferredPaint(); // toggle-close releases parked paints
};
const noteSelectClosed = (el) => {
  if (openLcdSelect === el) openLcdSelect = null;
};
// change/blur both mean the popup is closed; they pair the close marker
// with the existing #131 discard/flush semantics.
const handleSelectChangeClosed = (e) => {
  noteSelectClosed(e.target);
  discardDeferredPaint();
};
const handleSelectBlurClosed = (e) => {
  noteSelectClosed(e.target);
  flushDeferredPaint();
};

function lcdSelectFocused(lcdEl) {
  const active = document.activeElement;
  if (!active || !lcdEl.contains(active)) return false;
  // The in-glass inline editor parks while focused (focus = mid-edit);
  // a dropdown parks only while its popup is actually open.
  if (active.classList.contains('lcd-edit')) return true;
  return active.tagName === 'SELECT' && active === openLcdSelect;
}

const discardDeferredPaint = () => {
  deferredPaint = null;
};

const flushDeferredPaint = () => {
  if (!deferredPaint) return;
  // One tick later, never synchronously (review): blur fires between the
  // mousedown and click of whatever the user clicked next inside #lcd —
  // replacing innerHTML here would destroy the click target and drop that
  // navigation. The R3 guard re-validates the parked args against
  // currentKey at replay time, so a navigation that wins the tick is safe.
  setTimeout(() => {
    if (!deferredPaint) return;
    const args = deferredPaint;
    deferredPaint = null;
    renderScreen(...args);
  }, 0);
};

// A param line with every value slot blanked to the placeholder: the
// statement (else the tag) with format specifiers substituted; '%%'
// collapses to a literal '%' via the shared regex's leading alternative.
const placeholderLine = (s) =>
  (s.statement || s.tag || '').replace(FORMAT_SPEC_RE, (m) =>
    m === '%%' || m === '%' ? '%' : RENDER.VALUE_PLACEHOLDER
  );

// #132: one rendered line for a gang-inlined leaf param — the same type
// semantics as the embedded-child branch (value source, fetch rule, SET
// index decoding), kept as its own function so the two existing render
// paths and their snapshots stay byte-identical.
function gangParamLine(s, logParam) {
  if (s.type === 'NUM') {
    const value = appState.currentValues[s.key] || s.value;
    if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, logParam);
    const formatStr = s.statement || s.tag || '';
    return {
      text: formatValue(formatStr, value),
      html: formatValue(formatStr, value, true, s.key),
    };
  } else if (s.type === 'INF') {
    const value = appState.currentValues[s.key] || s.value || '';
    if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, logParam);
    const text = formatValue(s.statement, value);
    return { text, html: escapeHtml(text) };
  } else if (s.type === 'SET') {
    const value = appState.currentValues[s.key] || s.value || '';
    if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, logParam);
    let displayValue = value;
    let indexHex = '0';
    if (value) {
      indexHex = value.split(' ')[0];
      displayValue = value.substring(indexHex.length + 1);
    }
    const indexDec = parseInt(indexHex, 16).toString(10);
    let selectHtml = `<select data-key="${s.key}" class="param-select">`;
    s.options.forEach((option) => {
      const isSelected = option.index === indexDec;
      selectHtml += `<option value="${option.index}" ${isSelected ? 'selected' : ''}>${escapeHtml(option.desc)}</option>`;
    });
    selectHtml += `</select>`;
    return {
      text: formatValue(s.statement || '', displayValue),
      html: escapeHtml(s.statement || '').replace(/%(-)?(\d*)s/g, selectHtml),
    };
  } else if (s.type === 'TRG') {
    return {
      text: s.statement,
      html: `<span class="param-value" data-key="${s.key}">${escapeHtml(s.statement)}</span>`,
    };
  } else if (s.type === 'STR') {
    const value = appState.currentValues[s.key] ?? s.value ?? '';
    if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, logParam);
    const text = formatValue(s.statement || '%s', value);
    return {
      text,
      html: `<span class="param-value" data-key="${s.key}">${escapeHtml(text)}</span>`,
    };
  } else if (s.type === 'CON') {
    let meterValue = parseFloat(appState.currentValues[s.key] || s.value) || 0;
    if (isNaN(meterValue)) meterValue = 0;
    const conFormat = CON_FORMAT_RE.test(s.statement)
      ? s.statement
      : CON_FORMAT_RE.test(s.tag)
        ? s.tag
        : null;
    if (conFormat) {
      const text = formatValue(conFormat, meterValue);
      return { text, html: escapeHtml(text) };
    }
  }
  return null;
}

// #132: inline a gang COL subtree (the routing matrix shape — manual p.20's
// ganged parameters) into the current page, the way the hardware shows it.
// Group headers render at the top level always; a PAIR header renders only
// when its params' statements are all identical (the OutSource rows are
// bare '%12s  (+)' lines — without the pair label they are ambiguous; the
// Source/In rows self-describe with '-> IN1' / 'A IN1 Gain'). Uncached
// groups render a loading placeholder; the gang fan-out (parser) is
// fetching them and the child-arrival repaint (bridge) repaints on landing.
function renderGangInline(colSub, depth, paramLines, paramHtmlLines, logParam) {
  if (depth > GANG_MAX_DEPTH) return;
  const node = getNode(colSub.key);
  const header = (colSub.statement || '').trim();
  const children = node ? node.slice(1) : [];
  const paramChildren = children.filter((c) => c.type !== 'COL' && c.type !== TYPE_EMPTY);
  const identicalStatements =
    paramChildren.length > 1 &&
    paramChildren.every((c) => c.statement === paramChildren[0].statement);
  if (header && (depth === 0 || identicalStatements)) {
    paramLines.push(header);
    paramHtmlLines.push(escapeHtml(header));
  }
  if (!node) {
    const text = `${header || labelForSub(colSub)} ${RENDER.VALUE_PLACEHOLDER}`;
    paramLines.push(text);
    paramHtmlLines.push(escapeHtml(text));
    return;
  }
  for (const cs of children) {
    if (cs.type === 'COL') {
      if (isGangCol(cs)) renderGangInline(cs, depth + 1, paramLines, paramHtmlLines, logParam);
      continue;
    }
    if (cs.type === TYPE_EMPTY) continue;
    if (prePainting) {
      const text = placeholderLine(cs);
      if (text) {
        paramLines.push(text);
        paramHtmlLines.push(escapeHtml(text));
      }
      continue;
    }
    const line = gangParamLine(cs, logParam);
    if (line && line.text) {
      paramLines.push(line.text);
      paramHtmlLines.push(line.html);
    }
  }
}

// Program-select view resolution (#141): the device's load-menu dump
// carries ONLY the currently-selected bank's program list, so when the
// user's chosen bank differs from the bank the dump was taken in, the
// dump's options are the OLD bank's — never show them. Serve the session
// memo (tree.js) when this bank has been seen, else an honest loading
// line until the targeted dump lands ("its the fact we keep the old
// stuff around thats the issue" — maintainer).
// Returns: {stale:false} = render the dump as usual; {loading:true} =
// render RENDER.LOADING_PROGRAMS; {options,value} = render the memo.
//
// The chosen bank lives in MODULE state, not only the optimistic cache
// (review): a program pick from the memoized list runs the generic
// updateScreen refresh, which wipes currentValues wholesale mid-transfer
// — the cache-only check then fell back to the dump and repainted the
// old bank's list. Set by the bank-change handler; self-clears when the
// load-menu dump converges on the chosen bank.
let chosenBankIdx = null;

/** Clears the chosen-bank module state (tests). */
export function resetProgramSelectView() {
  chosenBankIdx = null;
}

function programSelectView(s, siblings) {
  if (s.key !== KEY.PROGRAM_SELECT) return { stale: false };
  const bankSub = siblings.find((x) => x.key === KEY.BANK_SELECT);
  if (!bankSub?.value) return { stale: false };
  const cachedRaw = appState.currentValues[KEY.BANK_SELECT];
  const cached = cachedRaw ? parseInt(String(cachedRaw).split(' ')[0], 16) : NaN;
  const chosen = !isNaN(cached) ? cached : chosenBankIdx;
  const inDump = parseInt(String(bankSub.value).split(' ')[0], 16);
  if (chosen === null || isNaN(inDump) || chosen === inDump) {
    if (chosen !== null && chosen === inDump) chosenBankIdx = null; // converged
    return { stale: false };
  }
  const memo = bankProgramsFor(chosen);
  if (memo) return { stale: true, options: memo.options, value: memo.value };
  return { stale: true, loading: true };
}

export function renderScreen(subs, ascii, logParam) {
  const lcdEl = document.getElementById('lcd');
  if (!subs || subs.length === 0) {
    log('Skipping render: no subs available', 'debug', 'renderScreen');
    return;
  }
  if (lcdSelectFocused(lcdEl)) {
    deferredPaint = [subs, ascii, logParam];
    log('Deferring repaint: a SET dropdown is open (#131)', 'debug', 'renderScreen');
    return;
  }
  // R3 render guard (#106): these subs describe a DIFFERENT node than the
  // one navigated to — the new key's dump is still in flight. Never paint
  // the old menu under the new key (live bug: "[program] program functions"
  // titled as levels for seconds on a backed-up link). Pre-paint the tree's
  // cached structure instead, or an honest loading title when the tree has
  // never seen the key.
  if (!prePainting && subs[0]?.key !== appState.currentKey) {
    // Root with no cached dump: the ROOT render branch never displays a
    // title and filters the main sub out of its softkey rows, so the
    // synthetic loading node would paint a blank screen. Keeping the old
    // DOM beats painting nothing — skip the paint entirely (the root dump
    // is always the connect flow's first fetch, so this is a cold-start
    // corner only).
    if (appState.currentKey === KEY.ROOT && !getNode(KEY.ROOT)) {
      log('Render guard (R3): root not cached yet; skipping paint', 'debug', 'renderScreen');
      return;
    }
    const cached = getNode(appState.currentKey) || [
      {
        type: 'COL',
        position: '0',
        key: appState.currentKey,
        parent: appState.currentKey,
        statement: RENDER.LOADING_STATEMENT,
        tag: '',
      },
    ];
    log(
      `Render guard (R3): dump for ${subs[0]?.key} != current ${appState.currentKey}; pre-painting ${getNode(appState.currentKey) ? 'cached structure' : 'loading view'}`,
      'debug',
      'renderScreen'
    );
    prePainting = true;
    try {
      renderScreen(cached, '', logParam);
    } finally {
      prePainting = false;
    }
    return;
  }
  if (!prePainting) setState({ currentSubs: subs }, 'renderer:render-pin');
  const main = subs[0];
  if (!main) {
    log('Skipping render: main sub undefined', 'debug', 'renderScreen');
    return;
  }
  let displayLines = [];
  let paramLines = [];
  let paramHtmlLines = [];
  let isTabLineAdded = false;
  let topHtml = '';
  let softSubs = [];
  let localSoftSubs = [];
  if (appState.dspAName && appState.dspBName) {
    const isAActive = appState.presetKey.startsWith(KEY_PREFIX.DSP_A);
    const aPart = isAActive ? `[A: ${appState.dspAName}]` : `A: ${appState.dspAName}`;
    const bPart = !isAActive ? `[B: ${appState.dspBName}]` : `B: ${appState.dspBName}`;
    topHtml = ` <span class="${isAActive ? 'dsp-clickable current' : 'dsp-clickable'}" data-key="${appState.dspAKey}">${escapeHtml(aPart)}</span> <span class="${!isAActive ? 'dsp-clickable current' : 'dsp-clickable'}" data-key="${appState.dspBKey}">${escapeHtml(bPart)}</span>`;
    if (
      appState.currentKey === KEY.ROOT ||
      appState.currentKey.startsWith(KEY_PREFIX.DSP_A) ||
      appState.currentKey.startsWith(KEY_PREFIX.DSP_B)
    ) {
      displayLines.push(` ${aPart} ${bPart}`);
      isTabLineAdded = true;
    }
  }
  let titleText;
  let titleHtml;
  let mainHtmlLines = [];
  if (appState.currentKey === KEY.ROOT) {
    displayLines.push('');
    displayLines.push('');
    const softSubsUsed = subs.filter(
      (s) =>
        s.type === 'COL' &&
        s.key !== KEY.DSP_A_PRESET &&
        s.key !== KEY.DSP_B_PRESET &&
        s.key !== KEY.ROOT_META &&
        s.key !== KEY.ROOT
    );
    const itemsPerLine = LAYOUT.SOFTKEYS_PER_LINE;
    let softTextLines = [];
    for (let i = 0; i < softSubsUsed.length; i += itemsPerLine) {
      const slice = softSubsUsed.slice(i, i + itemsPerLine);
      const columnWidth = Math.floor(LAYOUT.LCD_COLUMNS / slice.length);
      const softTags = slice.map((s) => {
        const t = labelForSub(s);
        const text = (s.key === appState.currentKey ? `[${t}]` : t).padEnd(columnWidth);
        return text;
      });
      softTextLines.push(softTags.join(''));
    }
    displayLines.push(...softTextLines);
    // Build clickable HTML for root softkeys
    let softHtmlLines = [];
    for (let i = 0; i < softSubsUsed.length; i += itemsPerLine) {
      let softHtml = '';
      const slice = softSubsUsed.slice(i, i + itemsPerLine);
      const columnWidth = Math.floor(LAYOUT.LCD_COLUMNS / slice.length);
      slice.forEach((s, idx) => {
        const t = labelForSub(s);
        const text = (s.key === appState.currentKey ? `[${t}]` : t).padEnd(columnWidth);
        softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${escapeHtml(text)}</span>`;
      });
      softHtmlLines.push(softHtml);
    }
    mainHtmlLines.push(''); // blank
    mainHtmlLines.push(''); // blank
    mainHtmlLines = mainHtmlLines.concat(softHtmlLines);
  } else {
    titleText = main.statement || main.tag || 'Menu';
    titleHtml = escapeHtml(titleText);
    if (appState.keyStack.length > 0) {
      const parent = appState.keyStack[appState.keyStack.length - 1];
      titleText = `[${parent.tag}] ${titleText}`;
      titleHtml = `<span class="back-link" data-key="${parent.key}">[${escapeHtml(parent.tag)}]</span> ${escapeHtml(main.statement || main.tag || 'Menu')}`;
    }
    displayLines.push(titleText);
    // Group graphic EQ NUMs with position 'a'. The pre-paint pass keeps the
    // grouped one-line layout (placeholder values, no fetches) so the real
    // render doesn't collapse N lines into one when the dump lands (R3).
    const graphicEqSubs = subs.slice(1).filter((s) => s.type === 'NUM' && s.position === 'a');
    let graphicEqLine;
    let graphicEqHtml;
    if (graphicEqSubs.length > 0 && prePainting) {
      const line = graphicEqSubs
        .map((s) => `${s.tag.split(':')[0]}: ${RENDER.VALUE_PLACEHOLDER}`)
        .join(' ');
      paramLines.push(line);
      paramHtmlLines.push(escapeHtml(line));
    } else if (graphicEqSubs.length > 0) {
      const formattedParts = graphicEqSubs.map((s) => {
        const value = appState.currentValues[s.key] || s.value;
        // Fetch only when the dump carried NO value either — the same rule
        // SET/INF/STR always had (#107: the missing !s.value guard made
        // every settled render resend dump-valued NUMs, and each solo
        // wave's watchdog render resent again — a self-perpetuating
        // refetch loop measured live). Empty string stays confirmed-absent
        // (C1): no refetch.
        if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key);
        // Parse tag like 'v1:%3.0f' for label and format
        const [label, format] = s.tag.split(':');
        const formattedValue = formatValue(format || '%3.0f', value);
        return `${label}: ${formattedValue}`;
      });
      graphicEqLine = formattedParts.join(' ');
      // For HTML, wrap each value in span for potential editing
      const formattedHtmlParts = graphicEqSubs.map((s) => {
        const value = appState.currentValues[s.key] || s.value;
        const [label, format] = s.tag.split(':');
        const formattedValue = formatValue(format || '%3.0f', value, true, s.key);
        return `${escapeHtml(label)}: ${formattedValue}`;
      });
      graphicEqHtml = formattedHtmlParts.join(' ');
      paramLines.push(graphicEqLine);
      paramHtmlLines.push(graphicEqHtml);
    }
    subs.slice(1).forEach((s) => {
      if (prePainting) {
        // R3: one inert placeholder line per param — no clickable spans,
        // no selects, and no value refetches (the real render issues those
        // when the live dump lands). 'a'-positioned NUMs already rendered
        // as the grouped graphic-EQ placeholder line above.
        if (s.type === 'COL' || s.type === TYPE_EMPTY || s.position === 'a') return;
        const text = placeholderLine(s);
        if (text) {
          paramLines.push(text);
          paramHtmlLines.push(escapeHtml(text));
        }
        return;
      }
      if (s.position === 'a') return; // Skip individual 'a' after grouping
      let fullText = '';
      let fullHtml = '';
      if (s.type === 'NUM') {
        const value = appState.currentValues[s.key] || s.value;
        // Same fetch rule as SET/INF/STR — see the graphic-EQ comment
        // above (#107). Empty string = confirmed-absent, no refetch (C1).
        if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key);
        const formatStr = s.statement || s.tag || '';
        fullText = formatValue(formatStr, value);
        fullHtml = formatValue(formatStr, value, true, s.key);
      } else if (s.type === 'INF') {
        let value = appState.currentValues[s.key] || s.value || '';
        if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, logParam);
        fullText = formatValue(s.statement, value); // Use updated formatValue with s support
        fullHtml = escapeHtml(fullText); // INF isn't clickable: escape, add no span
      } else if (s.type === 'SET') {
        const progView = programSelectView(s, subs.slice(1));
        if (progView.loading) {
          // #141: the chosen bank's list is on the wire and unseen — an
          // honest loading line, never the old bank's options.
          fullText = RENDER.LOADING_PROGRAMS;
          fullHtml = fullText;
        } else {
          const options = progView.options ?? s.options;
          // Stale branch: a program the user just picked from the memoized
          // list (optimistic cache) beats the memo's remembered selection.
          let value = progView.stale
            ? appState.currentValues[s.key] || progView.value
            : appState.currentValues[s.key] || s.value || '';
          if (!progView.stale && appState.currentValues[s.key] === undefined && !s.value)
            sendValueDump(s.key, logParam);
          let displayValue = value;
          let indexHex = '0';
          if (value) {
            indexHex = value.split(' ')[0];
            displayValue = value.substring(indexHex.length + 1);
          }
          const indexDec = parseInt(indexHex, 16).toString(10);
          fullText = formatValue(s.statement || '', displayValue); // Use formatValue for %-width s
          let selectHtml = `<select data-key="${s.key}" class="param-select">`;
          options.forEach((option) => {
            const isSelected = option.index === indexDec;
            selectHtml += `<option value="${option.index}" ${isSelected ? 'selected' : ''}>${escapeHtml(option.desc)}</option>`;
          });
          selectHtml += `</select>`;
          // Escape the statement's literal text before splicing in the
          // select (which is intentional markup).
          fullHtml = escapeHtml(s.statement || '').replace(/%(-)?(\d*)s/g, selectHtml);
        }
      } else if (s.type === 'CON') {
        let meterValue = parseFloat(appState.currentValues[s.key] || s.value) || 0;
        if (isNaN(meterValue)) {
          meterValue = 0; // Default to 0 if invalid value
        }
        // CON display semantics (probed live, device-model §3/§12): values
        // arrive in DISPLAY units (assign monitors 0-100 with a '%%'
        // format; file sizes in raw bytes), and the format spec can live
        // in the TAG when the statement is blank (the pedal monitors:
        // statement '', tag '%2.1f%%'). The old statement-only check sent
        // pedal monitors down the bar path with the literal format string
        // as their label, and the old *100 "percent inflation" assumed 0-1
        // fractions — live values disprove it ('monitor = %2.2f%%' at
        // 100.03 rendered as 10003.00%).
        const conFormat = CON_FORMAT_RE.test(s.statement)
          ? s.statement
          : CON_FORMAT_RE.test(s.tag)
            ? s.tag
            : null;
        if (conFormat) {
          fullText = formatValue(conFormat, meterValue); // '%%' collapses in formatValue
          fullHtml = escapeHtml(fullText);
        } else {
          // No format spec anywhere: an indicator CON (the Tempo 'Beat'
          // flasher is the only live-observed case) — render a compact
          // flash block, treating the value as a 0-1 fraction, clamped.
          // Width-capped (live external-clock test): the binary flasher as
          // a full-LCD slab overwhelmed the page.
          const tagLength = s.tag.length;
          const barSpace = Math.min(RENDER.INDICATOR_BAR_CELLS, LAYOUT.LCD_COLUMNS - tagLength - 1);
          let barLength = Math.round(meterValue * barSpace);
          barLength = Math.max(0, Math.min(barSpace, barLength)); // Clamp to prevent invalid repeat counts
          const bar = '█'.repeat(barLength) + '░'.repeat(barSpace - barLength);
          fullText = `${s.tag} ${bar}`.padEnd(40);
          fullHtml = `<span class="param-label">${escapeHtml(s.tag)}</span> <span class="meter-bar">${bar}</span>`;
          log(
            `Rendering CON for key ${s.key}: tag=${s.tag}, value=${meterValue}, barLength=${barLength}, line="${fullText.trim()}"`,
            'debug',
            'renderScreen'
          );
        }
      } else if (s.type === 'TRG') {
        fullHtml = `<span class="param-value" data-key="${s.key}">${escapeHtml(s.statement)}</span>`;
        fullText = s.statement;
      } else if (s.type === 'STR') {
        // String-edit field (R8; live-discovered type, device-model §3):
        // formatted value rendered as a clickable editor — the save
        // program/bank name fields.
        const value = appState.currentValues[s.key] ?? s.value ?? '';
        if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, logParam);
        fullText = formatValue(s.statement || '%s', value);
        fullHtml = `<span class="param-value" data-key="${s.key}">${escapeHtml(fullText)}</span>`;
      }
      if (fullText) {
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      }
    });
    // Gang subtrees inline (#132): the routing-matrix groups render as part
    // of THIS page (headers + leaf params), exactly like the hardware's
    // ganged-parameter screens — never as softkeys. The pre-paint pass
    // renders their cached structure with placeholder values (no fetches,
    // no clickables) like every other param.
    subs
      .slice(1)
      .filter((s) => isGangCol(s))
      .forEach((s) => renderGangInline(s, 0, paramLines, paramHtmlLines, logParam));
    // Append only the first child sub-menu inline if available.
    // NOTE (R1, live-validated): an earlier filter here dropped ALL
    // position-0 COLs from the softkeys whenever the menu had any param,
    // which made mixed menus like 'program functions' (TRG + 8 position-0
    // COL children) unnavigable — the physical PROGRAM screen shows those
    // softkeys. Only the actually-embedded child is excluded, below.
    localSoftSubs = subs.slice(1).filter((s) => s.type === 'COL' && !isGangCol(s));
    // Deterministic embed (R6, live-validated): only ever the FIRST
    // position-0 child in subs order may embed. The old loop embedded
    // whichever child's dump happened to have arrived — on 'program
    // functions' the first child's response (the giant bank list) is the
    // slowest, so a later sibling like 'link program' would win the race
    // and the embedded UI varied run to run. The physical PROGRAM page is
    // the ground truth: the first child ('load new preset') is the menu's
    // default view.
    // Embeds are a real-render concern: the pre-paint pass keeps every COL
    // child a softkey (no embedded child params, whose values would also be
    // unconfirmed) — R3.
    let potentialEmbedSubs = prePainting
      ? []
      : subs
          .slice(1)
          .filter((s) => s.type === 'COL' && s.position === '0' && s.parent === appState.currentKey)
          .slice(0, 1);
    let embeddedKey = null;
    // T1b: the parser fan-out fetches ALL COL children of the current menu,
    // so the embed candidate is always covered - the R6/R9 prefetch (which
    // existed for label-filtered children) is retired.
    for (let local of potentialEmbedSubs) {
      const childSubs = getNode(local.key) || [];
      if (childSubs.length > 0 && !embeddedKey) {
        embeddedKey = local.key; // Only embed the first local COL
        paramLines.push(''); // Blank line separator
        paramHtmlLines.push('<br>'); // HTML separator
        const childMain = childSubs[0];
        const childTitle = childMain.statement || childMain.tag || '';
        // Skip childTitle if empty or duplicates parent title
        if (childTitle && childTitle !== main.statement && childTitle !== main.tag) {
          paramLines.push(childTitle);
          paramHtmlLines.push(escapeHtml(childTitle));
        }
        // Process child params
        childSubs.slice(1).forEach((cs) => {
          let childFullText = '';
          let childFullHtml = '';
          if (cs.type === 'NUM') {
            const value = appState.currentValues[cs.key] || cs.value;
            if (appState.currentValues[cs.key] === undefined) sendValueDump(cs.key); // empty string = confirmed-absent, do not refetch (C1 review)
            const formatStr = cs.statement || cs.tag || '';
            childFullText = formatValue(formatStr, value);
            childFullHtml = formatValue(formatStr, value, true, cs.key);
          } else if (cs.type === 'INF') {
            let value = appState.currentValues[cs.key] || cs.value || '';
            if (appState.currentValues[cs.key] === undefined && !cs.value)
              sendValueDump(cs.key, logParam);
            childFullText = formatValue(cs.statement, value);
            childFullHtml = escapeHtml(childFullText);
          } else if (cs.type === 'SET') {
            const progView = programSelectView(cs, childSubs.slice(1));
            if (progView.loading) {
              // #141: honest loading line — never the old bank's options.
              childFullText = RENDER.LOADING_PROGRAMS;
              childFullHtml = childFullText;
            } else {
              const options = progView.options ?? cs.options;
              // A just-picked program (optimistic cache) beats the memo's
              // remembered selection — same rule as the top-level branch.
              let value = progView.stale
                ? appState.currentValues[cs.key] || progView.value
                : appState.currentValues[cs.key] || cs.value || '';
              if (!progView.stale && appState.currentValues[cs.key] === undefined && !cs.value)
                sendValueDump(cs.key, logParam);
              let displayValue = value;
              let indexHex = '0';
              if (value) {
                indexHex = value.split(' ')[0];
                displayValue = value.substring(indexHex.length + 1);
              }
              const indexDec = parseInt(indexHex, 16).toString(10);
              childFullText = formatValue(cs.statement || '', displayValue);
              let selectHtml = `<select data-key="${cs.key}" class="param-select">`;
              options.forEach((option) => {
                const isSelected = option.index === indexDec;
                selectHtml += `<option value="${option.index}" ${isSelected ? 'selected' : ''}>${escapeHtml(option.desc)}</option>`;
              });
              selectHtml += `</select>`;
              childFullHtml = escapeHtml(cs.statement || '').replace(/%(-)?(\d*)s/g, selectHtml);
            }
          } else if (cs.type === 'CON') {
            let meterValue = parseFloat(appState.currentValues[cs.key] || cs.value) || 0;
            if (isNaN(meterValue)) {
              meterValue = 0; // Default to 0 if invalid value
            }
            // Same CON display semantics as the top-level branch (probed
            // live): format spec may live in the tag; values are display
            // units, never *100-inflated.
            const conFormat = CON_FORMAT_RE.test(cs.statement)
              ? cs.statement
              : CON_FORMAT_RE.test(cs.tag)
                ? cs.tag
                : null;
            if (conFormat) {
              childFullText = formatValue(conFormat, meterValue); // '%%' collapses in formatValue
              childFullHtml = escapeHtml(childFullText);
            } else {
              // Same compact indicator block as the top-level CON branch.
              const tagLength = cs.tag.length;
              const barSpace = Math.min(
                RENDER.INDICATOR_BAR_CELLS,
                LAYOUT.LCD_COLUMNS - tagLength - 1
              );
              let barLength = Math.round(meterValue * barSpace);
              barLength = Math.max(0, Math.min(barSpace, barLength)); // Clamp to prevent invalid repeat counts
              const bar = '█'.repeat(barLength) + '░'.repeat(barSpace - barLength);
              childFullText = `${cs.tag} ${bar}`.padEnd(40);
              childFullHtml = `<span class="param-label">${escapeHtml(cs.tag)}</span> <span class="meter-bar">${bar}</span>`;
              log(
                `Rendering CON for key ${cs.key}: tag=${cs.tag}, value=${meterValue}, barLength=${barLength}, line="${childFullText.trim()}"`,
                'debug',
                'renderScreen'
              );
            }
          } else if (cs.type === 'TRG') {
            childFullHtml = `<span class="param-value" data-key="${cs.key}">${escapeHtml(cs.statement)}</span>`;
            childFullText = cs.statement;
          } else if (cs.type === 'STR') {
            const value = appState.currentValues[cs.key] ?? cs.value ?? '';
            if (appState.currentValues[cs.key] === undefined && !cs.value)
              sendValueDump(cs.key, logParam);
            childFullText = formatValue(cs.statement || '%s', value);
            childFullHtml = `<span class="param-value" data-key="${cs.key}">${escapeHtml(childFullText)}</span>`;
          }
          if (childFullText) {
            paramLines.push(childFullText);
            paramHtmlLines.push(childFullHtml);
          }
        });
        break; // Only embed the first local COL
      }
    }
    displayLines = displayLines.concat(paramLines);
    // Filter out the embedded local COL from softkeys
    localSoftSubs = localSoftSubs.filter((s) => s.key !== embeddedKey);
    // Set softSubs: local if present, else immediate parent's COLs for leaf menus
    if (appState.keyStack.length > 0) {
      const parentEntry = appState.keyStack[appState.keyStack.length - 1];
      const parentColSubs = (parentEntry.subs || [])
        .slice(1)
        .filter((s) => s.type === 'COL' && !isGangCol(s)); // gang groups are page content, never softkeys (#132)
      softSubs = localSoftSubs.length > 0 ? localSoftSubs : parentColSubs;
    } else {
      softSubs = localSoftSubs;
    }
    // Pre-paint passes write no state at all (R3): the softkey pin, like
    // the currentSubs pin, records only device-confirmed renders. (Note:
    // currentSoftkeys currently has no reader in src — clicks resolve via
    // data-key attributes — so during a pre-paint window the DOM's softkeys
    // intentionally lead this pin; revisit if a consumer is ever added.)
    if (softSubs.length > 0 && !prePainting) {
      setState({ currentSoftkeys: softSubs }, 'renderer:render-pin');
    }
    // Build current/sibling soft text lines (lower level first)
    const itemsPerLine = LAYOUT.SOFTKEYS_PER_LINE;
    let softTextLines = [];
    for (let i = 0; i < softSubs.length; i += itemsPerLine) {
      const slice = softSubs.slice(i, i + itemsPerLine);
      const columnWidth = Math.floor(LAYOUT.LCD_COLUMNS / slice.length) || 10;
      const softTags = slice.map((s) => {
        const t = labelForSub(s);
        const text = (s.key === appState.currentKey ? `[${t}]` : t).padEnd(columnWidth);
        return text;
      });
      softTextLines.push(softTags.join(''));
    }
    // Ancestor softkeys (higher levels after sibling level)
    let ancestorSeparatorAdded = false;
    if (paramLines.length > 0) {
      displayLines.push('');
      ancestorSeparatorAdded = true;
    }
    displayLines.push(...softTextLines);
    // Render immediate parent softkeys only if local >0 (non-leaf)
    if (appState.keyStack.length > 1 && (localSoftSubs || []).length > 0) {
      const parentEntry = appState.keyStack[appState.keyStack.length - 1];
      if (
        !parentEntry.key.startsWith(KEY_PREFIX.DSP_A) &&
        !parentEntry.key.startsWith(KEY_PREFIX.DSP_B)
      ) {
        // Skip if parent is preset
        if (softTextLines.length > 0 && !ancestorSeparatorAdded) {
          displayLines.push('');
          ancestorSeparatorAdded = true;
        }
        const parentSoftSubs = (parentEntry.subs || [])
          .slice(1)
          .filter((s) => s.type === 'COL' && !isGangCol(s)); // gang groups are page content, never softkeys (#132)
        const parentHighlightKey = appState.currentKey;
        let parentSoftTextLines = [];
        for (let i = 0; i < parentSoftSubs.length; i += itemsPerLine) {
          const slice = parentSoftSubs.slice(i, i + itemsPerLine);
          const columnWidth = Math.floor(LAYOUT.LCD_COLUMNS / slice.length) || 10;
          const softTags = slice.map((s) => {
            const t = labelForSub(s);
            const text = (s.key === parentHighlightKey ? `[${t}]` : t).padEnd(columnWidth);
            return text;
          });
          parentSoftTextLines.push(softTags.join(''));
        }
        displayLines.push(...parentSoftTextLines);
      }
    }
    // Render grandparent softkeys if depth >2
    if (appState.keyStack.length > 2) {
      if (
        (softTextLines.length > 0 ||
          (appState.keyStack.length > 1 && (localSoftSubs || []).length > 0)) &&
        !ancestorSeparatorAdded
      ) {
        displayLines.push('');
      }
      const upperEntryIndex = appState.keyStack.length - 2;
      const upperEntry = appState.keyStack[upperEntryIndex];
      if (
        !upperEntry.key.startsWith(KEY_PREFIX.DSP_A) &&
        !upperEntry.key.startsWith(KEY_PREFIX.DSP_B)
      ) {
        // Skip if grandparent is preset
        const upperSoftSubs = (upperEntry.subs || [])
          .slice(1)
          .filter((s) => s.type === 'COL' && !isGangCol(s)); // gang groups are page content, never softkeys (#132)
        const upperHighlightKey = appState.keyStack[appState.keyStack.length - 1].key;
        let upperSoftTextLines = [];
        for (let i = 0; i < upperSoftSubs.length; i += itemsPerLine) {
          const slice = upperSoftSubs.slice(i, i + itemsPerLine);
          const columnWidth = Math.floor(LAYOUT.LCD_COLUMNS / slice.length) || 10;
          const softTags = slice.map((s) => {
            const t = labelForSub(s);
            const text = (s.key === upperHighlightKey ? `[${t}]` : t).padEnd(columnWidth);
            return text;
          });
          upperSoftTextLines.push(softTags.join(''));
        }
        displayLines.push(...upperSoftTextLines);
      }
    }
    if (displayLines.length > 0 && displayLines[displayLines.length - 1] !== '') {
      displayLines.push('');
    }
    const staticRootSoftSubs = ROOT_SOFTKEYS;
    const staticColumnWidth = Math.floor(LAYOUT.LCD_COLUMNS / staticRootSoftSubs.length);
    const staticTags = staticRootSoftSubs.map((s) => {
      const text = (s.key === appState.currentKey ? `[${s.tag}]` : s.tag).padEnd(staticColumnWidth);
      return text;
    });
    displayLines.push(staticTags.join(''));
  }
  log(`Rendered screen text: ${displayLines.join('\n')}`, 'debug', 'renderScreen');
  let bottomHtml = '';
  const startIndex = isTabLineAdded ? 1 : 0;
  if (appState.currentKey === KEY.ROOT) {
    mainHtmlLines = displayLines.slice(startIndex);
  } else {
    // Explicitly build mainHtmlLines for clarity and multi-line softkeys
    mainHtmlLines.push(titleHtml); // Use titleHtml with breadcrumb
    paramHtmlLines.forEach((html) => mainHtmlLines.push(html)); // Param HTML
    let ancestorSeparatorAdded = false;
    if (paramLines.length > 0) {
      mainHtmlLines.push(''); // Separator after params
      ancestorSeparatorAdded = true;
    }
    // Build current/sibling soft HTML lines (lower level first)
    let softHtmlLines = [];
    const itemsPerLine = LAYOUT.SOFTKEYS_PER_LINE;
    for (let i = 0; i < softSubs.length; i += itemsPerLine) {
      let softHtml = '';
      const slice = softSubs.slice(i, i + itemsPerLine);
      const columnWidth = Math.floor(LAYOUT.LCD_COLUMNS / slice.length) || 10;
      slice.forEach((s, idx) => {
        const t = labelForSub(s);
        const text = (s.key === appState.currentKey ? `[${t}]` : t).padEnd(columnWidth);
        softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${escapeHtml(text)}</span>`;
      });
      softHtmlLines.push(softHtml);
    }
    mainHtmlLines = mainHtmlLines.concat(softHtmlLines);
    // Render immediate parent softkeys only if local >0 (non-leaf)
    if (appState.keyStack.length > 1 && (localSoftSubs || []).length > 0) {
      const parentEntry = appState.keyStack[appState.keyStack.length - 1];
      if (
        !parentEntry.key.startsWith(KEY_PREFIX.DSP_A) &&
        !parentEntry.key.startsWith(KEY_PREFIX.DSP_B)
      ) {
        // Skip if parent is preset
        if (softHtmlLines.length > 0 && !ancestorSeparatorAdded) {
          mainHtmlLines.push('');
          ancestorSeparatorAdded = true;
        }
        const parentSoftSubs = (parentEntry.subs || [])
          .slice(1)
          .filter((s) => s.type === 'COL' && !isGangCol(s)); // gang groups are page content, never softkeys (#132)
        const parentHighlightKey = appState.currentKey;
        let parentSoftHtmlLines = [];
        for (let i = 0; i < parentSoftSubs.length; i += itemsPerLine) {
          let softHtml = '';
          const slice = parentSoftSubs.slice(i, i + itemsPerLine);
          const columnWidth = Math.floor(LAYOUT.LCD_COLUMNS / slice.length) || 10;
          slice.forEach((s, idx) => {
            const t = labelForSub(s);
            const text = (s.key === parentHighlightKey ? `[${t}]` : t).padEnd(columnWidth);
            softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${escapeHtml(text)}</span>`;
          });
          parentSoftHtmlLines.push(softHtml);
        }
        mainHtmlLines = mainHtmlLines.concat(parentSoftHtmlLines);
        if (parentSoftHtmlLines.length > 0) {
          mainHtmlLines.push(''); // Separator after parent softkeys
        }
        log('Rendered immediate parent softkeys after current softkeys', 'debug', 'renderScreen');
      }
    }
    // Render grandparent softkeys if depth >2
    if (appState.keyStack.length > 2) {
      if (
        (softHtmlLines.length > 0 ||
          (appState.keyStack.length > 1 && (localSoftSubs || []).length > 0)) &&
        !ancestorSeparatorAdded
      ) {
        mainHtmlLines.push('');
      }
      const upperEntryIndex = appState.keyStack.length - 2;
      const upperEntry = appState.keyStack[upperEntryIndex];
      if (
        !upperEntry.key.startsWith(KEY_PREFIX.DSP_A) &&
        !upperEntry.key.startsWith(KEY_PREFIX.DSP_B)
      ) {
        // Skip if grandparent is preset
        const upperSoftSubs = (upperEntry.subs || [])
          .slice(1)
          .filter((s) => s.type === 'COL' && !isGangCol(s)); // gang groups are page content, never softkeys (#132)
        const upperHighlightKey = appState.keyStack[appState.keyStack.length - 1].key;
        let upperSoftHtmlLines = [];
        for (let i = 0; i < upperSoftSubs.length; i += itemsPerLine) {
          let softHtml = '';
          const slice = upperSoftSubs.slice(i, i + itemsPerLine);
          const columnWidth = Math.floor(LAYOUT.LCD_COLUMNS / slice.length) || 10;
          slice.forEach((s, idx) => {
            const t = labelForSub(s);
            const text = (s.key === upperHighlightKey ? `[${t}]` : t).padEnd(columnWidth);
            softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${escapeHtml(text)}</span>`;
          });
          upperSoftHtmlLines.push(softHtml);
        }
        mainHtmlLines = mainHtmlLines.concat(upperSoftHtmlLines);
        log('Rendered grandparent softkeys after ancestor softkeys', 'debug', 'renderScreen');
      }
    }
    if (mainHtmlLines.length > 0 && mainHtmlLines[mainHtmlLines.length - 1] !== '') {
      mainHtmlLines.push(''); // Separator after softkeys
    }
    // Static as bottom
    const staticRootSoftSubs = ROOT_SOFTKEYS;
    let softHtml = '';
    const staticColumnWidth = Math.floor(LAYOUT.LCD_COLUMNS / staticRootSoftSubs.length);
    staticRootSoftSubs.forEach((s, idx) => {
      const text = (s.key === appState.currentKey ? `[${s.tag}]` : s.tag).padEnd(staticColumnWidth);
      softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${escapeHtml(text)}</span>`;
    });
    bottomHtml = softHtml;
  }
  lcdEl.innerHTML = `<div class="top-docked">${topHtml}</div><div class="main-content">${mainHtmlLines.join('\n')}</div><div class="bottom-docked">${bottomHtml}</div>`;
  // Add change listeners to selects. The change discard runs after
  // handleSelectChange (registration order) so a stale parked paint never
  // replays over the post-change refresh; blur replays the latest deferred
  // paint when the user closes the dropdown without changing (#131).
  // mousedown drives the popup-open inference; change/blur mark it closed.
  lcdEl.querySelectorAll('select[data-key]').forEach((select) => {
    select.removeEventListener('mousedown', handleSelectMousedown);
    select.addEventListener('mousedown', handleSelectMousedown);
    select.removeEventListener('change', handleSelectChange);
    select.addEventListener('change', handleSelectChange);
    select.removeEventListener('change', handleSelectChangeClosed);
    select.addEventListener('change', handleSelectChangeClosed);
    select.removeEventListener('blur', handleSelectBlurClosed);
    select.addEventListener('blur', handleSelectBlurClosed);
  });
  // Add click listeners to param-value for NUM and TRG editing
  lcdEl.querySelectorAll('.param-value').forEach((span) => {
    span.removeEventListener('click', handleParamClick);
    span.addEventListener('click', handleParamClick);
  });
  // Remove and re-add the event listener to ensure only one is active
  lcdEl.removeEventListener('click', handleLcdClick);
  lcdEl.addEventListener('click', handleLcdClick);
  // The auto-descend into a COL-only menu's first child no longer lives here:
  // C2 (#38) replaced the sticky autoLoad flag this branch consumed with a
  // one-shot pendingDescend, consumed in event-bridge.js when the dump for
  // the navigated-to menu ARRIVES — a render (including a stale re-render)
  // can no longer trigger navigation. That also retires the C5 (#41)
  // staleness class this function had to defend against.
}
