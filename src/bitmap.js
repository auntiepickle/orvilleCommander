// bitmap.js
import { log } from './logger.js';
import { denibble, computePixels, parseScreenHeader } from './framebuffer.js';
import { SCREEN } from './sysex-commands.js';
import { CANVAS } from './constants.js';

// Re-exported so existing importers (parser.js) keep working unchanged.
export { denibble };

// Render the screen-dump bytes onto the canvas. Pixel decoding lives in
// framebuffer.js (pure); this only handles the canvas plumbing.
export function renderBitmap(canvasId, rawBytes) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  // Use the dimensions the device reports in the header (falling back to the
  // 240x64 defaults if the header is missing/insane), and surface integrity
  // problems rather than silently rendering a partial or corrupt screen.
  const hdr = parseScreenHeader(rawBytes);
  const width = hdr.dimsValid ? hdr.width : SCREEN.WIDTH;
  const height = hdr.dimsValid ? hdr.height : SCREEN.HEIGHT;
  if (!hdr.dimsValid) {
    log(
      `[SCREEN] Header dims out of range (${hdr.width}x${hdr.height}); using ${width}x${height}`,
      'error',
      'error'
    );
  } else if (!hdr.complete) {
    log(
      `[SCREEN] Dump truncated: got ${rawBytes.length} bytes, expected ${hdr.expectedLength}`,
      'error',
      'error'
    );
  } else if (!hdr.checksumOk) {
    log('[SCREEN] Dump checksum mismatch', 'error', 'error');
  }
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = CANVAS.CSS_WIDTH;
  canvas.style.height = CANVAS.CSS_HEIGHT;
  canvas.style.aspectRatio = CANVAS.ASPECT_RATIO; // Force aspect ratio
  canvas.style.imageRendering = CANVAS.IMAGE_RENDERING; // Sharp pixels
  const imgData = ctx.getImageData(0, 0, width, height);
  imgData.data.set(computePixels(rawBytes, { width, height }));
  ctx.putImageData(imgData, 0, 0);
  log('[LOG] Rendered bitmap to canvas');
}
