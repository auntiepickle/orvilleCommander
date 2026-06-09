// logger.js — centralized logger (roadmap Step 2)
//
// Owns its own log level + category visibility (C6): it does NOT import
// state.js, which collapses the former store -> logger -> state -> store import
// cycle. main.js pushes the user's saved/merged preferences in via setLogLevel /
// setLogCategories at boot; defaults come from constants.js.
import { DEFAULT_LOG_LEVEL, DEFAULT_LOG_CATEGORIES } from './constants.js';

export const levels = { error: 0, info: 1, debug: 2 };

let logLevel = DEFAULT_LOG_LEVEL;
let logCategories = { ...DEFAULT_LOG_CATEGORIES };

const logArea = document.getElementById('log-area');

export function log(message, level = 'info', category = 'general') {
  if (levels[logLevel] < levels[level] || !logCategories[category]) return;
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;
  logArea.value += entry;
  logArea.scrollTop = logArea.scrollHeight;
  console.log(entry);
}

export function setLogLevel(level) {
  logLevel = level;
}

export function getLogLevel() {
  return logLevel;
}

export function setLogCategories(categories) {
  logCategories = { ...categories };
}

export function getLogCategories() {
  return logCategories;
}
