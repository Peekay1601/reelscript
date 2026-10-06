/*
 * ReelScript unit tests — run with:  node tests/run.js
 * No dependencies; exercises the parser, layout/pagination and exporters.
 */
'use strict';
const path = require('path');
const assert = require('assert');
['parser', 'layout', 'export', 'docx', 'editor', 'sample'].forEach((f) => require(path.join(__dirname, '..', 'js', f + '.js')));
const SF = globalThis.SF;

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`✗ ${name}\n    ${e.message}`);
  }
}
const types = (src) => SF.parse(src).tokens.map((t) => t.type);
const lineText = (it) => it.segs.map((s) => s.runs.map((r) => r.text).join('')).join(' | ');
const body = (m, page) => m.pages[page].items.filter((i) => i.kind !== 'header');

// ---------------------------------------------------------------- parser
test('recognises the core elements', () => {
  const src = 'INT. HOUSE - DAY\n\nJohn enters.\n\nJOHN\n(quietly)\nHello.\n\nCUT TO:\n\n> THE END <\n';
  assert.deepStrictEqual(types(src), ['scene_heading', 'action', 'dialogue', 'transition', 'centered']);
  const d = SF.parse(src).tokens[2];
  assert.deepStrictEqual(d.parts.map((p) => p.type), ['parenthetical', 'dialogue']);
});

test('forced elements', () => {
  assert.deepStrictEqual(types('.FLASHBACK\n\n!LOUD NOISES\n\n@McClane\nYippee.\n\n> FADE OUT\n'), ['scene_heading', 'action', 'dialogue', 'transition']);
});

test('all-caps line without dialogue is action, not a character', () => {
  assert.deepStrictEqual(types('BOOM!\n\nThe wall falls.'), ['action', 'action']);
});

test('scene numbers are extracted', () => {
  const t = SF.parse('EXT. ROOF - NIGHT #12A#\n').tokens[0];
  assert.strictEqual(t.text, 'EXT. ROOF - NIGHT');
  assert.strictEqual(t.number, '12A');
});

test('title page fields', () => {
  const p = SF.parse('Title: Big Fish\nAuthor: John August\nContact:\n    a@b.com\n    555\n\nINT. A - DAY\n');
  assert.deepStrictEqual(p.title.title, ['Big Fish']);
  assert.deepStrictEqual(p.title.contact, ['a@b.com', '555']);
  assert.deepStrictEqual(types('Title: X\n\nINT. A - DAY\n'), ['scene_heading']);
});

test('notes, boneyard and sections are not printed', () => {
  const src = '# Act One\n\n= synopsis\n\n/* hidden\nstuff */\n\nINT. A - DAY\n\n[[note]]\n\nAction [[inline]] here.\n';
  const m = SF.layout(src);
  const text = body(m, 0).map(lineText).join('\n');
  assert.ok(!/hidden|note|synopsis|Act One/.test(text), text);
  assert.ok(/Action here\./.test(text), text);
});

test('dual dialogue', () => {
  const p = SF.parse('BRICK\nScrew retirement.\n\nSTEEL ^\nScrew retirement.\n');
  assert.deepStrictEqual(p.tokens.map((t) => t.type), ['dual_dialogue']);
});

test('inline emphasis', () => {
  const runs = SF.parseInline('a *b* **c** ***d*** _e_ \\*f\\* 2*3');
  const flat = runs.map((r) => `${r.b ? 'B' : ''}${r.i ? 'I' : ''}${r.u ? 'U' : ''}[${r.text}]`).join('');
  assert.strictEqual(flat, '[a ]I[b][ ]B[c][ ]BI[d][ ]U[e][ *f* 2*3]');
});

