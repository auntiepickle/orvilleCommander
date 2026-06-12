// preset-browser.js
// The preset browser (#153) + program preview (#135): a top-level modal over
// the faceplate (NOT inside the bezel like the sync dialog — it is a full
// interactive panel, not an LCD overlay) for browsing the synced library and
// auditioning programs before committing.
//
// Browse: a bank list on the left, that bank's programs on the right, plus a
// name search (the same searchLibrary corpus the conn-strip quick-search
// uses). Each program offers Preview / load-to-A / load-to-B.
//
// Preview (#135) is the subtle part. The Orville runs BOTH DSP engines at
// once, so there is no truly idle engine — auditioning a program necessarily
// OVERWRITES whatever preset sits in the engine we load it into. We make that
// safe with remember-and-restore: before previewing we capture the EXACT
// bank/program the target slot holds (indices, since names repeat across
// banks — getRememberedProgram), load the preview onto the NON-active engine
// (so the patch you are focused on keeps playing), and offer Keep (leave it)
// vs Cancel (reload the remembered program). Every preview load and every
// restore costs the device's ~2s DSP rebuild, so preview is an explicit
// action (never auto-fired on selection) and the controls lock while a load
// is in flight.
//
// All device I/O goes through library.js (loadProgramToDsp); this module only
// renders and sequences. The root refetch after a load is injected at setup
// (onLoadComplete) so the module never sends SysEx itself.

import { appState } from './state.js';
import { KEY_PREFIX } from './sysex-commands.js';
import {
  getLibrary,
  searchLibrary,
  canSearch,
  libraryProgramCount,
  loadProgramToDsp,
  getRememberedProgram,
  isFavoritesBank,
  refreshFavoritesBank,
} from './library.js';
import { log } from './logger.js';

let el = null; // the modal element (created lazily, reused)
let onLoadComplete = null; // injected root-refetch callback (no SysEx here)
let selectedBankIdx = null; // which bank's programs are shown (decimal string)
let searchQuery = '';

// Preview session state (#135). previewing/restore are load targets
// ({ bankIdx, programIdx, programName }); dspSlot is 'A'|'B'; loading locks
// the controls during the ~2s device rebuild.
let previewState = { dspSlot: null, previewing: null, restore: null, loading: false };

/** The DSP slot ('A'|'B') currently in focus, from the presetKey prefix. */
function activeSlot() {
  return appState.presetKey.startsWith(KEY_PREFIX.DSP_A) ? 'A' : 'B';
}

/** The non-active engine — where a preview auditions (#135). */
function previewSlot() {
  return activeSlot() === 'A' ? 'B' : 'A';
}

/**
 * Wires the injected post-load callback (the same root refetch the conn-strip
 * search uses) once at boot. Kept out of this module so it never sends SysEx.
 *
 * @param {{onLoadComplete: () => void}} cfg
 */
export function setupPresetBrowser(cfg) {
  onLoadComplete = cfg?.onLoadComplete || null;
}

function ensureEl() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'preset-browser';
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

/** Opens the browser (renders fresh from the current library). */
export function openPresetBrowser() {
  const node = ensureEl();
  node.hidden = false;
  renderBrowser();
}

/** Closes the browser. Leaves any preview in place (Keep is implicit). */
export function closePresetBrowser() {
  if (el) el.hidden = true;
}

/** Resets browser + preview state (disconnect / Sync — see main.js). */
export function resetPresetBrowser() {
  previewState = { dspSlot: null, previewing: null, restore: null, loading: false };
  selectedBankIdx = null;
  searchQuery = '';
  // Remove the panel entirely (not just hide): the next open rebuilds it fresh
  // from the re-read device, with no stale DOM or preview banner lingering.
  if (el) {
    el.remove();
    el = null;
  }
}

// --- rendering -----------------------------------------------------------

function makeButton(label, className, onClick, disabled) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  if (disabled) b.disabled = true;
  else b.addEventListener('click', onClick);
  return b;
}

// One program row: the name plus Preview / →A / →B. Names are device-supplied
// strings — textContent only, never innerHTML (matches the renderer/search
// caution). prefix shows the bank when listing search hits across banks.
function programRow(target, prefix) {
  const row = document.createElement('li');
  row.className = 'pb-prog';

  const name = document.createElement('span');
  name.className = 'pb-prog-name';
  if (prefix) {
    const p = document.createElement('span');
    p.className = 'pb-prog-bank';
    p.textContent = `${prefix} › `;
    name.append(p);
  }
  name.append(document.createTextNode(target.programName));
  row.append(name);

  const actions = document.createElement('span');
  actions.className = 'pb-prog-actions';
  const locked = previewState.loading;
  actions.append(
    makeButton('Preview', 'pb-btn pb-preview', () => previewProgram(target, previewSlot()), locked),
    makeButton('→A', 'pb-btn pb-load-a', () => loadToSlot(target, 'A'), locked),
    makeButton('→B', 'pb-btn pb-load-b', () => loadToSlot(target, 'B'), locked)
  );
  row.append(actions);
  return row;
}

