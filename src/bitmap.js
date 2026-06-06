// bitmap.js
import { log } from './logger.js';
import { denibble, computePixels } from './framebuffer.js';
import { SCREEN } from './sysex-commands.js';
import { CANVAS } from './constants.js';

// Re-exported so existing importers (parser.js) keep working unchanged.
export { denibble };

// Render the screen-dump bytes onto the canvas. Pixel decoding lives in
// framebuffer.js (pure); this only handles the canvas plumbing.
export function renderBitmap(canvasId, rawBytes) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const width = SCREEN.WIDTH;
  const height = SCREEN.HEIGHT;
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
