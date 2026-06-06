// bitmap.js
import { log } from './logger.js';
import { denibble, computePixels } from './framebuffer.js';

// Re-exported so existing importers (parser.js) keep working unchanged.
export { denibble };

// Render the screen-dump bytes onto the canvas. Pixel decoding lives in
// framebuffer.js (pure); this only handles the canvas plumbing.
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
  imgData.data.set(computePixels(rawBytes, { width, height }));
  ctx.putImageData(imgData, 0, 0);
  log('[LOG] Rendered bitmap to canvas');
}