function renderBanks(lib) {
  const list = document.createElement('ul');
  list.className = 'pb-banks';
  for (const bank of lib.banks) {
    const li = document.createElement('li');
    const live = isFavoritesBank(bank.idx);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'pb-bank' + (bank.idx === selectedBankIdx ? ' pb-bank-sel' : '') + (live ? ' pb-bank-live' : '');
    btn.textContent = bank.name;
    if (live) {
      // The Favorites bank is the device's live MRU — flag it and re-read it
      // on select so we never show a stale snapshot (#138/#135 follow-up).
      const tag = document.createElement('span');
      tag.className = 'pb-bank-livetag';
      tag.textContent = 'live';
      btn.append(tag);
    }
    btn.disabled = previewState.loading;
    btn.addEventListener('click', () => selectBank(bank.idx, live));
    li.append(btn);
    list.append(li);
  }
  return list;
}

// Selecting a bank just shows its programs — EXCEPT the live Favorites bank,
// which is re-fetched from the device first (its MRU list reorders on every
// load, so the static snapshot is stale). The fetch locks the controls.
function selectBank(bankIdx, live) {
  if (previewState.loading) return;
  selectedBankIdx = bankIdx;
  searchQuery = '';
  if (!live) {
    renderBrowser();
    return;
  }
  previewState.loading = true;
  renderBrowser();
  refreshFavoritesBank(() => {
    previewState.loading = false;
    onLoadComplete?.();
    renderBrowser();
  });
}

function renderPrograms(lib) {
  const list = document.createElement('ul');
  list.className = 'pb-programs';

  if (searchQuery.trim()) {
    // Search mode: flat hits across every bank (each row shows its bank).
    if (!canSearch()) {
      return emptyNote('Sync the library first to search.');
    }
    const hits = searchLibrary(searchQuery);
    if (!hits.length) return emptyNote('No matching presets.');
    for (const hit of hits) list.append(programRow(hit, hit.bankName));
    return list;
  }

  const bank = lib.banks.find((b) => b.idx === selectedBankIdx);
  if (!bank) return emptyNote('Select a bank to see its programs.');
  for (const program of bank.programs) {
    list.append(
      programRow({ bankIdx: bank.idx, programIdx: program.idx, programName: program.name }, '')
    );
  }
  return list;
}

function emptyNote(text) {
  const d = document.createElement('div');
  d.className = 'pb-empty';
  d.textContent = text;
  return d;
}

// The preview status bar: idle when nothing is auditioning, otherwise the
// previewing program + Keep / Cancel. Cancel restores the slot's remembered
// program; when there is no restore point we say so instead of offering it.
function renderBanner() {
  const bar = document.createElement('div');
  bar.className = 'pb-banner';
  const locked = previewState.loading;

  if (previewState.loading && !previewState.previewing) {
    bar.classList.add('pb-banner-busy');
    bar.textContent = 'loading…';
    return bar;
  }
  if (!previewState.previewing) {
    bar.classList.add('pb-banner-idle');
    bar.textContent = 'Preview auditions on the idle engine (DSP ' + previewSlot() + ').';
    return bar;
  }

  bar.classList.add('pb-banner-live');
  const msg = document.createElement('span');
  msg.className = 'pb-banner-msg';
  // Make the destructive reality legible: Keep leaves the preview in this
  // slot (replacing what was there); Cancel puts the original back.
  msg.append(
    document.createTextNode('Previewing '),
    bold(previewState.previewing.programName),
    document.createTextNode(` on DSP ${previewState.dspSlot} — Keep replaces DSP ${previewState.dspSlot}.`)
  );
  bar.append(msg);

  const actions = document.createElement('span');
  actions.className = 'pb-banner-actions';
  actions.append(makeButton('Keep', 'pb-btn pb-keep', keepPreview, locked));
  if (previewState.restore) {
    actions.append(makeButton('Cancel', 'pb-btn pb-cancel', cancelPreview, locked));
  } else {
    const note = document.createElement('span');
    note.className = 'pb-banner-note';
    note.textContent = `(no saved state for DSP ${previewState.dspSlot})`;
    actions.append(note);
  }
  bar.append(actions);
  return bar;
}

