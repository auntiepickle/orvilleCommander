// renderer.js
import { appState } from './state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, sendSysEx } from './midi.js';
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
  }
};

const handleSelectChange = (e, log) => {
  const key = e.target.dataset.key;
  const selectedIndex = e.target.value;
  const selectedDesc = e.target.options[e.target.selectedIndex].text;
  console.log(`Selected option for key ${key}: index ${selectedIndex}, desc ${selectedDesc}`);
  sendValuePut(key, selectedIndex, log);
  appState.currentValues[key] = `${selectedIndex} ${selectedDesc}`;
  renderScreen(null, appState.lastAscii, log); // Immediate local update
  setTimeout(() => {
    updateScreen(log);
    if (appState.updateBitmapOnChange) {
      sendSysEx(0x18, [], log);
      log('Triggered bitmap update after value change.', 'debug', 'bitmap');
    }
    setTimeout(() => {
      const newValue = appState.currentValues[key];
      if (newValue && newValue.includes(selectedDesc)) {
        console.log(`Value update successful for key ${key}: ${newValue}`);
      } else {
        console.log(`Value update failed for key ${key}. Expected desc: ${selectedDesc}, got: ${newValue}`);
      }
    }, 500); // Wait for VALUE_DUMP to arrive
  }, 200); // Delay to allow MIDI update
};

const handleParamClick = (e, log) => {
  if (e.target.classList.contains('param-value')) {
    const key = e.target.dataset.key;
    // Find the sub for title and limits
    const sub = appState.currentSubs.find(s => s.key === key);
    if (sub && sub.type === 'NUM') {
      const title = sub.statement.replace(/%.*f/, '').trim(); // Clean format specifier
      const currentValue = appState.currentValues[key] || sub.value;
      const newValueStr = prompt(`Enter new value for ${title}:`, currentValue);
      if (newValueStr !== null) {
        const newValue = parseFloat(newValueStr);
        const min = parseFloat(sub.min) || -Infinity;
        const max = parseFloat(sub.max) || Infinity;
        if (!isNaN(newValue) && newValue >= min && newValue <= max) {
          sendValuePut(key, newValueStr, log);
          appState.currentValues[key] = newValueStr;
          renderScreen(null, appState.lastAscii, log); // Immediate local update
          setTimeout(() => {
            updateScreen(log);
            if (appState.updateBitmapOnChange) {
              sendSysEx(0x18, [], log);
              log('Triggered bitmap update after value change.', 'debug', 'bitmap');
            }
          }, 200);
        } else {
          alert(`Invalid value. Must be a number between ${min} and ${max}.`);
        }
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
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      } else if (s.type === 'CON' || s.type === 'SET') {
        let value, isEditable = (s.type === 'SET');
        if (s.type === 'CON') {
          value = s.value || '0';
          isEditable = false;
        } else { // SET
          value = appState.currentValues[s.key] || '';
          if (!appState.currentValues[s.key]) sendValueDump(s.key, log);
        }
        let displayValue = value;
        let indexHex = '0';
        if (value) {
          indexHex = value.split(' ')[0];
          displayValue = value.substring(indexHex.length + 1);
        }
        if (s.type === 'SET') {
          fullText = (s.statement || '').replace(/%s/g, displayValue);
          let selectHtml = `<select data-key="${s.key}" style="background: transparent; border: none; color: inherit; font: inherit; cursor: pointer;">`;
          s.options.forEach(option => {
            const isSelected = option.index === indexHex;
            selectHtml += `<option value="${option.index}" ${isSelected ? 'selected' : ''}>${option.desc}</option>`;
          });
          selectHtml += `</select>`;
          fullHtml = (s.statement || '').replace(/%s/g, selectHtml);
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
  log(`Rendered screen text: ${displayLines.join('\n')}`, 'debug', 'renderScreen');
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

  // Add change listeners to selects
  lcdEl.querySelectorAll('select[data-key]').forEach(select => {
    select.removeEventListener('change', handleSelectChange);
    select.addEventListener('change', (e) => handleSelectChange(e, log));
  });
  
  // Add click listeners to param-value for NUM editing
  lcdEl.querySelectorAll('.param-value').forEach(span => {
    span.removeEventListener('click', handleParamClick);
    span.addEventListener('click', (e) => handleParamClick(e, log));
  });
  
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