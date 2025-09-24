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
  } else if (data[3] === 0x01 && data[4] === 0x17) {  // Screen dump response
    log(`Received Screen Dump SysEx: ${data.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    const nibbles = data.slice(5, data.length - 1);
    if (nibbles.length % 2 !== 0) {
      log('Error: Odd number of nibbles in screen dump');
      return;
    }
    const bitmap = [];
    for (let i = 0; i < nibbles.length; i += 2) {
      bitmap.push((nibbles[i] << 4) | nibbles[i + 1]);
    }
    log(`Denibbled screen data to ${bitmap.length} bytes`);
    // Adjust skipBytes if length > 1920 (e.g., try 6 if garbage at top)
    const skipBytes = 0;
    renderBitmap(bitmap.slice(skipBytes), log);
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

// Render bitmap to canvas (updated with flipped bit order for correct top-bottom mapping)
export function renderBitmap(bitmap, log) {
  const canvas = document.getElementById('lcd-canvas');
  if (!canvas) {
    console.error('Canvas not found');
    return;
  }
  const ctx = canvas.getContext('2d');
  const width = 240;
  const height = 64;
  if (bitmap.length < 1920) {
    console.error(`Bitmap too short: ${bitmap.length} bytes`);
    log('Error: Bitmap data too short for full 240x64 render');
    return;
  }
  // Clear canvas
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);
  // Draw pixels with flipped bit order (bit 7 = top, bit 0 = bottom)
  for (let page = 0; page < 8; page++) {
    for (let col = 0; col < width; col++) {
      const byte = bitmap[page * width + col];
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (1 << (7 - bit))) {  // Flipped: Check MSB first for top pixel
          ctx.fillStyle = 'lime';  // Green LCD look
          ctx.fillRect(col, page * 8 + bit, 1, 1);
        }
      }
    }
  }
  log('Rendered bitmap with flipped bit order');
}