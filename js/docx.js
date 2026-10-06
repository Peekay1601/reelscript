/*
 * ReelScript — Microsoft Word (.docx) export
 * Builds a real Office Open XML document with screenplay paragraph styles
 * (Scene Heading, Action, Character, Parenthetical, Dialogue, Transition,
 * Episode…) so the script stays editable in Word / Google Docs / Pages.
 * No dependencies: includes a tiny ZIP writer.
 */
(function (root) {
  'use strict';

  const SF = (root.SF = root.SF || {});
  const TW = 1440; // twips per inch
  const LINE = 240; // 12pt line in twips

  // ---------------------------------------------------------------------------
  // Minimal ZIP (store, no compression) — enough for .docx
  // ---------------------------------------------------------------------------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    files.forEach(({ name, data }) => {
      const nameBytes = utf8(name);
      const bytes = typeof data === 'string' ? utf8(data) : data;
      const crc = crc32(bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // store
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, bytes);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, dosTime, true);
      cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, bytes.length, true);
      cen.setUint32(24, bytes.length, true);
      cen.setUint16(28, nameBytes.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameBytes);
      offset += 30 + nameBytes.length + bytes.length;
    });

    const cenSize = central.reduce((n, a) => n + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true);
    end.setUint32(16, offset, true);

    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
    let p = 0;
    all.forEach((a) => {
      out.set(a, p);
      p += a.length;
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // WordprocessingML helpers
  // ---------------------------------------------------------------------------
  const xmlEsc = (s) =>
    s
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function runs(text, extra) {
    const rs = SF.parseInline(text);
    if (!rs.length) return '';
    return rs
      .map((r) => {
        const pr = [];
        if (r.b || (extra && extra.b)) pr.push('<w:b/><w:bCs/>');
        if (r.i || (extra && extra.i)) pr.push('<w:i/><w:iCs/>');
        if (r.u || (extra && extra.u)) pr.push('<w:u w:val="single"/>');
        if (extra && extra.caps) pr.push('<w:caps/>');
        const rpr = pr.length ? `<w:rPr>${pr.join('')}</w:rPr>` : '';
        return `<w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(r.text)}</w:t></w:r>`;
      })
      .join('');
  }

  function p(style, text, opts) {
    const o = opts || {};
    const ppr = [`<w:pStyle w:val="${style}"/>`];
    if (o.pageBreakBefore) ppr.push('<w:pageBreakBefore/>');
    if (o.spacingBefore != null) ppr.push(`<w:spacing w:before="${o.spacingBefore}"/>`);
    if (o.jc) ppr.push(`<w:jc w:val="${o.jc}"/>`);
    if (o.sectPr) ppr.push(o.sectPr);
    return `<w:p><w:pPr>${ppr.join('')}</w:pPr>${runs(text || '', o.extra)}</w:p>`;
  }

  function styleDef(id, name, ppr, rpr) {
    return `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${ppr}</w:pPr>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}</w:style>`;
  }

  function stylesXml(opts) {
    const ind = (left, right) => `<w:ind w:left="${Math.round(left * TW)}" w:right="${Math.round((right || 0) * TW)}"/>`;
    const sp = (before) => `<w:spacing w:before="${before * LINE}" w:after="0" w:line="${LINE}" w:lineRule="exact"/>`;
    const sceneBefore = opts.doubleSpaceSceneHeadings ? 2 : 1;
    const sceneRpr = '<w:caps/>' + (opts.boldSceneHeadings ? '<w:b/>' : '') + (opts.underlineSceneHeadings ? '<w:u w:val="single"/>' : '');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="Courier New"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="${LINE}" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/></w:pPr></w:style>
${styleDef('SceneHeading', 'Scene Heading', sp(sceneBefore) + '<w:keepNext/><w:keepLines/>', sceneRpr)}
${styleDef('Action', 'Action', sp(1))}
${styleDef('Character', 'Character', sp(1) + '<w:keepNext/><w:keepLines/>' + ind(2.2, 0), '<w:caps/>')}
${styleDef('Parenthetical', 'Parenthetical', sp(0) + '<w:keepNext/>' + `<w:ind w:left="${1.6 * TW}" w:right="${1.9 * TW}" w:hanging="${0.1 * TW}"/>`)}
${styleDef('Dialogue', 'Dialogue', sp(0) + ind(1.0, 1.5))}
${styleDef('Transition', 'Transition', sp(1) + '<w:jc w:val="right"/>', '<w:caps/>')}
${styleDef('Centered', 'Centered', sp(1) + '<w:jc w:val="center"/>')}
${styleDef('Lyrics', 'Lyrics', sp(0) + ind(1.0, 1.5), '<w:i/>')}
${styleDef('Episode', 'Episode', sp(0) + '<w:jc w:val="center"/><w:keepNext/>', '<w:b/><w:caps/><w:u w:val="single"/>')}
${styleDef('TitlePage', 'Title Page', sp(0) + '<w:jc w:val="center"/>')}
${styleDef('Contact', 'Contact', sp(0))}
${styleDef('Header', 'Header', '<w:jc w:val="right"/>')}
</w:styles>`;
  }

  function sectPr(size, opts) {
    const w = Math.round(size.w * TW);
    const h = Math.round(size.h * TW);
    const hdr = opts.headers || '';
    const extra = opts.extra || '';
    return `<w:sectPr>${hdr}${extra}<w:pgSz w:w="${w}" w:h="${h}"/><w:pgMar w:top="${TW}" w:right="${TW}" w:bottom="${TW}" w:left="${1.5 * TW}" w:header="${TW / 2}" w:footer="${TW / 2}" w:gutter="0"/>${opts.pgNum || ''}${opts.titlePg ? '<w:titlePg/>' : ''}</w:sectPr>`;
  }

  // ---------------------------------------------------------------------------
  // Script → document.xml body
  // ---------------------------------------------------------------------------
  function bodyXml(parsed, opts) {
    const out = [];
    let lastSpeaker = null;
    let firstPrinted = true;
    const baseName = (n) => SF.plainText(n).replace(/\(.*?\)/g, '').replace(/\^/g, '').trim().toUpperCase();

    const dialogue = (d, contd) => {
      const rows = [];
      let name = d.character;
      if (contd && !/CONT['’]?D/i.test(name)) name += " (CONT'D)";
      rows.push(p('Character', d.forced ? name : name.toUpperCase()));
      d.parts.forEach((pt) => {
        if (pt.type === 'parenthetical') rows.push(p('Parenthetical', pt.text));
        else if (pt.type === 'lyrics') rows.push(p('Lyrics', pt.text));
        else rows.push(p('Dialogue', pt.text));
      });
      return rows.join('');
    };

    const cell = (xml, wIn) =>
      `<w:tc><w:tcPr><w:tcW w:w="${Math.round(wIn * TW)}" w:type="dxa"/></w:tcPr>${xml || '<w:p/>'}</w:tc>`;

    parsed.tokens.forEach((t) => {
      const isFirst = firstPrinted;
      switch (t.type) {
        case 'episode':
          lastSpeaker = null;
          out.push(p('Episode', t.text, { pageBreakBefore: opts.episodeNewPage && !isFirst }));
          break;
        case 'scene_heading':
          lastSpeaker = null;
          out.push(p('SceneHeading', t.text.toUpperCase() + (t.number && opts.sceneNumbers !== 'none' ? `   ${t.number}` : ''), isFirst ? { spacingBefore: 0 } : null));
          break;
        case 'action':
          // keep the paragraph's manual line breaks
          out.push(
            `<w:p><w:pPr><w:pStyle w:val="Action"/>${isFirst ? '<w:spacing w:before="0"/>' : ''}</w:pPr>${t.lines
              .map((l, k) => (k ? '<w:r><w:br/></w:r>' : '') + runs(l.text))
              .join('')}</w:p>`
          );
          break;
        case 'dialogue': {
          const b = baseName(t.character);
          out.push(dialogue(t, opts.autoContd && lastSpeaker === b));
          lastSpeaker = b;
          break;
        }
        case 'dual_dialogue':
          lastSpeaker = null;
          out.push(
            `<w:tbl><w:tblPr><w:tblW w:w="${6 * TW}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${3 * TW}"/><w:gridCol w:w="${3 * TW}"/></w:tblGrid><w:tr>${cell(
              dualCol(t.left),
              3
            )}${cell(dualCol(t.right), 3)}</w:tr></w:tbl>`
          );
          break;
        case 'transition':
          lastSpeaker = null;
          out.push(p('Transition', t.text));
          break;
        case 'centered':
          out.push(p('Centered', t.text, t.continued ? { spacingBefore: 0 } : null));
          break;
        case 'lyrics':
          out.push(p('Lyrics', t.text));
          break;
        case 'page_break':
          out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
          break;
        default:
          return;
      }
      firstPrinted = false;
    });

    function dualCol(d) {
      const rows = [`<w:p><w:pPr><w:pStyle w:val="Character"/><w:spacing w:before="${LINE}"/><w:ind w:left="${0.8 * TW}" w:right="0"/></w:pPr>${runs(d.forced ? d.character : d.character.toUpperCase())}</w:p>`];
      d.parts.forEach((pt) => {
        const st = pt.type === 'parenthetical' ? 'Parenthetical' : pt.type === 'lyrics' ? 'Lyrics' : 'Dialogue';
        const ind = pt.type === 'parenthetical' ? `<w:ind w:left="${0.3 * TW}" w:right="${0.2 * TW}"/>` : '<w:ind w:left="0" w:right="0"/>';
        rows.push(`<w:p><w:pPr><w:pStyle w:val="${st}"/>${ind}</w:pPr>${runs(pt.text)}</w:p>`);
      });
      return rows.join('');
    }

    return out.join('\n');
  }

  function titleXml(fields, size, sect) {
    const get = (k) => (fields[k] || []).filter((s) => s.trim() !== '');
    const out = [];
    let used = 0;
    const title = get('title');
    title.forEach((t, k) => {
      out.push(p('TitlePage', t.toUpperCase(), k === 0 ? { spacingBefore: 15 * LINE } : null));
      used += k === 0 ? 16 : 1;
    });
    const authors = get('authors');
    const credit = get('credit');
    if (credit.length || authors.length) {
      (credit.length ? credit : ['Written by']).forEach((t, k) => {
        out.push(p('TitlePage', t, k === 0 ? { spacingBefore: 3 * LINE } : null));
        used += k === 0 ? 4 : 1;
      });
      authors.forEach((t, k) => {
        out.push(p('TitlePage', t, k === 0 ? { spacingBefore: LINE } : null));
        used += k === 0 ? 2 : 1;
      });
    }
    get('source').forEach((t, k) => {
      out.push(p('TitlePage', t, k === 0 ? { spacingBefore: 3 * LINE } : null));
      used += k === 0 ? 4 : 1;
    });

    const left = [...get('contact'), ...get('copyright')];
    const right = [...get('draft date'), ...get('revision'), ...get('notes')];
    const linesPerPage = Math.floor((size.h - 2) * 6);
    const n = Math.max(left.length, right.length);
    if (n) {
      const gap = Math.max(1, linesPerPage - used - n - 1);
      const col = (arr, jc) => arr.map((t) => p('Contact', t, { jc })).join('') || '<w:p/>';
      out.push(`<w:p><w:pPr><w:spacing w:before="${gap * LINE}"/></w:pPr></w:p>`);
      out.push(
        `<w:tbl><w:tblPr><w:tblW w:w="${6 * TW}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${3 * TW}"/><w:gridCol w:w="${3 * TW}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${3 * TW}" w:type="dxa"/></w:tcPr>${col(left, 'left')}</w:tc><w:tc><w:tcPr><w:tcW w:w="${3 * TW}" w:type="dxa"/></w:tcPr>${col(right, 'right')}</w:tc></w:tr></w:tbl>`
      );
    }
    // Section break closes the title page section (no page numbers there)
    out.push(`<w:p><w:pPr>${sect}</w:pPr></w:p>`);
    return out.join('\n');
  }

  /** Build a .docx (Uint8Array) from Fountain source + layout options. */
  function buildDOCX(src, options, meta) {
    const opts = Object.assign({}, SF.LAYOUT_DEFAULTS, options || {});
    const size = SF.PAGE_SIZES[opts.pageSize] || SF.PAGE_SIZES.letter;
    const parsed = SF.parse(src);
    const ns =
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

    const hasTitle = opts.titlePage && parsed.title && ((parsed.title.title || []).length || (parsed.title.authors || []).length);
    const blankHdrs = '<w:headerReference w:type="default" r:id="rIdH0"/><w:headerReference w:type="first" r:id="rIdH0"/>';
    const scriptHdrs = '<w:headerReference w:type="default" r:id="rIdH1"/><w:headerReference w:type="first" r:id="rIdH2"/>';

    let body = '';
    if (hasTitle) body += titleXml(parsed.title, size, sectPr(size, { headers: blankHdrs, extra: '<w:type w:val="nextPage"/>' })) + '\n';
    body += bodyXml(parsed, opts);
    body += sectPr(size, { headers: scriptHdrs, pgNum: '<w:pgNumType w:start="1"/>', titlePg: true });

    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${ns}><w:body>${body}</w:body></w:document>`;

    const headerText = (opts.headerText || '').trim();
    const pageField =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>.</w:t></w:r>';
    const hdr = (content) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${ns}><w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr>${content}</w:p></w:hdr>`;
    const htxt = headerText ? `<w:r><w:t xml:space="preserve">${xmlEsc(headerText)}   </w:t></w:r>` : '';

    const files = [
      {
        name: '[Content_Types].xml',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header0.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
      },
      {
        name: '_rels/.rels',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
      },
      {
        name: 'word/_rels/document.xml.rels',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdH0" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header0.xml"/><Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdH2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/></Relationships>`,
      },
      { name: 'word/document.xml', data: document },
      { name: 'word/styles.xml', data: stylesXml(opts) },
      {
        name: 'word/settings.xml',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
      },
      { name: 'word/header0.xml', data: hdr('') },
      { name: 'word/header1.xml', data: hdr(htxt + pageField) },
      { name: 'word/header2.xml', data: hdr(htxt) },
      {
        name: 'docProps/core.xml',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc((meta && meta.title) || 'Screenplay')}</dc:title><dc:creator>${xmlEsc((meta && meta.author) || '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`,
      },
      {
        name: 'docProps/app.xml',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ReelScript</Application></Properties>`,
      },
    ];
    return zip(files);
  }

  Object.assign(SF, { buildDOCX, zip, crc32 });
})(typeof window !== 'undefined' ? window : globalThis);
