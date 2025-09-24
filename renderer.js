// renderer.js
import { appState } from './state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, sendKeypress } from './midi.js';
import { keypressMasks } from './controls.js';
import { parseSubObject } from './parser.js';

export function updateScreen(log = null) {
  appState.currentValues = {};
  sendObjectInfoDump(appState.currentKey, log);
  sendValueDump(appState.currentKey, log);
}

const handleLcdClick = (e) => {
  if (e.target.classList.contains('dsp-clickable')) {
    appState.presetKey = e.target.dataset.key;
    appState.currentKey = e.target.dataset.key;
    appState.autoLoad = true;
    updateScreen();
  } else if (e.target.classList.contains('softkey')) {
    appState.currentKey = e.target.dataset.key;
    appState.paramOffset = 0; // Reset offset for new menu
    updateScreen();
  } else if (e.target.classList.contains('param-value')) {
    const key = e.target.dataset.key;
    const sub = appState.currentSubs.find(s => s.key === key);
    let currentValue = appState.currentValues[key] || sub.value || '';
    if (sub && sub.type === 'SET') {
      const currentIndex = currentValue.split(' ')[0] || sub.value;
      const currentDesc = currentValue.split(' ').slice(1).join(' ') || (sub.options.find(o => o.index === currentIndex)?.desc || '');
      let promptMsg = `Edit value for key ${key}. Current: ${currentDesc}\nOptions:\n`;
      sub.options.forEach((o, idx) => {
        promptMsg += `${idx + 1}. ${o.desc}\n`;
      });
      const newChoice = prompt(promptMsg);
      if (newChoice !== null) {
        const choiceNum = parseInt(newChoice);
        let selected;
        if (!isNaN(choiceNum) && choiceNum > 0 && choiceNum <= sub.options.length) {
          selected = sub.options[choiceNum - 1];
        } else {
          // Assume input is desc, find matching
          selected = sub.options.find(o => o.desc.toLowerCase() === newChoice.toLowerCase());
        }
        if (selected) {
          sendValuePut(key, selected.index);
          appState.currentValues[key] = `${selected.index} ${selected.desc}`;
          setTimeout(updateScreen, 200); // Delay to allow MIDI update
        }
      }
    } else {
      const fallbackValue = e.target.innerText.trim().replace(/[^0-9.-]/g, '');
      const promptValue = currentValue || fallbackValue;
      const newValue = prompt(`Edit value for key ${key}:`, promptValue);
      if (newValue !== null && newValue !== promptValue) {
        sendValuePut(key, newValue);
        appState.currentValues[key] = newValue;
        setTimeout(updateScreen, 200); // Delay to allow MIDI update
      }
    }
  }
};

function formatValue(statement, value, isHtml = false, key = '') {
  return statement.replace(/%(\d*)(\.\d*)?f|%/g, (match, widthStr, precStr) => {
    if (match === '%') return '%';
    const width = widthStr ? parseInt(widthStr) : 0;
    const prec = precStr ? parseInt(precStr.slice(1)) : 0;
    let valStr = parseFloat(value).toFixed(prec);
    if (width) valStr = valStr.padStart(width);
    if (isHtml) {
      return `<span class="param-value" data-key="${key}">${valStr}</span>`;
    }
    return valStr;
  });
}

