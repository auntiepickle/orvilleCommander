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

export function toggleDspKey(key) {
  return key.startsWith('4') ? '8' + key.slice(1) : '4' + key.slice(1);
}

const handleLcdClick = (e) => {
  if (e.target.classList.contains('dsp-clickable')) {
    appState.presetKey = e.target.dataset.key;
    if (!appState.currentKey.startsWith('4') && !appState.currentKey.startsWith('8')) {
      appState.keyStack.push(appState.currentKey);
    }
    appState.currentKey = appState.presetKey;
    appState.autoLoad = true;
    updateScreen();
  } else if (e.target.classList.contains('softkey')) {
    appState.keyStack.push(appState.currentKey);
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
  let isTabLineAdded = false;
  let topHtml = '';

  // Dynamically select the correct menus array based on currentKey prefix
  let menus = [];
  if (appState.currentKey.startsWith('4')) {
    menus = appState.menusA;
  } else if (appState.currentKey.startsWith('8')) {
    menus = appState.menusB;
  }

  if (appState.dspAName && appState.dspBName) {
    const isDspScreen = appState.currentKey.startsWith('4') || appState.currentKey.startsWith('8');
    const isASelected = isDspScreen && appState.currentKey.startsWith('4');
    const aText = isASelected ? `[A: ${appState.dspAName}]` : `A: ${appState.dspAName}`;
    const bText = !isASelected && isDspScreen ? `[B: ${appState.dspBName}]` : `B: ${appState.dspBName}`;
    displayLines.push(` ${aText} ${bText}`);
    topHtml = ` <span class="dsp-clickable" data-key="${appState.dspAKey}">${aText}</span> <span class="dsp-clickable" data-key="${appState.dspBKey}">${bText}</span>`;
    isTabLineAdded = true;
  }
  if (appState.currentKey === '0') {
    displayLines.push('');
    displayLines.push('');
    const softSubs = subs.filter(s => s.type === 'COL' && s.tag.trim() && s.key !== '401000b' && s.key !== '801000b' && s.key !== '10040000' && s.key !== '0');
    const softTags = softSubs.map(s => (s.tag || '').padEnd(10));
    displayLines.push(softTags.join(''));
  } else {
    displayLines.push('');
    let title = main.statement || main.tag || 'Menu';
    displayLines.push(title);
    displayLines.push('--------------------------------');
    let paramLines = [];
    let paramHtmlLines = [];
    subs.slice(1).forEach(s => {
      let fullText = '';
      let fullHtml = '';
      if (s.type === 'NUM') {
        const value = appState.currentValues[s.key] || s.value;
        if (!appState.currentValues[s.key]) sendValueDump(s.key);
        fullText = formatValue(s.statement || '', value);
        fullHtml = formatValue(s.statement || '', value, true, s.key);
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      } else if (s.type === 'INF') {
        const replaceWith = s.value || s.tag || '';
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
          let selectHtml = `<select data-key="${s.key}" class="param-select">`;
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
    if (menus.length > 0 && appState.currentKey !== appState.presetKey && (appState.currentKey.startsWith('4') || appState.currentKey.startsWith('8'))) {
      softSubs = menus;
    }
    const softTags = softSubs.map(s => s.tag.trim());
    displayLines.push('');
    displayLines.push(softTags.map((t, idx) => (softSubs[idx].key === appState.currentKey ? `[${t}]` : t).padEnd(10)).join(''));
    displayLines.push('');
    displayLines.push('');
    const staticRootSoftSubs = [
      {key: '10020000', tag: 'program'},
      {key: '10010000', tag: 'setup'},
      {key: '10030000', tag: 'levels'},
      {key: '10030500', tag: 'bypass'}
    ];
    displayLines.push(staticRootSoftSubs.map((s, idx) => (s.key === appState.currentKey ? `[${s.tag}]` : s.tag).padEnd(10)).join(''));
  }
  log(`Rendered screen text: ${displayLines.join('\n')}`, 'debug', 'renderScreen');
  let mainHtmlLines = [];
  let bottomHtml = '';
  const startIndex = isTabLineAdded ? 1 : 0;
  if (appState.currentKey === '0') {
    mainHtmlLines = displayLines.slice(startIndex).map((l, index) => {
      if (index === displayLines.length - startIndex - 1) {
        let softHtml = '';
        let softSubsUsed = subs.filter(s => s.type === 'COL' && s.tag.trim() && s.key !== '401000b' && s.key !== '801000b' && s.key !== '10040000' && s.key !== '0');
        softSubsUsed.forEach((s, idx) => {
          const text = (s.key === appState.currentKey ? '[' + (s.tag || '') + ']' : (s.tag || '')).padEnd(10);
          softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${text}</span>`;
        });
        return softHtml;
      } else {
        return l;
      }
    });
  } else {
    mainHtmlLines = displayLines.slice(startIndex, -1).map((l, index) => {
      if (index === displayLines.length - startIndex - 4) { // dynamic softkeys before '' '' static
        let softHtml = '';
        let softSubsUsed = subs.slice(1).filter(s => s.type === 'COL' && s.tag.trim().length <=10 && s.tag.trim());
        if (menus.length > 0 && appState.currentKey !== appState.presetKey && (appState.currentKey.startsWith('4') || appState.currentKey.startsWith('8'))) {
          softSubsUsed = menus;
        }
        softSubsUsed.forEach((s, idx) => {
          const text = (s.key === appState.currentKey ? '[' + (s.tag || '') + ']' : (s.tag || '')).padEnd(10);
          softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${text}</span>`;
        });
        return softHtml;
      } else if (index > (isTabLineAdded ? 3 : 2) && index < displayLines.length - startIndex - 4) {
        const paramIndex = index - (isTabLineAdded ? 4 : 3);
        const html = paramDisplayedHtml[paramIndex];
        return html || l;
      } else {
        return l;
      }
    });
    // Static as bottom
    const staticRootSoftSubs = [
      {key: '10020000', tag: 'program'},
      {key: '10010000', tag: 'setup'},
      {key: '10030000', tag: 'levels'},
      {key: '10030500', tag: 'bypass'}
    ];
    let softHtml = '';
    staticRootSoftSubs.forEach((s, idx) => {
      const text = (s.key === appState.currentKey ? '[' + s.tag + ']' : s.tag).padEnd(10);
      softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${text}</span>`;
    });
    bottomHtml = softHtml;
  }
  lcdEl.innerHTML = `<div class="top-docked">${topHtml}</div><div class="main-content">${mainHtmlLines.join('\n')}</div><div class="bottom-docked">${bottomHtml}</div>`;

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
      appState.keyStack.push(appState.currentKey);
      appState.currentKey = softSubs[0].key;
      updateScreen();
    }
  }
}