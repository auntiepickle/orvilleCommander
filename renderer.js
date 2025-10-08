// renderer.js
import { appState } from './state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, sendSysEx } from './midi.js';
import { keypressMasks } from './controls.js';
import { parseSubObject } from './parser.js';
import { showLoading } from './main.js';

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
    appState.autoLoad = true;
    updateScreen();
  }
};

const handleSelectChange = (e, log) => {
  const key = e.target.dataset.key;
  const selectedIndex = e.target.value;
  const selectedDesc = e.target.options[e.target.selectedIndex].text;
  console.log(`Selected option for key ${key}: index ${selectedIndex}, desc ${selectedDesc}`);
  showLoading();
  sendValuePut(key, selectedIndex, log);
  appState.currentValues[key] = `${parseInt(selectedIndex, 10).toString(16)} ${selectedDesc}`;
  // Removed immediate renderScreen to avoid old subs with new value
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

    // Auto-load preset if changing the program select in load menu
    if (key === '10020011') {
      setTimeout(() => {
        const loadKey = appState.presetKey.startsWith('4') ? '1002001c' : '1002001d';
        appState.isLoadingPreset = true;
        sendValuePut(loadKey, '1', log);
        log(`Auto-triggered load for ${loadKey} after program change`, 'info', 'general');
        setTimeout(() => {
          updateScreen(log);
          sendObjectInfoDump('0', log);
          log('Fetched root after preset load.', 'debug', 'general');
          if (appState.updateBitmapOnChange) {
            sendSysEx(0x18, [], log);
            log('Triggered bitmap update after TRG.', 'debug', 'bitmap');
          }
        }, 500); // Delay for device to process load and fetch root
      }, 300); // Additional delay to ensure program value is set
    }
  }, 200); // Delay to allow MIDI update
};

