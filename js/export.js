/*
 * ReelScript — exporters & importers
 *  - PDF (vector text, embedded standard Courier, via vendored jsPDF)
 *  - Final Draft .fdx export / import
 */
(function (root) {
  'use strict';

  const SF = (root.SF = root.SF || {});
  const BASELINE = 0.122; // inches from line top to text baseline for 12pt Courier

  // ---------------------------------------------------------------------------
  // PDF
  // ---------------------------------------------------------------------------
  const PDF_MAP = {
    '‘': "'", '’': "'", '‚': "'", '′': "'",
    '“': '"', '”': '"', '„': '"', '″': '"',
    '–': '-', '—': '--', '―': '--', '−': '-',
    '…': '...', ' ': ' ', '•': '*', '™': '(TM)',
  };

  function pdfSafe(text, bad) {
    let out = '';
    for (const ch of text) {
      if (PDF_MAP[ch] !== undefined) out += PDF_MAP[ch];
      else if (ch.codePointAt(0) <= 0xff) out += ch;
      else {
        if (bad) bad.add(ch);
        out += '?';
      }
    }
    return out;
  }

  function allPages(model) {
    return model.titlePage ? [model.titlePage, ...model.pages] : model.pages;
  }

  /** Characters the built-in PDF Courier font can't draw (e.g. Devanagari, Telugu, emoji). */
  function unsupportedChars(model) {
    const bad = new Set();
    allPages(model).forEach((p) => p.items.forEach((it) => it.segs.forEach((s) => s.runs.forEach((r) => pdfSafe(r.text, bad)))));
    return [...bad];
  }

  function fontStyle(r) {
    if (r.b && r.i) return 'bolditalic';
    if (r.b) return 'bold';
    if (r.i) return 'italic';
    return 'normal';
  }

  function buildPDF(model, meta) {
    const JsPDF = root.jspdf && root.jspdf.jsPDF;
    if (!JsPDF) throw new Error('PDF engine failed to load.');
    const { w, h } = model.size;
    const doc = new JsPDF({ unit: 'in', format: [w, h], orientation: 'portrait', compress: true, putOnlyUsedFonts: true });
    doc.setProperties({
      title: (meta && meta.title) || 'Screenplay',
      author: (meta && meta.author) || '',
      subject: 'Screenplay',
      creator: 'ReelScript Screenplay Formatter',
    });
    doc.setFontSize(12);
    doc.setLineWidth(0.01);
    doc.setTextColor(0, 0, 0);
    const watermark = (model.options.watermark || '').trim();

    allPages(model).forEach((page, idx) => {
      if (idx > 0) doc.addPage([w, h], 'portrait');
      page.items.forEach((it) => {
        const base = it.y + BASELINE;
        it.segs.forEach((s) => {
          let x = s.x;
          s.runs.forEach((r) => {
            const t = pdfSafe(r.text);
            if (!t) return;
            doc.setFont('courier', fontStyle(r));
            doc.text(t, x, base);
            const width = [...t].length * SF.CHAR_WIDTH;
            if (r.u) doc.line(x, base + 0.025, x + width, base + 0.025);
            x += [...r.text].length * SF.CHAR_WIDTH;
          });
        });
      });

      if (watermark) {
        doc.saveGraphicsState();
        if (doc.GState) doc.setGState(new doc.GState({ opacity: 0.08 }));
        doc.setFont('helvetica', 'bold');
        let size = 96;
        doc.setFontSize(size);
        let tw = doc.getTextWidth(pdfSafe(watermark));
        const maxW = Math.hypot(w, h) * 0.75;
        if (tw > maxW) {
          size = Math.floor((size * maxW) / tw);
          doc.setFontSize(size);
          tw = doc.getTextWidth(pdfSafe(watermark));
        }
        const a = Math.atan2(h, w);
        const cx = w / 2 - (Math.cos(a) * tw) / 2;
        const cy = h / 2 + (Math.sin(a) * tw) / 2;
        doc.setTextColor(0, 0, 0);
        doc.text(pdfSafe(watermark), cx, cy, { angle: (a * 180) / Math.PI });
        doc.restoreGraphicsState();
        doc.setFontSize(12);
      }
    });
    return doc;
  }

  // ---------------------------------------------------------------------------
  // Final Draft (.fdx)
  // ---------------------------------------------------------------------------
  const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function fdxText(text, extra) {
    const runs = SF.parseInline(text);
    if (!runs.length) return '<Text></Text>';
    return runs
      .map((r) => {
        const st = [];
        if (r.b || (extra && extra.b)) st.push('Bold');
        if (r.i || (extra && extra.i)) st.push('Italic');
        if (r.u || (extra && extra.u)) st.push('Underline');
        return `<Text${st.length ? ` Style="${st.join('+')}"` : ''}>${xmlEscape(r.text)}</Text>`;
      })
      .join('');
  }

  function toFDX(src) {
    const parsed = SF.parse(src);
    const out = [];
    let newPage = false;
    const para = (type, text, attrs, extra) => {
      let a = attrs || '';
      if (newPage) {
        a += ' StartsNewPage="Yes"';
        newPage = false;
      }
      return `    <Paragraph Type="${type}"${a}>${fdxText(text, extra)}</Paragraph>`;
    };
    const dialogue = (d) => {
      const rows = [para('Character', d.character)];
      d.parts.forEach((p) => {
        if (p.type === 'parenthetical') rows.push(para('Parenthetical', p.text));
        else rows.push(para('Dialogue', p.text, '', p.type === 'lyrics' ? { i: true } : null));
      });
      return rows;
    };

    parsed.tokens.forEach((t) => {
      switch (t.type) {
        case 'scene_heading':
          out.push(para('Scene Heading', t.text.toUpperCase(), t.number ? ` Number="${xmlEscape(t.number)}"` : ''));
          break;
        case 'action':
          t.lines.forEach((l) => out.push(para('Action', l.text)));
          break;
        case 'dialogue':
          out.push(...dialogue(t));
          break;
        case 'dual_dialogue':
          out.push('    <Paragraph>\n      <DualDialogue>');
          out.push(...dialogue(t.left).map((r) => '    ' + r));
          out.push(...dialogue(t.right).map((r) => '    ' + r));
          out.push('      </DualDialogue>\n    </Paragraph>');
          break;
        case 'transition':
          out.push(para('Transition', t.text.toUpperCase()));
          break;
        case 'centered':
          out.push(para('Action', t.text, ' Alignment="Center"'));
          break;
        case 'lyrics':
          out.push(para('Action', t.text, '', { i: true }));
          break;
        case 'page_break':
          newPage = true;
          break;
        default:
          break;
      }
    });

    const tp = [];
    if (parsed.title) {
      const f = parsed.title;
      const line = (text, align) => tp.push(`      <Paragraph Alignment="${align || 'Center'}">${fdxText(text || '')}</Paragraph>`);
      for (let k = 0; k < 18; k++) line('');
      (f.title || []).forEach((t) => line(t.toUpperCase()));
      line('');
      line('');
      (f.credit || ['Written by']).forEach((t) => line(t));
      line('');
      (f.authors || []).forEach((t) => line(t));
      if (f.source) {
        line('');
        f.source.forEach((t) => line(t));
      }
      for (let k = 0; k < 14; k++) line('');
      (f.contact || []).forEach((t) => line(t, 'Left'));
      (f['draft date'] || []).forEach((t) => line(t, 'Right'));
    }

    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
      '<FinalDraft DocumentType="Script" Template="No" Version="5">',
      '  <Content>',
      ...out,
      '  </Content>',
      tp.length ? `  <TitlePage>\n    <Content>\n${tp.join('\n')}\n    </Content>\n  </TitlePage>` : '',
      '</FinalDraft>',
      '',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }

  /** Final Draft XML → Fountain text. Requires DOMParser (browser). */
  function fromFDX(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This .fdx file could not be read.');
    const content = doc.querySelector('FinalDraft > Content');
    if (!content) throw new Error('No script content found in this .fdx file.');

    const textOf = (p) =>
      [...p.getElementsByTagName('Text')]
        .map((t) => {
          let s = t.textContent || '';
          const style = t.getAttribute('Style') || '';
          if (s.trim()) {
            if (/Underline/.test(style)) s = `_${s}_`;
            if (/Bold/.test(style) && /Italic/.test(style)) s = `***${s}***`;
            else if (/Bold/.test(style)) s = `**${s}**`;
            else if (/Italic/.test(style)) s = `*${s}*`;
          }
          return s;
        })
        .join('')
        .replace(/\s+$/, '');

    const out = [];
    const blank = () => {
      if (out.length && out[out.length - 1] !== '') out.push('');
    };

    const emit = (p, dualFirst) => {
      const type = p.getAttribute('Type') || 'Action';
      const text = textOf(p);
      if (p.getAttribute('StartsNewPage') === 'Yes') {
        blank();
        out.push('===');
      }
      switch (type) {
        case 'Scene Heading': {
          blank();
          const n = p.getAttribute('Number');
          const t = text.toUpperCase();
          out.push((SF.isSceneHeading(t) ? t : '.' + t) + (n ? ` #${n}#` : ''));
          blank();
          break;
        }
        case 'Character': {
          blank();
          const t = text.trim();
          const cue = SF.isCharacterCue(t) ? t : '@' + t;
          out.push(dualFirst === false ? cue + ' ^' : cue);
          break;
        }
        case 'Parenthetical': {
          const t = text.trim();
          out.push(t.startsWith('(') ? t : `(${t})`);
          break;
        }
        case 'Dialogue':
          out.push(text.trim());
          break;
        case 'Transition': {
          blank();
          const t = text.trim().toUpperCase();
          out.push(SF.isTransition(t) ? t : '> ' + t);
          blank();
          break;
        }
        case 'Shot': {
          blank();
          out.push('.' + text.trim().toUpperCase());
          blank();
          break;
        }
        default: {
          if (!text.trim()) return;
          blank();
          if (p.getAttribute('Alignment') === 'Center') out.push(`> ${text.trim()} <`);
          else {
            const t = text.trim();
            out.push(SF.isAllCaps(t) || SF.isSceneHeading(t) ? '!' + t : t);
          }
        }
      }
    };

    [...content.children].forEach((p) => {
      const dual = p.querySelector(':scope > DualDialogue');
      if (dual) {
        let cueSeen = 0;
        [...dual.children].forEach((dp) => {
          if (dp.getAttribute('Type') === 'Character') cueSeen++;
          emit(dp, dp.getAttribute('Type') === 'Character' ? cueSeen === 1 : undefined);
        });
        return;
      }
      if (p.tagName === 'Paragraph') emit(p);
    });

    // Title page (best effort)
    let title = '';
    const tpc = doc.querySelector('FinalDraft > TitlePage > Content');
    if (tpc) {
      const lines = [...tpc.getElementsByTagName('Paragraph')].map((p) => ({ text: textOf(p).trim(), align: p.getAttribute('Alignment') || 'Left' })).filter((l) => l.text);
      const centered = lines.filter((l) => l.align === 'Center');
      const fields = {};
      if (centered.length) {
        fields.title = centered[0].text;
        const by = centered.findIndex((l) => /^(written|screenplay|story|teleplay)\b/i.test(l.text) || /\bby$/i.test(l.text));
        if (by !== -1) {
          fields.credit = centered[by].text;
          fields.authors = centered.slice(by + 1).map((l) => l.text).join('\n');
        }
      }
      fields.contact = lines.filter((l) => l.align === 'Left').map((l) => l.text).join('\n');
      fields['draft date'] = lines.filter((l) => l.align === 'Right').map((l) => l.text).join('\n');
      title = SF.setTitleFields('', fields).trim();
    }

    const body = out.filter((l, k) => !(l === '' && out[k - 1] === '')).join('\n').trim();
    return (title ? title + '\n\n' : '') + body + '\n';
  }

  Object.assign(SF, { buildPDF, unsupportedChars, toFDX, fromFDX, pdfSafe });
})(typeof window !== 'undefined' ? window : globalThis);
