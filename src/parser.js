// parser.js
import { appState } from './state.js';
import { CMD, KEY, KEY_PREFIX, KEY_SUFFIX, SYSEX } from './sysex-commands.js';
import { TIMING } from './constants.js';
import { setState } from './store.js';
import { sendValuePut, sendValueDump, sendObjectInfoDump, notifyResponse } from './midi.js';
import { recordDump, parentOf, findParamUnder } from './tree.js';
import { log } from './logger.js';
import { denibble } from './bitmap.js';
import { emit } from './events.js';
import { splitLine } from './sysex-split.js';

export function parseResponse(data) {
  // Atomic parse (A5): snapshot state so a throw mid-parse reverts cleanly
  // instead of leaving appState half-applied from a malformed dump.
  const snapshot = { ...appState };
  try {
    if (appState.deviceId === 0 && data.length > 3) {
      setState({ deviceId: data[3] }, 'parser:device-id-detect');
      log(`Detected device ID: ${appState.deviceId}`, 'info', 'general');
    }
    const ascii = String.fromCharCode(...data.slice(SYSEX.FRAME_PREFIX_LEN, data.length - 1))
      .replace(/\0+$/, '')
      .trim();
    if (data[3] === appState.deviceId && data[4] === CMD.OBJECTINFO) {
      // OBJECTINFO_DUMP
      const subs = ascii
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line)
        .map(parseSubObject);
      log(
        `Parsed OBJECTINFO_DUMP for key ${subs[0]?.key || 'unknown'}: ${ascii}`,
        'info',
        'parsedDump'
      );
      const main = subs[0];
      // T1b: every dump describes a tree node and names its children —
      // record unconditionally; all navigation state derives from this.
      recordDump(subs);
      if (main.key === KEY.ROOT) {
        const dspASub = subs.find((s) => s.key.startsWith(KEY_PREFIX.DSP_A));
        const dspBSub = subs.find((s) => s.key.startsWith(KEY_PREFIX.DSP_B));
        setState(
          {
            dspAKey: dspASub?.key || KEY.DSP_A_PRESET,
            dspBKey: dspBSub?.key || KEY.DSP_B_PRESET,
            dspAName: dspASub?.statement || '',
            dspBName: dspBSub?.statement || '',
          },
          'parser:root-dsp-meta'
        );
      }
      notifyResponse('objectinfo', main.key);
      if (main.key.endsWith(KEY_SUFFIX.PRESET)) {
        const dsp = main.key[0] === KEY_PREFIX.DSP_A ? 'A' : 'B';
        setState(
          {
            [`menus${dsp}`]: subs.slice(1).filter((s) => s.type === 'COL'),
            [`dsp${dsp}Name`]: main.statement,
          },
          'parser:preset-meta'
        );
        if (main.key === appState.currentKey) {
          setState({ presetKey: main.key }, 'parser:preset-key');
        }
      }
      if (main.key === appState.currentKey) {
        // Fetch child sub-menus for ALL COL children (T1b: labels no longer
        // gate fetching — blank nodes need their children loaded to derive a
        // label, and the tree wants completeness). Per-visit freshness: this
        // fires once per arrival of the current menu's dump. At ROOT the
        // presets are excluded: they render as header tabs, not softkeys,
        // and the connect landing fetches the active one itself (R9 review).
        const localSoftSubs = subs
          .slice(1)
          .filter(
            (s) => s.type === 'COL' && !(main.key === KEY.ROOT && s.key.endsWith(KEY_SUFFIX.PRESET))
          );
        localSoftSubs.forEach((s) => {
          sendObjectInfoDump(s.key);
          sendValueDump(s.key);
        });
        setState({ lastAscii: ascii }, 'parser:current-key-ascii');
        setState({ currentSubs: subs }, 'parser:current-subs');
        emit('objectinfo:received', { key: main.key, subs, ascii });
      } else if (main.key === KEY.ROOT && appState.currentKey !== KEY.ROOT) {
        // Background root dump received (e.g., after preset load). The new
        // top-bar/DSP names land on the wave's settled render (dumpComplete);
        // the event remains for observability.
        emit('objectinfo:received', { key: main.key });
      } else {
        // T1b: the tree (recordDump above) already stored the node. Emit the
        // child-arrival event only when the TREE says the dump belongs to the
        // on-screen menu — parentage learned from the menu's own dump, which
        // is what navigated us here. This replaces the C8 childSubs
        // correlation guard (view-state membership checks) entirely: late
        // dumps from a menu navigated away from have a different tree parent
        // and stay silent (still cached for when the user returns).
        if (parentOf(main.key) === appState.currentKey) {
          log(
            `Tree-recorded child ${main.key} of on-screen menu ${appState.currentKey}`,
            'debug',
            'parsedDump'
          );
          emit('objectinfo:received', { key: main.key });
        }
      }
      // Fix for Favorites re-ordering after preset load. Gates on
      // loadingPresetName alone since C4 deleted isLoadingPreset. NOTE: no
      // production code writes loadingPresetName — this path is currently
      // reachable only in tests (pre-existing; see the ledger C4 entry).
      if (main.key === KEY.FAVORITES && appState.loadingPresetName) {
        const bankSub = subs.find((s) => s.key === KEY.BANK_SELECT);
        if (bankSub) {
          const bankValue = appState.currentValues[bankSub.key] || bankSub.value;
          if (bankValue.startsWith('0 ')) {
            // Favorites bank
            const programSub = subs.find((s) => s.key === KEY.PROGRAM_SELECT);
            if (programSub && programSub.options) {
              const targetName = appState.loadingPresetName;
              const newIndex = programSub.options.findIndex(
                (opt) => opt.desc.trim().split(' ').slice(1).join(' ') === targetName
              );
              const currentProgramValue =
                appState.currentValues[programSub.key] || programSub.value;
              const currentIndex = parseInt(currentProgramValue.split(' ')[0], 10);
              if (newIndex !== -1 && newIndex !== currentIndex) {
                log(
                  `Correcting selection after Favorites re-order: setting to index ${newIndex} for "${targetName}"`,
                  'info',
                  'general'
                );
                sendValuePut(programSub.key, newIndex.toString());
                // No optimistic cache write (A3): the device echoes a 0x2e
                // dump of the resulting (possibly clamped) value after a PUT
                // (B10g.3), and the delayed re-dump below reconciles on top of
                // that — either way the device, not a local write, is the
                // single source of truth if the PUT does not take as sent.
                setTimeout(() => sendValueDump(programSub.key), TIMING.REDUMP_MS);
              }
            }
          }
        }
      }
    } else if (data[3] === appState.deviceId && data[4] === CMD.VALUE_DUMP) {
      // VALUE_DUMP
      const parts = splitLine(ascii);
      const key = parts[0];
      notifyResponse('valuedump', key);
      const value = parts.slice(1).join(' ');
      const oldValue = appState.currentValues[key];
      setState(
        { currentValues: { ...appState.currentValues, [key]: value } },
        'parser:value-cache'
      );
      log(`Parsed VALUE_DUMP for key ${key}: ${value}`, 'info', 'parsedDump');
      if (oldValue && oldValue !== value) {
        log(`Value changed from ${oldValue} to ${value}`, 'info', 'valueChange');
      } else if (oldValue) {
        log(`Value did not change, still ${value}`, 'debug', 'noChange');
      }
      if (key === KEY.PROGRAM_SELECT || key === KEY.BANK_SELECT) {
        return; // Skip render for program/bank VALUE_DUMP to avoid brief wrong state
      }
      log(
        `Checking for CON on key ${key}, currentSubs length: ${appState.currentSubs.length}`,
        'debug',
        'general'
      );
      const sub = appState.currentSubs.find((s) => s.key === key);
      log(
        `Sub found for key ${key}: ${!!sub}, type: ${sub ? sub.type : 'undefined'}`,
        'debug',
        'general'
      );
      // C7 (#43): meter detection is type-based — a key is a meter iff the
      // loaded subs (current menu or a stored child menu) type it CON. The old
      // endsWith('0002') key heuristic classified by naming convention and
      // could misfire (menu keys can end 0002 too); a key the app has not
      // loaded has no on-screen line an immediate render could update, so
      // unknown keys take the coalesced path instead. The 0002 naming
      // convention itself stays documented in docs/device-model.md §5.
      const childSub = findParamUnder(appState.currentKey, key);
      if ((sub || childSub)?.type === 'CON') {
        emit('value:received', { key, immediate: true });
        log(
          `Immediate re-rendered screen for CON value change on key ${key}`,
          'debug',
          'renderScreen'
        );
      } else if (childSub) {
        // Embedded child param: its line is already on screen, render now
        log(`Fallback triggered for child param key ${key}`, 'debug', 'general');
        emit('value:received', { key, immediate: true });
        log(`Immediate re-rendered screen for VALUE_DUMP on key ${key}`, 'debug', 'renderScreen');
      } else {
        emit('value:received', { key, immediate: false });
      }
    } else if (data[3] === appState.deviceId && data[4] === CMD.SCREEN_BITMAP) {
      // Screen dump response
      const nibbles = data.slice(SYSEX.FRAME_PREFIX_LEN, data.length - 1);
      if (nibbles.length % 2 !== 0) {
        log('[ERROR] Odd number of nibbles in screen dump', 'error', 'error');
        return;
      }
      const rawBytes = denibble(nibbles);
      // log() gates on the 'bitmap' category itself (C6 — no appState read here).
      log(`[LOG] Denibbled screen data to ${rawBytes.length} bytes`, 'debug', 'bitmap');
      emit('screen:received', { rawBytes });
    }
  } catch (err) {
    // Revert any partial writes from this call (A5). Delete keys added during
    // the failed parse, then restore the snapshot's values.
    for (const k of Object.keys(appState)) {
      if (!(k in snapshot)) delete appState[k];
    }
    Object.assign(appState, snapshot);
    log(`Parse response error: ${err.stack || err.message}`, 'error', 'error');
  }
}

export function parseSubObject(line) {
  const parts = splitLine(line);
  const type = parts[0] || '';
  const position = parts[1] || '0'; // Keep as string to handle 'a' etc.
  const key = parts[2] || '';
  const parent = parts[3] || '';
  const statement = parts[4] || '';
  const tag = parts[5] || '';
  let value;
  let min = '',
    max = '',
    step = '';
  let options = [];
  if (type === 'NUM') {
    value = parts[6] || '0';
    min = parts[7] || '';
    max = parts[8] || '';
    step = parts[9] || '';
  } else if (type === 'SET' || type === 'CON') {
    let i = 6; // skip tag
    if (type === 'CON') {
      value = parts[i] || '0';
    } else {
      // SET
      const current_index = parts[i++] || '0';
      const current_desc = parts[i++] || '';
      value = `${current_index} ${current_desc}`;
      const num = parseInt(parts[i++], 16);
      for (let j = 0; j < num; j++) {
        const desc = parts[i + j]; // Preserve apostrophes in desc
        const index = j.toString(10);
        options.push({ index, desc });
      }
    }
  } else {
    value = parts[6] || '';
  }
  return { type, position, key, parent, statement, tag, value, min, max, step, options };
}
