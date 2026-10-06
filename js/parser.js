/*
 * ReelScript — Fountain parser
 * Turns Fountain-flavoured plain text into a flat list of screenplay tokens.
 * Spec reference: https://fountain.io/syntax
 */
(function (root) {
  'use strict';

  const SF = (root.SF = root.SF || {});

  const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E|E\/I)(\.|\s)/i;
  const SCENE_NUM_RE = /\s*#([^#\s][^#]*)#\s*$/;
  const TITLE_KEY_RE = /^(title|credit|author|authors|source|draft date|date|contact|copyright|notes|revision|written by)\s*:/i;
  const TRANSITION_WORDS_RE = /^(FADE OUT\.?|FADE TO BLACK\.?|CUT TO BLACK\.?|SMASH CUT TO BLACK\.?|END CREDITS\.?)$/;
  const NOTE_SENTINEL = '\u0001';

  function normalize(src) {
    return String(src == null ? '' : src)
      .replace(/^﻿/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, '    ');
  }

  const isBlank = (s) => s === undefined || s.trim() === '';

  function hasUpper(s) {
    return /\p{Lu}/u.test(s);
  }

  function isAllCaps(s) {
    return hasUpper(s) && s === s.toUpperCase();
  }

  function isSceneHeading(line) {
    return SCENE_RE.test(line);
  }

  function isTransition(line) {
    return isAllCaps(line) && (/TO:$/.test(line) || TRANSITION_WORDS_RE.test(line));
  }

  function isCharacterCue(line) {
    if (line.startsWith('@')) return line.length > 1;
    const s = line.replace(/\s*\^$/, '');
    if (/[:]$/.test(s)) return false;
    const name = s.replace(/\(.*?\)/g, '').trim();
    if (!name || !hasUpper(name)) return false;
    if (isSceneHeading(s)) return false;
    return name === name.toUpperCase();
  }

  /** Strip boneyard comments while keeping line count stable. */
  function stripBoneyard(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));
  }

  /** Remove [[notes]]; keeps line count stable, returns notes separately. */
  function stripNotes(src, notes) {
    return src.replace(/\[\[([\s\S]*?)\]\]/g, (m, body, offset) => {
      notes.push({ text: body.trim(), offset });
      return NOTE_SENTINEL + m.replace(/[^\n]/g, '');
    });
  }

  /**
   * Title page: leading block of `Key: value` lines.
   * Returns { fields, lineCount } where lineCount is the number of source lines consumed.
   */
  function parseTitlePage(lines) {
    let i = 0;
    while (i < lines.length && isBlank(lines[i])) i++;
    if (i >= lines.length || !TITLE_KEY_RE.test(lines[i].trim())) return { fields: null, lineCount: 0 };

    const fields = {};
    let key = null;
    for (; i < lines.length; i++) {
      const raw = lines[i];
      if (isBlank(raw)) break;
      const m = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(raw.trim());
      if (m && !/^\s{2,}/.test(raw)) {
        key = m[1].toLowerCase();
        if (key === 'author' || key === 'written by') key = 'authors';
        if (key === 'date') key = 'draft date';
        fields[key] = m[2] ? [m[2].trim()] : [];
      } else if (key) {
        fields[key].push(raw.trim());
      }
    }
    return { fields, lineCount: i };
  }

  /**
   * Parse Fountain text.
   * @returns {{ title: object|null, tokens: Array, notes: Array }}
   * Every printable token carries `line`: its 0-based source line.
   */
  function parse(src) {
    const notes = [];
    const text = stripNotes(stripBoneyard(normalize(src)), notes);
    const allLines = text.split('\n').map((l) => {
      if (!l.includes(NOTE_SENTINEL)) return l;
      const cleaned = l.split(NOTE_SENTINEL).join('');
      // A line that only held a note disappears instead of becoming a blank separator.
      return cleaned.trim() === '' ? null : cleaned.replace(/\s{2,}/g, ' ');
    });

    const { fields, lineCount } = parseTitlePage(allLines.map((l) => (l === null ? '' : l)));
    const tokens = [];
    const lines = allLines;

    const prevBlankAt = (i) => {
      for (let k = i - 1; k >= lineCount; k--) {
        if (lines[k] === null) continue;
        return isBlank(lines[k]);
      }
      return true;
    };
    const nextIndex = (i) => {
      for (let k = i + 1; k < lines.length; k++) if (lines[k] !== null) return k;
      return -1;
    };
    const nextBlankAt = (i) => {
      const k = nextIndex(i);
      return k === -1 || isBlank(lines[k]);
    };

    for (let i = lineCount; i < lines.length; i++) {
      const raw = lines[i];
      if (raw === null || isBlank(raw)) continue;
      const line = raw.trim();
      const prevBlank = prevBlankAt(i);
      const nextBlank = nextBlankAt(i);

      if (/^={3,}$/.test(line)) {
        tokens.push({ type: 'page_break', line: i });
        continue;
      }
      if (line.startsWith('#')) {
        const depth = /^#+/.exec(line)[0].length;
        tokens.push({ type: 'section', depth, text: line.slice(depth).trim(), line: i });
        continue;
      }
      if (/^=(?!=)/.test(line)) {
        tokens.push({ type: 'synopsis', text: line.slice(1).trim(), line: i });
        continue;
      }

      // Forced scene heading (.HEADING) or natural one
      const forcedScene = line.startsWith('.') && !line.startsWith('..') && line.length > 1;
      if (prevBlank && (forcedScene || isSceneHeading(line))) {
        let t = forcedScene ? line.slice(1).trim() : line;
        let number = null;
        const nm = SCENE_NUM_RE.exec(t);
        if (nm) {
          number = nm[1].trim();
          t = t.slice(0, nm.index).trim();
        }
        tokens.push({ type: 'scene_heading', text: t, number, line: i });
        continue;
      }

      if (line.startsWith('>') && line.endsWith('<') && line.length > 1) {
        const prev = tokens[tokens.length - 1];
        tokens.push({
          type: 'centered',
          text: line.slice(1, -1).trim(),
          line: i,
          continued: !prevBlank && prev && prev.type === 'centered',
        });
        continue;
      }
      if (line.startsWith('>')) {
        tokens.push({ type: 'transition', text: line.slice(1).trim(), line: i });
        continue;
      }
      if (prevBlank && nextBlank && isTransition(line)) {
        tokens.push({ type: 'transition', text: line, line: i });
        continue;
      }

      const forcedAction = line.startsWith('!');
      if (!forcedAction && prevBlank && !nextBlank && isCharacterCue(line)) {
        const forcedCue = line.startsWith('@');
        let name = forcedCue ? line.slice(1).trim() : line;
        const dual = /\^$/.test(name);
        if (dual) name = name.replace(/\s*\^$/, '');
        const block = { type: 'dialogue', character: name, forced: forcedCue, dual, line: i, parts: [] };
        let j = i + 1;
        for (; j < lines.length; j++) {
          const l = lines[j];
          if (l === null) continue;
          if (isBlank(l) && l !== '  ') break;
          const t = l.trim();
          if (/^\(.*\)$/.test(t)) block.parts.push({ type: 'parenthetical', text: t, line: j });
          else if (t.startsWith('~')) block.parts.push({ type: 'lyrics', text: t.slice(1).trim(), line: j });
          else block.parts.push({ type: 'dialogue', text: t, line: j });
        }
        i = j - 1;

        const prev = tokens[tokens.length - 1];
        if (dual && prev && prev.type === 'dialogue') {
          tokens[tokens.length - 1] = { type: 'dual_dialogue', left: prev, right: block, line: prev.line };
        } else {
          tokens.push(block);
        }
        continue;
      }

      if (line.startsWith('~')) {
        tokens.push({ type: 'lyrics', text: line.slice(1).trim(), line: i });
        continue;
      }

      // Action: consume until a blank line
      const actionLines = [];
      let j = i;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l === null) continue;
        if (isBlank(l)) break;
        let t = l.trim();
        if (j === i && forcedAction) t = t.slice(1);
        actionLines.push({ text: t, line: j });
      }
      i = j - 1;
      tokens.push({ type: 'action', lines: actionLines, line: actionLines[0].line });
    }

    return { title: fields, tokens, notes, titleLineCount: lineCount };
  }

  /**
   * Inline emphasis → array of runs {text, b, i, u}.
   * Supports ***bold italic***, **bold**, *italic*, _underline_ and \* \_ escapes.
   */
  function parseInline(text) {
    const runs = [];
    const st = { b: false, i: false, u: false };
    let buf = '';
    const flush = () => {
      if (buf) runs.push({ text: buf, b: st.b, i: st.i, u: st.u });
      buf = '';
    };
    const hasCloser = (marker, from) => {
      let p = from;
      while ((p = text.indexOf(marker, p)) !== -1) {
        if (text[p - 1] !== '\\') return true;
        p += marker.length;
      }
      return false;
    };

    for (let p = 0; p < text.length; ) {
      const c = text[p];
      if (c === '\\' && (text[p + 1] === '*' || text[p + 1] === '_')) {
        buf += text[p + 1];
        p += 2;
        continue;
      }
      if (c === '*') {
        const n = text.startsWith('***', p) ? 3 : text.startsWith('**', p) ? 2 : 1;
        const marker = '*'.repeat(n);
        const on = n === 3 ? st.b && st.i : n === 2 ? st.b : st.i;
        if (on || hasCloser(marker, p + n)) {
          flush();
          if (n === 3) st.b = st.i = !on;
          else if (n === 2) st.b = !on;
          else st.i = !on;
          p += n;
          continue;
        }
      }
      if (c === '_' && (st.u || hasCloser('_', p + 1))) {
        flush();
        st.u = !st.u;
        p += 1;
        continue;
      }
      buf += c;
      p += 1;
    }
    flush();
    return runs;
  }

  function plainText(text) {
    return parseInline(text).map((r) => r.text).join('');
  }

  /** Map each source line → element type (for editor status + Tab cycling). */
  function lineTypes(src) {
    const res = parse(src);
    const types = [];
    for (let k = 0; k < res.titleLineCount; k++) types[k] = 'title_page';
    const mark = (t) => {
      if (t.type === 'action') t.lines.forEach((l) => (types[l.line] = 'action'));
      else if (t.type === 'dialogue') {
        types[t.line] = 'character';
        t.parts.forEach((p) => (types[p.line] = p.type));
      } else if (t.type === 'dual_dialogue') {
        mark(t.left);
        mark(t.right);
      } else types[t.line] = t.type;
    };
    res.tokens.forEach(mark);
    return types;
  }

  // ---------------------------------------------------------------------------
  // Title page helpers (read / write the Fountain title block)
  // ---------------------------------------------------------------------------
  const TITLE_ORDER = [
    ['title', 'Title'],
    ['credit', 'Credit'],
    ['authors', 'Author'],
    ['source', 'Source'],
    ['draft date', 'Draft date'],
    ['contact', 'Contact'],
    ['copyright', 'Copyright'],
  ];

  function getTitleFields(src) {
    const lines = normalize(src).split('\n');
    const { fields } = parseTitlePage(lines);
    const out = {};
    TITLE_ORDER.forEach(([k]) => (out[k] = fields && fields[k] ? fields[k].join('\n') : ''));
    return out;
  }

  function setTitleFields(src, values) {
    const lines = normalize(src).split('\n');
    const { lineCount } = parseTitlePage(lines);
    let body = lines.slice(lineCount);
    while (body.length && isBlank(body[0])) body.shift();
    const block = [];
    TITLE_ORDER.forEach(([k, label]) => {
      const v = (values[k] || '').trim();
      if (!v) return;
      const parts = v.split('\n').map((s) => s.trim()).filter(Boolean);
      if (parts.length === 1) block.push(`${label}: ${parts[0]}`);
      else {
        block.push(`${label}:`);
        parts.forEach((p) => block.push(`    ${p}`));
      }
    });
    if (!block.length) return body.join('\n');
    return block.join('\n') + '\n\n' + body.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Smart clean-up: turns loosely formatted / pasted scripts into clean Fountain
  // ---------------------------------------------------------------------------
  function cleanup(src) {
    const input = normalize(src).split('\n');
    const { lineCount } = parseTitlePage(input);
    const head = input.slice(0, lineCount);
    const lines = input.slice(lineCount);

    // "NAME: line of dialogue" chat-style scripts
    const chatRe = /^([\p{Lu}][\p{Lu}\p{N} .'\-]{0,30}?)(\s*\([^)]*\))?\s*:\s+(\S.*)$/u;
    const chatCount = lines.filter((l) => {
      const m = chatRe.exec(l.trim());
      return m && !isSceneHeading(l.trim()) && !TITLE_KEY_RE.test(l.trim());
    }).length;

    const out = [];
    const pushBlank = () => {
      if (out.length && out[out.length - 1] !== '') out.push('');
    };
    const terminal = /[.!?:"')\]…-]$/;
    let mode = 'none'; // 'action' | 'dialogue'
    let afterCue = false;

    const nextContent = (i) => {
      for (let k = i + 1; k < lines.length; k++) if (!isBlank(lines[k])) return k;
      return -1;
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const indent = raw.length - raw.trimStart().length;
      let t = raw.trim();

      if (!t) {
        mode = 'none';
        pushBlank();
        continue;
      }
      // PDF artefacts: page numbers, (MORE), CONTINUED markers
      if (/^\d+\.?$/.test(t) || /^\(MORE\)$/i.test(t) || /^\(?CONTINUED:?\)?$/i.test(t) || /^CONTINUED:?\s*\(\d+\)$/i.test(t)) continue;
      // Keep explicit Fountain markup as-is
      if (/^(===|#|=|\[\[|\/\*|!|@|~|\.(?!\.))/.test(t) || (t.startsWith('>') && t.length > 1)) {
        if (/^(#|===)/.test(t)) pushBlank();
        out.push(t);
        mode = 'none';
        continue;
      }

      const sceneM = /^(\d+[A-Z]?[.)]?\s+)?((?:INT|EXT|EST|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E)\b)[.:\-\s]*(.*?)(\s+\d+[A-Z]?\.?)?$/i.exec(t);
      if (sceneM && (isAllCaps(t) || /^(int|ext|est|i\/e)\b/i.test(t))) {
        const prefix = sceneM[2].toUpperCase().replace(/\s+/g, '').replace(/\.?\/\.?/, './').replace(/\.$/, '');
        const rest = sceneM[3].trim().toUpperCase();
        pushBlank();
        out.push((prefix.endsWith('.') ? prefix : prefix + '.') + (rest ? ' ' + rest : ''));
        out.push('');
        mode = 'none';
        continue;
      }

      if (isTransition(t) || (/^(FADE IN:?|FADE OUT\.?)$/i.test(t))) {
        pushBlank();
        out.push(/^fade in/i.test(t) ? 'FADE IN:' : t.toUpperCase());
        out.push('');
        mode = 'none';
        continue;
      }

      if (chatCount >= 2) {
        const m = chatRe.exec(t);
        if (m && !TITLE_KEY_RE.test(t)) {
          pushBlank();
          out.push((m[1] + (m[2] || '')).trim().toUpperCase());
          out.push(m[3].trim());
          mode = 'dialogue';
          afterCue = false;
          continue;
        }
      }

      const nk = nextContent(i);
      const next = nk === -1 ? '' : lines[nk].trim();
      const looksCue =
        isAllCaps(t) &&
        t.length <= 40 &&
        t.replace(/\(.*?\)/g, '').trim().split(/\s+/).length <= 5 &&
        !/[.!?,;:]$/.test(t.replace(/\s*\(.*?\)$/, '')) &&
        nk !== -1 &&
        !isSceneHeading(next) &&
        !(isAllCaps(next) && !next.startsWith('('));
      if (looksCue) {
        pushBlank();
        afterCue = true;
        out.push(t.replace(/\s*\(CONT['’]?D\)/i, '').replace(/\s*\(CONTINUING\)/i, ''));
        mode = 'dialogue';
        // Drop blank lines between a cue and its speech when the speech is clearly indented / a parenthetical
        if (nk > i + 1 && (next.startsWith('(') || lines[nk].length - lines[nk].trimStart().length >= Math.max(6, indent - 12))) {
          i = nk - 1;
        }
        continue;
      }

      if (mode === 'dialogue') {
        const last = out[out.length - 1];
        const first = afterCue;
        afterCue = false;
        if (first) {
          out.push(t);
          continue;
        }
        if (t.startsWith('(') || (last && last.startsWith('(') && !last.endsWith(')'))) {
          if (last && last.startsWith('(') && !last.endsWith(')')) out[out.length - 1] = last + ' ' + t;
          else out.push(t);
          continue;
        }
        if (last && !last.startsWith('(') && (!terminal.test(last) || last.length > 28)) {
          out[out.length - 1] = last + ' ' + t;
        } else out.push(t);
        continue;
      }

      // Action
      if (mode === 'action') {
        const last = out[out.length - 1];
        if (!terminal.test(last) || last.length > 50) {
          out[out.length - 1] = last + ' ' + t;
          continue;
        }
      } else pushBlank();
      // All-caps action lines would be read as cues → force them
      out.push(isAllCaps(t) && nk !== -1 && nk === i + 1 && !isTransition(t) ? '!' + t : t);
      mode = 'action';
    }

    while (out.length && out[out.length - 1] === '') out.pop();
    while (out.length && out[0] === '') out.shift();
    const collapsed = out.filter((l, k) => !(l === '' && out[k - 1] === ''));
    const body = collapsed.join('\n');
    return head.length ? head.join('\n').trimEnd() + '\n\n' + body + '\n' : body + '\n';
  }

  Object.assign(SF, {
    normalize,
    parse,
    parseInline,
    plainText,
    lineTypes,
    cleanup,
    getTitleFields,
    setTitleFields,
    isSceneHeading,
    isCharacterCue,
    isTransition,
    isAllCaps,
  });
})(typeof window !== 'undefined' ? window : globalThis);
