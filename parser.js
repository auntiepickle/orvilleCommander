// parser.js
import { renderScreen, updateScreen } from './renderer.js';
import { appState } from './state.js';

// Bit reverse table
const bit_reverse_table = new Array(256);
for (let i = 0; i < 256; i++) {
    bit_reverse_table[i] = parseInt(i.toString(2).padStart(8, '0').split('').reverse().join(''), 2);
}

// Function to extract nibbles from SysEx hex string
export function extractNibbles(sysExHex) {
    const hexMatches = sysExHex.toLowerCase().match(/[0-9a-f]{1,2}/g);
    if (!hexMatches) return [];
    const startIdx = hexMatches.indexOf('17') + 1;
    if (startIdx === 0) return []; // '17' not found
    const endIdx = hexMatches.indexOf('f7', startIdx) !== -1 ? hexMatches.indexOf('f7', startIdx) : hexMatches.length;
    const nibbles = hexMatches.slice(startIdx, endIdx).map(h => parseInt(h, 16));
    return nibbles;
}

// Function to denibble nibbles to bytes
export function denibble(nibbles) {
  const rawBytes = [];
  for (let i = 0; i < nibbles.length; i += 2) {
      if (i + 1 < nibbles.length) {
          rawBytes.push((nibbles[i] << 4) | nibbles[i + 1]);
      }
  }
  return rawBytes;
}

