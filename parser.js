// parser.js
// parser.js
import { renderScreen } from './renderer.js';
import { appState } from './state.js';

function splitLine(line) {
  const parts = [];
  let current = '';
  let inQuote = false;
  for (let char of line) {
    if (char === "'" && !inQuote) {
      inQuote = true;
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else if (char === "'" && inQuote) {
      inQuote = false;
      parts.push(current);
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

export function parseResponse(data, log) {
  const ascii = String.fromCharCode(...data.slice(5, data.length - 1)).trim();
  if (data[3] === 0x01 && data[4] === 0x32) { // OBJECTINFO_DUMP
    appState.lastAscii = ascii;
    const subs = ascii.split('\n').map(line => line.trim()).filter(line => line).map(parseSubObject);
    log(`Parsed OBJECTINFO_DUMP for key ${subs[0]?.key || 'unknown'}: ${ascii}`);
    const main = subs[0];
    if (main.key.endsWith('000b')) {
      appState.presetKey = main.key;
      appState.menus = subs.slice(1).filter(s => s.type === 'COL');
      if (!appState.autoNavigated && appState.menus.length > 0) {
        appState.autoNavigated = true;
        appState.keyStack.push(appState.currentKey);
        appState.currentKey = appState.menus[0].key;
        updateScreen();
        return;
      }
    }
    renderScreen(subs, ascii, log);
  } else if (data[3] === 0x01 && data[4] === 0x2e) { // VALUE_DUMP
    const parts = ascii.split(/\s+/);
    const key = parts[0];
    const value = parts.slice(1).join(' ');
    appState.currentValues[key] = value;
    log(`Parsed VALUE_DUMP for key ${key}: ${value}`);
    renderScreen(null, appState.lastAscii, log);
  }
}

export function parseSubObject(line) {
  const parts = splitLine(line);
  const type = parts[0] || '';
  const position = parseInt(parts[1] || '0', 10);
  const key = parts[2] || '';
  const parent = parts[3] || '';
  const statement = parts[4] || '';
  const tag = parts[5] || '';
  let value = '';
  let min = '', max = '', step = '';
  if (type === 'NUM') {
    value = parts[6] || '0';
    min = parts[7] || '';
    max = parts[8] || '';
    step = parts[9] || '';
  } else {
    value = parts[6] || '';
  }
  return { type, position, key, parent, statement, tag, value, min, max, step };
}