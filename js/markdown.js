/*
 * ReelScript — ChatGPT / Markdown script converter
 * AI assistants format screenplays as Markdown: "## EPISODE 01 — TITLE",
 * "### EXT. PLACE – NIGHT", "**KARTHIK**", "**CUT TO BLACK.**", "---" rules,
 * plus their own commentary ("Dramatic movement:", intros, summaries).
 * This turns that into clean Fountain with a title page, and sets the
 * commentary aside (dropped, or kept as hidden [[notes]]).
 */
(function (root) {
  'use strict';

  const SF = (root.SF = root.SF || {});

  const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RULE = /^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/;
  const LABEL = /^\*\*([^*]{1,40}?):?\*\*:?\s*(.*)$/;
  const NOTE_LABELS = /^(dramatic movement|emotional high|emotional beat|hook|cliffhanger|runtime|duration|timing|target runtime|beat|purpose|note|notes|director'?s note|writer'?s note|logline|summary|synopsis|theme|goal|objective|tone|mood|pacing|music|score note|visual note|why it works|takeaway)$/i;
  const TITLE_NOTE_LABELS = /^(format|genre|runtime|episodes|language|draft|version|duration|based on|logline)$/i;
  const TRANSITION_START = /^(FADE OUT|FADE TO BLACK|FADE TO WHITE|FADE TO|CUT TO BLACK|SMASH CUT|MATCH CUT|JUMP CUT|DISSOLVE TO|CUT TO|INTERCUT|BACK TO)\b/i;
  const THE_END = /^(THE END|END OF (SERIES|SEASON|EPISODE|FILM|SHOW|PART \w+)|END CREDITS)\.?$/i;

  const stripCitations = (s) => s.replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, '').replace(/【[^】]*】/g, '');
  const unwrap = (s) => {
    let t = s.trim();
    for (let k = 0; k < 2; k++) {
      const m = /^(\*\*|__)(?!\s)([\s\S]*?\S)\1$/.exec(t);
      if (m && !m[2].includes(m[1])) t = m[2].trim();
      const it = /^(\*|_)(?![\s*_])([\s\S]*?[^\s*_])\1$/.exec(t);
      if (it && !it[2].includes(it[1])) t = it[2].trim();
    }
    return t;
  };
  const wholeBold = (s) => /^(\*\*|__)(?!\s)[\s\S]*?\S\1$/.test(s.trim()) && (s.match(/\*\*|__/g) || []).length === 2;
  const wholeItalic = (s) => /^(\*|_)(?![\s*_])[\s\S]*[^\s*_]\1$/.test(s.trim()) && !/^(\*\*|__)/.test(s.trim());
  const caps = (s) => SF.isAllCaps(s);

  /** Does this text look like Markdown (e.g. pasted from ChatGPT) rather than Fountain? */
  function looksMarkdown(text) {
    const lines = SF.normalize(text).split('\n').map((l) => l.trim());
    const boldOnly = lines.filter((l) => wholeBold(l) && l.length < 60).length;
    const mdScene = lines.filter((l) => {
      const h = HEADING.exec(l);
      return h && (SF.isSceneHeading(unwrap(h[2])) || SF.isEpisode(unwrap(h[2])));
    }).length;
    const rules = lines.filter((l) => /^-{3,}$/.test(l)).length;
    const labels = lines.filter((l) => LABEL.test(l)).length;
    return mdScene >= 1 || boldOnly >= 3 || (rules >= 1 && (boldOnly >= 1 || labels >= 2));
  }

  function cueFrom(text) {
    // "KARTHIK — O.S." / "KARTHIK - TEXT" / "MADHAVI (V.O.)"
    const m = /^(.*?\S)\s+[—–-]{1,2}\s+(.+)$/.exec(text);
    if (m && caps(m[1]) && caps(m[2]) && m[2].length <= 20) return `${m[1].trim()} (${m[2].trim().replace(/^\(|\)$/g, '')})`;
    return text;
  }

  /**
   * Convert Markdown/ChatGPT screenplay text to Fountain.
   * @param {string} src
   * @param {{keepNotes?: boolean}} [opts]
   * @returns {{text: string, notes: number, episodes: number, scenes: number}}
   */
  function fromMarkdown(src, opts) {
    const keepNotes = !!(opts && opts.keepNotes);
    const lines = SF.normalize(src)
      .split('\n')
      .map((l) => stripCitations(l.replace(/[ \t]+$/, '').replace(/ /g, ' ')));
    const out = [];
    const title = { title: [], credit: [], authors: [], source: [], notes: [] };
    let phase = 'pre'; // pre → script → post
    let notes = 0;
    let episodes = 0;
    let scenes = 0;
    let inCue = false;

    const blank = () => {
      if (out.length && out[out.length - 1] !== '') out.push('');
    };
    const note = (t) => {
      const s = t.trim();
      if (!s) return;
      notes++;
      if (keepNotes) {
        blank();
        out.push(`[[${s.replace(/\]\]/g, '] ]')}]]`);
        blank();
      }
    };
    const nextNonBlankIsAdjacent = (i) => i + 1 < lines.length && lines[i + 1].trim() !== '';

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trim();

      if (!t || RULE.test(t)) {
        inCue = false;
        if (phase === 'script') blank();
        continue;
      }

      // ---- Headings -------------------------------------------------------
      const h = HEADING.exec(t);
      if (h) {
        inCue = false;
        const level = h[1].length;
        const txt = unwrap(h[2]).replace(/^\d+\.\s+(?=(INT|EXT|EST|I\/E)\b)/i, '');
        if (SF.isEpisode(txt) && !SF.isSceneHeading(txt)) {
          phase = 'script';
          episodes++;
          blank();
          out.push(txt);
          blank();
          continue;
        }
        if (SF.isSceneHeading(txt)) {
          phase = 'script';
          scenes++;
          blank();
          out.push(txt.toUpperCase());
          blank();
          continue;
        }
        if (phase === 'pre') {
          if (level === 1 && !title.title.length) title.title.push(txt);
          else if (!title.title.length) title.title.push(txt);
          else if (!title.source.length && level <= 3 && txt.length <= 80) title.source.push(txt);
          else note(txt);
          continue;
        }
        if (phase === 'script') {
          const up = txt.toUpperCase();
          if (/^(FADE|CUT TO|SMASH CUT|MATCH CUT|JUMP CUT|DISSOLVE)/i.test(txt) && caps(txt)) {
            blank();
            out.push(SF.isTransition(up) ? up : '> ' + up);
            blank();
          } else if (caps(txt) && txt.length <= 70) {
            // Slugs such as "MOMENTS LATER", "CLOSE ON PHONE", "INTERCUT — NEXT DAY"
            blank();
            out.push('.' + up);
            blank();
          } else {
            phase = 'post'; // e.g. "## What this episodic version protects"
            note(txt);
          }
          continue;
        }
        note(txt);
        continue;
      }

      // ---- Before the script starts: title page + commentary ----------------
      if (phase === 'pre') {
        const plain = unwrap(t);
        const by = /^(?:written|screenplay|story|teleplay|created)\s+by[:\s]+(.+)$/i.exec(plain);
        if (by) {
          title.credit.push(plain.slice(0, plain.length - by[1].length).replace(/[:\s]+$/, ''));
          title.authors.push(unwrap(by[1]).trim());
          continue;
        }
        const lm = LABEL.exec(t);
        if (lm && TITLE_NOTE_LABELS.test(lm[1].trim()) && lm[2].trim()) {
          title.notes.push(`${lm[1].trim()}: ${unwrap(lm[2])}`);
          continue;
        }
        if (SF.isSceneHeading(plain) && caps(plain)) {
          phase = 'script';
          i--;
          continue;
        }
        if (SF.isEpisode(plain) && !wholeItalic(t)) {
          phase = 'script';
          i--;
          continue;
        }
        note(t);
        continue;
      }

      if (phase === 'post') {
        const plain = unwrap(t);
        if (SF.isEpisode(plain) && caps(plain)) {
          phase = 'script';
          i--;
          continue;
        }
        note(t);
        continue;
      }

      // ---- Script body ------------------------------------------------------
      const lm = LABEL.exec(t);
      if (lm && NOTE_LABELS.test(lm[1].trim())) {
        note(t);
        continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(raw) && !inCue) {
        note(t); // bullet lists are commentary, not script
        continue;
      }
      if (wholeItalic(t) && !inCue && /[a-z]/.test(t) && /\s/.test(unwrap(t)) && !nextNonBlankIsAdjacent(i) && /\.\s*\*?$|\.\*$/.test(t) && unwrap(t).split(/\s+/).length > 6) {
        note(t); // italic production commentary
        continue;
      }

      if (wholeBold(t)) {
        const u = unwrap(t);
        const cue = cueFrom(u);
        if (caps(u) && nextNonBlankIsAdjacent(i) && !SF.isSceneHeading(u) && !TRANSITION_START.test(u) && u.length <= 50 && !/[.!?:]$/.test(cue.replace(/\s*\([^)]*\)$/, ''))) {
          blank();
          out.push(cue);
          inCue = true;
          continue;
        }
        if (THE_END.test(u)) {
          blank();
          out.push(`> ${u.toUpperCase()} <`);
          blank();
          continue;
        }
        if (/^FADE IN:?$/i.test(u)) {
          blank();
          out.push('FADE IN:');
          blank();
          continue;
        }
        if (TRANSITION_START.test(u) && caps(u)) {
          blank();
          out.push(SF.isTransition(u) ? u : '> ' + u);
          blank();
          continue;
        }
        if (SF.isSceneHeading(u) && caps(u)) {
          blank();
          scenes++;
          out.push(u);
          blank();
          continue;
        }
        if (SF.isEpisode(u)) {
          blank();
          episodes++;
          out.push(u);
          blank();
          continue;
        }
        if (caps(u)) {
          blank();
          out.push('!' + u);
          continue;
        }
        out.push(t);
        continue;
      }

      if (inCue) {
        out.push(t);
        continue;
      }
      // Un-bolded cue: short ALL-CAPS line with speech directly under it
      if (caps(t) && nextNonBlankIsAdjacent(i) && t.length <= 50 && !SF.isSceneHeading(t) && !TRANSITION_START.test(t) && !/[.!?:]$/.test(cueFrom(t).replace(/\s*\([^)]*\)$/, '')) && !/^[!.>@#~=]/.test(t)) {
        blank();
        out.push(cueFrom(t));
        inCue = true;
        continue;
      }
      // Plain script lines (action, inline-formatted lines)
      const first = out[out.length - 1];
      if (first !== undefined && first !== '' && !/^[!.>@]/.test(t)) blank();
      out.push(SF.isSceneHeading(t) && caps(t) ? (scenes++, t) : t);
    }

    while (out.length && out[out.length - 1] === '') out.pop();
    const body = out.filter((l, k) => !(l === '' && out[k - 1] === '')).join('\n').replace(/^\n+/, '');

    const fields = {
      title: title.title.join('\n'),
      credit: title.credit[0] || (title.authors.length ? 'Written by' : ''),
      authors: title.authors.join('\n'),
      source: title.source.join('\n'),
      notes: title.notes.join('\n'),
    };
    const head = SF.setTitleFields('', fields).trim();
    return { text: (head ? head + '\n\n' : '') + body + '\n', notes, episodes, scenes };
  }

  /** Pasted/imported text → Fountain, with a human-readable summary of what happened. */
  function convertPasted(text, opts) {
    if (looksMarkdown(text)) {
      const r = fromMarkdown(text, opts);
      const toks = SF.parse(r.text).tokens;
      r.episodes = toks.filter((t) => t.type === 'episode').length;
      r.scenes = toks.filter((t) => t.type === 'scene_heading').length;
      const bits = [];
      if (r.episodes) bits.push(`${r.episodes} episode${r.episodes === 1 ? '' : 's'}`);
      if (r.scenes) bits.push(`${r.scenes} scene${r.scenes === 1 ? '' : 's'}`);
      let info = `Converted ChatGPT formatting${bits.length ? ` — ${bits.join(', ')}` : ''}`;
      if (r.notes) info += opts && opts.keepNotes ? ` · ${r.notes} commentary lines kept as hidden notes` : ` · ${r.notes} commentary lines left out`;
      return { text: r.text, info, markdown: true, notes: r.notes };
    }
    return { text: SF.cleanup(text), info: null, markdown: false, notes: 0 };
  }

  Object.assign(SF, { looksMarkdown, fromMarkdown, convertPasted });
})(typeof window !== 'undefined' ? window : globalThis);
