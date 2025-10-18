// renderer.js
import { appState } from './state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, sendSysEx } from './midi.js';
import { keypressMasks } from './controls.js';
import { parseSubObject } from './parser.js';
import { showLoading } from './main.js';
import { log } from './main.js'; // Added import for log

export function updateScreen(logParam = null) {
  appState.childSubs = {}; // Clear childSubs on update to prevent stale data
  appState.currentValues = {};
  if (!appState.currentKey.startsWith('4') && !appState.currentKey.startsWith('8')) {
    appState.currentSoftkeys = []; // Clear softkeys only for non-preset menus to prevent leakage while preserving in effects
  }
  sendObjectInfoDump(appState.currentKey, logParam);
  sendValueDump(appState.currentKey, logParam);
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
    appState.currentSoftkeys = []; // Clear softkeys on DSP switch
    appState.childSubs = {}; // Clear child subs on DSP switch
    updateScreen();
  } else if (e.target.classList.contains('softkey')) {
    log(`User clicked virtual softkey: ${e.target.dataset.key} - ${e.target.textContent.trim()}`, 'info', 'general');
    appState.keyStack.push(appState.currentKey);
    appState.currentKey = e.target.dataset.key;
    appState.paramOffset = 0; // Reset offset for new menu
    appState.autoLoad = true;
    appState.childSubs = {}; // Clear child subs on navigation
    updateScreen();
  }
};

const handleSelectChange = (e) => {
  const key = e.target.dataset.key;
  const selectedIndex = e.target.value;
  const selectedDesc = e.target.options[e.target.selectedIndex].text;
  console.log(`Selected option for key ${key}: index ${selectedIndex}, desc ${selectedDesc}`);
  showLoading();
  sendValuePut(key, selectedIndex);
  appState.currentValues[key] = `${parseInt(selectedIndex, 10).toString(16)} ${selectedDesc}`;
  // Removed immediate renderScreen to avoid old subs with new value
  setTimeout(() => {
    updateScreen();
    if (appState.updateBitmapOnChange) {
      sendSysEx(0x18, []);
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
        sendValuePut(loadKey, '1');
        log(`Auto-triggered load for ${loadKey} after program change`, 'info', 'general');
        setTimeout(() => {
          updateScreen();
          sendObjectInfoDump('0');
          log('Fetched root after preset load.', 'debug', 'general');
          if (appState.updateBitmapOnChange) {
            sendSysEx(0x18, []);
            log('Triggered bitmap update after TRG.', 'debug', 'bitmap');
          }
        }, 500); // Delay for device to process load and fetch root
      }, 300); // Additional delay to ensure program value is set
    }
  }, 200); // Delay to allow MIDI update
};

