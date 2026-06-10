// renderer.js
import { appState } from './state.js';
import { CMD, KEY, KEY_PREFIX, ROOT_SOFTKEYS } from './sysex-commands.js';
import { TIMING, LAYOUT, RENDER } from './constants.js';
import { setState } from './store.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, sendSysEx } from './midi.js';
import { showLoading } from './main.js';
import { getNode, deriveKeyStack, findParamUnder, labelForSub } from './tree.js';
import { log } from './logger.js';

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
  const key = e.target.dataset.key;
  const selectedIndex = e.target.value;
  const selectedDesc = e.target.options[e.target.selectedIndex].text;
  log(
    `Selected option for key ${key}: index ${selectedIndex}, desc ${selectedDesc}`,
    'debug',
    'valueChange'
  );
  showLoading();
  sendValuePut(key, selectedIndex);
  setState(
    { currentValues: { ...appState.currentValues, [key]: `${selectedIndex} ${selectedDesc}` } },
    'renderer:select-change-value-cache'
  ); // Removed immediate renderScreen to avoid old subs with new value
  setTimeout(() => {
    updateScreen();
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
    // Auto-load preset if changing the program select in load menu
    if (key === KEY.PROGRAM_SELECT) {
      setTimeout(() => {
        const loadKey = appState.presetKey.startsWith(KEY_PREFIX.DSP_A)
          ? KEY.LOAD_TRIGGER_A
          : KEY.LOAD_TRIGGER_B;
        sendValuePut(loadKey, '1');
        log(`Auto-triggered load for ${loadKey} after program change`, 'info', 'general');
        setTimeout(() => {
          updateScreen();
          sendObjectInfoDump(KEY.ROOT);
          log('Fetched root after preset load.', 'debug', 'general');
          if (appState.updateBitmapOnChange) {
            sendSysEx(CMD.GET_SCREEN, []);
            log('Triggered bitmap update after TRG.', 'debug', 'bitmap');
          }
        }, TIMING.DEVICE_LOAD_MS); // Delay for device to process load and fetch root
      }, TIMING.PROGRAM_SET_MS); // Additional delay to ensure program value is set
    }
  }, TIMING.MIDI_SETTLE_MS); // Delay to allow MIDI update
};

/**
 * Handles clicks on parameter values for editing NUM or triggering TRG types.
 * Prompts for NUM changes, validates, sends VALUE_PUT, and updates screen.
 *
 * @param {Event} e - The click event.
 */