// Function to render the bitmap on canvas and return pixel data
export function renderBitmap(canvasId, rawBytes, log) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const width = 240;
    const height = 64;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = '480px';
    canvas.style.height = '128px';
    canvas.style.aspectRatio = '240 / 64'; // Force aspect ratio
    canvas.style.imageRendering = 'pixelated'; // Sharp pixels
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    // Skip 13-byte header
    const bitmap = rawBytes.slice(13, 13 + 1920);
    // Optional bit flip (hardcoded to false)
    const processedBitmap = NO_FLIP ? bitmap : bitmap.map(b => bit_reverse_table[b]);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let originalX = x;
            if (ROTATE_COLUMNS) {
                originalX = (x + (width - 8)) % width;
            }
            const byteIdx = y * 30 + Math.floor(originalX / 8);
            const byte = processedBitmap[byteIdx];
            const bit = (byte >> (7 - (originalX % 8))) & 1; // MSB-left
            const idx = (y * width + x) * 4;
            data[idx] = 0;
            data[idx + 1] = bit * 255; // Green on
            data[idx + 2] = 0;
            data[idx + 3] = 255; // Alpha
        }
    }
    // Post-processing: Non-wrapping shift for first 8 columns if enabled
    if (SHIFT_FIRST_COLUMN) {
        const shiftAmount = 1; // Down by 1px
        for (let x = 0; x < 8; x++) {
            for (let y = height - 1; y >= shiftAmount; y--) {
                const fromIdx = ((y - shiftAmount) * width + x) * 4;
                const idx = (y * width + x) * 4;
                data[idx] = data[fromIdx];
                data[idx + 1] = data[fromIdx + 1];
                data[idx + 2] = data[fromIdx + 2];
                data[idx + 3] = data[fromIdx + 3];
            }
            for (let y = 0; y < shiftAmount; y++) {
                const idx = (y * width + x) * 4;
                data[idx] = 0;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 255;
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
    if (appState.logCategories['bitmap']) log('[LOG] Rendered bitmap to canvas', 'debug', 'bitmap');
    if (SAVE_MONO_BMP) exportBMP(canvas);
}

export function exportBMP(canvas) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const buffer = new Uint8Array(54 + width * height);
  // BMP header
  buffer[0] = 66; buffer[1] = 77; // 'BM'
  const fileSize = 54 + width * height;
  buffer[2] = fileSize & 0xff;
  buffer[3] = (fileSize >> 8) & 0xff;
  buffer[4] = (fileSize >> 16) & 0xff;
  buffer[5] = (fileSize >> 24) & 0xff;
  buffer[10] = 54; // Offset to pixel data
  buffer[14] = 40; // DIB header size
  buffer[18] = width & 0xff;
  buffer[19] = (width >> 8) & 0xff;
  buffer[22] = height & 0xff;
  buffer[23] = (height >> 8) & 0xff;
  buffer[26] = 1; // Planes
  buffer[28] = 8; // Bits per pixel (mono with palette)
  // Palette: black and white (or green, but mono for BMP)
  buffer[54] = 0; buffer[55] = 0; buffer[56] = 0; buffer[57] = 255; // Black
  buffer[58] = 255; buffer[59] = 255; buffer[60] = 255; buffer[61] = 255; // White
  // Pixel data (mono, padded to 4 bytes per row)
  const rowBytes = Math.ceil(width / 8);
  const padding = (4 - rowBytes % 4) % 4;
  let offset = 62; // After palette
  for (let y = height - 1; y >= 0; y--) { // Bottom-up
    let byte = 0;
    let bitCount = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4 + 1; // Green channel
      byte = (byte << 1) | (data[idx] > 0 ? 1 : 0);
      bitCount++;
      if (bitCount === 8) {
        buffer[offset++] = byte;
        byte = 0;
        bitCount = 0;
      }
    }
    if (bitCount > 0) {
      byte <<= (8 - bitCount);
      buffer[offset++] = byte;
    }
    for (let p = 0; p < padding; p++) {
      buffer[offset++] = 0;
    }
  }
  const blob = new Blob([buffer], { type: 'image/bmp' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'orville_screen.bmp';
  a.click();
  URL.revokeObjectURL(url);
}

// Configurable flags
const NO_FLIP = true;
const ROTATE_COLUMNS = false;
const SHIFT_FIRST_COLUMN = true;
const SAVE_MONO_BMP = false;

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
  if (appState.deviceId === 0 && data.length > 3) {
    appState.deviceId = data[3];
    log(`Detected device ID: ${appState.deviceId}`, 'info', 'general');
  }
  const ascii = String.fromCharCode(...data.slice(5, data.length - 1)).trim();
  if (data[3] === appState.deviceId && data[4] === 0x32) { // OBJECTINFO_DUMP
    appState.lastAscii = ascii;
    const subs = ascii.split('\n').map(line => line.trim()).filter(line => line).map(parseSubObject);
    log(`Parsed OBJECTINFO_DUMP for key ${subs[0]?.key || 'unknown'}: ${ascii}`, 'info', 'parsedDump');
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
  } else if (data[3] === appState.deviceId && data[4] === 0x2e) { // VALUE_DUMP
    const parts = splitLine(ascii);
    const key = parts[0];
    const index = parts[1];
    const desc = parts.slice(2).join(' ');
    const value = `${index} ${desc}`;
    const oldValue = appState.currentValues[key];
    appState.currentValues[key] = value;
    log(`Parsed VALUE_DUMP for key ${key}: ${value}`, 'info', 'parsedDump');
    if (oldValue && oldValue !== value) {
      log(`Value changed from ${oldValue} to ${value}`, 'info', 'valueChange');
    } else if (oldValue) {
      log(`Value did not change, still ${value}`, 'debug', 'noChange');
    }
    renderScreen(null, appState.lastAscii, log);
  } else if (data[3] === appState.deviceId && data[4] === 0x17) { // Screen dump response
    const nibbles = data.slice(5, data.length - 1);
    if (nibbles.length % 2 !== 0) {
      log('[ERROR] Odd number of nibbles in screen dump', 'error', 'error');
      return;
    }
    const rawBytes = denibble(nibbles);
    if (appState.logCategories['bitmap']) log(`[LOG] Denibbled screen data to ${rawBytes.length} bytes`, 'debug', 'bitmap');
    renderBitmap('lcd-canvas', rawBytes, log);
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
  let options = [];
  if (type === 'NUM') {
    value = parts[6] || '0';
    min = parts[7] || '';
    max = parts[8] || '';
    step = parts[9] || '';
  } else if (type === 'SET' || type === 'CON') {
    if (type === 'CON') {
      value = parts[6] || '0';
    } else { // SET
      let i = 6; // skip tag
      while (i < parts.length) {
        const index = parts[i];
        const desc = parts[i + 1];
        options.push({ index, desc });
        i += 2;
      }
      console.log('Parsed SET options for key ' + key + ':', options);
    }
  } else {
    value = parts[6] || '';
  }
  return { type, position, key, parent, statement, tag, value, min, max, step, options };
}