// ---------------------------------------------------------------- layout
test('industry geometry (Courier 12pt, standard indents)', () => {
  const m = SF.layout('INT. HOUSE - DAY\n\nJohn enters.\n\nJOHN\n(quietly)\nHello.\n\nCUT TO:\n');
  const it = body(m, 0);
  const at = (txt) => it.find((i) => lineText(i).startsWith(txt));
  assert.strictEqual(at('INT.').segs[0].x, 1.5);
  assert.strictEqual(at('John').segs[0].x, 1.5);
  assert.strictEqual(at('JOHN').segs[0].x, 3.7);
  assert.strictEqual(at('(quietly)').segs[0].x, 3.1);
  assert.strictEqual(at('Hello').segs[0].x, 2.5);
  assert.ok(Math.abs(at('CUT TO:').segs[0].x + 7 * 0.1 - 7.5) < 1e-9, 'transition flush right at 7.5"');
  assert.strictEqual(m.linesPerPage, 54);
  assert.strictEqual(SF.layout('x', { pageSize: 'a4' }).linesPerPage, 58);
});

test('word wrap widths: action 60, dialogue 35 chars', () => {
  const long = 'word '.repeat(60).trim();
  const m = SF.layout(`${long}\n\nBOB\n${long}\n`);
  body(m, 0).forEach((i) => {
    const t = lineText(i);
    if (i.kind === 'action') assert.ok(t.length <= 60, t.length);
    if (i.kind === 'dialogue') assert.ok(t.length <= 35, t.length);
  });
});

test('page numbers from page 2, top right', () => {
  let src = '';
  for (let k = 0; k < 80; k++) src += `Line ${k}.\n\n`;
  const m = SF.layout(src);
  assert.ok(m.pages.length >= 2);
  assert.ok(!m.pages[0].items.some((i) => i.kind === 'header'));
  const h = m.pages[1].items.find((i) => i.kind === 'header');
  assert.strictEqual(lineText(h), '2.');
  assert.strictEqual(h.y, 0.5);
});

test('no page exceeds the line budget; scene headings never orphaned', () => {
  let src = '';
  for (let k = 0; k < 150; k++) src += `INT. ROOM ${k} - DAY\n\nSomething happens here that takes a little while to describe in detail, really.\n\nBOB\n(beat)\nI have a lot to say about this and will say it at length. Truly. Here goes nothing at all.\n\n`;
  const m = SF.layout(src);
  m.pages.forEach((p) => {
    const it = p.items.filter((i) => i.kind !== 'header');
    const last = it[it.length - 1];
    assert.ok((last.y - 1) * 6 < m.linesPerPage + 1e-6, `page ${p.number} overflows`);
    assert.notStrictEqual(last.kind, 'scene_heading', `scene heading orphaned on page ${p.number}`);
    assert.notStrictEqual(last.kind, 'character', `cue orphaned on page ${p.number}`);
  });
});

test('long speeches split with (MORE) / (CONT\'D)', () => {
  const speech = Array.from({ length: 80 }, (_, k) => `Sentence number ${k} is right here.`).join(' ');
  const m = SF.layout(`BOB\n${speech}\n`);
  assert.ok(m.pages.length >= 2);
  const p1 = body(m, 0);
  assert.strictEqual(lineText(p1[p1.length - 1]), '(MORE)');
  assert.strictEqual(lineText(body(m, 1)[0]), "BOB (CONT'D)");
});

test("auto (CONT'D) for the same speaker across action", () => {
  const m = SF.layout('INT. A - DAY\n\nBOB\nHi.\n\nHe sits.\n\nBOB\nBye.\n');
  const cues = body(m, 0).filter((i) => i.kind === 'character').map(lineText);
  assert.deepStrictEqual(cues, ['BOB', "BOB (CONT'D)"]);
  const off = SF.layout('INT. A - DAY\n\nBOB\nHi.\n\nHe sits.\n\nBOB\nBye.\n', { autoContd: false });
  assert.deepStrictEqual(body(off, 0).filter((i) => i.kind === 'character').map(lineText), ['BOB', 'BOB']);
});

test('page break ===', () => {
  const m = SF.layout('One.\n\n===\n\nTwo.\n');
  assert.strictEqual(m.pages.length, 2);
});

test('scene numbers in margins', () => {
  const m = SF.layout('INT. A - DAY #7#\n\nX.\n', { sceneNumbers: 'both' });
  const h = body(m, 0)[0];
  assert.strictEqual(h.segs.length, 3);
});

