// parser.js
import { renderScreen, updateScreen } from './renderer.js';
import { appState } from './state.js';
import { setState } from './store.js';
import { hideLoading } from './main.js';
import { sendValuePut, sendValueDump, sendObjectInfoDump } from './midi.js';
import { log } from './logger.js';
import { denibble, renderBitmap } from './bitmap.js';
import debounce from 'lodash.debounce'; // Add import; install via npm if needed

let renderTimeout = null;

function splitLine(line) {
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (let char of line) {
    if ((char === "'" || char === '"') && !inQuote) {
      inQuote = true;
      quoteChar = char;
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      parts.push(current.trim()); // Strip extra spaces
      current = '';
    } else if (char === ' ' && !inQuote) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// Debounced version of renderScreen to limit calls during rapid VALUE_DUMP
const debouncedRenderScreen = debounce((subs, ascii) => {
  renderScreen(subs, ascii, log);
}, 200);

export function parseResponse(data) {
  try {
    if (appState.deviceId === 0 && data.length > 3) {
      setState({ deviceId: data[3] }, 'parser:device-id-detect');
      log(`Detected device ID: ${appState.deviceId}`, 'info', 'general');
    }
    const ascii = String.fromCharCode(...data.slice(5, data.length - 1)).replace(/\0+$/, '').trim();
    if (data[3] === appState.deviceId && data[4] === 0x32) { // OBJECTINFO_DUMP
      const subs = ascii.split('\n').map(line => line.trim()).filter(line => line).map(parseSubObject);
      log(`Parsed OBJECTINFO_DUMP for key ${subs[0]?.key || 'unknown'}: ${ascii}`, 'info', 'parsedDump');
      const main = subs[0];
      if (main.key === '0') {
        const dspASub = subs.find(s => s.key.startsWith('4'));
        const dspBSub = subs.find(s => s.key.startsWith('8'));
        setState({
          dspAKey: dspASub?.key || '401000b',
          dspBKey: dspBSub?.key || '801000b',
          dspAName: dspASub?.statement || '',
          dspBName: dspBSub?.statement || '',
        }, 'parser:root-dsp-meta');
      }
      if (main.key.endsWith('000b')) {
        const dsp = main.key[0] === '4' ? 'A' : 'B';
        setState({
          [`menus${dsp}`]: subs.slice(1).filter(s => s.type === 'COL'),
          [`dsp${dsp}Name`]: main.statement,
        }, 'parser:preset-meta');
        if (main.key === appState.currentKey) {
          setState({ presetKey: main.key }, 'parser:preset-key');
        }
      }
      if (main.key === appState.currentKey) {
        // Fetch child sub-menus for local COLs if not already fetched
        const localSoftSubs = subs.slice(1).filter(s => s.type === 'COL' && s.tag.trim().length <= 10 && s.tag.trim() && !appState.childSubs[s.key]);
        localSoftSubs.forEach(s => {
          sendObjectInfoDump(s.key);
          sendValueDump(s.key);
        });
        if (renderTimeout) clearTimeout(renderTimeout);
        setState({ lastAscii: ascii }, 'parser:current-key-ascii');
        renderTimeout = setTimeout(() => {
          debouncedRenderScreen(subs, ascii);
          if (!appState.isLoadingPreset) {
            hideLoading();
          }
          renderTimeout = null;
        }, 200);
        setState({ currentSubs: subs }, 'parser:current-subs');
      } else if (main.key === '0' && appState.currentKey !== '0') {
        // Background root dump received (e.g., after preset load); re-render current screen to update top bar
        debouncedRenderScreen(appState.currentSubs, appState.lastAscii);
        if (appState.isLoadingPreset) {
          hideLoading();
          setState({ isLoadingPreset: false }, 'parser:loading-preset-clear');
        }
      } else {
        // Store child sub-menu data if it's a child of the current menu
        const isChild = appState.currentSubs.some(s => s.key === main.key && s.parent === appState.currentKey);
        if (isChild) {
          setState({ childSubs: { ...appState.childSubs, [main.key]: subs } }, 'parser:child-subs-store');
          log(`Stored child subs for key ${main.key} under parent ${appState.currentKey}`, 'debug', 'parsedDump');
          debouncedRenderScreen(appState.currentSubs, appState.lastAscii); // Re-render to include child data
        }
      }
      // Fix for Favorites re-ordering after preset load
      if (main.key === '10020010' && appState.isLoadingPreset && appState.loadingPresetName) {
        const bankSub = subs.find(s => s.key === '10020012');
        if (bankSub) {
          const bankValue = appState.currentValues[bankSub.key] || bankSub.value;
          if (bankValue.startsWith('0 ')) { // Favorites bank
            const programSub = subs.find(s => s.key === '10020011');
            if (programSub && programSub.options) {
              const targetName = appState.loadingPresetName;
              const newIndex = programSub.options.findIndex(opt => opt.desc.trim().split(' ').slice(1).join(' ') === targetName);
              const currentProgramValue = appState.currentValues[programSub.key] || programSub.value;
              const currentIndex = parseInt(currentProgramValue.split(' ')[0], 10);
              if (newIndex !== -1 && newIndex !== currentIndex) {
                log(`Correcting selection after Favorites re-order: setting to index ${newIndex} for "${targetName}"`, 'info', 'general');
                sendValuePut(programSub.key, newIndex.toString());
                const newDesc = programSub.options[newIndex].desc;
                setState({ currentValues: { ...appState.currentValues, [programSub.key]: `${newIndex} ${newDesc}` } }, 'parser:favorites-fix-optimistic');
                setTimeout(() => sendValueDump(programSub.key), 200);
              }
            }
          }
        }
      }
    } else if (data[3] === appState.deviceId && data[4] === 0x2e) { // VALUE_DUMP
      const parts = splitLine(ascii);
      const key = parts[0];
      const value = parts.slice(1).join(' ');
      const oldValue = appState.currentValues[key];
      setState({ currentValues: { ...appState.currentValues, [key]: value } }, 'parser:value-cache');
      log(`Parsed VALUE_DUMP for key ${key}: ${value}`, 'info', 'parsedDump');
      if (oldValue && oldValue !== value) {
        log(`Value changed from ${oldValue} to ${value}`, 'info', 'valueChange');
      } else if (oldValue) {
        log(`Value did not change, still ${value}`, 'debug', 'noChange');
      }
      if (key === '10020011' || key === '10020012') {
        return; // Skip render for program/bank VALUE_DUMP to avoid brief wrong state
      }
      log(`Checking for CON on key ${key}, currentSubs length: ${appState.currentSubs.length}`, 'debug', 'general');
      const sub = appState.currentSubs.find(s => s.key === key);
      log(`Sub found for key ${key}: ${!!sub}, type: ${sub ? sub.type : 'undefined'}`, 'debug', 'general');
      const isChildParam = Object.keys(appState.childSubs || {}).some(childKey => {
        const childSubs = appState.childSubs[childKey] || [];
        return childSubs.some(cs => cs.key === key);
      });
      if (sub && sub.type === 'CON') {
        debouncedRenderScreen(appState.currentSubs, null); // Immediate re-render for live meter update
        log(`Immediate re-rendered screen for CON value change on key ${key}`, 'debug', 'renderScreen');
      } else if (key.endsWith('0002') || isChildParam) { // Fallback for meter keys or child params
        log(`Fallback triggered for meter or child key ${key}`, 'debug', 'general');
        debouncedRenderScreen(appState.currentSubs, null);
        log(`Immediate re-rendered screen for VALUE_DUMP on key ${key}`, 'debug', 'renderScreen');
      } else {
        if (renderTimeout) clearTimeout(renderTimeout);
        renderTimeout = setTimeout(() => {
          debouncedRenderScreen(null, appState.lastAscii);
          if (!appState.isLoadingPreset) {
            hideLoading();
          }
          renderTimeout = null;
        }, 200);
      }
    } else if (data[3] === appState.deviceId && data[4] === 0x17) { // Screen dump response
      const nibbles = data.slice(5, data.length - 1);
      if (nibbles.length % 2 !== 0) {
        log('[ERROR] Odd number of nibbles in screen dump', 'error', 'error');
        return;
      }
      const rawBytes = denibble(nibbles);
      if (appState.logCategories['bitmap']) log(`[LOG] Denibbled screen data to ${rawBytes.length} bytes`, 'debug', 'bitmap');
      renderBitmap('lcd-canvas', rawBytes);
    }
  } catch (err) {
    log(`Parse response error: ${err.message}`, 'error', 'error');
    // Optional: Fallback to root or error screen
  }
}

export function parseSubObject(line) {
  const parts = splitLine(line);
  const type = parts[0] || '';
  const position = parts[1] || '0'; // Keep as string to handle 'a' etc.
  const key = parts[2] || '';
  const parent = parts[3] || '';
  const statement = parts[4] || '';
  const tag = parts[5] || '';
  let value = '';
  let min = '', max = '', step = '';
  let options = [];
  if (type === 'NUM') {
    value = parts[6] || '0';
    min = parts[7] || '';
    max = parts[8] || '';
    step = parts[9] || '';
  } else if (type === 'SET' || type === 'CON') {
    let i = 6; // skip tag
    if (type === 'CON') {
      value = parts[i] || '0';
    } else { // SET
      const current_index = parts[i++] || '0';
      const current_desc = parts[i++] || '';
      value = `${current_index} ${current_desc}`;
      const num = parseInt(parts[i++], 16);
      for (let j = 0; j < num; j++) {
        const desc = parts[i + j]; // Preserve apostrophes in desc
        const index = j.toString(10);
        options.push({ index, desc });
      }
    }
  } else {
    value = parts[6] || '';
  }
  return { type, position, key, parent, statement, tag, value, min, max, step, options };
}