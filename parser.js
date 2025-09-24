import { renderScreen } from './renderer.js';
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
    let canvas = document.getElementById(canvasId);
    if (!canvas) {
        // Create canvas if it doesn't exist
        canvas = document.createElement('canvas');
        canvas.id = canvasId;
        canvas.style.background = 'black';
        canvas.style.border = '2px solid #000';
        canvas.style.imageRendering = 'pixelated'; // Keep pixels sharp
        document.querySelector('.front-panel').appendChild(canvas); // Assuming front-panel div exists
    }

    // Set internal resolution (240x64) and display size (480x128 for 2x scale)
    canvas.width = 240;
    canvas.height = 64;
    canvas.style.width = '480px';
    canvas.style.height = '128px';

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
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
    log('[LOG] Rendered bitmap to canvas');

    // Export BMP if requested
    if (SAVE_MONO_BMP) {
        exportBMP(data, width, height);
    }

    return data; // Return pixel data for BMP export or comparison
}

// Function to export BMP
export function exportBMP(data, width, height) {
    const bmpData = new Uint8Array(62 + 2048); // Header + padded bitmap (32 bytes/row * 64)
    // BMP header for 240x64, 1-bit, bottom-up
    const header = new Uint8Array([
        66, 77, 78, 8, 0, 0, 0, 0, 0, 0, 62, 0, 0, 0, 40, 0, 0, 0, 240, 0, 0, 0, 64, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 0
    ]);
    bmpData.set(header, 0);
    // Fill bitmap data (bottom-up, padded to 32 bytes/row)
    let bmpOffset = 62;
    for (let y = height - 1; y >= 0; y--) {
        for (let byteX = 0; byteX < 30; byteX++) {
            let byte = 0;
            for (let bit = 7; bit >= 0; bit--) {
                const x = byteX * 8 + (7 - bit);
                const idx = (y * width + x) * 4 + 1; // Green channel for on/off
                byte = (byte << 1) | (data[idx] > 0 ? 1 : 0);
            }
            bmpData[bmpOffset++] = byte;
        }
        bmpOffset += 2; // Padding to 32 bytes
    }
    const blob = new Blob([bmpData], { type: 'image/bmp' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'decoded.bmp';
    a.click();
    URL.revokeObjectURL(url);
}

// Hardcoded flags
const NO_FLIP = true;
const ROTATE_COLUMNS = true;
const SHIFT_FIRST_COLUMN = true;
const SAVE_MONO_BMP = true;

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
      log('[ERROR] Odd number of nibbles in screen dump');
      return;
    }
    const rawBytes = denibble(nibbles);
    log(`[LOG] Denibbled screen data to ${rawBytes.length} bytes`);
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