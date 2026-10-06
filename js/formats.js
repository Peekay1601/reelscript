/*
 * ReelScript — native file formats of other screenwriting apps
 *  Export: Highland 2 (.highland), Fade In (.fadein / Open Screenplay Format),
 *          Celtx (.celtx), Trelby (.trelby)
 *  Import: Fade In (.fadein), Trelby (.trelby)   (Highland/Celtx/PDF/FDX live in importers.js)
 * Final Draft (.fdx) is in export.js, Word (.docx) in docx.js, Fountain is the native store.
 */
(function (root) {
  'use strict';

  const SF = (root.SF = root.SF || {});

  const xmlEsc = (s) =>
    String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const rid = (n) => {
    const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < (n || 12); i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  };

  /** Fountain → flat list of {type, text, number?, dual?} using the parser (printable elements + notes). */
  function elements(src) {
    const parsed = SF.parse(src);
    const out = [];
    const speech = (d, dual) => {
      out.push({ type: 'character', text: d.character, dual });
      d.parts.forEach((p) => out.push({ type: p.type === 'lyrics' ? 'dialogue' : p.type, text: p.text }));
    };
    parsed.tokens.forEach((t) => {
      switch (t.type) {
        case 'scene_heading':
          out.push({ type: 'scene_heading', text: t.text, number: t.number });
          break;
        case 'action':
          out.push({ type: 'action', text: t.lines.map((l) => l.text).join('\n') });
          break;
        case 'dialogue':
          speech(t, false);
          break;
        case 'dual_dialogue':
          speech(t.left, false);
          speech(t.right, true);
          break;
        case 'episode':
        case 'transition':
        case 'centered':
        case 'page_break':
        case 'note':
        case 'lyrics':
          out.push({ type: t.type === 'lyrics' ? 'action' : t.type, text: t.text || '' });
          break;
        default:
          break;
      }
    });
    return { title: parsed.title || {}, els: out };
  }

  const plain = (s) => SF.plainText(s || '');

  // ---------------------------------------------------------------------------
  // Highland 2 — zipped TextBundle containing text.fountain
  // ---------------------------------------------------------------------------
  function toHighland(src, name) {
    const folder = `${(name || 'Screenplay').replace(/[\\/:*?"<>|]+/g, '-')}.textbundle/`;
    const info = { version: 2, type: 'com.quoteunquoteapps.fountain', transient: false, creatorIdentifier: 'com.reelscript', creatorURL: 'https://peekay1601.github.io/reelscript/' };
    return SF.zip([
      { name: folder + 'info.json', data: JSON.stringify(info, null, 2) },
      { name: folder + 'text.fountain', data: SF.normalize(src) },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Trelby — documented line format (see Trelby's fileformat.txt)
  //   line = <linebreak char><element char><text>
  //   linebreak: '>' wrap with space, '|' forced line break, '.' end of element
  //   element:   '\' scene  '.' action  '_' character  ':' dialogue  '(' paren
  //              '/' transition  '=' shot  '@' act break  '%' note
  // ---------------------------------------------------------------------------
  const TRELBY_CHAR = { scene_heading: '\\', action: '.', character: '_', dialogue: ':', parenthetical: '(', transition: '/', episode: '@', note: '%', centered: '.', page_break: null };
  const TRELBY_TYPE = { '\\': 'scene_heading', '.': 'action', _: 'character', ':': 'dialogue', '(': 'parenthetical', '/': 'transition', '=': 'scene_heading', '@': 'episode', '%': 'note' };

  function toTrelby(src) {
    const { title, els } = elements(src);
    const out = ['﻿#Version 3'];
    // Title page (Title-String: xpos,ypos,fontsize,flags,font,reserved,text — millimetres)
    const tl = (k) => (title[k] || []).map((x) => plain(x)).filter(Boolean);
    let y = 70;
    const centred = (t, size, flags) => {
      out.push(`#Title-String 0.000000,${y.toFixed(6)},${size},${flags},Courier,,${t.replace(/\\/g, '\\\\')}`);
      y += 6;
    };
    tl('title').forEach((t) => centred(t.toUpperCase(), 12, 'c'));
    if (tl('authors').length) {
      y += 12;
      (tl('credit').length ? tl('credit') : ['Written by']).forEach((t) => centred(t, 12, 'c'));
      y += 6;
      tl('authors').forEach((t) => centred(t, 12, 'c'));
    }
    let cy = 240;
    [...tl('contact'), ...tl('draft date')].forEach((t) => {
      out.push(`#Title-String 38.100000,${cy.toFixed(6)},12,,Courier,,${t.replace(/\\/g, '\\\\')}`);
      cy += 5;
    });
    out.push('#Header-String 1,0,r,,${PAGE}.');
    out.push('#Header-Empty-Lines 1');
    out.push('#Start-Script ');
    els.forEach((e) => {
      const ch = TRELBY_CHAR[e.type];
      if (!ch) return;
      let text = plain(e.text);
      if (e.type === 'scene_heading' || e.type === 'character' || e.type === 'transition' || e.type === 'episode') text = text.toUpperCase();
      const lines = text.split('\n');
      lines.forEach((l, k) => out.push(`${k === lines.length - 1 ? '.' : '|'}${ch}${l}`));
    });
    if (out[out.length - 1] === '#Start-Script ') out.push('..');
    return out.join('\n') + '\n';
  }

  function fromTrelby(text) {
    const lines = SF.normalize(text).split('\n');
    if (!/^#Version\s+[123]/.test(lines[0] || '')) throw new Error('This doesn’t look like a Trelby file.');
    const version = +/#Version\s+(\d)/.exec(lines[0])[1];
    let started = version < 3;
    let inSection = false;
    const els = [];
    const title = { title: [], authors: [], contact: [] };
    let cur = null;
    for (let i = 1; i < lines.length; i++) {
      const s = lines[i];
      if (!s) continue;
      if (/^#Begin-/.test(s)) {
        inSection = true;
        continue;
      }
      if (/^#End-/.test(s)) {
        inSection = false;
        continue;
      }
      if (inSection) continue; // config / auto-completion / locations / dictionary blocks
      if (s[0] === '#') {
        if (/^#Start-Script/.test(s)) started = true;
        const ts = /^#Title-String\s+([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(.*)$/.exec(s);
        if (ts) {
          const t = ts[7].replace(/\\\\/g, '\\').split('\\n').join(' ').trim();
          if (!t) continue;
          if (!/c/.test(ts[4])) title.contact.push(t);
          else if (/^(written|screenplay|story|teleplay)\b.*\bby\b|^by$/i.test(t)) title.credit = [t];
          else (title.credit ? title.authors : title.title).push(t);
        }
        continue;
      }
      if (!started || s.length < 2) continue;
      const lb = s[0];
      const type = TRELBY_TYPE[s[1]] || 'action';
      const t = s.slice(2);
      if (!cur || cur.type !== type) {
        if (cur) els.push(cur);
        cur = { type, text: t };
      } else cur.text += cur.sep === '|' ? '\n' + t : (cur.text && t ? ' ' : '') + t;
      cur.sep = lb;
      if (lb === '.') {
        els.push(cur);
        cur = null;
      }
    }
    if (cur) els.push(cur);
    const fields = {};
    Object.keys(title).forEach((k) => (fields[k] = (title[k] || []).join('\n')));
    return SF.editorToFountain(SF.setTitleFields('', fields).trim(), els.map((e) => ({ type: e.type, text: e.text }))).text;
  }

  // ---------------------------------------------------------------------------
  // Fade In — .fadein = zip { document.xml } in Open Screenplay Format
  // ---------------------------------------------------------------------------
  const OSF_STYLE = { scene_heading: 'Scene Heading', action: 'Action', character: 'Character', dialogue: 'Dialogue', parenthetical: 'Parenthetical', transition: 'Transition', centered: 'Action', episode: 'Action' };

  function toFadeIn(src, name) {
    const { title, els } = elements(src);
    const tl = (k) => (title[k] || []).map((x) => plain(x)).join(' ');
    const paras = [];
    let breakNext = false;
    els.forEach((e) => {
      if (e.type === 'page_break') {
        breakNext = true;
        return;
      }
      if (e.type === 'note') {
        paras.push(`    <para note="${xmlEsc(plain(e.text))}"><style basestylename="Action"/><text></text></para>`);
        return;
      }
      const style = OSF_STYLE[e.type] || 'Action';
      let text = plain(e.text);
      if (['scene_heading', 'character', 'transition', 'episode'].includes(e.type)) text = text.toUpperCase();
      const attrs = [];
      if ((breakNext || e.type === 'episode') && paras.length) attrs.push('page_break="1"');
      breakNext = false;
      const extra = [];
      if (e.type === 'centered' || e.type === 'episode') extra.push('align="center"');
      if (e.type === 'scene_heading' && e.number) extra.push(`number="${xmlEsc(e.number)}"`);
      paras.push(`    <para${attrs.length ? ' ' + attrs.join(' ') : ''}><style basestylename="${style}"${extra.length ? ' ' + extra.join(' ') : ''}/><text>${xmlEsc(text).replace(/\n/g, '&lt;br&gt;')}</text></para>`);
    });
    const xml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
      '<document type="Open Screenplay Format document" version="40">',
      `  <info uuid="${rid(8)}-${rid(4)}-${rid(4)}-${rid(4)}-${rid(12)}" title="${xmlEsc(tl('title') || name || '')}" written_by="${xmlEsc(tl('authors'))}" contact="${xmlEsc(tl('contact'))}" draft_date="${xmlEsc(tl('draft date'))}"/>`,
      '  <paragraphs>',
      ...paras,
      '  </paragraphs>',
      '</document>',
      '',
    ].join('\n');
    return SF.zip([{ name: 'document.xml', data: xml }]);
  }

  const OSF_TYPE = { 'scene heading': 'scene_heading', action: 'action', character: 'character', dialogue: 'dialogue', parenthetical: 'parenthetical', transition: 'transition', shot: 'scene_heading', general: 'action' };

  async function fromFadeIn(buffer) {
    const files = await SF.unzip(buffer);
    const name = [...files.keys()].find((n) => /(^|\/)document\.xml$/i.test(n));
    if (!name) throw new Error('No document.xml inside this .fadein file.');
    const xml = new TextDecoder().decode(files.get(name));
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This .fadein file could not be read.');
    const els = [];
    const clean = (s) =>
      (s || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(b|i|u|font|size|bgcolor)[^>]*>/gi, '')
        .replace(/ /g, ' ');
    [...doc.getElementsByTagName('para')].forEach((p) => {
      if (p.getAttribute('page_break') === '1' && els.length) els.push({ type: 'page_break', text: '' });
      ['note', 'synopsis'].forEach((a) => {
        if (p.getAttribute(a)) els.push({ type: 'note', text: clean(p.getAttribute(a)) });
      });
      const st = p.getElementsByTagName('style')[0];
      const txt = p.getElementsByTagName('text')[0];
      if (!txt) return;
      const base = ((st && (st.getAttribute('basestylename') || st.getAttribute('basestyle'))) || 'Action').toLowerCase();
      let type = OSF_TYPE[base] || 'action';
      let text = clean(txt.textContent).replace(/\s+$/, '');
      if (!text.trim()) return;
      if (st && st.getAttribute('align') === 'center' && type === 'action') type = SF.isEpisode(text) ? 'episode' : 'centered';
      els.push({ type, text, number: (st && st.getAttribute('number')) || '' });
    });
    if (els.length && els[els.length - 1].type === 'page_break') els.pop();
    const info = doc.getElementsByTagName('info')[0];
    let titleBlock = '';
    if (info) {
      titleBlock = SF.setTitleFields('', {
        title: info.getAttribute('title') || '',
        authors: info.getAttribute('written_by') || '',
        contact: info.getAttribute('contact') || '',
        'draft date': info.getAttribute('draft_date') || '',
      }).trim();
    }
    return SF.editorToFountain(titleBlock, els).text;
  }

  // ---------------------------------------------------------------------------
  // Celtx — classic .celtx (zip: project.rdf, local.rdf, script-*.html, scratch-*.html)
  // ---------------------------------------------------------------------------
  const CELTX_CLASS = { scene_heading: 'sceneheading', action: 'action', character: 'character', dialogue: 'dialog', parenthetical: 'parenthetical', transition: 'transition', centered: 'action', episode: 'act', note: null, page_break: null };

  function toCeltx(src, name) {
    const { title, els } = elements(src);
    const id = rid(3).toLowerCase();
    const scriptFile = `script-${id}.html`;
    const scratchFile = `scratch-${id}.html`;
    const docRes = `http://celtx.com/res/${rid(12)}`;
    const projRes = `http://celtx.com/project/${rid(12)}`;
    const compRes = `http://celtx.com/res/${rid(12)}`;
    const tl = (k) => (title[k] || []).map((x) => plain(x)).join(' ');
    const ptitle = tl('title') || name || 'Screenplay';
    const body = els
      .map((e) => {
        const cls = CELTX_CLASS[e.type];
        if (!cls) return '';
        let t = plain(e.text);
        if (['scene_heading', 'character', 'transition', 'episode'].includes(e.type)) t = t.toUpperCase();
        return `<p class="${cls}">${xmlEsc(t).replace(/\n/g, '<br>')}<br>\n</p>`;
      })
      .filter(Boolean)
      .join('\n');
    const html = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">
<html>
<head>
  <title>Screenplay</title>
  <link rel="stylesheet" type="text/css" href="chrome://celtx/content/editor.css">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta content="none" name="CX.sceneNumbering">
  <meta content="true" name="CX.showPageNumbers">
  <meta content="false" name="CX.showFirstPageNumber">
  <link href="chrome://celtx/content/style/film/USLetter/Normal.css" type="text/css" rel="stylesheet">
  <meta content="${xmlEsc(tl('authors'))}" name="Author">
  <meta content="${xmlEsc(tl('source'))}" name="DC.source">
  <meta content="${xmlEsc(tl('copyright'))}" name="DC.rights">
  <meta content="${xmlEsc(tl('contact'))}" name="CX.contact">
  <meta content="${xmlEsc(tl('credit') || 'By')}" name="CX.byline">
</head>
<body>
${body}
</body>
</html>
`;
    const ns = `xmlns:dc="http://purl.org/dc/elements/1.1/"
         xmlns:cx="http://celtx.com/NS/v1/"
         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
         xmlns:NC="http://home.netscape.com/NC-rdf#"
         xmlns:RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#"`;
    const project = `<?xml version="1.0"?>
<RDF:RDF ${ns}>
  <cx:Project RDF:about="${projRes}"
                   cx:fileVersion="1.4"
                   dc:title="${xmlEsc(ptitle)}"
                   dc:modified="${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}">
    <cx:components RDF:resource="${compRes}"/>
  </cx:Project>
  <RDF:Seq RDF:about="${compRes}">
    <RDF:li RDF:resource="${docRes}"/>
  </RDF:Seq>
  <cx:Document RDF:about="${docRes}"
                   dc:title="Screenplay"
                   cx:localFile="${scriptFile}"
                   cx:auxFile="${scratchFile}">
    <cx:doctype RDF:resource="http://celtx.com/NS/v1/ScriptDocument"/>
  </cx:Document>
</RDF:RDF>
`;
    const local = `<?xml version="1.0"?>
<RDF:RDF ${ns}>
  <RDF:Seq RDF:about="rdf:#$${rid(5)}">
    <RDF:li RDF:resource="${docRes}"/>
  </RDF:Seq>
</RDF:RDF>
`;
    return SF.zip([
      { name: 'project.rdf', data: project },
      { name: 'local.rdf', data: local },
      { name: scriptFile, data: html },
      { name: scratchFile, data: '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body><p><br></p></body></html>\n' },
    ]);
  }

  Object.assign(SF, { toHighland, toTrelby, fromTrelby, toFadeIn, fromFadeIn, toCeltx, scriptElements: elements });
})(typeof window !== 'undefined' ? window : globalThis);