test('title page', () => {
  const m = SF.layout(SF.SAMPLE);
  assert.ok(m.titlePage);
  assert.ok(m.titlePage.items.some((i) => lineText(i) === 'THE LAST CHAI'));
  assert.strictEqual(SF.layout(SF.SAMPLE, { titlePage: false }).titlePage, null);
});

// ---------------------------------------------------------------- clean-up
test('smart clean-up of pasted / chat-style scripts', () => {
  const messy = 'int tea stall - night\nRain falls on the roof and\nnobody cares.\nRAVI: Two chai.\nMEERA: Make it three.\n12.\n          RAVI\n     (smiling)\n     You are late.\n(MORE)\nCUT TO:\nEXT. STREET - DAY\nShe walks.';
  const out = SF.cleanup(messy);
  assert.deepStrictEqual(types(out), ['scene_heading', 'action', 'dialogue', 'dialogue', 'dialogue', 'transition', 'scene_heading', 'action']);
  assert.ok(out.startsWith('INT. TEA STALL - NIGHT\n'), out);
  assert.ok(!/\(MORE\)|^12\.$/m.test(out), out);
});

test('clean-up is idempotent on clean Fountain', () => {
  const once = SF.cleanup(SF.SAMPLE);
  assert.strictEqual(SF.cleanup(once), once);
  assert.deepStrictEqual(types(once), types(SF.SAMPLE));
});

test('title page read / write', () => {
  const src = SF.setTitleFields('INT. A - DAY\n', { title: 'X', authors: 'A\nB', contact: '' });
  assert.ok(src.startsWith('Title: X\nAuthor:\n    A\n    B\n\nINT. A - DAY'), src);
  assert.strictEqual(SF.getTitleFields(src).authors, 'A\nB');
  assert.strictEqual(SF.setTitleFields(src, {}).trim(), 'INT. A - DAY');
});

// ---------------------------------------------------------------- exporters
test('FDX export contains typed paragraphs and escapes XML', () => {
  const x = SF.toFDX('INT. A & B - DAY\n\nBOB\n(beat)\n<Hi> **there**\n');
  assert.ok(x.includes('<Paragraph Type="Scene Heading"><Text>INT. A &amp; B - DAY</Text>'));
  assert.ok(x.includes('<Paragraph Type="Parenthetical">'));
  assert.ok(x.includes('<Text>&lt;Hi&gt; </Text><Text Style="Bold">there</Text>'));
});

test('PDF text sanitising + unsupported character detection', () => {
  assert.strictEqual(SF.pdfSafe('“Hi” — it’s…'), '"Hi" -- it\'s...');
  const m = SF.layout('INT. A - DAY\n\nనమస్తే\n');
  assert.ok(SF.unsupportedChars(m).length > 0);
  assert.strictEqual(SF.unsupportedChars(SF.layout('Café crème.')).length, 0);
});

test('PDF builds with jsPDF', () => {
  const jsPDF = require(path.join(__dirname, '..', 'vendor', 'jspdf.umd.min.js')).jsPDF;
  globalThis.jspdf = { jsPDF };
  const doc = SF.buildPDF(SF.layout(SF.SAMPLE, { watermark: 'DRAFT' }), { title: 'T' });
  assert.strictEqual(doc.getNumberOfPages(), 3); // title page + episode 1 + episode 2 (starts a new page)
  const out = doc.output();
  assert.ok(out.startsWith('%PDF-'));
  assert.ok(/Courier/.test(out));
});

// ---------------------------------------------------------------- episodes
test('episode headings in many spellings', () => {
  ['EPISODE 1', 'Episode 2: The Return', 'EP 04 - LOST', 'EP.5', 'ఎపిసోడ్ 3', 'एपिसोड 7', 'ACT ONE', '# Episode 9', '#! The Pilot'].forEach((h) => {
    assert.deepStrictEqual(types(`${h}\n\nINT. A - DAY\n`), ['episode', 'scene_heading'], h);
  });
});

test('episode directly above a scene heading is not read as a character', () => {
  assert.deepStrictEqual(types('EPISODE 1\nINT. HOUSE - DAY\n\nHi.'), ['episode', 'scene_heading', 'action']);
  assert.deepStrictEqual(types('EP 2\nRavi walks.\nHe stops.'), ['episode', 'action']);
  assert.deepStrictEqual(types('EPIC\nHello.'), ['dialogue']);
});

