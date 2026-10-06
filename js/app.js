/*
 * ReelScript — application controller (UI, storage, editor behaviour)
 */
(function () {
  'use strict';

  const SF = window.SF;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const STORE_KEY = 'reelscript.v1';
  const ELEMENT_LABELS = {
    scene_heading: 'Scene heading',
    action: 'Action',
    character: 'Character',
    parenthetical: 'Parenthetical',
    dialogue: 'Dialogue',
    lyrics: 'Lyrics',
    transition: 'Transition',
    centered: 'Centered',
    page_break: 'Page break',
    section: 'Section',
    synopsis: 'Synopsis',
    title_page: 'Title page',
    blank: 'Blank line',
  };
  const TAB_CYCLE = ['action', 'scene_heading', 'character', 'parenthetical', 'dialogue', 'transition'];
  const SHORTCUT_ELEMENTS = ['scene_heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'centered'];

  // ---------------------------------------------------------------------------
  // State & storage
  // ---------------------------------------------------------------------------
  const state = {
    scripts: [],
    currentId: null,
    prefs: { theme: null, smartEnter: true, zoom: 'fit', view: 'split', outlineOpen: false, outlineTab: 'scenes' },
  };
  let model = null;
  let lineTypes = [];
  let welcomeDismissed = false;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = () => Date.now();

  function newScript(name, content) {
    return { id: uid(), name: name || 'Untitled script', content: content || '', settings: { ...SF.LAYOUT_DEFAULTS }, createdAt: now(), updatedAt: now() };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.scripts)) state.scripts = data.scripts.filter((s) => s && typeof s.content === 'string');
        state.currentId = data.currentId || null;
        Object.assign(state.prefs, data.prefs || {});
      }
    } catch (e) {
      /* private mode / corrupted storage: start fresh */
    }
    state.scripts.forEach((s) => (s.settings = { ...SF.LAYOUT_DEFAULTS, ...(s.settings || {}) }));
    if (!state.scripts.length) state.scripts.push(newScript('The Last Chai (sample)', SF.SAMPLE));
    if (!state.scripts.some((s) => s.id === state.currentId)) state.currentId = state.scripts[0].id;
  }

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ scripts: state.scripts, currentId: state.currentId, prefs: state.prefs }));
      setSaveState('Saved');
      return true;
    } catch (e) {
      setSaveState('Not saved — browser storage is full or blocked. Export a copy!', true);
      return false;
    }
  }
  function schedulePersist() {
    setSaveState('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 500);
  }
  function setSaveState(text, error) {
    const el = $('#save-state');
    el.textContent = text;
    el.classList.toggle('error', !!error);
  }

  const current = () => state.scripts.find((s) => s.id === state.currentId);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const slug = (s) => (s || '').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'screenplay';

  function relTime(t) {
    const d = (now() - t) / 1000;
    if (d < 45) return 'just now';
    if (d < 3600) return `${Math.round(d / 60)}m ago`;
    if (d < 86400) return `${Math.round(d / 3600)}h ago`;
    if (d < 86400 * 7) return `${Math.round(d / 86400)}d ago`;
    return new Date(t).toLocaleDateString();
  }

  function download(filename, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  let toastTimer = null;
  function toast(message, action, ms) {
    const el = $('#toast');
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = message;
    el.appendChild(span);
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.addEventListener('click', () => {
        el.hidden = true;
        action.run();
      });
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), ms || (action ? 8000 : 3200));
  }

  function confirmDialog({ title, text, buttons }) {
    const dlg = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    const foot = $('#confirm-foot');
    foot.innerHTML = '';
    buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || 'btn-ghost');
      btn.value = b.value;
      btn.textContent = b.label;
      foot.appendChild(btn);
    });
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }));
  }

  // ---------------------------------------------------------------------------
  // Editor text operations (undo-friendly)
  // ---------------------------------------------------------------------------
  const ed = () => $('#editor');

  function replaceRange(start, end, text, caretStart, caretEnd) {
    const ta = ed();
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = text === '' ? document.execCommand('delete', false) : document.execCommand('insertText', false, text);
    } catch (e) {
      ok = false;
    }
    if (!ok || ta.selectionStart !== start + text.length || ta.value.slice(start, start + text.length) !== text) {
      ta.setRangeText(text, start, end, 'end');
      onInput();
    }
    if (caretStart != null) ta.setSelectionRange(caretStart, caretEnd == null ? caretStart : caretEnd);
  }

  function replaceAll(text) {
    replaceRange(0, ed().value.length, text, 0);
    ed().scrollTop = 0;
  }

  function lineBounds(value, pos) {
    const start = value.lastIndexOf('\n', pos - 1) + 1;
    let end = value.indexOf('\n', pos);
    if (end === -1) end = value.length;
    return { start, end };
  }

  const lineIndexAt = (value, pos) => {
    let n = 0;
    for (let k = value.indexOf('\n'); k !== -1 && k < pos; k = value.indexOf('\n', k + 1)) n++;
    return n;
  };

  function posOfLine(value, line) {
    let pos = 0;
    for (let k = 0; k < line; k++) {
      const nx = value.indexOf('\n', pos);
      if (nx === -1) return value.length;
      pos = nx + 1;
    }
    return pos;
  }

  function stripMarkers(line) {
    let t = line.trim();
    t = t.replace(/^[!@.~]/, '').replace(/^>\s*/, '').replace(/\s*<$/, '').replace(/\s*\^$/, '');
    return t.trim();
  }

  function setElement(type) {
    const ta = ed();
    const v = ta.value;
    let { start, end } = lineBounds(v, ta.selectionStart);
    const line = v.slice(start, end);
    let core = stripMarkers(line);
    const prevBlank = start === 0 || v.slice(lineBounds(v, start - 1).start, start - 1).trim() === '';
    const hasNext = end < v.length;
    const nextBlank = !hasNext || v.slice(end + 1, lineBounds(v, end + 1).end).trim() === '';

    let text = core;
    let blankBefore = false;
    let blankAfter = false;
    let joinPrev = false;
    let caretOffset = null;

    switch (type) {
      case 'scene_heading': {
        text = core.toUpperCase();
        if (!SF.isSceneHeading(text)) text = 'INT. ' + text;
        blankBefore = blankAfter = true;
        break;
      }
      case 'action':
        text = core.replace(/^\((.*)\)$/, '$1');
        if (SF.isAllCaps(text) || SF.isSceneHeading(text)) text = '!' + text;
        blankBefore = true;
        break;
      case 'character':
        text = core.replace(/^\((.*)\)$/, '$1').toUpperCase();
        blankBefore = true;
        break;
      case 'parenthetical': {
        const inner = core.replace(/^\(/, '').replace(/\)$/, '');
        text = `(${inner})`;
        joinPrev = true;
        caretOffset = text.length - 1;
        break;
      }
      case 'dialogue':
        text = core.replace(/^\((.*)\)$/, '$1');
        joinPrev = true;
        break;
      case 'transition':
        text = (core || 'CUT TO:').toUpperCase();
        if (!SF.isTransition(text)) text = '> ' + text;
        blankBefore = blankAfter = true;
        break;
      case 'centered':
        text = `> ${core} <`;
        caretOffset = 2 + core.length;
        blankBefore = true;
        break;
      case 'page_break':
        insertBlock('===');
        return;
      default:
        return;
    }

    let prefix = '';
    let suffix = '';
    if (blankBefore && start > 0 && !prevBlank) prefix = '\n';
    if (joinPrev && start > 1 && prevBlank && v[start - 1] === '\n') {
      // remove the blank line separating this line from the cue above
      const pb = lineBounds(v, start - 1);
      if (pb.start > 0) start = pb.start;
    }
    if (blankAfter && hasNext && !nextBlank) suffix = '\n';
    const insert = prefix + text + suffix;
    const caret = start + prefix.length + (caretOffset == null ? text.length : caretOffset);
    replaceRange(start, end, insert, caret);
    afterCaretMove();
  }

  function insertBlock(text) {
    const ta = ed();
    const v = ta.value;
    const { end } = lineBounds(v, ta.selectionStart);
    const insert = (end > 0 ? '\n\n' : '') + text + '\n\n';
    replaceRange(end, end, insert, end + insert.length);
  }

  function wrapSelection(marker) {
    const ta = ed();
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const sel = v.slice(s, e);
    if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= marker.length * 2) {
      const inner = sel.slice(marker.length, sel.length - marker.length);
      replaceRange(s, e, inner, s, s + inner.length);
    } else {
      replaceRange(s, e, marker + sel + marker, s + marker.length, s + marker.length + sel.length);
    }
  }

  function currentType() {
    const ta = ed();
    const v = ta.value;
    const idx = lineIndexAt(v, ta.selectionStart);
    const { start, end } = lineBounds(v, ta.selectionStart);
    if (v.slice(start, end).trim() === '') return 'blank';
    return lineTypes[idx] || 'action';
  }

  // ---------------------------------------------------------------------------
  // Rendering: pages
  // ---------------------------------------------------------------------------
  function runHTML(r) {
    const cls = [r.b && 'b', r.i && 'it', r.u && 'u'].filter(Boolean).join(' ');
    return cls ? `<span class="${cls}">${esc(r.text)}</span>` : esc(r.text);
  }

  function pageHTML(page, wm) {
    let html = '';
    if (page.isTitle) html += '<span class="page-tag">Title page</span>';
    page.items.forEach((it) => {
      const src = it.src != null ? ` data-src="${it.src}"` : '';
      html += `<div class="ln"${src} style="top:${it.y.toFixed(4)}in">`;
      it.segs.forEach((s) => {
        html += `<span class="sg" style="left:${s.x.toFixed(3)}in">${s.runs.map(runHTML).join('')}</span>`;
      });
      html += '</div>';
    });
    if (wm) html += `<div class="wm"><span>${esc(wm)}</span></div>`;
    return html;
  }

  function renderPages() {
    const container = $('#pages');
    const list = model.titlePage ? [model.titlePage, ...model.pages] : model.pages;
    const wm = (model.options.watermark || '').trim();
    while (container.children.length > list.length) container.lastElementChild.remove();
    list.forEach((p, idx) => {
      let el = container.children[idx];
      if (!el) {
        el = document.createElement('div');
        el.className = 'page';
        container.appendChild(el);
      }
      el.style.width = model.size.w + 'in';
      el.style.height = model.size.h + 'in';
      const html = pageHTML(p, wm);
      if (el._html !== html) {
        el.innerHTML = html;
        el._html = html;
      }
    });
    lineEls = null;
    applyZoom();
    $('#print-page-size').textContent = `@page { size: ${model.size.w}in ${model.size.h}in; margin: 0; }`;
  }

  function fitZoom() {
    const sc = $('#preview-scroll');
    const avail = sc.clientWidth - 48;
    if (!model || avail <= 0) return 1;
    return Math.max(0.3, Math.min(1, avail / (model.size.w * 96)));
  }

  function applyZoom() {
    const z = state.prefs.zoom === 'fit' ? fitZoom() : state.prefs.zoom;
    $('#pages').style.zoom = z;
    $('#zoom-label').textContent = state.prefs.zoom === 'fit' ? 'Fit' : Math.round(z * 100) + '%';
  }

  function stepZoom(dir) {
    const cur = state.prefs.zoom === 'fit' ? fitZoom() : state.prefs.zoom;
    const steps = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
    let next = dir > 0 ? steps.find((s) => s > cur + 0.01) : [...steps].reverse().find((s) => s < cur - 0.01);
    if (next == null) next = dir > 0 ? steps[steps.length - 1] : steps[0];
    state.prefs.zoom = next;
    applyZoom();
    persist();
  }

  // ---------------------------------------------------------------------------
  // Rendering: status, outline, sidebar
  // ---------------------------------------------------------------------------
  function renderStats() {
    const st = model.stats;
    $('#st-pages').textContent = `${st.pages} page${st.pages === 1 ? '' : 's'}`;
    $('#st-scenes').textContent = `${st.scenes.length} scene${st.scenes.length === 1 ? '' : 's'}`;
    $('#st-runtime').textContent = `~${st.runtimeMinutes} min`;
    $('#pv-info').textContent = `${st.pages} page${st.pages === 1 ? '' : 's'} · ${model.size.label}${model.titlePage ? ' · title page' : ''}`;
  }

  function renderOutline() {
    if (!state.prefs.outlineOpen) return;
    const body = $('#outline-body');
    const st = model.stats;
    const tab = state.prefs.outlineTab;
    $$('.outline-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.otab === tab));
    if (tab === 'scenes') {
      body.innerHTML = st.scenes.length
        ? st.scenes
            .map((s, k) => `<button class="ol-item" data-line="${s.line}"><span class="ol-num">${esc(s.number || String(k + 1))}</span><span class="ol-text">${esc(s.text)}</span><span class="ol-page">p${s.page}</span></button>`)
            .join('')
        : '<p class="ol-empty">No scenes yet. Start a line with INT. or EXT.</p>';
    } else if (tab === 'characters') {
      const max = st.characters.length ? st.characters[0].count : 1;
      body.innerHTML = st.characters.length
        ? st.characters
            .map((c) => `<div class="ol-item" style="display:block"><div style="display:flex;justify-content:space-between"><span class="ol-text">${esc(c.name)}</span><span class="ol-page">${c.count} speech${c.count === 1 ? '' : 'es'}</span></div><div class="ol-bar"><span style="width:${(c.count / max) * 100}%"></span></div></div>`)
            .join('')
        : '<p class="ol-empty">No speaking characters yet.</p>';
    } else {
      body.innerHTML = `<div class="stat-grid">
        <div class="stat"><b>${st.pages}</b><span>Pages</span></div>
        <div class="stat"><b>~${st.runtimeMinutes}m</b><span>Screen time</span></div>
        <div class="stat"><b>${st.scenes.length}</b><span>Scenes</span></div>
        <div class="stat"><b>${st.characters.length}</b><span>Speaking roles</span></div>
        <div class="stat"><b>${st.words.toLocaleString()}</b><span>Words</span></div>
        <div class="stat"><b>${esc(model.size.label)}</b><span>Paper</span></div>
      </div>`;
    }
  }

  function renderList() {
    const q = $('#script-search').value.trim().toLowerCase();
    const list = $('#script-list');
    const items = state.scripts
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.content.toLowerCase().includes(q));
    if (!items.length) {
      list.innerHTML = '<li class="empty-list">No scripts match.</li>';
      return;
    }
    list.innerHTML = items
      .map(
        (s) => `<li class="script-item${s.id === state.currentId ? ' active' : ''}" data-id="${s.id}" tabindex="0">
          <span class="meta"><span class="name">${esc(s.name || 'Untitled script')}</span><span class="time">${relTime(s.updatedAt)}</span></span>
          <span class="actions">
            <button class="icon-btn" data-act="dup" title="Duplicate" aria-label="Duplicate"><svg class="i"><use href="#i-copy"/></svg></button>
            <button class="icon-btn" data-act="del" title="Delete" aria-label="Delete"><svg class="i"><use href="#i-trash"/></svg></button>
          </span>
        </li>`
      )
      .join('');
  }

  function updateWelcome() {
    const empty = ed().value.trim() === '';
    $('#welcome').hidden = !(empty && !welcomeDismissed);
  }

  // ---------------------------------------------------------------------------
  // Render pipeline
  // ---------------------------------------------------------------------------
  let renderTimer = null;
  function render() {
    const s = current();
    model = SF.layout(s.content, s.settings);
    lineTypes = SF.lineTypes(s.content);
    renderPages();
    renderStats();
    renderOutline();
    updateStatus();
  }
  function scheduleRender() {
    clearTimeout(renderTimer);
    const len = ed().value.length;
    renderTimer = setTimeout(render, len > 150000 ? 600 : len > 40000 ? 300 : 120);
  }

  function onInput() {
    const s = current();
    s.content = ed().value;
    s.updatedAt = now();
    updateWelcome();
    scheduleRender();
    schedulePersist();
  }

  // ---------------------------------------------------------------------------
  // Caret ↔ preview sync
  // ---------------------------------------------------------------------------
  let lineEls = null;
  let lastHl = null;
  function updateStatus() {
    const ta = ed();
    const v = ta.value;
    const pos = ta.selectionStart;
    const idx = lineIndexAt(v, pos);
    const col = pos - lineBounds(v, pos).start + 1;
    $('#st-pos').textContent = `Ln ${idx + 1}, Col ${col}`;
    const type = currentType();
    $('#st-element').textContent = ELEMENT_LABELS[type] || type;
    $$('.tool[data-el]').forEach((b) => b.classList.toggle('current', b.dataset.el === type));
    return idx;
  }

  function highlightPreview(lineIdx, scroll) {
    if (!lineEls) lineEls = $$('#pages .ln[data-src]');
    let best = null;
    let bestSrc = -1;
    for (const el of lineEls) {
      const src = +el.dataset.src;
      if (src <= lineIdx && src >= bestSrc) {
        if (src > bestSrc) best = [];
        bestSrc = src;
        best.push(el);
      }
    }
    if (lastHl) lastHl.forEach((el) => el.classList.remove('hl'));
    lastHl = best;
    if (!best || !best.length) return;
    best.forEach((el) => el.classList.add('hl'));
    if (scroll && $('#app').dataset.view === 'split' && window.innerWidth > 900) {
      const sc = $('#preview-scroll');
      const r = best[0].getBoundingClientRect();
      const sr = sc.getBoundingClientRect();
      if (r.top < sr.top + sr.height * 0.15 || r.bottom > sr.bottom - sr.height * 0.15) {
        sc.scrollBy({ top: r.top - sr.top - sr.height / 2, behavior: 'smooth' });
      }
    }
  }

  let caretTimer = null;
  function afterCaretMove() {
    clearTimeout(caretTimer);
    caretTimer = setTimeout(() => {
      const idx = updateStatus();
      highlightPreview(idx, true);
    }, 60);
  }

  /** Pixel offset of a character position inside the textarea (mirror-div technique). */
  function caretTop(pos) {
    const ta = ed();
    const cs = getComputedStyle(ta);
    const m = document.createElement('div');
    ['fontFamily', 'fontSize', 'lineHeight', 'paddingTop', 'paddingLeft', 'paddingRight', 'letterSpacing', 'tabSize', 'wordSpacing'].forEach((p) => (m.style[p] = cs[p]));
    Object.assign(m.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: ta.clientWidth + 'px', boxSizing: 'border-box', top: '0', left: '-9999px' });
    m.textContent = ta.value.slice(0, pos);
    const mark = document.createElement('span');
    mark.textContent = '​';
    m.appendChild(mark);
    document.body.appendChild(m);
    const top = mark.offsetTop;
    m.remove();
    return top;
  }

  function gotoLine(line, focusEditor) {
    const ta = ed();
    const pos = posOfLine(ta.value, line);
    if ($('#app').dataset.view === 'preview' || (window.innerWidth <= 900 && $('#app').dataset.view !== 'write')) setView('write');
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(pos, lineBounds(ta.value, pos).end);
    ta.scrollTop = Math.max(0, caretTop(pos) - ta.clientHeight / 3);
    if (!focusEditor) ta.setSelectionRange(pos, pos);
    afterCaretMove();
  }

  // ---------------------------------------------------------------------------
  // Script management
  // ---------------------------------------------------------------------------
  function openScript(id) {
    if (!state.scripts.some((s) => s.id === id)) return;
    state.currentId = id;
    welcomeDismissed = false;
    const s = current();
    ed().value = s.content;
    ed().setSelectionRange(0, 0);
    ed().scrollTop = 0;
    $('#doc-title').value = s.name;
    document.title = `${s.name || 'Untitled script'} — ReelScript`;
    $('#preview-scroll').scrollTop = 0;
    updateWelcome();
    renderList();
    render();
    persist();
    closeSidebar();
  }

  function createScript(name, content) {
    const s = newScript(name, content);
    state.scripts.push(s);
    openScript(s.id);
    return s;
  }

  async function deleteScript(id) {
    const s = state.scripts.find((x) => x.id === id);
    if (!s) return;
    const v = await confirmDialog({
      title: 'Delete script?',
      text: `“${s.name || 'Untitled script'}” will be permanently removed from this browser. Export a copy first if you might need it.`,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete', value: 'delete', cls: 'btn-danger' },
      ],
    });
    if (v !== 'delete') return;
    state.scripts = state.scripts.filter((x) => x.id !== id);
    if (!state.scripts.length) state.scripts.push(newScript());
    if (state.currentId === id) openScript(state.scripts.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
    else {
      renderList();
      persist();
    }
    toast('Script deleted');
  }

  function duplicateScript(id) {
    const s = state.scripts.find((x) => x.id === id);
    if (!s) return;
    const copy = newScript(`${s.name} (copy)`, s.content);
    copy.settings = { ...s.settings };
    state.scripts.push(copy);
    openScript(copy.id);
    toast('Duplicated');
  }

  // ---------------------------------------------------------------------------
  // Import / export
  // ---------------------------------------------------------------------------
  function looksMessy(text) {
    const lines = text.split(/\r?\n/);
    const indented = lines.filter((l) => /^ {8,}\S/.test(l)).length;
    const chat = lines.filter((l) => /^[A-Z][A-Z .'-]{1,24}:\s+\S/.test(l)).length;
    const artefacts = /\(MORE\)|CONTINUED:|\(CONT['’]D\)/.test(text);
    const tight = /\S\n(INT|EXT)[. ]/.test(text);
    return indented >= 3 || chat >= 2 || artefacts || tight;
  }

  function importFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('That file is larger than 5 MB — is it really a script?');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast('Could not read that file.');
    reader.onload = () => {
      let text = String(reader.result || '');
      const name = file.name.replace(/\.[^.]+$/, '') || 'Imported script';
      try {
        if (/\.fdx$/i.test(file.name) || /<FinalDraft[\s>]/.test(text.slice(0, 2000))) text = SF.fromFDX(text);
      } catch (e) {
        toast(e.message || 'Could not read that Final Draft file.');
        return;
      }
      createScript(name, SF.normalize(text));
      if (looksMessy(text)) toast('This looks like pasted or exported text.', { label: 'Smart clean-up', run: runCleanup });
      else toast(`Imported “${name}”`);
    };
    reader.readAsText(file);
  }

  async function exportAs(kind) {
    closeExportMenu();
    const s = current();
    if (!model) render();
    const base = slug(s.name);
    if (kind === 'fountain') {
      download(`${base}.fountain`, s.content, 'text/plain;charset=utf-8');
      toast('Fountain file downloaded');
    } else if (kind === 'fdx') {
      download(`${base}.fdx`, SF.toFDX(s.content), 'application/xml;charset=utf-8');
      toast('Final Draft file downloaded');
    } else if (kind === 'print') {
      clearTimeout(renderTimer);
      render();
      setTimeout(() => window.print(), 50);
    } else if (kind === 'pdf') {
      clearTimeout(renderTimer);
      render();
      if (!s.content.trim()) {
        toast('Nothing to export yet — write something first.');
        return;
      }
      const bad = SF.unsupportedChars(model);
      if (bad.length) {
        const v = await confirmDialog({
          title: 'Some characters need the print route',
          text: `The built-in PDF font can't draw ${bad.slice(0, 8).join(' ')}${bad.length > 8 ? ' …' : ''}. Use “Print / Save as PDF” to keep every character exactly as written (choose “Save as PDF” as the printer).`,
          buttons: [
            { label: 'Cancel', value: 'cancel' },
            { label: 'Download anyway', value: 'anyway' },
            { label: 'Print / Save as PDF', value: 'print', cls: 'btn-primary' },
          ],
        });
        if (v === 'print') return exportAs('print');
        if (v !== 'anyway') return;
      }
      try {
        const tf = SF.getTitleFields(s.content);
        const doc = SF.buildPDF(model, { title: SF.plainText(tf.title || s.name), author: tf.authors.replace(/\n/g, ', ') });
        doc.save(`${base}.pdf`);
        toast(`PDF downloaded · ${model.pages.length} page${model.pages.length === 1 ? '' : 's'}`);
      } catch (e) {
        console.error(e);
        toast('PDF export failed — try Print / Save as PDF instead.', { label: 'Print', run: () => exportAs('print') });
      }
    }
  }

  function runCleanup() {
    const before = ed().value;
    const after = SF.cleanup(before);
    if (after.trim() === before.trim()) {
      toast('Already looks clean ✨');
      return;
    }
    replaceAll(after);
    toast('Formatting cleaned up', { label: 'Undo', run: () => { ed().focus(); document.execCommand('undo'); } });
  }

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------
  function openSettings() {
    const s = current();
    const f = $('#settings-form');
    Object.entries(s.settings).forEach(([k, v]) => {
      const el = f.elements[k];
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    f.elements.smartEnter.checked = !!state.prefs.smartEnter;
    $('#settings-dialog').showModal();
  }

  function saveSettings() {
    const s = current();
    const f = $('#settings-form');
    Object.keys(SF.LAYOUT_DEFAULTS).forEach((k) => {
      const el = f.elements[k];
      if (!el) return;
      s.settings[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
    state.prefs.smartEnter = f.elements.smartEnter.checked;
    s.updatedAt = now();
    render();
    persist();
    toast('Page settings saved');
  }

  function openTitle() {
    const vals = SF.getTitleFields(ed().value);
    const f = $('#title-form');
    Object.entries(vals).forEach(([k, v]) => {
      if (f.elements[k]) f.elements[k].value = v;
    });
    if (!vals.title && current().name && !/^untitled/i.test(current().name)) f.elements.title.value = current().name;
    $('#title-dialog').showModal();
  }

  function saveTitle() {
    const f = $('#title-form');
    const vals = {};
    ['title', 'credit', 'authors', 'source', 'draft date', 'contact', 'copyright'].forEach((k) => (vals[k] = f.elements[k].value));
    welcomeDismissed = true;
    replaceAll(SF.setTitleFields(ed().value, vals));
    const s = current();
    if (vals.title.trim() && /^untitled/i.test(s.name)) {
      s.name = SF.plainText(vals.title.trim()).replace(/\s+/g, ' ');
      $('#doc-title').value = s.name;
      renderList();
    }
    if (!s.settings.titlePage) {
      s.settings.titlePage = true;
      render();
    }
    toast('Title page updated');
  }

  // ---------------------------------------------------------------------------
  // View, theme, sidebar, menus
  // ---------------------------------------------------------------------------
  function setView(v) {
    state.prefs.view = v;
    $('#app').dataset.view = v;
    const mobile = window.innerWidth <= 900;
    $$('.segmented button').forEach((b) => b.classList.toggle('active', b.dataset.view === v || (mobile && v === 'split' && b.dataset.view === 'write')));
    requestAnimationFrame(applyZoom);
    persist();
  }

  function applyTheme() {
    const t = state.prefs.theme || (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = t;
    $('#theme-toggle span').textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
    document.querySelector('meta[name="theme-color"]').content = t === 'dark' ? '#0d0d12' : '#f7f7fa';
  }

  function toggleOutline(force) {
    state.prefs.outlineOpen = force != null ? force : !state.prefs.outlineOpen;
    $('#outline').hidden = !state.prefs.outlineOpen;
    $('#outline-toggle').classList.toggle('active', state.prefs.outlineOpen);
    renderOutline();
    requestAnimationFrame(applyZoom);
    persist();
  }

  const openSidebar = () => $('#app').classList.add('sidebar-open');
  const closeSidebar = () => $('#app').classList.remove('sidebar-open');

  function closeExportMenu() {
    $('#export-menu').hidden = true;
    $('#export-btn').setAttribute('aria-expanded', 'false');
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------
  function onEditorKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'i' || k === 'u') {
        e.preventDefault();
        wrapSelection(k === 'b' ? '**' : k === 'i' ? '*' : '_');
        return;
      }
      if (/^[1-7]$/.test(e.key)) {
        e.preventDefault();
        setElement(SHORTCUT_ELEMENTS[+e.key - 1]);
        return;
      }
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      const ta = ed();
      if (ta.selectionStart !== ta.selectionEnd && ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) return;
      e.preventDefault();
      const cur = currentType();
      let i = TAB_CYCLE.indexOf(cur);
      if (cur === 'blank') {
        // Empty line: directly under a cue or speech → parenthetical, otherwise a new scene heading
        const v = ta.value;
        const { start } = lineBounds(v, ta.selectionStart);
        const prev = start > 0 ? v.slice(lineBounds(v, start - 1).start, start - 1).trim() : '';
        const prevType = start > 0 ? lineTypes[lineIndexAt(v, start - 1)] : null;
        const inSpeech = prev && (SF.isCharacterCue(prev) || ['character', 'dialogue', 'parenthetical'].includes(prevType));
        setElement(inSpeech ? 'parenthetical' : 'scene_heading');
        return;
      }
      if (i === -1) i = 0;
      const next = TAB_CYCLE[(i + (e.shiftKey ? TAB_CYCLE.length - 1 : 1)) % TAB_CYCLE.length];
      setElement(next);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey && state.prefs.smartEnter && !e.isComposing) {
      const ta = ed();
      const v = ta.value;
      if (ta.selectionStart !== ta.selectionEnd) return;
      const { start, end } = lineBounds(v, ta.selectionStart);
      if (v.slice(ta.selectionStart, end).trim() !== '') return;
      const line = v.slice(start, end).trim();
      if (!line) return;
      const types = SF.lineTypes(v);
      const idx = lineIndexAt(v, start);
      let type = types[idx];
      const prevBlank = start === 0 || v.slice(lineBounds(v, start - 1).start, start - 1).trim() === '';
      const nextLine = end < v.length ? v.slice(end + 1, lineBounds(v, end + 1).end).trim() : '';
      if (type === 'action' && prevBlank && SF.isCharacterCue(line) && !SF.isTransition(line)) type = 'character';
      if (type === 'title_page') return;
      if (nextLine !== '') return; // editing in the middle of a block: plain newline
      if (['scene_heading', 'action', 'dialogue', 'lyrics', 'transition', 'centered'].includes(type)) {
        e.preventDefault();
        const s = ta.selectionStart;
        replaceRange(s, s, '\n\n', s + 2);
        afterCaretMove();
      }
    }
  }

  function onGlobalKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (persist()) toast('Saved');
    } else if (mod && e.key.toLowerCase() === 'p' && !e.shiftKey) {
      e.preventDefault();
      exportAs('pdf');
    } else if (e.key === 'Escape') {
      closeExportMenu();
      closeSidebar();
    }
  }

  // ---------------------------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------------------------
  function bind() {
    const ta = ed();
    ta.addEventListener('input', () => {
      onInput();
      afterCaretMove();
    });
    ta.addEventListener('keydown', onEditorKey);
    ['keyup', 'click', 'focus'].forEach((ev) => ta.addEventListener(ev, afterCaretMove));
    ta.addEventListener('paste', (e) => {
      const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
      if (text.length > 200 && looksMessy(text)) {
        setTimeout(() => toast('Pasted text looks like it needs tidying.', { label: 'Smart clean-up', run: runCleanup }), 50);
      }
    });

    document.addEventListener('keydown', onGlobalKey);

    $('#doc-title').addEventListener('input', (e) => {
      const s = current();
      s.name = e.target.value;
      s.updatedAt = now();
      document.title = `${s.name || 'Untitled script'} — ReelScript`;
      renderList();
      schedulePersist();
    });
    $('#doc-title').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ed().focus();
      }
    });

    $('#new-script').addEventListener('click', () => {
      createScript();
      ed().focus();
    });
    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', (e) => {
      importFile(e.target.files[0]);
      e.target.value = '';
    });
    $('#script-search').addEventListener('input', renderList);
    $('#script-list').addEventListener('click', (e) => {
      const item = e.target.closest('.script-item');
      if (!item) return;
      const act = e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === 'del') deleteScript(item.dataset.id);
        else duplicateScript(item.dataset.id);
        return;
      }
      openScript(item.dataset.id);
    });
    $('#script-list').addEventListener('keydown', (e) => {
      const item = e.target.closest('.script-item');
      if (item && e.target === item && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openScript(item.dataset.id);
      }
    });

    // Drag & drop import
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) {
        e.preventDefault();
        importFile(f);
      }
    });

    $('#menu-btn').addEventListener('click', openSidebar);
    $('#sidebar-close').addEventListener('click', closeSidebar);
    $('#scrim').addEventListener('click', closeSidebar);

    $$('.segmented button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $('#outline-toggle').addEventListener('click', () => toggleOutline());
    $$('.outline-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        state.prefs.outlineTab = b.dataset.otab;
        renderOutline();
        persist();
      })
    );
    $('#outline-body').addEventListener('click', (e) => {
      const it = e.target.closest('[data-line]');
      if (it) gotoLine(+it.dataset.line, true);
    });

    $('#settings-btn').addEventListener('click', openSettings);
    $('#settings-dialog').addEventListener('close', () => {
      if ($('#settings-dialog').returnValue === 'save') saveSettings();
    });
    $('#titlepage-btn').addEventListener('click', openTitle);
    $('#title-dialog').addEventListener('close', () => {
      if ($('#title-dialog').returnValue === 'save') saveTitle();
    });
    $('#open-guide').addEventListener('click', () => {
      closeSidebar();
      $('#guide-dialog').showModal();
    });
    $('#paste-dialog').addEventListener('close', () => {
      if ($('#paste-dialog').returnValue !== 'ok') return;
      const text = $('#paste-input').value;
      $('#paste-input').value = '';
      if (!text.trim()) return;
      welcomeDismissed = true;
      replaceAll(SF.cleanup(text));
      toast('Cleaned up — check the preview →');
    });

    $('#theme-toggle').addEventListener('click', () => {
      state.prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      persist();
    });

    $('#export-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const m = $('#export-menu');
      m.hidden = !m.hidden;
      $('#export-btn').setAttribute('aria-expanded', String(!m.hidden));
      if (!m.hidden) m.querySelector('button').focus();
    });
    $$('#export-menu [data-export]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.export)));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu-wrap')) closeExportMenu();
    });

    $$('.tool[data-el]').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor caret
      b.addEventListener('click', () => {
        welcomeDismissed = true;
        updateWelcome();
        setElement(b.dataset.el);
      });
    });
    $$('.tool[data-wrap]').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => wrapSelection(b.dataset.wrap));
    });
    $('#cleanup-btn').addEventListener('click', runCleanup);

    $('#welcome').addEventListener('click', (e) => {
      const c = e.target.closest('[data-welcome]');
      if (!c) return;
      const act = c.dataset.welcome;
      if (act === 'write') {
        welcomeDismissed = true;
        updateWelcome();
        ed().focus();
      } else if (act === 'sample') {
        welcomeDismissed = true;
        replaceAll(SF.SAMPLE);
        if (/^untitled/i.test(current().name)) {
          current().name = 'The Last Chai (sample)';
          $('#doc-title').value = current().name;
          renderList();
        }
      } else if (act === 'paste') $('#paste-dialog').showModal();
      else if (act === 'import') $('#import-file').click();
    });

    $('#zoom-in').addEventListener('click', () => stepZoom(1));
    $('#zoom-out').addEventListener('click', () => stepZoom(-1));
    $('#zoom-label').addEventListener('click', () => {
      state.prefs.zoom = 'fit';
      applyZoom();
      persist();
    });

    $('#pages').addEventListener('click', (e) => {
      const ln = e.target.closest('.ln[data-src]');
      if (ln) gotoLine(+ln.dataset.src, false);
    });

    let resizeRaf = null;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        applyZoom();
        setView(state.prefs.view);
      });
    });

    window.addEventListener('storage', (e) => {
      if (e.key !== STORE_KEY || !e.newValue) return;
      try {
        const data = JSON.parse(e.newValue);
        // Pick up scripts created in other tabs without clobbering the one being edited here
        const mine = current();
        state.scripts = data.scripts.map((s) => (s.id === mine.id ? mine : s));
        if (!state.scripts.some((s) => s.id === mine.id)) state.scripts.push(mine);
        renderList();
      } catch (err) {
        /* ignore */
      }
    });

    window.addEventListener('beforeunload', () => {
      if (saveTimer) persist();
    });
    if (window.matchMedia) matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
    setInterval(renderList, 60000);
  }

  function init() {
    if (!SF || !SF.layout) {
      document.body.innerHTML = '<p style="padding:24px">ReelScript failed to load. Please refresh the page.</p>';
      return;
    }
    load();
    applyTheme();
    bind();
    $('#app').dataset.view = state.prefs.view;
    setView(state.prefs.view);
    toggleOutline(state.prefs.outlineOpen);
    openScript(state.currentId);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
