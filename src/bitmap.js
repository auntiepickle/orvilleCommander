// bitmap.js
import { log } from './logger.js';

const NO_FLIP = true; // Hardcoded, adjust if needed
const ROTATE_COLUMNS = true;
const SHIFT_FIRST_COLUMN = true;

// Bit reverse table
const bit_reverse_table = new Array(256);
for (let i = 0; i < 256; i++) {
  bit_reverse_table[i] = parseInt(i.toString(2).padStart(8, '0').split('').reverse().join(''), 2);
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
export function renderBitmap(canvasId, rawBytes) {
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
  const processedBitmap = NO_FLIP ? bitmap : bitmap.map((b) => bit_reverse_table[b]);
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
}