export function renderScreen(subs, ascii, log) {
  const lcdEl = document.getElementById('lcd');
  if (!subs) {
    subs = ascii.split('\n').map(line => line.trim()).filter(line => line).map(parseSubObject);
  }
  appState.currentSubs = subs;
  const main = subs[0];
  let displayLines = [];
  let paramDisplayedHtml = [];
  if (appState.currentKey === '0') {
    const progA = subs.find(s => s.key === '401000b') || {key: '401000b', statement: ''};
    const progB = subs.find(s => s.key === '801000b') || {key: '801000b', statement: ''};
    displayLines.push(` A: ${progA.statement} B: ${progB.statement}`);
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
    let paramHtmlLines = [];
    subs.slice(1).forEach(s => {
      let fullText = '';
      let fullHtml = '';
      if (s.type === 'NUM') {
        const value = appState.currentValues[s.key] || parseFloat(s.value || 0).toFixed(3);
        fullText = formatValue(s.statement || '', value);
        fullHtml = formatValue(s.statement || '', value, true, s.key);
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
        if (!appState.currentValues[s.key]) sendValueDump(s.key);
      } else if (s.type === 'INF') {
        const replaceWith = s.tag || s.value || '';
        fullText = (s.statement || '').replace(/%s/g, replaceWith);
        fullHtml = fullText;
        if (fullText === 'text') {
          fullText = '';
          fullHtml = '';
        }
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      } else if (s.type === 'SET' || s.type === 'CON') {
        let value;
        let isEditable = true;
        if (s.type === 'CON') {
          value = s.value || '0';
          isEditable = false;
        } else { // SET
          value = appState.currentValues[s.key] || `${s.value} ${s.options.find(o => o.index === s.value)?.desc || ''}`;
          if (!appState.currentValues[s.key]) sendValueDump(s.key, log);
        }
        let displayValue = value;
        if (s.type === 'SET' && value) {
          const valueParts = value.split(' ');
          displayValue = valueParts.slice(1).join(' ');
        }
        if (s.type === 'SET') {
          fullText = (s.statement || '').replace(/%s/g, displayValue);
          fullHtml = (s.statement || '').replace(/%s/g, isEditable ? `<span class="param-value" data-key="${s.key}">${displayValue}</span>` : displayValue);
        } else { // CON
          fullText = formatValue(s.statement || '', value);
          fullHtml = isEditable ? formatValue(s.statement || '', value, true, s.key) : fullText;
        }
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      }
    });
    displayLines = displayLines.concat(paramLines);
    paramDisplayedHtml = paramHtmlLines;
    let softSubs = subs.slice(1).filter(s => s.type === 'COL' && s.tag.trim().length <=10 && s.tag.trim());
    if (appState.menus.length > 0 && appState.currentKey !== appState.presetKey) {
      softSubs = appState.menus;
    }
    const softTags = softSubs.map(s => s.tag.trim());
    displayLines.push(softTags.map((t, idx) => (softSubs[idx].key === appState.currentKey ? `[${t}]` : t).padEnd(10)).join(''));
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
        const text = (s.key === appState.currentKey ? '[' + (s.tag || '') + ']' : (s.tag || '')).padEnd(10);
        softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${text}</span>`;
      });
      return softHtml;
    } else if (index > 1 && index < displayLines.length - 1) {
      const html = paramDisplayedHtml[index - 2];
      return html || l;
    } else if (index === 0 && appState.currentKey === '0') {
      const progA = subs.find(s => s.key === '401000b') || {key: '401000b', statement: ''};
      const progB = subs.find(s => s.key === '801000b') || {key: '801000b', statement: ''};
      return `<span class="dsp-clickable" data-key="${progA.key}">A: ${progA.statement}</span> <span class="dsp-clickable" data-key="${progB.key}">B: ${progB.statement}</span>`;
    } else {
      return l;
    }
  });
  lcdEl.innerHTML = htmlLines.join('\n');
  
  // Remove and re-add the event listener to ensure only one is active
  lcdEl.removeEventListener('click', handleLcdClick);
  lcdEl.addEventListener('click', handleLcdClick);
  
  // Auto load first menu if applicable
  if (appState.autoLoad && appState.currentKey === appState.presetKey) {
    appState.autoLoad = false;
    const softSubs = subs.slice(1).filter(s => s.type === 'COL' && s.tag.trim().length <=10 && s.tag.trim());
    if (softSubs.length > 0) {
      appState.currentKey = softSubs[0].key;
      updateScreen();
    }
  }
}