const handleParamClick = (e) => {
  if (e.target.classList.contains('param-value')) {
    const key = e.target.dataset.key;
    // Find the sub for title and limits (tree lookup for embedded children)
    const sub =
      appState.currentSubs.find((s) => s.key === key) || findParamUnder(appState.currentKey, key);
    if (sub) {
      if (sub.type === 'NUM') {
        const title = sub.statement.replace(/%.*f/, '').trim(); // Clean format specifier
        const currentValue = appState.currentValues[key] || sub.value;
        const newValueStr = prompt(`Enter new value for ${title}:`, currentValue);
        if (newValueStr !== null) {
          const newValue = parseFloat(newValueStr);
          const min = parseFloat(sub.min) || -Infinity;
          const max = parseFloat(sub.max) || Infinity;
          if (!isNaN(newValue) && newValue >= min && newValue <= max) {
            showLoading();
            sendValuePut(key, newValueStr);
            setState(
              { currentValues: { ...appState.currentValues, [key]: newValueStr } },
              'renderer:param-click-num-value-cache'
            );
            renderScreen(appState.currentSubs, appState.lastAscii); // Immediate local update
            setTimeout(() => {
              updateScreen();
              if (appState.updateBitmapOnChange) {
                sendSysEx(CMD.GET_SCREEN, []);
                log('Triggered bitmap update after value change.', 'debug', 'bitmap');
              }
            }, TIMING.MIDI_SETTLE_MS);
          } else {
            alert(`Invalid value. Must be a number between ${min} and ${max}.`);
          }
        }
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
        // (#104).
        const title = sub.statement.replace(/%.*s/, '').trim() || sub.tag;
        const currentValue = appState.currentValues[key] ?? sub.value ?? '';
        const rawValue = prompt(`Enter new value for ${title}:`, currentValue);
        // Empty string is rejected like prompt-cancel: the device ignores
        // empty-string puts (value unchanged — probed live, #104), so
        // rejecting here matches hardware exactly.
        if (rawValue !== null && rawValue !== '') {
          // SysEx data bytes must be 7-bit: reject non-ASCII rather than
          // throwing mid-flow with the loading overlay up. Clamp to the
          // field width from the format (e.g. %-22s) when one is declared.
          if (!/^[\x20-\x7e]*$/.test(rawValue)) {
            alert('Only printable ASCII characters can be sent to the device.');
            return;
          }
          const widthMatch = (sub.statement || '').match(/%-?(\d+)s/);
          const newValue = widthMatch ? rawValue.slice(0, parseInt(widthMatch[1], 10)) : rawValue;
          showLoading();
          sendValuePut(key, newValue);
          setState(
            { currentValues: { ...appState.currentValues, [key]: newValue } },
            'renderer:param-click-str-value-cache'
          );
          renderScreen(appState.currentSubs, appState.lastAscii); // Immediate local update
          setTimeout(() => {
            updateScreen();
            if (appState.updateBitmapOnChange) {
              sendSysEx(CMD.GET_SCREEN, []);
              log('Triggered bitmap update after value change.', 'debug', 'bitmap');
            }
          }, TIMING.MIDI_SETTLE_MS);
        }
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
// families plus the literal '%%'); shared by formatValue and the R3
// pre-paint placeholder substitution.
const FORMAT_SPEC_RE = /%(-)?(\d*)(\.\d*)?f|%(-)?(\d*)s|%/g;

function formatValue(statement, value, isHtml = false, key = '') {
  return statement.replace(
    FORMAT_SPEC_RE,
    (match, fLeftFlag, fWidthStr, precStr, sLeftFlag, sWidthStr) => {
      if (match === '%') return '%';
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
          return `<span class="param-value" data-key="${key}">${valStr}</span>`;
        }
        return valStr;
      } else if (sLeftFlag !== undefined || sWidthStr !== undefined) {
        // %[-]widths
        const leftAlign = sLeftFlag === '-';
        const width = parseInt(sWidthStr || '0');
        if (width === 0) return value;
        return leftAlign ? value.padEnd(width) : value.padStart(width);
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

// A param line with every value slot blanked to the placeholder: the
// statement (else the tag) with format specifiers substituted; '%%' still
// renders as a literal '%'.
const placeholderLine = (s) =>
  (s.statement || s.tag || '').replace(FORMAT_SPEC_RE, (m) =>
    m === '%' ? '%' : RENDER.VALUE_PLACEHOLDER
  );

export function renderScreen(subs, ascii, logParam) {
  const lcdEl = document.getElementById('lcd');
  if (!subs || subs.length === 0) {
    log('Skipping render: no subs available', 'debug', 'renderScreen');
    return;
  }
  // R3 render guard (#106): these subs describe a DIFFERENT node than the
  // one navigated to — the new key's dump is still in flight. Never paint
  // the old menu under the new key (live bug: "[program] program functions"
  // titled as levels for seconds on a backed-up link). Pre-paint the tree's
  // cached structure instead, or an honest loading title when the tree has
  // never seen the key.
  if (!prePainting && subs[0]?.key !== appState.currentKey) {
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
    topHtml = ` <span class="${isAActive ? 'dsp-clickable current' : 'dsp-clickable'}" data-key="${appState.dspAKey}">${aPart}</span> <span class="${!isAActive ? 'dsp-clickable current' : 'dsp-clickable'}" data-key="${appState.dspBKey}">${bPart}</span>`;
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
        softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${text}</span>`;
      });
      softHtmlLines.push(softHtml);
    }
    mainHtmlLines.push(''); // blank
    mainHtmlLines.push(''); // blank
    mainHtmlLines = mainHtmlLines.concat(softHtmlLines);
  } else {
    titleText = main.statement || main.tag || 'Menu';
    titleHtml = titleText;
    if (appState.keyStack.length > 0) {
      const parent = appState.keyStack[appState.keyStack.length - 1];
      titleText = `[${parent.tag}] ${titleText}`;
      titleHtml = `<span class="back-link" data-key="${parent.key}">[${parent.tag}]</span> ${titleText.replace(`[${parent.tag}] `, '')}`;
    }
    displayLines.push(titleText);
    // Group graphic EQ NUMs with position 'a' (skipped in pre-paint: the
    // R3 shortcut below renders every param as a placeholder line instead,
    // and this block sends value fetches the real render owns).
    const graphicEqSubs = prePainting
      ? []
      : subs.slice(1).filter((s) => s.type === 'NUM' && s.position === 'a');
    let graphicEqLine;
    let graphicEqHtml;
    if (graphicEqSubs.length > 0) {
      const formattedParts = graphicEqSubs.map((s) => {
        const value = appState.currentValues[s.key] || s.value;
        if (appState.currentValues[s.key] === undefined) sendValueDump(s.key); // empty string = confirmed-absent, do not refetch (C1 review)
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
        return `${label}: ${formattedValue}`;
      });
      graphicEqHtml = formattedHtmlParts.join(' ');
      paramLines.push(graphicEqLine);
      paramHtmlLines.push(graphicEqHtml);
    }
    subs.slice(1).forEach((s) => {
      if (prePainting) {
        // R3: one inert placeholder line per param — no clickable spans,
        // no selects, and no value refetches (the real render issues those
        // when the live dump lands).
        if (s.type === 'COL' || s.type === '8') return;
        const text = placeholderLine(s);
        if (text) {
          paramLines.push(text);
          paramHtmlLines.push(text);
        }
        return;
      }
      if (s.position === 'a') return; // Skip individual 'a' after grouping
      let fullText = '';
      let fullHtml = '';
      if (s.type === 'NUM') {
        const value = appState.currentValues[s.key] || s.value;
        if (appState.currentValues[s.key] === undefined) sendValueDump(s.key); // empty string = confirmed-absent, do not refetch (C1 review)
        const formatStr = s.statement || s.tag || '';
        fullText = formatValue(formatStr, value);
        fullHtml = formatValue(formatStr, value, true, s.key);
      } else if (s.type === 'INF') {
        let value = appState.currentValues[s.key] || s.value || '';
        if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, logParam);
        fullText = formatValue(s.statement, value); // Use updated formatValue with s support
        fullHtml = fullText;
      } else if (s.type === 'SET') {
        let value = appState.currentValues[s.key] || s.value || '';
        if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, logParam);
        let displayValue = value;
        let indexHex = '0';
        if (value) {
          indexHex = value.split(' ')[0];
          displayValue = value.substring(indexHex.length + 1);
        }
        const indexDec = parseInt(indexHex, 16).toString(10);
        fullText = formatValue(s.statement || '', displayValue); // Use formatValue for %-width s
        let selectHtml = `<select data-key="${s.key}" class="param-select">`;
        s.options.forEach((option) => {
          const isSelected = option.index === indexDec;
          selectHtml += `<option value="${option.index}" ${isSelected ? 'selected' : ''}>${option.desc}</option>`;
        });
        selectHtml += `</select>`;
        fullHtml = (s.statement || '').replace(/%(-)?(\d*)s/g, selectHtml);
      } else if (s.type === 'CON') {
        let meterValue = parseFloat(appState.currentValues[s.key] || s.value) || 0;
        if (isNaN(meterValue)) {
          meterValue = 0; // Default to 0 if invalid value
        }
        if (/%.*[fs]/.test(s.statement)) {
          let displayValue = meterValue;
          if (s.statement.includes('%%')) displayValue *= 100;
          fullText = formatValue(s.statement, displayValue);
          if (fullText.includes('%%')) fullText = fullText.replace('%%', '%');
          fullHtml = fullText;
        } else {
          const tagLength = s.tag.length;
          const barSpace = LAYOUT.LCD_COLUMNS - tagLength - 1;
          let barLength = Math.round(meterValue * barSpace);
          barLength = Math.max(0, Math.min(barSpace, barLength)); // Clamp to prevent invalid repeat counts
          const bar = '█'.repeat(barLength) + '░'.repeat(barSpace - barLength);
          fullText = `${s.tag} ${bar}`.padEnd(40);
          fullHtml = `<span class="param-label">${s.tag}</span> <span class="meter-bar">${bar}</span>`;
          log(
            `Rendering CON for key ${s.key}: tag=${s.tag}, value=${meterValue}, barLength=${barLength}, line="${fullText.trim()}"`,
            'debug',
            'renderScreen'
          );
        }
      } else if (s.type === 'TRG') {
        fullHtml = `<span class="param-value" data-key="${s.key}">${s.statement}</span>`;
        fullText = s.statement;
      } else if (s.type === 'STR') {
        // String-edit field (R8; live-discovered type, device-model §3):
        // formatted value rendered as a clickable editor — the save
        // program/bank name fields.
        const value = appState.currentValues[s.key] ?? s.value ?? '';
        if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, logParam);
        fullText = formatValue(s.statement || '%s', value);
        fullHtml = `<span class="param-value" data-key="${s.key}">${fullText}</span>`;
      }
      if (fullText) {
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      }
    });
    // Append only the first child sub-menu inline if available.
    // NOTE (R1, live-validated): an earlier filter here dropped ALL
    // position-0 COLs from the softkeys whenever the menu had any param,
    // which made mixed menus like 'program functions' (TRG + 8 position-0
    // COL children) unnavigable — the physical PROGRAM screen shows those
    // softkeys. Only the actually-embedded child is excluded, below.
    localSoftSubs = subs.slice(1).filter((s) => s.type === 'COL');
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
          paramHtmlLines.push(childTitle);
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
            childFullHtml = childFullText;
          } else if (cs.type === 'SET') {
            let value = appState.currentValues[cs.key] || cs.value || '';
            if (appState.currentValues[cs.key] === undefined && !cs.value)
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
            cs.options.forEach((option) => {
              const isSelected = option.index === indexDec;
              selectHtml += `<option value="${option.index}" ${isSelected ? 'selected' : ''}>${option.desc}</option>`;
            });
            selectHtml += `</select>`;
            childFullHtml = (cs.statement || '').replace(/%(-)?(\d*)s/g, selectHtml);
          } else if (cs.type === 'CON') {
            let meterValue = parseFloat(appState.currentValues[cs.key] || cs.value) || 0;
            if (isNaN(meterValue)) {
              meterValue = 0; // Default to 0 if invalid value
            }
            if (/%.*[fs]/.test(cs.statement)) {
              let displayValue = meterValue;
              if (cs.statement.includes('%%')) displayValue *= 100;
              childFullText = formatValue(cs.statement, displayValue);
              if (childFullText.includes('%%')) childFullText = childFullText.replace('%%', '%');
              childFullHtml = childFullText;
            } else {
              const tagLength = cs.tag.length;
              const barSpace = LAYOUT.LCD_COLUMNS - tagLength - 1;
              let barLength = Math.round(meterValue * barSpace);
              barLength = Math.max(0, Math.min(barSpace, barLength)); // Clamp to prevent invalid repeat counts
              const bar = '█'.repeat(barLength) + '░'.repeat(barSpace - barLength);
              childFullText = `${cs.tag} ${bar}`.padEnd(40);
              childFullHtml = `<span class="param-label">${cs.tag}</span> <span class="meter-bar">${bar}</span>`;
              log(
                `Rendering CON for key ${cs.key}: tag=${cs.tag}, value=${meterValue}, barLength=${barLength}, line="${childFullText.trim()}"`,
                'debug',
                'renderScreen'
              );
            }
          } else if (cs.type === 'TRG') {
            childFullHtml = `<span class="param-value" data-key="${cs.key}">${cs.statement}</span>`;
            childFullText = cs.statement;
          } else if (cs.type === 'STR') {
            const value = appState.currentValues[cs.key] ?? cs.value ?? '';
            if (appState.currentValues[cs.key] === undefined && !cs.value)
              sendValueDump(cs.key, logParam);
            childFullText = formatValue(cs.statement || '%s', value);
            childFullHtml = `<span class="param-value" data-key="${cs.key}">${childFullText}</span>`;
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
      const parentColSubs = (parentEntry.subs || []).slice(1).filter((s) => s.type === 'COL');
      softSubs = localSoftSubs.length > 0 ? localSoftSubs : parentColSubs;
    } else {
      softSubs = localSoftSubs;
    }
    // Pre-paint passes write no state at all (R3): the softkey pin, like
    // the currentSubs pin, records only device-confirmed renders.
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
        const parentSoftSubs = (parentEntry.subs || []).slice(1).filter((s) => s.type === 'COL');
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
        const upperSoftSubs = (upperEntry.subs || []).slice(1).filter((s) => s.type === 'COL');
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
        softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${text}</span>`;
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
        const parentSoftSubs = (parentEntry.subs || []).slice(1).filter((s) => s.type === 'COL');
        const parentHighlightKey = appState.currentKey;
        let parentSoftHtmlLines = [];
        for (let i = 0; i < parentSoftSubs.length; i += itemsPerLine) {
          let softHtml = '';
          const slice = parentSoftSubs.slice(i, i + itemsPerLine);
          const columnWidth = Math.floor(LAYOUT.LCD_COLUMNS / slice.length) || 10;
          slice.forEach((s, idx) => {
            const t = labelForSub(s);
            const text = (s.key === parentHighlightKey ? `[${t}]` : t).padEnd(columnWidth);
            softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${text}</span>`;
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
        const upperSoftSubs = (upperEntry.subs || []).slice(1).filter((s) => s.type === 'COL');
        const upperHighlightKey = appState.keyStack[appState.keyStack.length - 1].key;
        let upperSoftHtmlLines = [];
        for (let i = 0; i < upperSoftSubs.length; i += itemsPerLine) {
          let softHtml = '';
          const slice = upperSoftSubs.slice(i, i + itemsPerLine);
          const columnWidth = Math.floor(LAYOUT.LCD_COLUMNS / slice.length) || 10;
          slice.forEach((s, idx) => {
            const t = labelForSub(s);
            const text = (s.key === upperHighlightKey ? `[${t}]` : t).padEnd(columnWidth);
            softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${text}</span>`;
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
      softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${text}</span>`;
    });
    bottomHtml = softHtml;
  }
  lcdEl.innerHTML = `<div class="top-docked">${topHtml}</div><div class="main-content">${mainHtmlLines.join('\n')}</div><div class="bottom-docked">${bottomHtml}</div>`;
  // Add change listeners to selects
  lcdEl.querySelectorAll('select[data-key]').forEach((select) => {
    select.removeEventListener('change', handleSelectChange);
    select.addEventListener('change', handleSelectChange);
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
