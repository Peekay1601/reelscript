/*
 * ReelScript — importers
 *  - Highland 2 (.highland: zipped TextBundle with text.fountain / .markdown / .txt)
 *  - Celtx (.celtx: zip with script-*.html — classic desktop Celtx)
 *  - PDF (any screenplay PDF: Celtx, Final Draft, Highland, WriterDuet… via pdf.js)
 *  - Final Draft (.fdx), Fountain / text / Markdown
 */
(function (root) {
  'use strict';

  const SF = (root.SF = root.SF || {});

  // ---------------------------------------------------------------------------
  // Minimal ZIP reader (stored + deflate via DecompressionStream)
  // ---------------------------------------------------------------------------
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open zipped files. Please update it.');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** @returns {Promise<Map<string, Uint8Array>>} */
  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('This file is not a valid zip archive.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (name.endsWith('/')) continue;
      const lnlen = dv.getUint16(local + 26, true);
      const lelen = dv.getUint16(local + 28, true);
      const start = local + 30 + lnlen + lelen;
      const data = bytes.subarray(start, start + csize);
      if (method === 0) files.set(name, data);
      else if (method === 8) files.set(name, await inflateRaw(data));
    }
    return files;
  }

  const text = (u8) => new TextDecoder('utf-8').decode(u8).replace(/^﻿/, '');

  // ---------------------------------------------------------------------------
  // Highland 2
  // ---------------------------------------------------------------------------
  async function fromHighland(buffer) {
    const files = await unzip(buffer);
    const names = [...files.keys()];
    const pick =
      names.find((n) => /(^|\/)text\.fountain$/i.test(n)) ||
      names.find((n) => /\.fountain$/i.test(n)) ||
      names.find((n) => /(^|\/)text\.(markdown|md)$/i.test(n)) ||
      names.find((n) => /(^|\/)text\.txt$/i.test(n)) ||
      names.find((n) => /\.(txt|md|markdown)$/i.test(n));
    if (!pick) throw new Error('No script text found inside this .highland file.');
    return text(files.get(pick));
  }

  // ---------------------------------------------------------------------------
  // Celtx (classic desktop .celtx — zip with script-XXXX.html)
  // ---------------------------------------------------------------------------
  const CELTX_TYPES = {
    sceneheading: 'scene_heading',
    action: 'action',
    character: 'character',
    dialog: 'dialogue',
    dialogue: 'dialogue',
    parenthetical: 'parenthetical',
    transition: 'transition',
    shot: 'shot',
    act: 'episode',
    actheading: 'episode',
    newact: 'episode',
    centered: 'centered',
  };

  function fromScriptHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const els = [];
    doc.querySelectorAll('p, div, h1, h2, h3').forEach((p) => {
      if (p.querySelector('p, div')) return; // containers
      const cls = (p.className || '').toLowerCase().replace(/[^a-z ]/g, '');
      const key = cls.split(/\s+/).find((c) => CELTX_TYPES[c]);
      const t = (p.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      if (!t) return;
      els.push({ type: key ? CELTX_TYPES[key] : 'action', text: t });
    });
    return elementsToFountain(els);
  }

  async function fromCeltx(buffer) {
    const files = await unzip(buffer);
    const scripts = [...files.keys()].filter((n) => /script[^/]*\.html?$/i.test(n));
    const pick = scripts.sort((a, b) => files.get(b).length - files.get(a).length)[0] || [...files.keys()].find((n) => /\.html?$/i.test(n));
    if (!pick) throw new Error('No script found inside this .celtx file. In Celtx, use File → Download/Export as PDF or Final Draft, then import that file.');
    return fromScriptHtml(text(files.get(pick)));
  }

  /** Generic element list → Fountain (through the script editor's serializer). */
  function elementsToFountain(els) {
    const norm = els.map((e) => {
      if (e.type === 'shot') return { type: 'scene_heading', text: e.text };
      return e;
    });
    return SF.editorToFountain('', norm).text;
  }

  // ---------------------------------------------------------------------------
  // PDF (pdf.js, loaded on demand)
  // ---------------------------------------------------------------------------
  let pdfjsPromise = null;
  function loadPdfJs() {
    if (!pdfjsPromise) {
      const base = (typeof document !== 'undefined' && document.baseURI) || '';
      const v = (root.SF && root.SF.APP_VERSION) || '';
      pdfjsPromise = import(new URL('vendor/pdfjs/pdf.min.mjs?v=' + v, base).href).then((m) => {
        m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs?v=' + v, base).href;
        return m;
      });
    }
    return pdfjsPromise;
  }

  /** Read positioned text lines from a PDF: [{page, lines:[{x, right, y, text}]}] (inches). */
  async function pdfLines(buffer, pdfjs) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const rows = [];
      tc.items.forEach((it) => {
        if (!it.str || !it.str.trim()) return;
        const x = it.transform[4] / 72;
        const y = (vp.height - it.transform[5]) / 72; // from top
        const w = (it.width || 0) / 72;
        let row = rows.find((r) => Math.abs(r.y - y) < 0.04);
        if (!row) rows.push((row = { y, items: [] }));
        row.items.push({ x, w, str: it.str });
      });
      rows.sort((a, b) => a.y - b.y);
      const lines = rows.map((r) => {
        r.items.sort((a, b) => a.x - b.x);
        // split far-apart chunks (e.g. scene numbers in the margins, or a right-aligned date)
        const chunks = [];
        r.items.forEach((it) => {
          const last = chunks[chunks.length - 1];
          const gap = last ? it.x - (last.x + last.w) : 0;
          if (last && gap < 0.45) {
            last.str += (gap > 0.04 && !/\s$/.test(last.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
            last.w = it.x + it.w - last.x;
          } else chunks.push({ ...it });
        });
        return { y: r.y, chunks };
      });
      pages.push({ n, width: vp.width / 72, height: vp.height / 72, lines });
    }
    return pages;
  }

  /** Turn positioned PDF lines into Fountain using standard screenplay indents. */
  function pdfToFountain(pages) {
    // Body left margin = most common chunk start among long lines
    const starts = new Map();
    pages.forEach((pg) =>
      pg.lines.forEach((l) =>
        l.chunks.forEach((c) => {
          if (c.str.length > 25) {
            const k = Math.round(c.x * 20) / 20;
            starts.set(k, (starts.get(k) || 0) + c.str.length);
          }
        })
      )
    );
    let base = 1.5;
    let best = 0;
    starts.forEach((v, k) => {
      if (v > best || (v === best && k < base)) {
        best = v;
        base = k;
      }
    });

    const els = [];
    let title = null;
    const isNum = (s) => /^\(?\d+[A-Z]?\.?\)?$/.test(s.trim());

    pages.forEach((pg, pi) => {
      const mid = pg.width / 2;
      // Drop headers/footers: page numbers, (CONTINUED), CONTINUED:
      const lines = pg.lines
        .map((l) => {
          const chunks = l.chunks.filter((c) => !(isNum(c.str) && (c.x < base - 0.1 || c.x > pg.width - 1.3)));
          const sceneNum = l.chunks.find((c) => isNum(c.str) && (c.x < base - 0.1 || c.x > pg.width - 1.3));
          return { ...l, chunks, sceneNum: sceneNum ? sceneNum.str.replace(/[().]/g, '') : null };
        })
        .filter((l) => l.chunks.length)
        .filter((l) => !(l.y < 0.85 && l.chunks.every((c) => isNum(c.str) || /^(\d+\.)$/.test(c.str))))
        .filter((l) => !(l.y < 0.85 || l.y > pg.height - 0.75) || !/^\(?CONTINUED\)?:?$|^\(?CONT['’]?D\)?$/i.test(l.chunks[0].str.trim()))
        .filter((l) => !/^\(CONTINUED\)$|^CONTINUED:$/i.test(l.chunks.map((c) => c.str).join(' ').trim()));

      // Title page: first page without screenplay structure
      if (pi === 0 && pages.length > 1) {
        const body = lines.map((l) => l.chunks.map((c) => c.str).join(' ').trim());
        const looksScript = body.some((t) => SF.isSceneHeading(t)) || lines.filter((l) => Math.abs(l.chunks[0].x - (base + 1)) < 0.2).length > 3;
        if (!looksScript && lines.length && lines.length < 30) {
          const centered = lines.filter((l) => l.chunks.length === 1 && Math.abs(l.chunks[0].x + l.chunks[0].w / 2 - mid) < 0.35 && l.y < pg.height * 0.75);
          const bottom = lines.filter((l) => l.y >= pg.height * 0.7);
          const f = { title: [], credit: [], authors: [], contact: [], 'draft date': [] };
          let stage = 'title';
          let lastY = null;
          f.source = [];
          centered.forEach((l) => {
            const t = l.chunks[0].str.trim();
            const bigGap = lastY != null && l.y - lastY > 0.4;
            lastY = l.y;
            if (/^(written|screenplay|story|teleplay|created)\b.*\bby\b|^by$/i.test(t)) {
              f.credit.push(t);
              stage = 'authors';
            } else if (stage === 'authors' && f.authors.length && bigGap) {
              stage = 'source';
              f.source.push(t);
            } else f[stage].push(t);
          });
          bottom.forEach((l) =>
            l.chunks.forEach((c) => {
              if (c.x + c.w > mid + 0.5 && c.x > mid - 0.5) f['draft date'].push(c.str.trim());
              else f.contact.push(c.str.trim());
            })
          );
          title = {};
          Object.keys(f).forEach((k) => (title[k] = f[k].join('\n')));
          return;
        }
      }

      let prev = null;
      lines.forEach((l) => {
        const c = l.chunks[0];
        const t = l.chunks.map((ch) => ch.str).join('   ').replace(/\s+$/, '');
        const right = c.x + c.w;
        const d = c.x - base;
        const gap = prev ? l.y - prev.y : 1;
        const newPara = gap > 0.25; // more than one 1/6" line
        let type;
        if (SF.isEpisode(t.trim()) && Math.abs(c.x + c.w / 2 - mid) < 0.6) type = 'episode';
        else if (d < 0.35) {
          const tt = t.trim();
          // Slugs such as MOMENTS LATER / CLOSE ON… : short ALL-CAPS line, no sentence punctuation, on its own
          const slug = SF.isAllCaps(tt) && tt.length <= 50 && !/[.!?:,]$/.test(tt) && newPara && !SF.isTransition(tt);
          type = SF.isSceneHeading(tt) || slug ? 'scene_heading' : 'action';
        }
        else if (right > pg.width - 1.25 && d > 2.5 && SF.isAllCaps(t)) type = 'transition';
        else if (d >= 1.9 && SF.isAllCaps(t.replace(/\(.*?\)/g, '')) && !/[.!?]$/.test(t.replace(/\s*\(.*\)$/, ''))) type = 'character';
        else if (d >= 1.9 && Math.abs(c.x + c.w / 2 - mid) < 0.4) type = 'centered';
        else if (d >= 1.3 || /^\(/.test(t.trim())) type = /^\(/.test(t.trim()) || (prev && prev.type === 'parenthetical' && !/\)$/.test(prev.text)) ? 'parenthetical' : 'dialogue';
        else type = 'dialogue';

        const text = type === 'character' ? t.trim().replace(/\s*\(CONT['’]?D\)\s*$/i, '') : t.trim();
        if (/^\(MORE\)$/i.test(text)) return; // page-break artefact
        const last = els[els.length - 1];
        // Wrapped lines continue the previous element
        if (last && !newPara && last.type === type && ['action', 'dialogue'].includes(type) && prev && prev.type === type) {
          last.text += ' ' + text;
        } else if (last && !newPara && type === 'parenthetical' && last.type === 'parenthetical' && !/\)$/.test(last.text)) {
          last.text += ' ' + text;
        } else if (last && type === 'character' && last.type === 'character' && last.text === text && els.length) {
          // repeated cue after a page break "(CONT'D)" — skip
        } else {
          els.push({ type, text, number: type === 'scene_heading' && l.sceneNum ? l.sceneNum : '' });
        }
        prev = { y: l.y, type, text };
      });
    });

    // A cue repeated at the top of the next page "(CONT'D)" duplicates the speech: merge
    const merged = [];
    els.forEach((e) => {
      const a = merged[merged.length - 1];
      const b = merged[merged.length - 2];
      if (e.type === 'character' && b && b.type === 'character' && b.text === e.text && a && a.type === 'dialogue') return;
      merged.push(e);
    });

    let out = SF.editorToFountain(title ? SF.setTitleFields('', title).trim() : '', merged).text;
    return out;
  }

  async function fromPdf(buffer) {
    const pdfjs = await loadPdfJs();
    const pages = await pdfLines(buffer, pdfjs);
    const chars = pages.reduce((n, p) => n + p.lines.length, 0);
    if (!chars) throw new Error('This PDF has no selectable text (it may be a scan), so it can’t be imported.');
    return pdfToFountain(pages);
  }

  // ---------------------------------------------------------------------------
  // Entry point
  // ---------------------------------------------------------------------------
  const readAs = (file, how) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('Could not read that file.'));
      r.onload = () => resolve(r.result);
      if (how === 'buffer') r.readAsArrayBuffer(file);
      else r.readAsText(file);
    });

  /**
   * Import any supported file.
   * @returns {Promise<{name: string, text: string, info: string|null, source: string}>}
   */
  async function importFile(file) {
    const name = (file.name || 'Imported script').replace(/\.[^.]+$/, '') || 'Imported script';
    const ext = ((/\.([^.]+)$/.exec(file.name || '') || [])[1] || '').toLowerCase();
    if (file.size > 25 * 1024 * 1024) throw new Error('That file is larger than 25 MB — is it really a script?');

    if (ext === 'highland') {
      const raw = await fromHighland(await readAs(file, 'buffer'));
      const conv = SF.looksMarkdown(raw) ? SF.convertPasted(raw) : { text: SF.normalize(raw), info: null };
      return { name, text: conv.text, info: conv.info || `Imported from Highland 2 · “${name}”`, source: 'Highland 2' };
    }
    if (ext === 'trelby') {
      const t = SF.fromTrelby(await readAs(file, 'text'));
      return { name, text: t, info: `Imported from Trelby · “${name}”`, source: 'Trelby' };
    }
    if (ext === 'fadein') {
      const t = await SF.fromFadeIn(await readAs(file, 'buffer'));
      return { name, text: t, info: `Imported from Fade In · “${name}”`, source: 'Fade In' };
    }
    if (ext === 'celtx') {
      const t = await fromCeltx(await readAs(file, 'buffer'));
      return { name, text: t, info: `Imported from Celtx · “${name}”`, source: 'Celtx' };
    }
    if (ext === 'pdf' || file.type === 'application/pdf') {
      const t = await fromPdf(await readAs(file, 'buffer'));
      return { name, text: t, info: `Imported from PDF · “${name}”. Check scene headings and characters — PDFs only keep the layout, not the elements.`, source: 'PDF' };
    }
    const raw = await readAs(file, 'text');
    if (ext === 'fdx' || /<FinalDraft[\s>]/.test(raw.slice(0, 2000))) {
      return { name, text: SF.fromFDX(raw), info: `Imported from Final Draft · “${name}”`, source: 'Final Draft' };
    }
    if (ext === 'html' || ext === 'htm' || /class=["']?(sceneheading|dialog)/i.test(raw.slice(0, 5000))) {
      return { name, text: fromScriptHtml(raw), info: `Imported script HTML · “${name}”`, source: 'HTML' };
    }
    if (SF.looksMarkdown(raw)) {
      const conv = SF.convertPasted(raw);
      return { name, text: conv.text, info: conv.info, source: 'ChatGPT / Markdown' };
    }
    return { name, text: SF.normalize(raw), info: null, source: 'Fountain' };
  }

  Object.assign(SF, { unzip, importFile, fromHighland, fromCeltx, fromScriptHtml, pdfToFountain, pdfLines, loadPdfJs });
})(typeof window !== 'undefined' ? window : globalThis);