const handleParamClick = (e) => {
  if (e.target.classList.contains('param-value')) {
    const key = e.target.dataset.key;
    // Find the sub for title and limits
    const sub = appState.currentSubs.find(s => s.key === key) ||
                Object.values(appState.childSubs || {}).flat().find(s => s.key === key);
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
            sendValuePut(key, newValueStr);
            appState.currentValues[key] = newValueStr;
            renderScreen(null, appState.lastAscii); // Immediate local update
            setTimeout(() => {
              updateScreen();
              if (appState.updateBitmapOnChange) {
                sendSysEx(0x18, []);
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
        sendValuePut(key, '1');
        log(`Triggered TRG for key ${key}: ${sub.statement}`, 'info', 'general');
        renderScreen(null, appState.lastAscii); // Immediate local update
        setTimeout(() => {
          updateScreen();
          if (key === '1002001c' || key === '1002001d') {
            // Fetch root to update preset names after loading a new program
            sendObjectInfoDump('0');
            log('Fetched root after preset load.', 'debug', 'general');
          }
          if (appState.updateBitmapOnChange) {
            sendSysEx(0x18, []);
            log('Triggered bitmap update after TRG.', 'debug', 'bitmap');
          }
        }, 500); // Increased delay for device to process load
      }
    }
  }
};

function formatValue(statement, value, isHtml = false, key = '') {
  return statement.replace(/%(-)?(\d*)(\.\d*)?f|%(-)?(\d*)s|%/g, (match, fLeftFlag, fWidthStr, precStr, sLeftFlag, sWidthStr) => {
    if (match === '%') return '%';
    if (fLeftFlag !== undefined || fWidthStr !== undefined || precStr !== undefined) { // %[-]width[.prec]f
      const leftAlign = fLeftFlag === '-';
      const width = parseInt(fWidthStr || '0');
      const prec = parseInt(precStr ? precStr.slice(1) : '0');
      let valStr = parseFloat(value).toFixed(prec);
      if (width) {
        valStr = leftAlign ? valStr.padEnd(width) : valStr.padStart(width);
      }
      if (isHtml) {
        return `<span class="param-value" data-key="${key}">${valStr}</span>`;
      }
      return valStr;
    } else if (sLeftFlag !== undefined || sWidthStr !== undefined) { // %[-]widths
      const leftAlign = sLeftFlag === '-';
      const width = parseInt(sWidthStr || '0');
      if (width === 0) return value;
      return leftAlign ? value.padEnd(width) : value.padStart(width);
    }
    return match;
  });
}

export function renderScreen(subs, ascii, logParam) {
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
  const isPreset = appState.currentKey.startsWith('4') || appState.currentKey.startsWith('8');
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
        const formatStr = s.statement || s.tag || '';
        fullText = formatValue(formatStr, value);
        fullHtml = formatValue(formatStr, value, true, s.key);
      } else if (s.type === 'INF') {
        let value = appState.currentValues[s.key] || s.value || '';
        if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, logParam);
        fullText = formatValue(s.statement, value); // Use updated formatValue with s support
        fullHtml = fullText;
      } else if (s.type === 'SET') {
        let value = appState.currentValues[s.key] || s.value || '';
        if (appState.currentValues[s.key] === undefined && !s.value) sendValueDump(s.key, logParam);
        let displayValue = value;
        let indexHex = '0';
        if (value) {
          indexHex = value.split(' ')[0];
          displayValue = value.substring(indexHex.length + 1);
        }
        const indexDec = parseInt(indexHex, 16).toString(10);
        fullText = formatValue(s.statement || '', displayValue); // Use formatValue for %-width s
        let selectHtml = `<select data-key="${s.key}" class="param-select">`;
        s.options.forEach(option => {
          const isSelected = option.index === indexDec;
          selectHtml += `<option value="${option.index}" ${isSelected ? 'selected' : ''}>${option.desc}</option>`;
        });
        selectHtml += `</select>`;
        fullHtml = (s.statement || '').replace(/%(-)?(\d*)s/g, selectHtml);
      } else if (s.type === 'CON') {
        let meterValue = parseFloat(appState.currentValues[s.key] || s.value) || 0;
        if (isNaN(meterValue)) {
          meterValue = 0; // Default to 0 if invalid value
        }
        if (/%[fs]/.test(s.statement)) {
          let displayValue = meterValue;
          if (s.statement.includes('%%')) displayValue *= 100;
          fullText = formatValue(s.statement, displayValue);
          if (fullText.includes('%%')) fullText = fullText.replace('%%', '%');
          fullHtml = fullText;
        } else {
          const tagLength = s.tag.length;
          const barSpace = 40 - tagLength - 1;
          let barLength = Math.round(meterValue * barSpace);
          barLength = Math.max(0, Math.min(barSpace, barLength)); // Clamp to prevent invalid repeat counts
          const bar = '█'.repeat(barLength) + '░'.repeat(barSpace - barLength);
          fullText = `${s.tag} ${bar}`.padEnd(40);
          fullHtml = `<span class="param-label">${s.tag}</span> <span class="meter-bar">${bar}</span>`;
          log(`Rendering CON for key ${s.key}: tag=${s.tag}, value=${meterValue}, barLength=${barLength}, line="${fullText.trim()}"`, 'debug', 'renderScreen');
        }
      } else if (s.type === 'TRG') {
        fullHtml = `<span class="param-value" data-key="${s.key}">${s.statement}</span>`;
        fullText = s.statement;
      }
      if (fullText) {
        paramLines.push(fullText);
        paramHtmlLines.push(fullHtml);
      }
    });
    // Append only the first child sub-menu inline if available
    const hasNonColParams = subs.slice(1).some(s => ['NUM', 'SET', 'CON', 'TRG', 'INF'].includes(s.type));
    let localSoftSubs = subs.slice(1).filter(s => s.type === 'COL' && s.tag.trim().length <=10 && s.tag.trim());
    if (hasNonColParams) {
      localSoftSubs = localSoftSubs.filter(s => s.position !== '0');
    }
    let potentialEmbedSubs = subs.slice(1).filter(s => s.type === 'COL' && s.position === '0' && s.parent === appState.currentKey);
    let embeddedKey = null;
    for (let local of potentialEmbedSubs) {
      const childSubs = (appState.childSubs || {})[local.key] || [];
      if (childSubs.length > 0 && !embeddedKey) {
        embeddedKey = local.key; // Only embed the first local COL
        paramLines.push(''); // Blank line separator
        paramHtmlLines.push('<br>'); // HTML separator
        const childMain = childSubs[0];
        const childTitle = childMain.tag || childMain.statement || '';
        paramLines.push(childTitle);
        paramHtmlLines.push(childTitle);
        // Process child params
        childSubs.slice(1).forEach(cs => {
          let childFullText = '';
          let childFullHtml = '';
          if (cs.type === 'NUM') {
            const value = appState.currentValues[cs.key] || cs.value;
            if (!appState.currentValues[cs.key]) sendValueDump(cs.key);
            const formatStr = cs.statement || cs.tag || '';
            childFullText = formatValue(formatStr, value);
            childFullHtml = formatValue(formatStr, value, true, cs.key);
          } else if (cs.type === 'INF') {
            let value = appState.currentValues[cs.key] || cs.value || '';
            if (appState.currentValues[cs.key] === undefined && !cs.value) sendValueDump(cs.key, logParam);
            childFullText = formatValue(cs.statement, value);
            childFullHtml = childFullText;
          } else if (cs.type === 'SET') {
            let value = appState.currentValues[cs.key] || cs.value || '';
            if (appState.currentValues[cs.key] === undefined && !cs.value) sendValueDump(cs.key, logParam);
            let displayValue = value;
            let indexHex = '0';
            if (value) {
              indexHex = value.split(' ')[0];
              displayValue = value.substring(indexHex.length + 1);
            }
            const indexDec = parseInt(indexHex, 16).toString(10);
            childFullText = formatValue(cs.statement || '', displayValue);
            let selectHtml = `<select data-key="${cs.key}" class="param-select">`;
            cs.options.forEach(option => {
              const isSelected = option.index === indexDec;
              selectHtml += `<option value="${option.index}" ${isSelected ? 'selected' : ''}>${option.desc}</option>`;
            });
            selectHtml += `</select>`;
            childFullHtml = (cs.statement || '').replace(/%(-)?(\d*)s/g, selectHtml);
          } else if (cs.type === 'CON') {
            let meterValue = parseFloat(appState.currentValues[cs.key] || cs.value) || 0;
            if (isNaN(meterValue)) {
              meterValue = 0; // Default to 0 if invalid value
            }
            if (/%[fs]/.test(cs.statement)) {
              let displayValue = meterValue;
              if (cs.statement.includes('%%')) displayValue *= 100;
              childFullText = formatValue(cs.statement, displayValue);
              if (childFullText.includes('%%')) childFullText = childFullText.replace('%%', '%');
              childFullHtml = childFullText;
            } else {
              const tagLength = cs.tag.length;
              const barSpace = 40 - tagLength - 1;
              let barLength = Math.round(meterValue * barSpace);
              barLength = Math.max(0, Math.min(barSpace, barLength)); // Clamp to prevent invalid repeat counts
              const bar = '█'.repeat(barLength) + '░'.repeat(barSpace - barLength);
              childFullText = `${cs.tag} ${bar}`.padEnd(40);
              childFullHtml = `<span class="param-label">${cs.tag}</span> <span class="meter-bar">${bar}</span>`;
              log(`Rendering CON for key ${cs.key}: tag=${cs.tag}, value=${meterValue}, barLength=${barLength}, line="${childFullText.trim()}"`, 'debug', 'renderScreen');
            }
          } else if (cs.type === 'TRG') {
            childFullHtml = `<span class="param-value" data-key="${cs.key}">${cs.statement}</span>`;
            childFullText = cs.statement;
          }
          if (childFullText) {
            paramLines.push(childFullText);
            paramHtmlLines.push(childFullHtml);
          }
        });
        break; // Only embed the first local COL
      }
    }
    displayLines = displayLines.concat(paramLines);
    paramDisplayedHtml = paramHtmlLines;
    // Filter out the embedded local COL from softkeys
    localSoftSubs = localSoftSubs.filter(s => s.key !== embeddedKey);
    let uniqueSoftSubs = [];
    const seen = new Set();
    for (let s of [...(appState.currentSoftkeys || []), ...localSoftSubs]) {
      if (!seen.has(s.key)) {
        seen.add(s.key);
        uniqueSoftSubs.push(s);
      }
    }
    // Only render dynamic softkeys if in a preset/effect menu; otherwise, use subs directly for static menus
    if (isPreset) {
      softSubs = uniqueSoftSubs;
    } else {
      softSubs = subs.slice(1).filter(s => s.type === 'COL' && s.tag.trim());
    }
    if (softSubs.length > 0) {
      appState.currentSoftkeys = softSubs;
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
    select.addEventListener('change', handleSelectChange);
  });
 
  // Add click listeners to param-value for NUM and TRG editing
  lcdEl.querySelectorAll('.param-value').forEach(span => {
    span.removeEventListener('click', handleParamClick);
    span.addEventListener('click', handleParamClick);
  });
 
  // Remove and re-add the event listener to ensure only one is active
  lcdEl.removeEventListener('click', handleLcdClick);
  lcdEl.addEventListener('click', handleLcdClick);
 
  // Auto load first menu if applicable
  const hasParams = subs.slice(1).some(s => ['NUM', 'SET', 'CON', 'TRG', 'INF'].includes(s.type));
  if (appState.autoLoad && !hasParams) {
    appState.autoLoad = false;
    const softSubs = subs.slice(1).filter(s => s.type === 'COL' && s.tag.trim().length <=10 && s.tag.trim());
    if (softSubs.length > 0) {
      log(`Auto-loading first menu: ${softSubs[0].key} - ${softSubs[0].tag}`, 'info', 'general');
      appState.keyStack.push(appState.currentKey);
      appState.currentKey = softSubs[0].key;
      updateScreen();
    }
  } else if (appState.autoLoad) {
    appState.autoLoad = false;
  }
}