const handleParamClick = (e, log) => {
  if (e.target.classList.contains('param-value')) {
    const key = e.target.dataset.key;
    // Find the sub for title and limits
    const sub = appState.currentSubs.find(s => s.key === key);
    if (sub) {
      if (sub.type === 'NUM') {
        const title = sub.statement.replace(/%.*f/, '').trim(); // Clean format specifier
        const currentValue = appState.currentValues[key] || sub.value;
        const newValueStr = prompt(`Enter new value for ${title}:`, currentValue);
        if (newValueStr !== null) {
          const newValue = parseFloat(newValueStr);
          const min = parseFloat(sub.min) || -Infinity;
          const max = parseFloat(sub.max) || Infinity;
          if (!isNaN(newValue) && newValue >= min && newValue <= max) {
            showLoading();
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
      } else if (sub.type === 'TRG') {
        showLoading();
        if (key === '1002001c' || key === '1002001d') {
          appState.isLoadingPreset = true;
          log('Started loading preset.', 'info', 'general');
        }
        sendValuePut(key, '1', log);
        log(`Triggered TRG for key ${key}: ${sub.statement}`, 'info', 'general');
        renderScreen(null, appState.lastAscii, log); // Immediate local update
        setTimeout(() => {
          updateScreen(log);
          if (key === '1002001c' || key === '1002001d') {
            // Fetch root to update preset names after loading a new program
            sendObjectInfoDump('0', log);
            log('Fetched root after preset load.', 'debug', 'general');
          }
          if (appState.updateBitmapOnChange) {
            sendSysEx(0x18, [], log);
            log('Triggered bitmap update after TRG.', 'debug', 'bitmap');
          }
        }, 500); // Increased delay for device to process load
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
  let softSubs = [];

  if (appState.dspAName && appState.dspBName) {
    const isAActive = appState.presetKey.startsWith('4');
    const aPart = isAActive ? `[A: ${appState.dspAName}]` : `A: ${appState.dspAName}`;
    const bPart = !isAActive ? `[B: ${appState.dspBName}]` : `B: ${appState.dspBName}`;
    topHtml = ` <span class="${isAActive ? 'dsp-clickable current' : 'dsp-clickable'}" data-key="${appState.dspAKey}">${aPart}</span> <span class="${!isAActive ? 'dsp-clickable current' : 'dsp-clickable'}" data-key="${appState.dspBKey}">${bPart}</span>`;

    if (appState.currentKey === '0' || appState.currentKey.startsWith('4') || appState.currentKey.startsWith('8')) {
      displayLines.push(` ${aPart} ${bPart}`);
      isTabLineAdded = true;
    }
  }

  if (appState.currentKey === '0') {
    displayLines.push('');
    displayLines.push('');
    const softSubsUsed = subs.filter(s => s.type === 'COL' && s.tag.trim() && s.key !== '401000b' && s.key !== '801000b' && s.key !== '10040000' && s.key !== '0');
    const columnWidth = Math.floor(40 / softSubsUsed.length);
    const softTags = softSubsUsed.map(s => {
      const t = s.tag.trim();
      const text = (s.key === appState.currentKey ? `[${t}]` : t).padEnd(columnWidth);
      return text;
    });
    displayLines.push(softTags.join(''));
  } else {
    let title = main.statement || main.tag || 'Menu';
    displayLines.push(title);
    let paramLines = [];
    let paramHtmlLines = [];

    // Group graphic EQ NUMs with position 'a'
    const graphicEqSubs = subs.slice(1).filter(s => s.type === 'NUM' && s.position === 'a');
    let graphicEqLine = '';
    let graphicEqHtml = '';
    if (graphicEqSubs.length > 0) {
      const formattedParts = graphicEqSubs.map(s => {
        const value = appState.currentValues[s.key] || s.value;
        if (!appState.currentValues[s.key]) sendValueDump(s.key);
        // Parse tag like 'v1:%3.0f' for label and format
        const [label, format] = s.tag.split(':');
        const formattedValue = formatValue(format || '%3.0f', value);
        return `${label}: ${formattedValue}`;
      });
      graphicEqLine = formattedParts.join(' ');
      // For HTML, wrap each value in span for potential editing
      const formattedHtmlParts = graphicEqSubs.map(s => {
        const value = appState.currentValues[s.key] || s.value;
        const [label, format] = s.tag.split(':');
        const formattedValue = formatValue(format || '%3.0f', value, true, s.key);
        return `${label}: ${formattedValue}`;
      });
      graphicEqHtml = formattedHtmlParts.join(' ');
      paramLines.push(graphicEqLine);
      paramHtmlLines.push(graphicEqHtml);
    }

    subs.slice(1).forEach(s => {
      if (s.position === 'a') return; // Skip individual 'a' after grouping
      let fullText = '';
      let fullHtml = '';
      if (s.type === 'NUM') {
        const value = appState.currentValues[s.key] || s.value;
        if (!appState.currentValues[s.key]) sendValueDump(s.key);
        // Use statement if present, fallback to tag for formatting if statement empty
        const formatStr = s.statement || s.tag || '';
        fullText = formatValue(formatStr, value);
        fullHtml = formatValue(formatStr, value, true, s.key);
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      } else if (s.type === 'INF') {
        let value = appState.currentValues[s.key] || s.value || '';
        if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, log);
        // Parse format for %[-width]s
        fullText = s.statement.replace(/%(-)?(\d*)s/g, (match, leftFlag, widthStr) => {
          const leftAlign = !!leftFlag;
          const width = parseInt(widthStr) || 0;
          if (width === 0) return value;
          return leftAlign ? value.padEnd(width) : value.padStart(width);
        });
        fullHtml = fullText;
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      } else if (s.type === 'SET') {
        let value = appState.currentValues[s.key] || s.value || '';
        if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, log); 
        let displayValue = value;
        let indexHex = '0';
        if (value) {
          indexHex = value.split(' ')[0];
          displayValue = value.substring(indexHex.length + 1);
        }
        const indexDec = parseInt(indexHex, 16).toString(10);
        fullText = (s.statement || '').replace(/%s/g, displayValue);
        let selectHtml = `<select data-key="${s.key}" class="param-select">`;
        s.options.forEach(option => {
          const isSelected = option.index === indexDec;
          selectHtml += `<option value="${option.index}" ${isSelected ? 'selected' : ''}>${option.desc}</option>`;
        });
        selectHtml += `</select>`;
        fullHtml = (s.statement || '').replace(/%s/g, selectHtml);
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      } else if (s.type === 'CON') {
        const meterValue = parseFloat(appState.currentValues[s.key] || s.value) || 0;
        const tagLength = s.tag.length;
        const barSpace = 40 - tagLength - 1;
        const barLength = Math.round(meterValue * barSpace);
        const bar = '█'.repeat(barLength) + '░'.repeat(barSpace - barLength); // Use ░ for empty to visualize full meter
        fullText = `${s.tag} ${bar}`.padEnd(40);
        fullHtml = `<span class="param-label">${s.tag}</span> <span class="meter-bar">${bar}</span>`;
        if (log) log(`Rendering CON for key ${s.key}: tag=${s.tag}, value=${meterValue}, barLength=${barLength}, line="${fullText.trim()}"`, 'debug', 'renderScreen');
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      } else if (s.type === 'TRG') {
        fullHtml = `<span class="param-value" data-key="${s.key}">${s.statement}</span>`;
        fullText = s.statement;
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      }
    });
    displayLines = displayLines.concat(paramLines);
    paramDisplayedHtml = paramHtmlLines;
    let localSoftSubs = subs.slice(1).filter(s => s.type === 'COL' && s.tag.trim().length <=10 && s.tag.trim());
    softSubs = localSoftSubs;
    if (localSoftSubs.length > 0) {
      appState.currentSoftkeys = localSoftSubs;
    } else {
      softSubs = appState.currentSoftkeys || [];
    }
    const columnWidth = softSubs.length > 0 ? Math.floor(40 / softSubs.length) : 10;
    const softTags = softSubs.map(s => {
      const t = s.tag.trim();
      const text = (s.key === appState.currentKey ? `[${t}]` : t).padEnd(columnWidth);
      return text;
    });
    if (paramLines.length > 0) {
      displayLines.push('');
    }
    displayLines.push(softTags.join(''));
    displayLines.push('');
    const staticRootSoftSubs = [
      {key: '10020000', tag: 'program'},
      {key: '10010000', tag: 'setup'},
      {key: '10030000', tag: 'levels'},
      {key: '10030500', tag: 'bypass'}
    ];
    const staticColumnWidth = Math.floor(40 / staticRootSoftSubs.length);
    const staticTags = staticRootSoftSubs.map(s => {
      const text = (s.key === appState.currentKey ? `[${s.tag}]` : s.tag).padEnd(staticColumnWidth);
      return text;
    });
    displayLines.push(staticTags.join(''));
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
        const columnWidth = Math.floor(40 / softSubsUsed.length);
        softSubsUsed.forEach((s, idx) => {
          const t = (s.tag || '').trim();
          const text = (s.key === appState.currentKey ? `[${t}]` : t).padEnd(columnWidth);
          softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${text}</span>`;
        });
        return softHtml;
      } else {
        return l;
      }
    });
  } else {
    mainHtmlLines = displayLines.slice(startIndex, -1).map((l, index) => {
      if (index === displayLines.length - startIndex - 3) { // dynamic softkeys before '' static
        let softHtml = '';
        const columnWidth = softSubs.length > 0 ? Math.floor(40 / softSubs.length) : 10;
        softSubs.forEach((s, idx) => {
          const t = (s.tag || '').trim();
          const text = (s.key === appState.currentKey ? `[${t}]` : t).padEnd(columnWidth);
          softHtml += `<span class="softkey" data-key="${s.key}" data-idx="${idx}">${text}</span>`;
        });
        return softHtml;
      } else if (index > 0 && index < displayLines.length - startIndex - 3) {
        const paramIndex = index - 1; // Adjust for title at 0
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
    const staticColumnWidth = Math.floor(40 / staticRootSoftSubs.length);
    staticRootSoftSubs.forEach((s, idx) => {
      const text = (s.key === appState.currentKey ? `[${s.tag}]` : s.tag).padEnd(staticColumnWidth);
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
  
  // Add click listeners to param-value for NUM and TRG editing
  lcdEl.querySelectorAll('.param-value').forEach(span => {
    span.removeEventListener('click', handleParamClick);
    span.addEventListener('click', (e) => handleParamClick(e, log));
  });
  
  // Remove and re-add the event listener to ensure only one is active
  lcdEl.removeEventListener('click', handleLcdClick);
  lcdEl.addEventListener('click', handleLcdClick);
  
  // Auto load first menu if applicable
  if (appState.autoLoad) {
    appState.autoLoad = false;
    const softSubs = subs.slice(1).filter(s => s.type === 'COL' && s.tag.trim().length <=10 && s.tag.trim());
    if (softSubs.length > 0) {
      appState.keyStack.push(appState.currentKey);
      appState.currentKey = softSubs[0].key;
      updateScreen();
    }
  }
}