function bold(text) {
  const b = document.createElement('b');
  b.textContent = text;
  return b;
}

export function renderBrowser() {
  // No-op when closed: external callers (post-sync refresh) must not build the
  // panel until it is actually open. Internal callers open it first.
  if (!el || el.hidden) return;
  const node = el;
  node.innerHTML = '';
  const lib = getLibrary();

  const panel = document.createElement('div');
  panel.className = 'pb-panel';

  // Header: title, search, close.
  const head = document.createElement('header');
  head.className = 'pb-head';
  const title = document.createElement('span');
  title.className = 'pb-title';
  title.textContent = 'PRESET BROWSER';
  head.append(title);

  if (lib) {
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'pb-search';
    search.value = searchQuery;
    const enabled = canSearch();
    search.disabled = !enabled;
    search.placeholder = enabled
      ? `Search ${libraryProgramCount()} presets`
      : `Sync more to search (${libraryProgramCount()})`;
    search.addEventListener('input', () => {
      searchQuery = search.value;
      renderPanelBody(panel, lib);
    });
    head.append(search);
  }
  head.append(makeButton('✕', 'pb-close', closePresetBrowser, false));
  panel.append(head);

  renderPanelBody(panel, lib);
  node.append(panel);
}

// The body below the header — split out so a search keystroke can repaint the
// lists + banner without rebuilding (and re-focusing) the search input.
function renderPanelBody(panel, lib) {
  panel.querySelector('.pb-banner')?.remove();
  panel.querySelector('.pb-body')?.remove();

  if (!lib) {
    panel.append(
      bannerless('Library not synced. Use Sync Library to browse every bank and program here.')
    );
    return;
  }

  panel.append(renderBanner());

  const body = document.createElement('div');
  body.className = 'pb-body';
  // Default to the first STATIC bank so opening is instant — landing on the
  // live Favorites bank would force a device round-trip on every open.
  if (selectedBankIdx === null && lib.banks.length) {
    const firstStatic = lib.banks.find((b) => !isFavoritesBank(b.idx)) || lib.banks[0];
    selectedBankIdx = firstStatic.idx;
  }
  body.append(renderBanks(lib), renderPrograms(lib));
  panel.append(body);
}

function bannerless(text) {
  const d = document.createElement('div');
  d.className = 'pb-body pb-unsynced';
  d.append(emptyNote(text));
  return d;
}

// --- actions (device-touching, all via library.js) -----------------------

// Locks the controls, repaints (so buttons show disabled), runs the load,
// then unlocks + repaints on the device-confirmed callback.
function withLoadLock(run) {
  previewState.loading = true;
  renderBrowser();
  run(() => {
    previewState.loading = false;
    onLoadComplete?.();
    renderBrowser();
  });
}

function loadToSlot(target, slot) {
  if (previewState.loading) return;
  withLoadLock((done) => loadProgramToDsp(target, slot, done));
}

/**
 * Auditions a program on the idle engine (#135). Captures the slot's current
 * program as the restore point BEFORE loading (and not again while a preview
 * is already live on that slot, so the restore stays the pre-preview state).
 *
 * @param {{bankIdx: string, programIdx: string, programName: string}} target
 * @param {'A'|'B'} slot
 */
export function previewProgram(target, slot) {
  if (previewState.loading) return;
  const startingFresh = !previewState.previewing || previewState.dspSlot !== slot;
  const restore = startingFresh ? getRememberedProgram(slot) : previewState.restore;
  if (startingFresh && !restore) {
    log(`Preview: no saved program for DSP ${slot} — Cancel cannot restore`, 'general', 'general');
  }
  withLoadLock((done) =>
    loadProgramToDsp(target, slot, () => {
      previewState.dspSlot = slot;
      previewState.previewing = target;
      previewState.restore = restore;
      done();
    })
  );
}

/** Keeps the previewed program (no device I/O) and clears the banner. */
export function keepPreview() {
  if (previewState.loading) return;
  previewState = { dspSlot: null, previewing: null, restore: null, loading: false };
  renderBrowser();
}

/** Restores the slot's pre-preview program (#135). */
export function cancelPreview() {
  if (previewState.loading || !previewState.restore) return;
  const { restore, dspSlot } = previewState;
  withLoadLock((done) =>
    loadProgramToDsp(restore, dspSlot, () => {
      previewState = { dspSlot: null, previewing: null, restore: null, loading: false };
      done();
    })
  );
}
