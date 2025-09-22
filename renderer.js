// renderer.js
import { appState } from './state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, sendKeypress } from './midi.js';
import { keypressMasks } from './controls.js';
import { parseSubObject } from './parser.js';

export function updateScreen() {
  appState.currentValues = {};
  sendObjectInfoDump(appState.currentKey);
  sendValueDump(appState.currentKey);
}

export function renderScreen(subs, ascii, log) {
  const lcdEl = document.getElementById('lcd');
  if (!subs) {
    subs = ascii.split('\n').map(line => line.trim()).filter(line => line).map(parseSubObject);
  }

  const main = subs[0];
  let displayLines = [];

  if (appState.currentKey === '0') {
    const progA = subs.find(s => s.key === '401000b') || {key: '401000b', statement: ''};
    const progB = subs.find(s => s.key === '801000b') || {key: '801000b', statement: ''};
    displayLines.push(`<span class="softkey" data-key="${progA.key}">A: ${progA.statement}</span> <span class="softkey" data-key="${progB.key}">B: ${progB.statement}</span>`);
    displayLines.push('');
    displayLines.push('');
    const softSubs = subs.filter(s => s.type === 'COL' && s.tag.trim() && s.key !== '401000b' && s.key !== '801000b' && s.key !== '10040000' && s.key !== '0');
    const softTags = softSubs.map(s => (s.tag || '').padEnd(10));
    displayLines.push(softTags.join(''));
  } else {
    let title = main.statement || main.tag || 'Menu';
    if (appState.presetKey) {
      title += ` | ${main.statement || main.tag || 'Menu'}`;
    }
    displayLines.push(title);
    displayLines.push('--------------------------------');
    let paramLines = [];
    subs.slice(1).forEach(s => {
      if (s.type === 'NUM') {
        const value = appState.currentValues[s.key] || parseFloat(s.value || 0).toFixed(3);
        let fullText = (s.statement || '').replace(/%f/g, value).replace(/%/g, '%');
        paramLines.push(fullText);
        if (!appState.currentValues[s.key]) sendValueDump(s.key);
      } else if (s.type === 'INF') {
        paramLines.push(s.statement || s.tag || '');
      }
    });
    let paramDisplayed = paramLines.slice(appState.paramOffset, appState.paramOffset + 3);
    while (paramDisplayed.length < 3) paramDisplayed.push('');
    displayLines = displayLines.concat(paramDisplayed);
    let softSubs = subs.slice(1).filter(s => s.type === 'COL' && s.tag.trim().length <=10 && s.tag.trim());
    if (appState.menus.length > 0 && appState.currentKey !== appState.presetKey) {
      softSubs = appState.menus;
    }
    const softTags = softSubs.map(s => s.tag.trim());
    displayLines.push(softTags.map((t, idx) => (idx === 0 ? `[${t}]` : t).padEnd(10)).join(''));
  }

  log(`Rendered screen text: ${displayLines.join('\n')}`); 

  let htmlLines = displayLines.map((l, index) => {
    if (index === displayLines.length - 1) {
      let softHtml = '';
      let softSubsUsed = appState.currentKey === '0' ? subs.filter(s => s.type === 'COL' && s.tag.trim() && s.key !== '401000b' && s.key !== '801000b' && s.key !== '10040000' && s.key !== '0') : subs.slice(1).filter(s => s.type === 'COL' && s.tag.trim().length <=10 && s.tag.trim());
      if (appState.menus.length > 0 && appState.currentKey !== appState.presetKey) {
        softSubsUsed = appState.menus;
      }
      softSubsUsed.forEach((s, idx) => {
        const text = (idx === 0 && appState.currentKey !== '0' ? '[' + (s.tag || '') + ']' : (s.tag || '')).padEnd(10);
        softHtml += `<span class="softkey" data-key="${s.key}" data-index="${idx}">${text}</span>`;
      });
      return `<div class="line">${softHtml}</div>`;
    } else if (index > 1 && index < displayLines.length - 1 && l.includes(':')) {
      const [tag, val] = l.split(':');
      const paramSub = subs.find(s => s.type === 'NUM' && (s.statement || '').includes(tag.trim()));
      if (paramSub) {
        return `<div class="line">${tag}: <span class="param-value" data-key="${paramSub.key}">${val.trim()}</span></div>`;
      }
    }
    return `<div class="line">${l}</div>`;
  });

  lcdEl.innerHTML = htmlLines.join('');

  lcdEl.querySelectorAll('.softkey').forEach(el => {
    el.addEventListener('click', () => {
      const newKey = el.dataset.key;
      const index = el.dataset.index;
      if (index !== undefined) {
        const softKeyName = `soft${parseInt(index, 10) + 1}`;
        const softMask = keypressMasks[softKeyName] || [];
        if (softMask.length > 0) {
          sendKeypress(softMask);
          log(`Clicked softkey for key ${newKey}: ${el.innerText.trim()}, sent press for ${softKeyName}`);
        }
      } else {
        const parameterMask = keypressMasks['parameter'] || [];
        if (parameterMask.length > 0) {
          sendKeypress(parameterMask);
          log(`Clicked DSP for key ${newKey}: ${el.innerText.trim()}, sent parameter press to enter preset`);
        }
      }
      appState.keyStack.push(appState.currentKey);
      appState.currentKey = newKey;
      appState.paramOffset = 0;
      appState.autoNavigated = false;
      updateScreen();
    });
  });
  lcdEl.querySelectorAll('.param-value').forEach(el => {
    el.addEventListener('click', () => {
      const paramKey = el.dataset.key;
      const newValue = prompt('Enter new value:', el.innerText);
      if (newValue) {
        sendValuePut(paramKey, newValue);
        log(`Set value for param ${paramKey} to ${newValue}`);
        updateScreen();
      }
    });
  });
}