test('episodes: new page, centered bold underline, scene numbers restart', () => {
  const m = SF.layout('EPISODE 1\n\nINT. A - DAY\n\nX.\n\nINT. B - DAY\n\nY.\n\nEPISODE 2\n\nINT. C - DAY\n\nZ.', { sceneNumbers: 'left', numberScenesAutomatically: true });
  assert.strictEqual(m.pages.length, 2);
  const ep = body(m, 1)[0];
  assert.strictEqual(ep.kind, 'episode');
  assert.ok(ep.segs[0].runs[0].b && ep.segs[0].runs[0].u);
  assert.deepStrictEqual(m.stats.scenes.map((s) => s.number), ['1', '2', '1']);
  assert.strictEqual(m.stats.episodes.length, 2);
  const one = SF.layout('EPISODE 1\n\nX.\n\nEPISODE 2\n\nY.', { episodeNewPage: false });
  assert.strictEqual(one.pages.length, 1);
});

test('FDX: episodes export as New Act and import back', () => {
  const x = SF.toFDX('EPISODE 1\n\nINT. A - DAY\n\nX.\n\nEPISODE 2\n\nY.');
  assert.ok(x.includes('<Paragraph Type="New Act"><Text>EPISODE 1</Text>'));
  assert.ok(x.includes('<Paragraph Type="New Act" StartsNewPage="Yes"><Text>EPISODE 2</Text>'));
});

// ---------------------------------------------------------------- script editor model
test('script editor ⇄ Fountain round-trip is lossless for printable content', () => {
  const sig = (m) => m.pages.map((p) => p.items.map((i) => i.segs.map((s) => s.x.toFixed(2) + s.runs.map((r) => (r.b ? 'B' : '') + (r.i ? 'I' : '') + (r.u ? 'U' : '') + r.text).join('')).join('|')).join('\n')).join('\n==\n');
  [SF.SAMPLE, 'EPISODE 1\nINT. A - DAY\n\nLOUD BANG!\n\nCUT TO:\n\nCUT TO: THE CHASE\n\nBOB\n(beat)\n**bold***it* _u_\nline two\n\nALICE ^\nHi.\n\n===\n\n> THE END <'].forEach((src) => {
    const { titleBlock, els } = SF.editorFromFountain(src);
    const back = SF.editorToFountain(titleBlock, els).text;
    assert.strictEqual(sig(SF.layout(back)), sig(SF.layout(src)));
  });
});

test('script editor: speech without a cue is kept as action, all-caps action is forced', () => {
  const { text } = SF.editorToFountain('', [
    { type: 'dialogue', text: 'Orphan line.' },
    { type: 'action', text: 'BOOM' },
    { type: 'character', text: 'bob' },
    { type: 'dialogue', text: 'Hi.' },
  ]);
  assert.deepStrictEqual(types(text), ['action', 'action', 'dialogue']);
  assert.ok(text.includes('BOB\nHi.'));
});

// ---------------------------------------------------------------- docx
test('DOCX is a valid zip with screenplay styles', () => {
  const bytes = SF.buildDOCX(SF.SAMPLE, {}, { title: 'T' });
  const buf = Buffer.from(bytes);
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50);
  const str = buf.toString('utf8');
  ['word/document.xml', 'word/styles.xml', '[Content_Types].xml', 'w:styleId="SceneHeading"', 'w:styleId="Episode"', 'w:pStyle w:val="Character"', 'EPISODE 1: THE FIRST CUP', 'w:pageBreakBefore'].forEach((needle) => assert.ok(str.includes(needle), needle));
  // CRC of stored entries must match
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const crc = buf.readUInt32LE(p + 14);
    const size = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26);
    const data = buf.subarray(p + 30 + nlen, p + 30 + nlen + size);
    assert.strictEqual(SF.crc32(data), crc);
    p += 30 + nlen + size;
  }
});

// ----------------------------------------------------------------
console.log(failures.join('\n'));
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
