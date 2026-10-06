/*
 * ReelScript — Final Draft–style script editor
 * A paragraph-per-element WYSIWYG editor. Each paragraph is a screenplay
 * element (Scene Heading, Action, Character…) formatted in place on a page.
 * Storage stays Fountain: toFountain()/load() convert both ways, so the
 * layout engine, PDF, DOCX and FDX exporters work unchanged.
 */
(function (root) {
  'use strict';

  const SF = (root.SF = root.SF || {});

  const TYPES = ['episode', 'scene_heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'centered', 'note', 'page_break'];
  const LABELS = {
    episode: 'Episode / New Act',
    scene_heading: 'Scene Heading',
    action: 'Action',
    character: 'Character',
    parenthetical: 'Parenthetical',
    dialogue: 'Dialogue',
    transition: 'Transition',
    centered: 'Centered',
    note: 'Note (not printed)',
    page_break: 'Page Break',
  };
  // Final Draft element flow
  const ENTER_NEXT = {
    episode: 'scene_heading',
    scene_heading: 'action',
    action: 'action',
    character: 'dialogue',
    parenthetical: 'dialogue',
    dialogue: 'action',
    transition: 'scene_heading',
    centered: 'action',
    note: 'action',
    page_break: 'action',
  };
  const TAB_NEXT = {
    episode: 'scene_heading',
    scene_heading: 'action',
    action: 'character',
    character: 'transition',
    parenthetical: 'dialogue',
    dialogue: 'parenthetical',
    transition: 'scene_heading',
    centered: 'action',
  };
  const SHIFT_TAB_NEXT = {
    action: 'scene_heading',
    character: 'action',
    dialogue: 'character',
    parenthetical: 'dialogue',
    transition: 'character',
    scene_heading: 'transition',
    episode: 'action',
    centered: 'action',
    note: 'action',
  };
  const CAPS = new Set(['episode', 'scene_heading', 'character', 'transition']);

  const SCENE_INTROS = ['INT. ', 'EXT. ', 'INT./EXT. ', 'EXT./INT. ', 'I/E. '];
  const SCENE_TIMES = ['DAY', 'NIGHT', 'MORNING', 'AFTERNOON', 'EVENING', 'DAWN', 'DUSK', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'SAME'];
  const TRANSITIONS = ['CUT TO:', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'JUMP CUT TO:', 'FADE TO:', 'FADE OUT.', 'FADE TO BLACK.', 'CUT TO BLACK.', 'INTERCUT WITH:'];
  const EXTENSIONS = ['(V.O.)', '(O.S.)', '(O.C.)', "(CONT'D)", '(PRE-LAP)', '(ON PHONE)'];

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---------------------------------------------------------------------------
  // Fountain → element list
  // ---------------------------------------------------------------------------
  function fromFountain(src) {
    const text = SF.normalize(src);
    const parsed = SF.parse(text);
    const lines = text.split('\n');
    let titleBlock = lines.slice(0, parsed.titleLineCount).join('\n').replace(/\s+$/, '');
    // "# Title" first line (Markdown) → keep it as a proper title page
    if (!titleBlock && parsed.title && parsed.title.title) titleBlock = SF.setTitleFields('', { title: parsed.title.title.join('\n') }).trim();
    const els = [];
    const push = (type, t, extra) => els.push(Object.assign({ type, text: t }, extra || {}));
    const dialogue = (d, dual) => {
      push('character', d.character, { dual: !!dual, forced: !!d.forced });
      d.parts.forEach((p) => {
        if (p.type === 'parenthetical') push('parenthetical', p.text);
        else push('dialogue', p.type === 'lyrics' ? '~' + p.text : p.text);
      });
    };
    parsed.tokens.forEach((t) => {
      switch (t.type) {
        case 'episode':
          push('episode', t.text);
          break;
        case 'scene_heading':
          push('scene_heading', t.text, { number: t.number || '' });
          break;
        case 'action':
          push('action', t.lines.map((l) => l.text).join('\n'));
          break;
        case 'dialogue':
          dialogue(t, false);
          break;
        case 'dual_dialogue':
          dialogue(t.left, false);
          dialogue(t.right, true);
          break;
        case 'transition':
          push('transition', t.text);
          break;
        case 'centered':
          push('centered', t.text);
          break;
        case 'lyrics':
          push('action', '~' + t.text);
          break;
        case 'page_break':
          push('page_break', '');
          break;
        case 'note':
        case 'synopsis':
          push('note', t.text);
          break;
        default:
          break;
      }
    });
    // Only boneyard text and notes buried inside a line or a speech can't be shown as elements
    const noteTokens = parsed.tokens.filter((t) => t.type === 'note').length;
    const lost = /\/\*/.test(text) || parsed.notes.some((n) => n.inline) || noteTokens < parsed.notes.length || parsed.tokens.some((t) => t.type === 'section');
    return { titleBlock, els, lost };
  }

  // ---------------------------------------------------------------------------
  // Element list → Fountain (+ map of fountain line → element index)
  // ---------------------------------------------------------------------------
  function toFountainText(titleBlock, els) {
    const out = [];
    const lineToEl = [];
    const emit = (line, idx) => {
      out.push(line);
      lineToEl.push(idx);
    };
    const blank = () => {
      if (out.length && out[out.length - 1] !== '') emit('', -1);
    };
    if (titleBlock) {
      titleBlock.split('\n').forEach((l) => emit(l, -1));
      emit('', -1);
    }

    els.forEach((el, idx) => {
      // Paragraph alignment travels as a trailing [[rs:align=…]] marker on the element
      const pa = SF.paraAlign(el.text || '');
      const am = pa.align ? ` [[rs:align=${pa.align}]]` : '';
      const raw = pa.text.replace(/\s+$/g, '');
      const t = raw.trim();
      const prev = els[idx - 1];
      const emitLines = (lines) => lines.forEach((l, k) => emit(k === lines.length - 1 ? l + am : l, idx));
      switch (el.type) {
        case 'episode':
          if (!t) return;
          blank();
          emit((SF.isEpisode(t) && !SF.isSceneHeading(t) ? t : '#! ' + t) + am, idx);
          blank();
          break;
        case 'scene_heading': {
          if (!t) return;
          blank();
          const up = t.toUpperCase();
          const num = el.number ? ` #${el.number}#` : '';
          emit((SF.isSceneHeading(up) ? up : '.' + up) + am + num, idx);
          blank();
          break;
        }
        case 'action': {
          if (!t) return;
          blank();
          emitLines(
            raw.split('\n').map((l, k) => {
              let line = l.trim();
              if (k === 0 && needsForceAction(line)) line = '!' + line;
              else if (k > 0 && line === '') line = '  ';
              return line;
            })
          );
          blank();
          break;
        }
        case 'character': {
          if (!t) return;
          blank();
          let name = el.forced ? t : t.toUpperCase();
          if (el.forced || !SF.isCharacterCue(name) || SF.isSceneHeading(name) || SF.isEpisode(name)) name = '@' + name;
          emit(name + am + (el.dual ? ' ^' : ''), idx);
          break;
        }
        case 'parenthetical':
        case 'dialogue': {
          if (!t) return;
          // Must follow a cue / speech line with no blank in between
          if (!out.length || out[out.length - 1] === '' || !inSpeech(els, idx)) {
            // Speech without a character cue above it can't be expressed in Fountain: keep it as action
            blank();
            emitLines(
              raw.split('\n').map((l, k) => {
                const line = l.trim();
                return k === 0 && needsForceAction(line) ? '!' + line : line || '  ';
              })
            );
            blank();
            break;
          }
          if (el.type === 'parenthetical') {
            const inner = t.replace(/^\(/, '').replace(/\)$/, '');
            emit(`(${inner})${am}`, idx);
          } else {
            emitLines(raw.split('\n').map((l) => (l.trim() === '' ? '  ' : l.trim())));
          }
          const next = els[idx + 1];
          if (!next || !['parenthetical', 'dialogue'].includes(next.type)) blank();
          break;
        }
        case 'transition': {
          if (!t) return;
          blank();
          const up = t.toUpperCase();
          emit((SF.isTransition(up) ? up : '> ' + up) + am, idx);
          blank();
          break;
        }
        case 'centered':
          if (!t) return;
          blank();
          emit(`> ${t}${am} <`, idx);
          blank();
          break;
        case 'page_break':
          blank();
          emit('===', idx);
          blank();
          break;
        case 'note':
          if (!t) return;
          blank();
          emit(`[[${raw.replace(/\]\]/g, '] ]').replace(/\n+/g, ' ').trim()}]]`, idx);
          blank();
          break;
        default:
          break;
      }
    });
    while (out.length && out[out.length - 1] === '') {
      out.pop();
      lineToEl.pop();
    }
    return { text: out.join('\n') + '\n', lineToEl };
  }

  /** True when the element at idx sits under a non-empty character cue (only speech elements between). */
  function inSpeech(els, idx) {
    for (let k = idx - 1; k >= 0; k--) {
      const e = els[k];
      if (e.type === 'character') return !!e.text.trim();
      if (e.type !== 'parenthetical' && e.type !== 'dialogue') return false;
    }
    return false;
  }

  function needsForceAction(line) {
    if (!line) return false;
    if (/^[!@#~=>.\[]|^\/\*/.test(line)) return true;
    if (SF.isSceneHeading(line) || SF.isEpisode(line)) return true;
    if (SF.isAllCaps(line) && (SF.isTransition(line) || SF.isCharacterCue(line))) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Inline formatting: DOM ↔ Fountain emphasis
  // ---------------------------------------------------------------------------
  function htmlFromText(text) {
    return SF.parseInline(text)
      .map((r) => {
        let h = esc(r.text);
        if (r.u) h = `<u>${h}</u>`;
        if (r.i) h = `<i>${h}</i>`;
        if (r.b) h = `<b>${h}</b>`;
        if (r.s) h = `<s>${h}</s>`;
        if (r.h) h = `<span style="background-color:${r.h}">${h}</span>`;
        if (r.c) h = `<span style="color:${r.c}">${h}</span>`;
        return h;
      })
      .join('');
  }

  /** CSS colour (rgb()/#hex) → #rrggbb, or null for transparent */
  function toHex(css) {
    if (!css) return null;
    const v = String(css).trim().toLowerCase();
    if (!v || v === 'transparent' || v === 'inherit' || v === 'initial') return null;
    if (/^#[0-9a-f]{3,8}$/.test(v)) return v.length === 4 ? '#' + v.slice(1).split('').map((c) => c + c).join('') : v.slice(0, 7);
    const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/.exec(v);
    if (!m) return null;
    if (m[4] !== undefined && +m[4] === 0) return null;
    return '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
  }

  function textFromNode(node) {
    const runs = [];
    const walk = (n, st) => {
      if (n.nodeType === 3) {
        runs.push({ text: n.nodeValue.replace(/ /g, ' ').replace(/​/g, ''), ...st });
        return;
      }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'BR') {
        // trailing <br> in a block is only a placeholder
        if (n.nextSibling) runs.push({ text: '\n', ...st });
        return;
      }
      const s = { ...st };
      const tag = n.tagName;
      const style = n.style || {};
      const deco = (style.textDecoration || '') + ' ' + (style.textDecorationLine || '');
      if (tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(style.fontWeight || '')) s.b = true;
      if (/^(normal|[1-5]00)$/.test(style.fontWeight || '') && tag === 'SPAN') s.b = false;
      if (tag === 'I' || tag === 'EM' || style.fontStyle === 'italic') s.i = true;
      if (tag === 'U' || /underline/.test(deco)) s.u = true;
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || /line-through/.test(deco)) s.s = true;
      const col = toHex(style.color || (tag === 'FONT' && n.getAttribute('color')));
      if (col) s.c = /^#(000000|111111)$/.test(col) ? null : col;
      const bg = toHex(style.backgroundColor);
      if (bg) s.h = /^#ffffff$/.test(bg) ? null : bg;
      if ((tag === 'DIV' || tag === 'P') && runs.length && n !== node) runs.push({ text: '\n', ...st });
      n.childNodes.forEach((c) => walk(c, s));
    };
    walk(node, { b: false, i: false, u: false, s: false, c: null, h: null });

    // Merge neighbours with identical style
    const groups = [];
    runs.forEach((r) => {
      if (!r.text) return;
      const g = groups[groups.length - 1];
      if (g && g.b === r.b && g.i === r.i && g.u === r.u && g.s === r.s && g.c === r.c && g.h === r.h) g.text += r.text;
      else groups.push({ ...r });
    });

    // Serialise: [[rs:…]] markers outside, Fountain **/*/_ inside; emphasis never wraps edge spaces
    let out = '';
    groups.forEach((g) => {
      const t = g.text.replace(/([*_])/g, '\\$1');
      const rsOpen = (g.c ? `[[rs:c=${g.c}]]` : '') + (g.h ? `[[rs:h=${g.h}]]` : '') + (g.s ? '[[rs:s]]' : '');
      const rsClose = (g.s ? '[[rs:/s]]' : '') + (g.h ? '[[rs:/h]]' : '') + (g.c ? '[[rs:/c]]' : '');
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t);
      if (!m[2]) {
        out += t;
        return;
      }
      const open = (g.u ? '_' : '') + (g.b ? '**' : '') + (g.i ? '*' : '');
      const close = (g.i ? '*' : '') + (g.b ? '**' : '') + (g.u ? '_' : '');
      out += rsOpen + m[1] + open + m[2] + close + m[3] + rsClose;
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Editor
  // ---------------------------------------------------------------------------
  class ScriptEditor {
    constructor(host, opts) {
      this.host = host;
      this.opts = opts || {};
      this.titleBlock = '';
      this.lineToEl = [];
      this.undoStack = [];
      this.redoStack = [];
      this.suggest = null;
      this.composing = false;

      host.innerHTML = '';
      host.classList.add('sp-desk');
      this.paper = document.createElement('div');
      this.paper.className = 'sp-paper';
      this.root = document.createElement('div');
      this.root.className = 'sp-root';
      this.root.contentEditable = 'true';
      this.root.spellcheck = true;
      this.root.setAttribute('role', 'textbox');
      this.root.setAttribute('aria-multiline', 'true');
      this.root.setAttribute('aria-label', 'Screenplay');
      this.paper.appendChild(this.root);
      host.appendChild(this.paper);

      this.pop = document.createElement('div');
      this.pop.className = 'sp-suggest';
      this.pop.hidden = true;
      document.body.appendChild(this.pop);

      this._bind();
    }

    // ----------------------------------------------------------------- data
    load(src, keepUndo) {
      const { titleBlock, els, lost } = fromFountain(src || '');
      this.titleBlock = titleBlock;
      this._render(els.length ? els : [{ type: 'action', text: '' }]);
      if (!keepUndo) {
        this.undoStack = [];
        this.redoStack = [];
      }
      this._lastText = this.toFountain();
      return { lost };
    }

    elements() {
      return [...this.root.children].filter((n) => n.classList.contains('sp-el'));
    }

    _elData(div) {
      return {
        type: div.dataset.t,
        text: div.dataset.t === 'page_break' ? '' : textFromNode(div) + (div.dataset.align && div.textContent.trim() ? ` [[rs:align=${div.dataset.align}]]` : ''),
        number: div.dataset.num || '',
        dual: div.dataset.dual === '1',
        forced: div.dataset.forced === '1',
      };
    }

    toFountain() {
      const res = toFountainText(this.titleBlock, this.elements().map((d) => this._elData(d)));
      this.lineToEl = res.lineToEl;
      return res.text;
    }

    /** Push any pending edit to the app now; returns the current Fountain text. */
    sync() {
      this._changed();
      return this._lastText;
    }

    setTitleBlock(block) {
      this.titleBlock = (block || '').replace(/\s+$/, '');
    }

    _makeEl(e) {
      const div = document.createElement('div');
      div.className = 'sp-el';
      this._applyType(div, e.type);
      if (e.number) div.dataset.num = e.number;
      if (e.dual) div.dataset.dual = '1';
      if (e.forced) div.dataset.forced = '1';
      if (e.type === 'page_break') {
        div.contentEditable = 'false';
        div.innerHTML = '';
      } else {
        const pa = SF.paraAlign(e.text);
        if (pa.align) div.dataset.align = pa.align;
        div.innerHTML = htmlFromText(pa.text) || '<br>';
      }
      return div;
    }

    _render(els) {
      const frag = document.createDocumentFragment();
      els.forEach((e) => frag.appendChild(this._makeEl(e)));
      this.root.innerHTML = '';
      this.root.appendChild(frag);
    }

    _applyType(div, type) {
      div.dataset.t = type;
      div.setAttribute('data-label', LABELS[type] || type);
    }

    // ----------------------------------------------------------------- caret
    currentEl() {
      const sel = window.getSelection();
      if (!sel.rangeCount) return null;
      let n = sel.anchorNode;
      if (!n || !this.root.contains(n)) return null;
      if (n === this.root) return this.root.children[Math.min(sel.anchorOffset, this.root.children.length - 1)] || null;
      while (n && n.parentNode !== this.root) n = n.parentNode;
      return n && n.classList && n.classList.contains('sp-el') ? n : null;
    }

    caretOffset(el) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return 0;
      const r = sel.getRangeAt(0).cloneRange();
      const pre = document.createRange();
      pre.selectNodeContents(el);
      try {
        pre.setEnd(r.startContainer, r.startOffset);
      } catch (e) {
        return 0;
      }
      return pre.toString().length;
    }

    setCaret(el, offset) {
      if (!el) return;
      const sel = window.getSelection();
      const range = document.createRange();
      let remaining = offset == null ? Infinity : offset;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      let last = null;
      while ((node = walker.nextNode())) {
        last = node;
        if (remaining <= node.nodeValue.length) {
          range.setStart(node, remaining);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          this._ensureVisible(el);
          return;
        }
        remaining -= node.nodeValue.length;
      }
      if (last) range.setStart(last, last.nodeValue.length);
      else range.setStart(el, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      this._ensureVisible(el);
    }

    _ensureVisible(el) {
      const host = this.host;
      const r = el.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      if (r.bottom > hr.bottom - 60) host.scrollTop += r.bottom - hr.bottom + 120;
      else if (r.top < hr.top + 20) host.scrollTop -= hr.top - r.top + 80;
    }

    focus() {
      const el = this.currentEl() || this.elements()[0];
      this.root.focus({ preventScroll: true });
      if (!this.currentEl() && el) this.setCaret(el, 0);
    }

    // ----------------------------------------------------------------- undo
    _snapshot() {
      const el = this.currentEl();
      const els = this.elements();
      return { text: this.toFountain(), idx: el ? els.indexOf(el) : 0, off: el ? this.caretOffset(el) : 0 };
    }

    checkpoint() {
      const s = this._snapshot();
      const top = this.undoStack[this.undoStack.length - 1];
      if (top && top.text === s.text) return;
      this.undoStack.push(s);
      if (this.undoStack.length > 300) this.undoStack.shift();
      this.redoStack = [];
    }

    _restore(s) {
      this.load(s.text, true);
      const el = this.elements()[Math.min(s.idx, this.elements().length - 1)];
      this.root.focus({ preventScroll: true });
      this.setCaret(el, s.off);
      // load() already updated _lastText, so tell the app directly: save + re-render the preview
      const text = this.toFountain();
      this._lastText = text;
      if (this.opts.onChange) this.opts.onChange(text, true);
    }

    undo() {
      this._flushTyping();
      const s = this.undoStack.pop();
      if (!s) return;
      this.redoStack.push(this._snapshot());
      this._restore(s);
    }

    redo() {
      const s = this.redoStack.pop();
      if (!s) return;
      this.undoStack.push(this._snapshot());
      this._restore(s);
    }

    _flushTyping() {
      if (this._typingSnap) {
        const top = this.undoStack[this.undoStack.length - 1];
        if (!top || top.text !== this._typingSnap.text) this.undoStack.push(this._typingSnap);
        this._typingSnap = null;
      }
    }

    // ----------------------------------------------------------------- changes
    _changed(silentUndo) {
      clearTimeout(this._changeTimer);
      const text = this.toFountain();
      if (text === this._lastText) return;
      this._lastText = text;
      if (this.opts.onChange) this.opts.onChange(text, silentUndo);
    }

    _normalize() {
      // Wrap stray nodes the browser may create directly under the root.
      [...this.root.childNodes].forEach((n) => {
        if (n.nodeType === 1 && n.classList.contains('sp-el')) {
          if (!n.dataset.t) this._applyType(n, 'action');
          return;
        }
        if (n.nodeType === 3 && !n.nodeValue.trim()) {
          n.remove();
          return;
        }
        const div = document.createElement('div');
        div.className = 'sp-el';
        this._applyType(div, 'action');
        this.root.insertBefore(div, n);
        if (n.nodeType === 1 && (n.tagName === 'DIV' || n.tagName === 'P')) {
          while (n.firstChild) div.appendChild(n.firstChild);
          n.remove();
        } else div.appendChild(n);
      });
      if (!this.root.children.length) this.root.appendChild(this._makeEl({ type: 'action', text: '' }));
      // Browsers sometimes nest blocks inside an element (e.g. after pasting); flatten.
      this.elements().forEach((el) => {
        el.querySelectorAll('div,p').forEach((d) => {
          d.insertAdjacentText('beforebegin', '\n');
          while (d.firstChild) d.parentNode.insertBefore(d.firstChild, d);
          d.remove();
        });
        if (el.dataset.t !== 'page_break' && !el.textContent && !el.querySelector('br')) el.innerHTML = '<br>';
      });
    }

    // ----------------------------------------------------------------- element ops
    currentType() {
      const el = this.currentEl();
      return el ? el.dataset.t : 'action';
    }

    setType(type, el) {
      el = el || this.currentEl() || this.elements()[this.elements().length - 1];
      if (!el || !TYPES.includes(type)) return;
      this.checkpoint();
      if (type === 'page_break') {
        const pb = this._makeEl({ type: 'page_break', text: '' });
        el.after(pb);
        const next = this._makeEl({ type: 'action', text: '' });
        pb.after(next);
        this.setCaret(next, 0);
        this._changed();
        return;
      }
      const old = el.dataset.t;
      if (old === 'page_break') return;
      const off = this.caretOffset(el);
      let text = textFromNode(el);
      let caret = off;
      if (old === 'parenthetical' && type !== 'parenthetical') {
        const stripped = text.replace(/^\(/, '').replace(/\)$/, '');
        caret = Math.max(0, off - (text.startsWith('(') ? 1 : 0));
        text = stripped;
      }
      if (type === 'parenthetical' && !/^\(.*\)$/.test(text.trim())) {
        text = `(${text.trim().replace(/^\(|\)$/g, '')})`;
        caret = Math.min(text.length - 1, caret + 1);
      }
      if (type !== 'character') {
        delete el.dataset.dual;
        delete el.dataset.forced;
      }
      this._applyType(el, type);
      el.innerHTML = htmlFromText(text) || '<br>';
      this.setCaret(el, caret);
      this._changed();
      this._updateSuggest();
    }

    insertAfter(el, type, html) {
      const div = this._makeEl({ type, text: '' });
      if (html != null) div.innerHTML = html || '<br>';
      el.after(div);
      return div;
    }

    toggleDual() {
      const el = this.currentEl();
      if (!el || el.dataset.t !== 'character') return false;
      this.checkpoint();
      if (el.dataset.dual === '1') delete el.dataset.dual;
      else el.dataset.dual = '1';
      this._changed();
      return true;
    }

    _splitAtCaret(el) {
      const sel = window.getSelection();
      const r = sel.getRangeAt(0);
      if (!r.collapsed) r.deleteContents();
      const tail = document.createRange();
      tail.setStart(r.startContainer, r.startOffset);
      tail.setEnd(el, el.childNodes.length);
      const frag = tail.extractContents();
      if (!el.textContent && !el.querySelector('br')) el.innerHTML = '<br>';
      const holder = document.createElement('div');
      holder.appendChild(frag);
      const hasText = holder.textContent.length > 0;
      return hasText ? holder.innerHTML : '';
    }

    _onEnter(shift) {
      const el = this.currentEl();
      if (!el) return;
      this.checkpoint();
      const type = el.dataset.t;

      if (type === 'page_break') {
        const n = this.insertAfter(el, 'action');
        this.setCaret(n, 0);
        this._changed();
        return;
      }
      if (shift && (type === 'action' || type === 'dialogue')) {
        document.execCommand('insertText', false, '\n');
        return;
      }
      const text = el.textContent.replace(/​/g, '');
      if (!text.trim()) {
        // Enter on an empty element changes it (Final Draft shows an element menu here)
        if (type !== 'action') this.setType('action', el);
        return;
      }
      if (type === 'parenthetical' && !text.trim().endsWith(')')) el.insertAdjacentText('beforeend', ')');
      const off = this.caretOffset(el);
      const atEnd = off >= text.length || (type === 'parenthetical' && off >= text.length - 1);
      let tailHtml = '';
      if (!atEnd) tailHtml = this._splitAtCaret(el);
      const nextType = atEnd ? ENTER_NEXT[type] || 'action' : type === 'parenthetical' ? 'dialogue' : type;
      const n = this.insertAfter(el, nextType, tailHtml);
      if (nextType === 'parenthetical' && !tailHtml) n.innerHTML = '()';
      this.setCaret(n, nextType === 'parenthetical' && !tailHtml ? 1 : 0);
      this._changed();
      this._updateSuggest();
    }

    _onTab(shift) {
      const el = this.currentEl();
      if (!el) return;
      const type = el.dataset.t;
      const empty = !el.textContent.replace(/​/g, '').trim() || (type === 'parenthetical' && /^\(\s*\)$/.test(el.textContent.trim()));
      if (shift) {
        this.setType(SHIFT_TAB_NEXT[type] || 'action', el);
        return;
      }
      // Tab at the end of a speech adds a parenthetical below, like Final Draft
      if (!empty && type === 'dialogue' && this.caretOffset(el) >= el.textContent.length) {
        this.checkpoint();
        const n = this.insertAfter(el, 'parenthetical');
        n.innerHTML = '()';
        this.setCaret(n, 1);
        this._changed();
        return;
      }
      this.setType(TAB_NEXT[type] || 'action', el);
    }

    _onBackspace(e) {
      const el = this.currentEl();
      if (!el) return;
      const sel = window.getSelection();
      if (!sel.isCollapsed) return;
      const off = this.caretOffset(el);
      if (off > 0) return;
      const prev = el.previousElementSibling;
      e.preventDefault();
      this.checkpoint();
      if (!el.textContent && !prev) {
        if (el.dataset.t !== 'action') this.setType('action', el);
        return;
      }
      if (!prev) return;
      if (prev.dataset.t === 'page_break') {
        prev.remove();
        this._changed();
        return;
      }
      if (!el.textContent) {
        el.remove();
        this.setCaret(prev, Infinity);
        this._changed();
        return;
      }
      // merge into previous element
      const len = prev.textContent.length;
      if (!prev.textContent) prev.innerHTML = '';
      while (el.firstChild) prev.appendChild(el.firstChild);
      el.remove();
      prev.querySelectorAll('br').forEach((b) => {
        if (!b.nextSibling && prev.textContent) b.remove();
      });
      this.setCaret(prev, len);
      this._changed();
    }

    _onDelete(e) {
      const el = this.currentEl();
      if (!el) return;
      const sel = window.getSelection();
      if (!sel.isCollapsed) return;
      if (this.caretOffset(el) < el.textContent.length) return;
      const next = el.nextElementSibling;
      if (!next) return;
      e.preventDefault();
      this.checkpoint();
      const len = el.textContent.length;
      if (next.dataset.t === 'page_break' || !next.textContent) {
        next.remove();
      } else {
        if (!el.textContent) el.innerHTML = '';
        while (next.firstChild) el.appendChild(next.firstChild);
        next.remove();
      }
      this.setCaret(el, len);
      this._changed();
    }

    _onPaste(e) {
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      e.preventDefault();
      if (!text) return;
      this.checkpoint();
      if (!/\n/.test(text.trim())) {
        document.execCommand('insertText', false, text.replace(/\s+/g, ' '));
        return;
      }
      // Multi-line paste: treat as a script fragment
      const el = this.currentEl() || this.elements()[this.elements().length - 1];
      const tailHtml = el && el.dataset.t !== 'page_break' ? this._splitAtCaret(el) : '';
      const conv = SF.convertPasted ? SF.convertPasted(text) : { text: SF.cleanup(text) };
      const { els, titleBlock } = fromFountain(conv.text);
      if (titleBlock && !this.titleBlock) this.titleBlock = titleBlock;
      if (conv.info && this.opts.onInfo) setTimeout(() => this.opts.onInfo(conv.info), 0);
      let anchor = el;
      if (el && !el.textContent) {
        anchor = el.previousElementSibling;
        el.remove();
      }
      let last = null;
      els.forEach((d) => {
        const n = this._makeEl(d);
        if (anchor) anchor.after(n);
        else this.root.prepend(n);
        anchor = n;
        last = n;
      });
      if (tailHtml && last) {
        const n = this.insertAfter(last, last.dataset.t === 'character' ? 'dialogue' : last.dataset.t, tailHtml);
        last = n;
        this.setCaret(n, 0);
      } else if (last) this.setCaret(last, Infinity);
      this._normalize();
      this._changed();
    }

    // ----------------------------------------------------------------- SmartType
    _knownCharacters() {
      const seen = new Map();
      this.elements().forEach((d) => {
        if (d.dataset.t === 'character' && d !== this.currentEl()) {
          const n = d.textContent.replace(/\(.*?\)/g, '').replace(/\^/g, '').trim().toUpperCase();
          if (n) seen.set(n, (seen.get(n) || 0) + 1);
        }
      });
      return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    }

    _knownLocations() {
      const set = new Set();
      this.elements().forEach((d) => {
        if (d.dataset.t === 'scene_heading' && d !== this.currentEl()) {
          const m = /^(?:INT\.?\/EXT|EXT\.?\/INT|INT|EXT|EST|I\/E)\.?\s+(.*?)(?:\s+-\s+.*)?$/i.exec(d.textContent.trim());
          if (m && m[1]) set.add(m[1].toUpperCase());
        }
      });
      return [...set];
    }

    _suggestions(el) {
      const type = el.dataset.t;
      const text = el.textContent.replace(/​/g, '');
      const off = this.caretOffset(el);
      if (off < text.length) return null;
      const up = text.toUpperCase();
      if (type === 'character') {
        const paren = /^(.*?\S)\s*\(([^)]*)$/.exec(up);
        if (paren) {
          const list = EXTENSIONS.filter((x) => x.startsWith('(' + paren[2]));
          return { items: list, replace: (v) => `${paren[1]} ${v}` };
        }
        if (!up.trim()) return null;
        const list = this._knownCharacters().filter((n) => n.startsWith(up.trim()) && n !== up.trim());
        return { items: list.slice(0, 8), replace: (v) => v };
      }
      if (type === 'scene_heading') {
        const m = /^((?:INT\.?\/EXT|EXT\.?\/INT|INT|EXT|EST|I\/E)\.?\s+)(.*)$/i.exec(up);
        if (!m) {
          const list = SCENE_INTROS.filter((s) => s.startsWith(up) && s !== up);
          return { items: list, replace: (v) => v };
        }
        const dash = /^(.*\s-\s*)([^-]*)$/.exec(m[2]);
        if (dash) {
          const part = dash[2].trim();
          const list = SCENE_TIMES.filter((t) => t.startsWith(part) && t !== part);
          return { items: list, replace: (v) => m[1] + dash[1].replace(/\s*$/, ' ') + v };
        }
        const loc = m[2].trim();
        if (!loc) return { items: this._knownLocations().slice(0, 8), replace: (v) => m[1] + v + ' - ' };
        const list = this._knownLocations().filter((l) => l.startsWith(loc) && l !== loc);
        return { items: list.slice(0, 8), replace: (v) => m[1] + v + ' - ' };
      }
      if (type === 'transition') {
        if (!up.trim()) return { items: TRANSITIONS.slice(0, 6), replace: (v) => v };
        const list = TRANSITIONS.filter((t) => t.startsWith(up.trim()) && t !== up.trim());
        return { items: list, replace: (v) => v };
      }
      return null;
    }

    _updateSuggest() {
      const el = this.currentEl();
      const sel = window.getSelection();
      if (!el || !sel.isCollapsed || this.composing || document.activeElement !== this.root) return this._hideSuggest();
      const s = this._suggestions(el);
      if (!s || !s.items.length) return this._hideSuggest();
      this.suggest = { ...s, el, index: 0 };
      this.pop.innerHTML = s.items.map((it, k) => `<button type="button" class="${k === 0 ? 'on' : ''}" data-k="${k}">${esc(it)}</button>`).join('');
      const range = sel.getRangeAt(0).cloneRange();
      let rect = range.getClientRects()[0];
      if (!rect) rect = el.getBoundingClientRect();
      this.pop.hidden = false;
      const top = Math.min(rect.bottom + 6, window.innerHeight - this.pop.offsetHeight - 8);
      this.pop.style.top = `${top}px`;
      this.pop.style.left = `${Math.min(rect.left, window.innerWidth - this.pop.offsetWidth - 8)}px`;
    }

    _hideSuggest() {
      this.suggest = null;
      this.pop.hidden = true;
    }

    _accept(k) {
      const s = this.suggest;
      if (!s) return false;
      const v = s.items[k == null ? s.index : k];
      this.checkpoint();
      const text = s.replace(v);
      s.el.innerHTML = htmlFromText(text) || '<br>';
      this.setCaret(s.el, text.length);
      this._hideSuggest();
      this._changed();
      setTimeout(() => this._updateSuggest(), 0);
      return true;
    }

    // ----------------------------------------------------------------- page marks
    /** Mark elements that begin a new printed page (from the layout model). */
    markPages(model) {
      this.elements().forEach((d) => d.removeAttribute('data-page'));
      if (!model) return;
      const els = this.elements();
      model.pages.forEach((p) => {
        if (p.number === 1) return;
        const first = p.items.find((i) => i.src != null && i.kind !== 'header');
        if (!first) return;
        const idx = this.lineToEl[first.src];
        if (idx != null && idx >= 0 && els[idx]) els[idx].setAttribute('data-page', p.number);
      });
    }

    elementIndexForLine(line) {
      for (let l = line; l >= 0; l--) if (this.lineToEl[l] != null && this.lineToEl[l] >= 0) return this.lineToEl[l];
      return 0;
    }

    lineForElement(idx) {
      return this.lineToEl.indexOf(idx);
    }

    revealElement(idx, select) {
      const el = this.elements()[idx];
      if (!el) return;
      this.root.focus({ preventScroll: true });
      this.setCaret(el, select ? 0 : 0);
      const hr = this.host.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      this.host.scrollTop += r.top - hr.top - hr.height / 3;
      el.classList.add('sp-flash');
      setTimeout(() => el.classList.remove('sp-flash'), 900);
    }

    // ----------------------------------------------------------------- events
    _bind() {
      const root = this.root;

      root.addEventListener('beforeinput', (e) => {
        switch (e.inputType) {
          case 'insertParagraph':
            e.preventDefault();
            if (this.suggest && this._accept()) return;
            this._onEnter(false);
            break;
          case 'insertLineBreak':
            e.preventDefault();
            this._onEnter(true);
            break;
          case 'historyUndo':
            e.preventDefault();
            this.undo();
            break;
          case 'historyRedo':
            e.preventDefault();
            this.redo();
            break;
          case 'formatBold':
          case 'formatItalic':
          case 'formatUnderline':
            this.checkpoint();
            break;
          default:
            if (!this._typingSnap) this._typingSnap = this._snapshot();
            clearTimeout(this._typingTimer);
            this._typingTimer = setTimeout(() => this._flushTyping(), 800);
        }
      });

      root.addEventListener('input', () => {
        this._normalize();
        clearTimeout(this._changeTimer);
        this._changeTimer = setTimeout(() => this._changed(), this.root.children.length > 1500 ? 250 : 60);
        this._updateSuggest();
      });

      root.addEventListener('compositionstart', () => (this.composing = true));
      root.addEventListener('compositionend', () => {
        this.composing = false;
        this._changed();
      });

      root.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        const mod = e.ctrlKey || e.metaKey;
        if (this.suggest && !this.pop.hidden) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = this.suggest.items.length;
            this.suggest.index = (this.suggest.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
            [...this.pop.children].forEach((b, k) => b.classList.toggle('on', k === this.suggest.index));
            return;
          }
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            this._accept();
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            this._hideSuggest();
            return;
          }
        }
        if (e.key === 'Enter' && !mod && !e.altKey) {
          // Handled here as well as in beforeinput for browsers without insertParagraph support
          e.preventDefault();
          if (!e.shiftKey && this.suggest && !this.pop.hidden && this._accept()) {
            // Final Draft: accepting a character name moves straight on to dialogue
            const el = this.currentEl();
            if (el && el.dataset.t === 'character') this._onEnter(false);
            return;
          }
          this._onEnter(e.shiftKey);
          return;
        }
        if (e.key === 'Tab' && !mod && !e.altKey) {
          e.preventDefault();
          this._onTab(e.shiftKey);
          return;
        }
        if (e.key === 'F3' && e.shiftKey) {
          // Word: Shift+F3 cycles UPPER → lower → Title case
          e.preventDefault();
          const t = window.getSelection().toString() || (this.currentEl() || {}).textContent || '';
          this.changeCase(t === t.toUpperCase() ? 'lower' : t === t.toLowerCase() ? 'title' : 'upper');
          return;
        }
        if (e.key === 'Backspace' && !mod) return this._onBackspace(e);
        if (e.key === 'Delete' && !mod) return this._onDelete(e);
        if (mod && !e.altKey) {
          const k = e.key.toLowerCase();
          if (k === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
            return;
          }
          if ((k === 'z' && e.shiftKey) || k === 'y') {
            e.preventDefault();
            this.redo();
            return;
          }
          if ((k === 'b' || k === 'i' || k === 'u') && !e.shiftKey) {
            e.preventDefault();
            this.format(k);
            return;
          }
          if (k === 'x' && e.shiftKey) {
            e.preventDefault();
            this.format('s');
            return;
          }
          const al = { l: 'left', e: 'center', r: 'right', j: 'justify' }[k];
          if (al) {
            e.preventDefault();
            this.align(al);
            return;
          }
          if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            this.clearFormatting();
            return;
          }
          const map = { 0: 'episode', 1: 'scene_heading', 2: 'action', 3: 'character', 4: 'parenthetical', 5: 'dialogue', 6: 'transition', 7: 'centered' };
          if (map[e.key]) {
            e.preventDefault();
            this.setType(map[e.key]);
          }
        }
      });

      root.addEventListener('paste', (e) => this._onPaste(e));
      root.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) return; // file import handled by app
        e.preventDefault();
      });

      const caretMoved = () => {
        if (document.activeElement !== root) return;
        if (this.opts.onCaret) this.opts.onCaret();
      };
      document.addEventListener('selectionchange', () => {
        clearTimeout(this._selTimer);
        this._selTimer = setTimeout(() => {
          caretMoved();
          if (this.suggest && this.currentEl() !== this.suggest.el) this._hideSuggest();
        }, 50);
      });
      root.addEventListener('blur', () => setTimeout(() => this._hideSuggest(), 150));

      this.pop.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const b = e.target.closest('button');
        if (b) this._accept(+b.dataset.k);
      });
      this.host.addEventListener('scroll', () => this._hideSuggest());

      // Click on the desk below the last element focuses the end of the script
      this.host.addEventListener('mousedown', (e) => {
        if (e.target === this.host || e.target === this.paper) {
          e.preventDefault();
          const els = this.elements();
          this.root.focus({ preventScroll: true });
          this.setCaret(els[els.length - 1], Infinity);
        }
      });
    }

    format(k) {
      this.checkpoint();
      this._ensureSelection();
      document.execCommand('styleWithCSS', false, false);
      const cmd = { b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough' }[k];
      if (cmd) document.execCommand(cmd);
      this._afterFormat();
    }

    /** Word-style formatting ------------------------------------------------ */
    _ensureSelection() {
      if (document.activeElement !== this.root) this.root.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (!sel.rangeCount || !this.root.contains(sel.anchorNode)) {
        const el = this.currentEl() || this.elements()[0];
        if (el) this.setCaret(el, Infinity);
      }
    }

    _afterFormat() {
      this._normalize();
      this._changed();
      if (this.opts.onCaret) this.opts.onCaret();
    }

    /** Elements touched by the current selection (or the caret's element). */
    selectedElements() {
      const sel = window.getSelection();
      if (!sel.rangeCount || !this.root.contains(sel.anchorNode)) {
        const el = this.currentEl();
        return el ? [el] : [];
      }
      const r = sel.getRangeAt(0);
      const els = this.elements().filter((el) => r.intersectsNode(el));
      return els.length ? els : [this.currentEl()].filter(Boolean);
    }

    /** If nothing is selected, select the word at the caret (like Word). */
    _selectWordIfCollapsed() {
      const sel = window.getSelection();
      if (!sel.rangeCount || !sel.isCollapsed) return;
      if (sel.modify) {
        sel.modify('move', 'backward', 'word');
        sel.modify('extend', 'forward', 'word');
      }
    }

    color(hex) {
      this.checkpoint();
      this._ensureSelection();
      this._selectWordIfCollapsed();
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('foreColor', false, hex || '#111111');
      document.execCommand('styleWithCSS', false, false);
      this._afterFormat();
    }

    highlight(hex) {
      this.checkpoint();
      this._ensureSelection();
      this._selectWordIfCollapsed();
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('hiliteColor', false, hex || 'transparent');
      document.execCommand('styleWithCSS', false, false);
      this._afterFormat();
    }

    static defaultAlign(type) {
      return type === 'transition' ? 'right' : type === 'centered' || type === 'episode' ? 'center' : 'left';
    }

    align(a) {
      this.checkpoint();
      this.selectedElements().forEach((el) => {
        if (el.dataset.t === 'page_break') return;
        if (!a || a === ScriptEditor.defaultAlign(el.dataset.t)) delete el.dataset.align;
        else el.dataset.align = a;
      });
      this._changed();
      if (this.opts.onCaret) this.opts.onCaret();
    }

    currentAlign() {
      const el = this.currentEl();
      if (!el) return 'left';
      return el.dataset.align || ScriptEditor.defaultAlign(el.dataset.t);
    }

    changeCase(mode) {
      this._ensureSelection();
      const sel = window.getSelection();
      if (sel.isCollapsed) {
        const el = this.currentEl();
        if (!el) return;
        const r = document.createRange();
        r.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      const t = sel.toString();
      if (!t) return;
      const out =
        mode === 'upper'
          ? t.toUpperCase()
          : mode === 'lower'
          ? t.toLowerCase()
          : mode === 'title'
          ? t.toLowerCase().replace(/(^|[\s(\-"“'‘])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
          : t.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
      this.checkpoint();
      document.execCommand('insertText', false, out);
      // re-select the changed text so case can be cycled
      this._afterFormat();
    }

    clearFormatting() {
      this.checkpoint();
      this._ensureSelection();
      const sel = window.getSelection();
      const els = this.selectedElements();
      if (sel.isCollapsed) {
        els.forEach((el) => {
          if (el.dataset.t === 'page_break') return;
          el.innerHTML = esc(el.textContent) || '<br>';
        });
      } else {
        document.execCommand('removeFormat');
        document.execCommand('styleWithCSS', false, true);
        document.execCommand('hiliteColor', false, 'transparent');
        document.execCommand('styleWithCSS', false, false);
      }
      els.forEach((el) => delete el.dataset.align);
      this._afterFormat();
    }

    /** Formatting state at the caret, for toolbar buttons */
    formatState() {
      let strike = false;
      try {
        strike = document.queryCommandState('strikeThrough');
      } catch (e) {
        /* ignore */
      }
      return { align: this.currentAlign(), strike };
    }

    setPageStyle(model, opts) {
      this.paper.style.setProperty('--sp-w', model.size.w + 'in');
      this.paper.style.setProperty('--sp-scene-before', opts.doubleSpaceSceneHeadings ? 2 : 1);
      this.paper.classList.toggle('sp-bold-scenes', !!opts.boldSceneHeadings);
      this.paper.classList.toggle('sp-ul-scenes', !!opts.underlineSceneHeadings);
      this.paper.classList.toggle('sp-bold-cues', !!opts.boldCharacterNames);
    }
  }

  Object.assign(SF, { ScriptEditor, ELEMENT_LABELS: LABELS, ELEMENT_TYPES: TYPES, editorFromFountain: fromFountain, editorToFountain: toFountainText, textFromNode, htmlFromText });
})(typeof window !== 'undefined' ? window : globalThis);
