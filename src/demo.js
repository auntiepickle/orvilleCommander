// demo.js
// Demo mode: browse the full UI with the unit off. createDemoPorts() returns
// in/out adapters satisfying midi.js's port contract, where the "device" is
// src/demo-data.json — a tree of real OBJECTINFO dumps captured from the
// live Orville (98 nodes, depth 4) plus a real screen frame. Replies are
// delivered asynchronously after DEMO.REPLY_LATENCY_MS so the dump-wave
// lifecycle (BUSY LED, progressive paints, watchdog) behaves like the wire.
//
// Semantics:
// - OBJECTINFO_DUMP: served from the capture; uncaptured keys get an honest
//   placeholder node so navigation never strands a wave.
// - VALUE (get): the value embedded in the captured dumps, overlaid by any
//   demo-session PUTs — edits stick for the session, like a device would.
// - VALUE (put): stored and echoed back (the device echoes puts, #104).
// - GET_SCREEN: replays the captured frame verbatim.
// - KEYPRESS: accepted silently (the app's follow-up refresh drives the UI).

import demoData from './demo-data.json';
import { SYSEX, CMD } from './sysex-commands.js';
import { DEMO } from './constants.js';
import { parseSubObject } from './parser.js';
import { log } from './logger.js';

// key -> value, seeded from every captured dump's embedded values; PUTs
// overlay it for the session.
function buildValueStore() {
  const values = new Map();
  for (const ascii of Object.values(demoData.objectinfo)) {
    for (const line of ascii.split('\n').slice(1)) {
      const sub = parseSubObject(line.trim());
      if (sub.key && sub.value !== undefined && sub.value !== '') {
        values.set(sub.key, sub.value);
      }
    }
  }
  return values;
}

export function createDemoPorts() {
  const listeners = [];
  const values = buildValueStore();

  const inAdapter = {
    addListener(type, cb) {
      if (type === 'sysex') listeners.push(cb);
    },
    removeListener(type, cb) {
      const i = listeners.indexOf(cb);
      if (i !== -1) listeners.splice(i, 1);
    },
  };

  const deliverAscii = (cmd, ascii) => {
    const payload = [...ascii].map((c) => c.charCodeAt(0));
    const frame = [
      SYSEX.START,
      ...SYSEX.MANUFACTURER,
      demoData.deviceId,
      cmd,
      ...payload,
      SYSEX.END,
    ];
    setTimeout(() => {
      for (const cb of listeners) cb({ data: frame });
    }, DEMO.REPLY_LATENCY_MS);
  };

  const outAdapter = {
    sendSysex(_mfr, data) {
      const cmd = data[1];
      const payload = data.slice(2);
      if (cmd === CMD.OBJECTINFO_DUMP) {
        const key = String.fromCharCode(...payload).trim();
        const ascii =
          demoData.objectinfo[key] ??
          // Honest placeholder: an empty COL so the wave drains and the
          // page says what happened instead of hanging.
          `COL 0 ${key} ${key} 'not in demo capture' demo 0`;
        deliverAscii(CMD.OBJECTINFO, ascii);
      } else if (cmd === CMD.VALUE) {
        const sep = payload.indexOf(SYSEX.VALUE_SEPARATOR);
        if (sep === -1) {
          const key = String.fromCharCode(...payload).trim();
          deliverAscii(CMD.VALUE_DUMP, `${key} ${values.get(key) ?? ''}`.trim());
        } else {
          const key = String.fromCharCode(...payload.slice(0, sep)).trim();
          const value = String.fromCharCode(...payload.slice(sep + 1)).trim();
          // SET puts arrive as a bare DECIMAL option index; the device's
          // value shape is '<HEX index> <desc>' (renderScreen decodes the
          // first token with parseInt(_, 16) — review: a decimal echo
          // mis-selects options >= 10, exactly the long bank lists).
          const options = optionDescs(key);
          const desc = options?.[value];
          values.set(key, desc ? `${parseInt(value, 10).toString(16)} ${desc}` : value);
          deliverAscii(CMD.VALUE_DUMP, `${key} ${values.get(key)}`);
        }
      } else if (cmd === CMD.GET_SCREEN) {
        // The shipped capture always carries a frame; if a future dataset
        // omits it, the silent stall is bounded by the wave idle watchdog.
        if (demoData.screenFrame?.length) {
          setTimeout(() => {
            for (const cb of listeners) cb({ data: demoData.screenFrame });
          }, DEMO.REPLY_LATENCY_MS);
        }
      } else if (cmd === CMD.KEYPRESS) {
        log('Demo mode: keypress accepted (no device to press)', 'debug', 'general');
      }
    },
  };

  // index (decimal string) -> option desc for a SET key, from its line in
  // any captured dump. Lazy per-call; demo traffic is tiny.
  function optionDescs(key) {
    for (const ascii of Object.values(demoData.objectinfo)) {
      for (const line of ascii.split('\n').slice(1)) {
        if (!line.includes(key)) continue;
        const sub = parseSubObject(line.trim());
        if (sub.key === key && sub.type === 'SET' && sub.options?.length) {
          return Object.fromEntries(sub.options.map((o) => [o.index, o.desc]));
        }
      }
    }
    return null;
  }

  return { outAdapter, inAdapter, deviceId: demoData.deviceId };
}

// For main.js's demo entry logging.
export const DEMO_NODE_COUNT = Object.keys(demoData.objectinfo).length;
