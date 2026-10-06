/*
 * ReelScript — layout & pagination engine
 * Produces page objects in inches. The HTML preview and the PDF writer both
 * render from this single model, so what you see is exactly what you download.
 *
 * Geometry follows US industry convention: Courier 12pt (10 chars/inch,
 * 6 lines/inch), 1.5" left margin, 1" top/bottom, dialogue at 2.5",
 * parentheticals at 3.1", character cues at 3.7", transitions flush to 7.5".
 */
(function (root) {
  'use strict';

  const SF = (root.SF = root.SF || {});

  const LH = 1 / 6; // line height (inches)
  const CW = 0.1; // character width (inches)

  const PAGE_SIZES = {
    letter: { w: 8.5, h: 11, label: 'US Letter' },
    a4: { w: 8.27, h: 11.69, label: 'A4' },
  };

  const EL = {
    scene_heading: { x: 1.5, width: 60 },
    action: { x: 1.5, width: 60 },
    character: { x: 3.7, width: 33 },
    parenthetical: { x: 3.1, width: 25 },
    dialogue: { x: 2.5, width: 35 },
    lyrics: { x: 2.5, width: 35 },
    transition: { right: 7.5, width: 25 },
    centered: { center: 4.5, width: 60 },
  };

  const DUAL = {
    left: { character: { x: 2.4, width: 18 }, parenthetical: { x: 1.8, width: 22 }, dialogue: { x: 1.5, width: 28 }, lyrics: { x: 1.5, width: 28 } },
    right: { character: { x: 5.5, width: 18 }, parenthetical: { x: 4.9, width: 22 }, dialogue: { x: 4.6, width: 28 }, lyrics: { x: 4.6, width: 28 } },
  };

  const DEFAULTS = {
    pageSize: 'letter',
    font: 'courier-prime', // courier-prime | courier
    style: 'reelscript',
    sceneNumbers: 'none', // none | left | right | both
    boldSceneHeadings: true,
    boldCharacterNames: true,
    underlineSceneHeadings: false,
    doubleSpaceSceneHeadings: true,
    autoContd: true,
    titlePage: true,
    watermark: '',
    headerText: '',
    numberScenesAutomatically: false,
    episodeNewPage: true,
    restartSceneNumbers: true,
  };

  // Formatting styles of popular screenwriting apps (their default output).
  // Bold scene headings / bold character names are NOT part of a style: every app below
  // treats bold as the writer's own choice, so those two settings are never changed here.
  const STYLE_PRESETS = {
    reelscript: { label: 'ReelScript', app: 'ReelScript', hint: 'Courier Prime, 2 blank lines before scene headings', font: 'courier-prime', doubleSpaceSceneHeadings: true, underlineSceneHeadings: false, autoContd: true },
    finaldraft: { label: 'Final Draft', app: 'Final Draft 13', hint: 'Courier, plain caps sluglines, 2 blank lines before scene headings, (MORE)/(CONT’D)', font: 'courier', doubleSpaceSceneHeadings: true, underlineSceneHeadings: false, autoContd: true },
    writerduet: { label: 'WriterDuet', app: 'WriterDuet', hint: 'Courier Prime, standard industry layout', font: 'courier-prime', doubleSpaceSceneHeadings: true, underlineSceneHeadings: false, autoContd: true },
    fadein: { label: 'Fade In', app: 'Fade In Pro', hint: 'Courier, standard industry layout', font: 'courier', doubleSpaceSceneHeadings: true, underlineSceneHeadings: false, autoContd: true },
    highland: { label: 'Highland 2', app: 'Highland 2', hint: 'Courier Prime, single blank line before scene headings', font: 'courier-prime', doubleSpaceSceneHeadings: false, underlineSceneHeadings: false, autoContd: true },
    arcstudio: { label: 'Arc Studio Pro', app: 'Arc Studio Pro', hint: 'Courier Prime, standard industry layout', font: 'courier-prime', doubleSpaceSceneHeadings: true, underlineSceneHeadings: false, autoContd: true },
    celtx: { label: 'Celtx', app: 'Celtx', hint: 'Courier, single blank line before scene headings', font: 'courier', doubleSpaceSceneHeadings: false, underlineSceneHeadings: false, autoContd: true },
    moviemagic: { label: 'Movie Magic Screenwriter', app: 'Movie Magic Screenwriter 6', hint: 'Courier, standard industry layout', font: 'courier', doubleSpaceSceneHeadings: true, underlineSceneHeadings: false, autoContd: true },
    studiobinder: { label: 'StudioBinder', app: 'StudioBinder', hint: 'Courier, plain sluglines, standard layout', font: 'courier', doubleSpaceSceneHeadings: false, underlineSceneHeadings: false, autoContd: true },
    kitscenarist: { label: 'KIT Scenarist', app: 'KIT Scenarist', hint: 'Courier Prime, standard layout', font: 'courier-prime', doubleSpaceSceneHeadings: true, underlineSceneHeadings: false, autoContd: true },
    trelby: { label: 'Trelby', app: 'Trelby', hint: 'Courier, single blank line before scene headings', font: 'courier', doubleSpaceSceneHeadings: false, underlineSceneHeadings: false, autoContd: true },
    beat: { label: 'Beat', app: 'Beat (Fountain)', hint: 'Courier Prime, Fountain-style layout', font: 'courier-prime', doubleSpaceSceneHeadings: true, underlineSceneHeadings: false, autoContd: true },
    bbc: { label: 'BBC / UK (A4)', app: 'BBC Writersroom', hint: 'A4 paper, underlined sluglines, Courier', font: 'courier', doubleSpaceSceneHeadings: true, underlineSceneHeadings: true, autoContd: true, pageSize: 'a4' },
  };
  // Settings a style controls (bold is deliberately not one of them)
  const PRESET_KEYS = ['font', 'underlineSceneHeadings', 'doubleSpaceSceneHeadings', 'autoContd'];

  /** Which style is in use? Uses the chosen style if the settings still match it, else 'custom'. */
  function detectStyle(settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const matches = (k) => PRESET_KEYS.every((p) => STYLE_PRESETS[k][p] === s[p]) && (!STYLE_PRESETS[k].pageSize || STYLE_PRESETS[k].pageSize === s.pageSize);
    if (s.style && STYLE_PRESETS[s.style] && matches(s.style)) return s.style;
    if (s.style && s.style !== 'custom') return 'custom';
    return Object.keys(STYLE_PRESETS).find(matches) || 'custom';
  }

  function applyStyle(settings, key) {
    const p = STYLE_PRESETS[key];
    if (!p) return settings;
    PRESET_KEYS.forEach((k) => (settings[k] = p[k]));
    if (p.pageSize) {
      // remember the writer's paper so leaving this style (e.g. BBC → A4) puts it back
      if (!settings.paperBeforeStyle) settings.paperBeforeStyle = settings.pageSize || 'letter';
      settings.pageSize = p.pageSize;
    } else if (settings.paperBeforeStyle) {
      settings.pageSize = settings.paperBeforeStyle;
      delete settings.paperBeforeStyle;
    }
    settings.style = key;
    return settings;
  }

  // --------------------------------------------------------------------------
  // Text → styled chars → wrapped lines → runs
  // --------------------------------------------------------------------------
  function toChars(text, extra) {
    const chars = [];
    SF.parseInline(text).forEach((r) => {
      for (const ch of r.text) chars.push({ ch, b: r.b || !!(extra && extra.b), i: r.i || !!(extra && extra.i), u: r.u || !!(extra && extra.u) });
    });
    return chars;
  }

  function toRuns(chars) {
    const runs = [];
    chars.forEach((c) => {
      const last = runs[runs.length - 1];
      if (last && last.b === c.b && last.i === c.i && last.u === c.u) last.text += c.ch;
      else runs.push({ text: c.ch, b: c.b, i: c.i, u: c.u });
    });
    return runs;
  }

  /** Greedy word-wrap on a styled char array. */
  function wrapChars(chars, width) {
    const lines = [];
    let start = 0;
    while (start < chars.length) {
      // skip leading spaces on continuation lines
      if (lines.length) while (start < chars.length && chars[start].ch === ' ') start++;
      if (start >= chars.length) break;
      if (chars.length - start <= width) {
        lines.push(chars.slice(start));
        break;
      }
      let brk = -1;
      for (let k = start + width; k > start; k--) {
        if (chars[k].ch === ' ') {
          brk = k;
          break;
        }
      }
      if (brk === -1) {
        // no space: break after a hyphen / dash if possible, else hard break
        for (let k = start + width - 1; k > start; k--) {
          if (chars[k].ch === '-') {
            brk = k + 1;
            break;
          }
        }
      }
      if (brk === -1) brk = start + width;
      let end = brk;
      while (end > start && chars[end - 1].ch === ' ') end--;
      lines.push(chars.slice(start, end));
      start = brk;
    }
    if (!lines.length) lines.push([]);
    return lines;
  }

  function wrapText(text, width, extra) {
    return wrapChars(toChars(text, extra), width).map(toRuns);
  }

  const runsLength = (runs) => runs.reduce((n, r) => n + [...r.text].length, 0);

  function seg(x, runs) {
    return { x, runs };
  }

  function placeX(spec, runs) {
    const len = runsLength(runs);
    if (spec.right != null) return spec.right - len * CW;
    if (spec.center != null) return spec.center - (len * CW) / 2;
    return spec.x;
  }

  // --------------------------------------------------------------------------
  // Tokens → blocks of lines
  // --------------------------------------------------------------------------
  function upper(s) {
    // Uppercase but keep inline markers intact
    return s.toUpperCase();
  }

  const CONTD = " (CONT'D)";
  const baseName = (n) => SF.plainText(n).replace(/\(.*?\)/g, '').replace(/\^/g, '').trim().toUpperCase();

  function dialogueLines(block, geo, name, opts) {
    const lines = [];
    const cue = wrapText(block.forced ? name : upper(name), geo.character.width, opts && opts.boldCharacterNames ? { b: true } : null);
    cue.forEach((runs) => lines.push({ kind: 'character', segs: [seg(geo.character.x, runs)], src: block.line }));
    block.parts.forEach((p) => {
      const g = geo[p.type];
      const wrapped = p.text === '' ? [[]] : wrapText(p.text, g.width, p.type === 'lyrics' ? { i: true } : null);
      wrapped.forEach((runs, k) => {
        const x = p.type === 'parenthetical' && k > 0 ? g.x + CW : g.x;
        lines.push({ kind: p.type, segs: [seg(x, runs)], src: p.line });
      });
    });
    return lines;
  }

  function buildBlocks(parsed, opts) {
    const blocks = [];
    let lastSpeaker = null;
    let sceneCounter = 0;
    let episode = null;

    const speakerName = (d) => {
      let name = d.character;
      const b = baseName(name);
      if (opts.autoContd && lastSpeaker && b === lastSpeaker && !/CONT['’]?D/i.test(name)) name += CONTD;
      lastSpeaker = b;
      return name;
    };

    parsed.tokens.forEach((t) => {
      switch (t.type) {
        case 'episode': {
          lastSpeaker = null;
          if (opts.restartSceneNumbers) sceneCounter = 0;
          episode = SF.plainText(t.text).toUpperCase();
          if (opts.episodeNewPage) blocks.push({ kind: 'page_break', lines: [] });
          const lines = wrapText(upper(t.text), EL.centered.width, { b: true, u: true }).map((runs) => ({ kind: 'episode', segs: [seg(placeX(EL.centered, runs), runs)], src: t.line }));
          blocks.push({ kind: 'episode', lines, spaceBefore: 2, keepWithNext: true, episode });
          break;
        }
        case 'scene_heading': {
          lastSpeaker = null;
          sceneCounter++;
          const number = t.number || (opts.numberScenesAutomatically ? String(sceneCounter) : null);
          const style = { b: opts.boldSceneHeadings, u: opts.underlineSceneHeadings };
          const wrapped = wrapText(upper(t.text), EL.scene_heading.width, style);
          const lines = wrapped.map((runs, k) => {
            const segs = [seg(EL.scene_heading.x, runs)];
            if (k === 0 && number && opts.sceneNumbers !== 'none') {
              const nr = [{ text: number, b: false, i: false, u: false }];
              if (opts.sceneNumbers === 'left' || opts.sceneNumbers === 'both') segs.push(seg(1.25 - number.length * CW, nr));
              if (opts.sceneNumbers === 'right' || opts.sceneNumbers === 'both') segs.push(seg(7.75, nr));
            }
            return { kind: 'scene_heading', segs, src: t.line };
          });
          blocks.push({ kind: 'scene_heading', lines, spaceBefore: opts.doubleSpaceSceneHeadings ? 2 : 1, keepWithNext: true, scene: { text: SF.plainText(t.text).toUpperCase(), number, episode } });
          break;
        }
        case 'action': {
          const lines = [];
          t.lines.forEach((l) => {
            wrapText(l.text, EL.action.width).forEach((runs) => lines.push({ kind: 'action', segs: [seg(EL.action.x, runs)], src: l.line }));
          });
          blocks.push({ kind: 'action', lines, spaceBefore: 1, splittable: true });
          break;
        }
        case 'dialogue': {
          const name = speakerName(t);
          blocks.push({ kind: 'dialogue', lines: dialogueLines(t, EL, name, opts), spaceBefore: 1, splittable: true, character: baseName(t.character) });
          break;
        }
        case 'dual_dialogue': {
          lastSpeaker = null;
          const L = dialogueLines(t.left, DUAL.left, t.left.character, opts);
          const R = dialogueLines(t.right, DUAL.right, t.right.character, opts);
          const n = Math.max(L.length, R.length);
          const lines = [];
          for (let k = 0; k < n; k++) {
            const segs = [...(L[k] ? L[k].segs : []), ...(R[k] ? R[k].segs : [])];
            lines.push({ kind: 'dual', segs, src: (L[k] || R[k]).src });
          }
          blocks.push({ kind: 'dual_dialogue', lines, spaceBefore: 1, characters: [baseName(t.left.character), baseName(t.right.character)] });
          break;
        }
        case 'transition': {
          lastSpeaker = null;
          const lines = wrapText(upper(t.text), EL.transition.width).map((runs) => ({ kind: 'transition', segs: [seg(placeX(EL.transition, runs), runs)], src: t.line }));
          blocks.push({ kind: 'transition', lines, spaceBefore: 1 });
          break;
        }
        case 'centered': {
          const lines = wrapText(t.text, EL.centered.width).map((runs) => ({ kind: 'centered', segs: [seg(placeX(EL.centered, runs), runs)], src: t.line }));
          blocks.push({ kind: 'centered', lines, spaceBefore: t.continued ? 0 : 1 });
          break;
        }
        case 'lyrics': {
          const lines = wrapText(t.text, EL.lyrics.width, { i: true }).map((runs) => ({ kind: 'lyrics', segs: [seg(EL.lyrics.x, runs)], src: t.line }));
          blocks.push({ kind: 'lyrics', lines, spaceBefore: 1 });
          break;
        }
        case 'page_break':
          blocks.push({ kind: 'page_break', lines: [] });
          break;
        default:
          break; // sections, synopses: not printed
      }
    });
    return blocks;
  }

  // --------------------------------------------------------------------------
  // Pagination
  // --------------------------------------------------------------------------
  const SENTENCE_END = /[.!?…]["'”’)\]]*$|--$|—$/;
  const lineText = (l) => l.segs.map((s) => s.runs.map((r) => r.text).join('')).join(' ').trim();

  function minLines(b) {
    if (!b) return 0;
    if (b.kind === 'action') return Math.min(2, b.lines.length);
    if (b.kind === 'dialogue') {
      const first = b.lines.findIndex((l) => l.kind === 'dialogue' || l.kind === 'lyrics');
      return first === -1 ? b.lines.length : Math.min(b.lines.length, first + 1);
    }
    return b.lines.length;
  }

  function splitAction(b, avail) {
    const n = b.lines.length;
    if (avail < 2 || n < 4) return null;
    const max = Math.min(avail, n - 2);
    let k = -1;
    for (let c = max; c >= 2; c--) {
      if (SENTENCE_END.test(lineText(b.lines[c - 1]))) {
        k = c;
        break;
      }
    }
    if (k === -1) k = max;
    return [
      { ...b, lines: b.lines.slice(0, k) },
      { ...b, lines: b.lines.slice(k), spaceBefore: 0 },
    ];
  }

  function splitDialogue(b, avail, force) {
    const n = b.lines.length;
    const cueCount = b.lines.findIndex((l) => l.kind !== 'character');
    if (cueCount <= 0) return null;
    // head = cue + ≥1 speech line + (MORE); tail = cue (CONT'D) + ≥1 speech line
    const max = Math.min(avail - 1, n - 1);
    const min = cueCount + 1;
    if (max < min) return null;
    let k = -1;
    const isSpeech = (l) => l.kind === 'dialogue' || l.kind === 'lyrics';
    for (let c = max; c >= min; c--) {
      const last = b.lines[c - 1];
      if (isSpeech(last) && b.lines[c].kind !== 'character' && SENTENCE_END.test(lineText(last))) {
        k = c;
        break;
      }
    }
    if (k === -1) {
      if (!force && max - min < 0) return null;
      // fall back to any speech-line boundary (avoid ending on a parenthetical)
      for (let c = max; c >= min; c--) {
        if (b.lines[c - 1].kind !== 'parenthetical') {
          k = c;
          break;
        }
      }
      if (k === -1) k = max;
    }
    const cue = b.lines[0];
    const cueX = cue.segs[0].x;
    const more = { kind: 'more', segs: [seg(cueX, [{ text: '(MORE)', b: false, i: false, u: false }])], src: b.lines[k - 1].src };
    const cueText = cue.segs[0].runs.map((r) => r.text).join('');
    const contdRuns = /CONT['’]?D/i.test(cueText) ? cue.segs[0].runs : [...cue.segs[0].runs, { text: CONTD, b: !!(cue.segs[0].runs[0] && cue.segs[0].runs[0].b), i: false, u: false }];
    const contCue = { kind: 'character', segs: [seg(cueX, contdRuns)], src: cue.src };
    return [
      { ...b, lines: [...b.lines.slice(0, k), more] },
      { ...b, lines: [contCue, ...b.lines.slice(k)], spaceBefore: 0 },
    ];
  }

  function paginate(blocks, linesPerPage) {
    const pages = [];
    let cur = [];
    let curScenes = [];
    const queue = blocks.slice();
    const newPage = () => {
      pages.push({ lines: cur, scenes: curScenes });
      cur = [];
      curScenes = [];
    };
    const place = (b, space) => {
      for (let s = 0; s < space; s++) cur.push(null);
      b.lines.forEach((l) => cur.push(l));
      if (b.scene) curScenes.push(b.scene);
      if (b.episode) curScenes.push({ episodeMarker: b.episode });
    };

    let guard = 0;
    for (let bi = 0; bi < queue.length; bi++) {
      if (++guard > 200000) break; // safety net — should never trigger
      const b = queue[bi];
      if (b.kind === 'page_break') {
        if (cur.length) newPage();
        continue;
      }
      if (!b.lines.length) continue;
      const top = cur.length === 0;
      const space = top ? 0 : b.spaceBefore || 0;
      const avail = linesPerPage - cur.length - space;

      let extra = 0;
      if (b.keepWithNext) {
        const nb = queue[bi + 1];
        if (nb && nb.kind !== 'page_break') extra = (nb.spaceBefore || 0) + minLines(nb);
      }

      if (b.lines.length + extra <= avail) {
        place(b, space);
        continue;
      }
      if (b.lines.length <= avail && extra > 0) {
        if (!top) {
          newPage();
          bi--;
        } else place(b, space);
        continue;
      }

      let parts = null;
      if (b.kind === 'action') parts = splitAction(b, avail);
      else if (b.kind === 'dialogue') parts = splitDialogue(b, avail, false);

      if (parts) {
        place(parts[0], space);
        newPage();
        queue.splice(bi + 1, 0, parts[1]);
        continue;
      }
      if (!top) {
        newPage();
        bi--;
        continue;
      }
      // Block taller than a whole page and unsplittable by the rules: hard cut.
      const hard = b.kind === 'dialogue' ? splitDialogue(b, avail, true) : [{ ...b, lines: b.lines.slice(0, avail) }, { ...b, lines: b.lines.slice(avail), spaceBefore: 0 }];
      if (!hard) {
        place(b, 0);
        newPage();
        continue;
      }
      place(hard[0], 0);
      newPage();
      queue.splice(bi + 1, 0, hard[1]);
    }
    if (cur.length || !pages.length) newPage();
    return pages;
  }

  // --------------------------------------------------------------------------
  // Title page
  // --------------------------------------------------------------------------
  function titlePage(fields, size) {
    if (!fields) return null;
    const get = (k) => (fields[k] || []).filter((s) => s.trim() !== '');
    const items = [];
    const center = size.w / 2;
    const centered = (text, y, extra) => {
      const runs = toRuns(toChars(text, extra));
      items.push({ y, segs: [seg(center - (runsLength(runs) * CW) / 2, runs)] });
    };

    let y = 3.5;
    const title = get('title');
    if (!title.length && !get('authors').length) return null;
    title.forEach((t) => {
      centered(t.toUpperCase(), y);
      y += LH;
    });
    const authors = get('authors');
    const credit = get('credit');
    if (credit.length || authors.length) {
      y += LH * 3;
      (credit.length ? credit : ['Written by']).forEach((t) => {
        centered(t, y);
        y += LH;
      });
      y += LH;
      authors.forEach((t) => {
        centered(t, y);
        y += LH;
      });
    }
    const source = get('source');
    if (source.length) {
      y += LH * 3;
      source.forEach((t) => {
        centered(t, y);
        y += LH;
      });
    }

    const bottom = size.h - 1 - LH;
    const contact = [...get('contact'), ...get('copyright')];
    contact.forEach((t, k) => {
      items.push({ y: bottom - (contact.length - 1 - k) * LH, segs: [seg(1.5, toRuns(toChars(t)))] });
    });
    const date = [...get('draft date'), ...get('revision'), ...get('notes')];
    date.forEach((t, k) => {
      const runs = toRuns(toChars(t));
      items.push({ y: bottom - (date.length - 1 - k) * LH, segs: [seg(7.5 - runsLength(runs) * CW, runs)] });
    });
    return { items, isTitle: true, number: null };
  }

  // --------------------------------------------------------------------------
  // Public: layout(text, options) → document model
  // --------------------------------------------------------------------------
  function layout(src, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const size = PAGE_SIZES[opts.pageSize] || PAGE_SIZES.letter;
    const linesPerPage = Math.floor((size.h - 2) / LH + 1e-6);
    const parsed = SF.parse(src);
    const blocks = buildBlocks(parsed, opts);
    const raw = paginate(blocks, linesPerPage);

    const pages = raw.map((p, idx) => {
      const items = [];
      p.lines.forEach((l, k) => {
        if (l) items.push({ y: 1 + k * LH, segs: l.segs, kind: l.kind, src: l.src });
      });
      const number = idx + 1;
      if (number > 1 || opts.headerText) {
        const label = number > 1 ? `${number}.` : '';
        const header = [opts.headerText, label].filter(Boolean).join('   ');
        const runs = [{ text: header, b: false, i: false, u: false }];
        items.push({ y: 0.5, segs: [seg(7.5 - runsLength(runs) * CW, runs)], kind: 'header' });
      }
      return { items, number, scenes: p.scenes };
    });

    const tp = opts.titlePage ? titlePage(parsed.title, size) : null;

    // Stats for the outline / status bar
    const scenes = [];
    const episodes = [];
    const characters = new Map();
    let words = 0;
    pages.forEach((p) =>
      p.scenes.forEach((s) => {
        if (s.episodeMarker) episodes.push({ text: s.episodeMarker, page: p.number, scenes: 0 });
        else {
          scenes.push({ ...s, page: p.number });
          if (episodes.length) episodes[episodes.length - 1].scenes++;
        }
      })
    );
    pages.forEach((p) => (p.scenes = p.scenes.filter((s) => !s.episodeMarker)));
    const countWords = (s) => (s.match(/\S+/g) || []).length;
    const addChar = (name) => characters.set(name, (characters.get(name) || 0) + 1);
    const sceneLines = [];
    const episodeLines = [];
    parsed.tokens.forEach((t) => {
      if (t.type === 'scene_heading') sceneLines.push(t.line);
      if (t.type === 'episode') episodeLines.push(t.line);
      if (t.type === 'action') t.lines.forEach((l) => (words += countWords(SF.plainText(l.text))));
      if (t.type === 'dialogue' || t.type === 'dual_dialogue') {
        (t.type === 'dialogue' ? [t] : [t.left, t.right]).forEach((d) => {
          addChar(baseName(d.character));
          d.parts.forEach((pp) => (words += countWords(SF.plainText(pp.text))));
        });
      }
    });
    scenes.forEach((s, k) => (s.line = sceneLines[k]));
    episodes.forEach((e, k) => (e.line = episodeLines[k]));

    return {
      size,
      options: opts,
      titlePage: tp,
      pages,
      linesPerPage,
      stats: {
        pages: pages.length,
        scenes,
        episodes,
        characters: [...characters.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
        words,
        runtimeMinutes: Math.max(1, Math.round(pages.length)),
      },
      parsed,
    };
  }

  Object.assign(SF, { STYLE_PRESETS, PRESET_KEYS, detectStyle, applyStyle, layout, PAGE_SIZES, LAYOUT_DEFAULTS: DEFAULTS, LINE_HEIGHT: LH, CHAR_WIDTH: CW, wrapText });
})(typeof window !== 'undefined' ? window : globalThis);
