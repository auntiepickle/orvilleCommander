// logger.js — centralized logger lifted from main.js (roadmap Step 2)
import { appState } from './state.js';

export const levels = { error: 0, info: 1, debug: 2 };

const logArea = document.getElementById('log-area');

export function log(message, level = 'info', category = 'general') {
  if (levels[appState.logLevel] < levels[level] || !appState.logCategories[category]) return;
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;
  logArea.value += entry;
  logArea.scrollTop = logArea.scrollHeight;
  console.log(entry);
}
