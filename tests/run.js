/*
 * ReelScript unit tests — run with:  node tests/run.js
 * No dependencies; exercises the parser, layout/pagination and exporters.
 */
'use strict';
const path = require('path');
const assert = require('assert');
['parser', 'layout', 'export', 'docx', 'markdown', 'editor', 'importers', 'formats', 'files', 'sample'].forEach((f) => require(path.join(__dirname, '..', 'js', f + '.js')));
const SF = globalThis.SF;

let passed = 0;
const failures = [];
const pending = [];
function test(name, fn) {
  const fail = (e) => failures.push(`✗ ${name}\n    ${e.message}`);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => passed++, fail));
    else passed++;
  } catch (e) {
    fail(e);
  }
}
const types = (src) => SF.parse(src).tokens.map((t) => t.type);
const lineText = (it) => it.segs.map((s) => s.runs.map((r) => r.text).join('')).join(' | ');
const body = (m, page) => m.pages[page].items.filter((i) => i.kind !== 'header');

// ---------------------------------------------------------------- files (save to computer)
test('save serializes by the chosen file extension', async () => {
  const sc = { id: 'x', name: 'Test', content: 'INT. HOUSE - DAY\n\nJOHN\nHi.\n', settings: SF.LAYOUT_DEFAULTS };
  assert.strictEqual(SF.Files.serialize(sc, 'a.fountain'), sc.content);
  assert.ok(/<FinalDraft/.test(SF.Files.serialize(sc, 'My Script.FDX')));
  assert.ok(/\[Scene Heading\]|INT\. HOUSE/.test(String(SF.Files.serialize(sc, 'x.trelby'))));
  for (const ext of ['highland', 'fadein', 'celtx']) {
    const z = SF.Files.serialize(sc, 'x.' + ext);
    assert.ok(z instanceof Uint8Array && z[0] === 0x50 && z[1] === 0x4b, ext + ' is a zip');
    const files = await SF.unzip(z);
    const all = [...files.values()].map((f) => new TextDecoder().decode(f)).join('\n');
    assert.ok(/JOHN/.test(all), ext + ' contains the script');
  }
  assert.strictEqual(SF.Files.extOf('a.b.FadeIn'), 'fadein');
  assert.strictEqual(SF.Files.extOf('noext'), 'fountain');
  assert.ok(SF.Files.canWriteBack('draft.fountain') && SF.Files.canWriteBack('x.txt'));
  assert.ok(!SF.Files.canWriteBack('x.fdx') && !SF.Files.canWriteBack('x.pdf') && !SF.Files.canWriteBack('x.md'));
  assert.strictEqual(SF.Files.canPickFiles(), false);
});

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
  assert.ok(x.includes('<Paragraph Type="Scene Heading"><Text Style="Bold">INT. A &amp; B - DAY</Text>'));
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

// ---------------------------------------------------------------- ChatGPT / Markdown
const CHATGPT = [
  '# YOUR TURN, THEN MINE',
  '### 30-episode microdrama adaptation',
  '**Written by KODATI PAVAN KALYAN**  ',
  '**Format:** 30 episodes × approximately 2 minutes  ',
  '**Genre:** Romantic drama',
  '',
  'Your story’s strongest hook is already there: **two people** who love each other. [1]',
  '',
  '---',
  '',
  '## EPISODE 01 — “NOT WITHOUT YOU”',
  '**Dramatic movement:** A failed performance becomes the beginning of a shared dream.  ',
  '**Emotional high:** She refuses applause that excludes him.',
  '',
  '### EXT. NEIGHBOURHOOD STAGE, RAJAHMUNDRY – NIGHT',
  '',
  'A dance track CUTS OUT.',
  '',
  '**KARTHIK**  ',
  'I can play. Keep dancing.',
  '',
  '**KARTHIK — O.S.**  ',
  '(softly)  ',
  'Again.',
  '',
  '### MOMENTS LATER',
  '',
  '**SUPER: FIFTEEN YEARS LATER.**',
  '',
  '*This is a performance-led episode. Its runtime should come from actual dance and music.*',
  '',
  '**END IMAGE:** Two children eating.',
  '',
  '**CUT TO BLACK.**',
  '',
  '---',
  '',
  '## What this episodic version protects',
  '',
  '- **Karthik remains loving and flawed.**',
].join('\n');

test('ChatGPT markdown is detected (and plain Fountain is not)', () => {
  assert.ok(SF.looksMarkdown(CHATGPT));
  assert.ok(!SF.looksMarkdown(SF.SAMPLE));
  assert.ok(!SF.looksMarkdown('INT. A - DAY\n\nBOB\nHi.\n'));
});

test('ChatGPT markdown → title page, episodes, scenes, cues, transitions; commentary removed', () => {
  const r = SF.convertPasted(CHATGPT);
  const p = SF.parse(r.text);
  assert.deepStrictEqual(p.title.title, ['YOUR TURN, THEN MINE']);
  assert.deepStrictEqual(p.title.authors, ['KODATI PAVAN KALYAN']);
  assert.ok(p.title.notes.join(' ').includes('Genre: Romantic drama'));
  assert.deepStrictEqual(p.tokens.map((t) => t.type), ['episode', 'scene_heading', 'action', 'dialogue', 'dialogue', 'scene_heading', 'action', 'action', 'transition']);
  assert.strictEqual(p.tokens[0].text, 'EPISODE 01 — “NOT WITHOUT YOU”');
  assert.strictEqual(p.tokens[3].character, 'KARTHIK');
  assert.strictEqual(p.tokens[4].character, 'KARTHIK (O.S.)');
  assert.deepStrictEqual(p.tokens[4].parts.map((x) => x.type), ['parenthetical', 'dialogue']);
  assert.ok(!/Dramatic movement|Emotional high|strongest hook|protects|performance-led|\[1\]|---|\*\*KARTHIK/.test(r.text), r.text);
  assert.ok(r.notes >= 5);
});

test('ChatGPT commentary can be kept as hidden notes', () => {
  const r = SF.convertPasted(CHATGPT, { keepNotes: true });
  assert.ok(r.text.includes('[[**Dramatic movement:**'));
  const printed = SF.layout(r.text).pages.map((pg) => pg.items.map(lineText).join('\n')).join('\n');
  assert.ok(!/Dramatic movement/.test(printed));
});

test('### scene headings typed directly in Fountain still print', () => {
  assert.deepStrictEqual(types('### EXT. ROOF - NIGHT\n\nWind.'), ['scene_heading', 'action']);
});

test('no # line ever disappears, even unconverted', () => {
  const src = '# MY SHOW\nSome intro text.\n## EPISODE 3 — THE END\n### MOMENTS LATER\n### Ext. beach - day\n### MATCH CUT:\n## What this protects\n# Act One\nAction under it.';
  const p = SF.parse(src);
  assert.deepStrictEqual(p.title.title, ['MY SHOW']);
  assert.deepStrictEqual(p.tokens.map((t) => t.type), ['action', 'episode', 'scene_heading', 'scene_heading', 'transition', 'action', 'action', 'action']);
  const printed = SF.layout(src).pages.map((pg) => pg.items.map(lineText).join('\n')).join('\n');
  ['Some intro text.', 'EPISODE 3', 'MOMENTS LATER', 'EXT. BEACH', 'MATCH CUT:', 'What this protects', 'Act One', 'Action under it.'].forEach((w) => assert.ok(printed.includes(w), w));
  const docx = Buffer.from(SF.buildDOCX(src, {})).toString('utf8');
  ['EPISODE 3', 'MOMENTS LATER', 'What this protects'].forEach((w) => assert.ok(docx.includes(w), 'docx ' + w));
  const fdx = SF.toFDX(src);
  ['EPISODE 3', 'MOMENTS LATER', 'What this protects'].forEach((w) => assert.ok(fdx.includes(w), 'fdx ' + w));
});

test('character names are bold by default (and optional)', () => {
  const src = 'INT. A - DAY\n\nBOB\nHi.\n\nALICE\nHey.\n\nBOB ^\nYo.\n';
  const cues = (m) => body(m, 0).filter((i) => i.kind === 'character' || i.kind === 'dual');
  const dualCueLine = cues(SF.layout(src)).find((i) => i.kind === 'dual');
  assert.ok(dualCueLine.segs.every((sg) => sg.runs.every((r) => r.b)), 'dual cues bold');
  assert.ok(body(SF.layout(src), 0).filter((i) => i.kind === 'character').every((i) => i.segs[0].runs.every((r) => r.b)));
  assert.ok(body(SF.layout(src, { boldCharacterNames: false }), 0).filter((i) => i.kind === 'character').every((i) => i.segs[0].runs.every((r) => !r.b)));
  const speech = Array.from({ length: 80 }, (_, k) => `Sentence number ${k} is right here.`).join(' ');
  const m = SF.layout(`BOB\n${speech}\n`);
  assert.ok(body(m, 1)[0].segs[0].runs.every((r) => r.b), "CONT'D cue bold too");
  assert.ok(Buffer.from(SF.buildDOCX(src, {})).toString('utf8').includes('<w:caps/><w:b/><w:bCs/>'));
  assert.ok(SF.toFDX(src).includes('<Paragraph Type="Character"><Text Style="Bold">BOB</Text>'));
});

test('ChatGPT text copied as plain text (no # or **) converts the same way', () => {
  const plain = CHATGPT.split('\n')
    .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\*(\S.*\S)\*$/, '$1').replace(/^-{3,}$/, '').replace(/^- /, '').replace(/\s+$/, ''))
    .join('\n');
  assert.ok(SF.looksMarkdown(plain));
  const p = SF.parse(SF.convertPasted(plain).text);
  assert.deepStrictEqual(p.title.title, ['YOUR TURN, THEN MINE']);
  assert.deepStrictEqual(p.title.authors, ['KODATI PAVAN KALYAN']);
  assert.deepStrictEqual(p.tokens.filter((t) => t.type === 'episode').map((t) => t.text), ['EPISODE 01 — “NOT WITHOUT YOU”']);
  assert.deepStrictEqual(p.tokens.filter((t) => t.type === 'dialogue').map((t) => t.character), ['KARTHIK', 'KARTHIK (O.S.)']);
  assert.deepStrictEqual(p.tokens.filter((t) => t.type === 'scene_heading').map((t) => t.text), ['EXT. NEIGHBOURHOOD STAGE, RAJAHMUNDRY – NIGHT', 'MOMENTS LATER']);
  const txt = SF.convertPasted(plain).text;
  assert.ok(!/Dramatic movement|Emotional high|strongest hook|protects|performance-led/.test(txt), txt);
});

test('converting already-converted text changes nothing (no double markers)', () => {
  const once = SF.convertPasted(CHATGPT).text;
  assert.strictEqual(SF.cleanup(once), once);
  const { titleBlock, els } = SF.editorFromFountain(CHATGPT);
  const again = SF.convertPasted(SF.editorToFountain(titleBlock, els).text).text;
  assert.ok(!/^(!\.|!!|!>|\.\.|!\*\*)/m.test(again), again);
});

test('notes on their own line become note elements in Script view and round-trip', () => {
  const src = 'INT. A - DAY\n\n[[Dramatic movement: x]]\n\nHi.\n';
  const { els, lost } = SF.editorFromFountain(src);
  assert.strictEqual(lost, false);
  assert.deepStrictEqual(els.map((e) => e.type), ['scene_heading', 'note', 'action']);
  const back = SF.editorToFountain('', els).text;
  assert.ok(back.includes('[[Dramatic movement: x]]'));
  assert.ok(!SF.layout(back).pages[0].items.some((i) => /Dramatic/.test(lineText(i))));
});

test('scene headings are bold by default, like modern Final Draft scripts', () => {
  const src = 'EXT. VENNELA’S RIVERSIDE TERRACE – DAY\n\nShe dances.\n';
  const h = body(SF.layout(src), 0)[0];
  assert.strictEqual(lineText(h), 'EXT. VENNELA’S RIVERSIDE TERRACE – DAY');
  assert.ok(h.segs[0].runs.every((r) => r.b));
  assert.ok(body(SF.layout(src, { boldSceneHeadings: false }), 0)[0].segs[0].runs.every((r) => !r.b));
  assert.ok(SF.toFDX(src).includes('<Paragraph Type="Scene Heading"><Text Style="Bold">'));
  assert.ok(/styleId="SceneHeading">[\s\S]{0,300}<w:b\/>/.test(Buffer.from(SF.buildDOCX(src, {})).toString('utf8')));
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

// ---------------------------------------------------------------- styles & importers
test('format styles: 13 app presets, detected back, never touch bold', () => {
  const keys = Object.keys(SF.STYLE_PRESETS);
  assert.ok(keys.length >= 13);
  ['finaldraft', 'writerduet', 'fadein', 'highland', 'arcstudio', 'celtx', 'moviemagic', 'studiobinder', 'kitscenarist', 'trelby', 'beat', 'bbc'].forEach((k) => assert.ok(keys.includes(k), k));
  keys.forEach((k) => {
    const st = SF.applyStyle({ ...SF.LAYOUT_DEFAULTS, boldSceneHeadings: true, boldCharacterNames: true }, k);
    assert.strictEqual(SF.detectStyle(st), k, k);
    assert.strictEqual(st.boldSceneHeadings, true, k + ' kept bold scene headings');
    assert.strictEqual(st.boldCharacterNames, true, k + ' kept bold names');
    const off = SF.applyStyle({ ...SF.LAYOUT_DEFAULTS, boldSceneHeadings: false, boldCharacterNames: false }, k);
    assert.strictEqual(off.boldSceneHeadings, false, k + ' kept plain');
  });
  assert.strictEqual(SF.detectStyle(SF.LAYOUT_DEFAULTS), 'reelscript');
  assert.strictEqual(SF.detectStyle({ ...SF.applyStyle({ ...SF.LAYOUT_DEFAULTS }, 'highland'), doubleSpaceSceneHeadings: true }), 'custom');
  assert.strictEqual(SF.applyStyle({}, 'bbc').pageSize, 'a4');
  const paper = SF.applyStyle(SF.applyStyle({ pageSize: 'letter' }, 'bbc'), 'finaldraft');
  assert.strictEqual(paper.pageSize, 'letter', 'leaving BBC restores the paper');
  const src = 'INT. A - DAY\n\nBOB\nHi.\n';
  keys.forEach((k) => {
    const it = body(SF.layout(src, { ...SF.applyStyle({ ...SF.LAYOUT_DEFAULTS }, k) }), 0);
    assert.ok(it[0].segs[0].runs.every((r) => r.b), k + ': scene heading bold by default');
    assert.ok(it[1].segs[0].runs.every((r) => r.b), k + ': name bold by default');
  });
  const two = 'X.\n\nINT. B - DAY\n';
  const gap = (st) => { const it = body(SF.layout(two, SF.applyStyle({}, st)), 0); return Math.round((it[1].y - it[0].y) * 6); };
  assert.strictEqual(gap('finaldraft'), 3);
  assert.strictEqual(gap('celtx'), 2);
});

test('Courier Prime PDF keeps curly quotes and dashes', () => {
  assert.strictEqual(SF.primeSafe('“Hi” — it’s…'), '“Hi” — it’s…');
  assert.strictEqual(SF.pdfSafe('“Hi” — it’s…'), '"Hi" -- it\'s...');
});

test('Highland 2: .highland zip (deflated TextBundle) imports its text.fountain', async () => {
  const buf = Buffer.from('UEsDBBQAAAAIAJNZRl2HWfISLQAAAC0AAAAaAAAAeC50ZXh0YnVuZGxlL3RleHQuZm91bnRhaW7z9AvRU/DwDw12VdBV8PN09wjh4gpKzMxTSEvMySnWA3Icwzy5PFJzcvL1uABQSwECFAMUAAAACACTWUZdh1nyEi0AAAAtAAAAGgAAAAAAAAAAAAAAgAEAAAAAeC50ZXh0YnVuZGxlL3RleHQuZm91bnRhaW5QSwUGAAAAAAEAAQBIAAAAZQAAAAAA', 'base64');
  const files = await SF.unzip(buf);
  assert.ok(files.has('x.textbundle/text.fountain'));
  const t = await SF.fromHighland(buf);
  assert.deepStrictEqual(types(t), ['scene_heading', 'action', 'dialogue']);
});

// ---------------------------------------------------------------- other apps' native formats
const shape = (src) => SF.parse(src).tokens.filter((t) => !['note', 'page_break'].includes(t.type)).map((t) => (t.type === 'dual_dialogue' ? 'dialogue,dialogue' : t.type === 'centered' ? 'action' : t.type)).join(',');

test('Trelby: export follows Trelby\'s file rules and imports back', () => {
  const out = SF.toTrelby(SF.SAMPLE);
  const lines = out.replace(/^\uFEFF/, '').split('\n').filter(Boolean);
  assert.strictEqual(lines[0], '#Version 3');
  const start = lines.indexOf('#Start-Script ');
  assert.ok(start > 0);
  let prev = null;
  lines.slice(start + 1).forEach((l) => {
    assert.ok('>|.'.includes(l[0]), 'linebreak char ' + l);
    assert.ok('\\._:(/=@%'.includes(l[1]), 'element char ' + l);
    if (prev) assert.strictEqual(l[1], prev, 'element type changes only after "."');
    prev = l[0] === '.' ? null : l[1];
  });
  assert.strictEqual(shape(SF.fromTrelby(out)), shape(SF.SAMPLE).replace('dialogue,dialogue,action,transition,episode', 'dialogue,dialogue,action,transition,episode'));
  // Trelby v1 file (as shipped in Trelby's repo): wrapped lines, forced breaks, notes
  const v1 = '\uFEFF#Version 1\n.\\INT. WAREHOUSE - NIGHT\n>.JIM stands in\n..the middle.\n._JIM\n.((beat)\n>:What are you\n.:doing?\n|.Line one\n..line two\n.%A note\n./CUT TO:\n';
  const t = SF.fromTrelby(v1);
  assert.ok(t.includes('JIM stands in the middle.'));
  assert.ok(t.includes('What are you doing?'));
  assert.ok(t.includes('Line one\nline two'));
  assert.ok(t.includes('[[A note]]'));
  assert.strictEqual(shape(t), 'scene_heading,action,dialogue,action,transition');
});

test('Highland 2: .highland export is a TextBundle that imports back', async () => {
  const zipBytes = SF.toHighland(SF.SAMPLE, 'The Last Chai');
  const files = await SF.unzip(zipBytes);
  assert.ok(files.has('The Last Chai.textbundle/text.fountain'));
  assert.ok(files.has('The Last Chai.textbundle/info.json'));
  assert.strictEqual(shape(await SF.fromHighland(zipBytes)), shape(SF.SAMPLE));
});

test('Fade In and Celtx exports are well-formed zips with the expected parts', async () => {
  const fi = await SF.unzip(SF.toFadeIn(SF.SAMPLE, 'x'));
  const xml = new TextDecoder().decode(fi.get('document.xml'));
  assert.ok(xml.includes('<document type="Open Screenplay Format document"'));
  assert.ok(xml.includes('<para><style basestylename="Scene Heading" number="1"/><text>EXT. MUMBAI LOCAL TRAIN STATION - NIGHT</text></para>'));
  assert.ok(/<para><style basestylename="Character"\/><text>MEERA<\/text><\/para>/.test(xml));
  assert.ok(!/^\s*<para page_break/m.test(xml.split('<paragraphs>')[1].split('\n')[1]), 'no page break before the first paragraph');
  const cx = await SF.unzip(SF.toCeltx(SF.SAMPLE, 'x'));
  const names = [...cx.keys()];
  assert.ok(names.includes('project.rdf') && names.includes('local.rdf') && names.some((n) => /^script-\w+\.html$/.test(n)));
  const html = new TextDecoder().decode(cx.get(names.find((n) => /^script-/.test(n))));
  assert.ok(html.includes('<p class="sceneheading">EXT. MUMBAI LOCAL TRAIN STATION - NIGHT<br>'));
  assert.ok(html.includes('<p class="dialog">'));
  const proj = new TextDecoder().decode(cx.get('project.rdf'));
  assert.ok(proj.includes('cx:localFile="' + names.find((n) => /^script-/.test(n)) + '"'));
  assert.ok(proj.includes('http://celtx.com/NS/v1/ScriptDocument'));
});

// ---------------------------------------------------------------- Word-style formatting
test('rich formatting markers: strike, colour, highlight parse; invisible to plain text', () => {
  const r = SF.parseInline('A [[rs:c=#C00]]red[[rs:/c]] [[rs:s]]cut[[rs:/s]] [[rs:h=#ff0]]hi[[rs:/h]]');
  assert.deepStrictEqual(r.map((x) => [x.text, x.c || '', x.s || false, x.h || '']), [['A ', '', false, ''], ['red', '#c00', false, ''], [' ', '', false, ''], ['cut', '', true, ''], [' ', '', false, ''], ['hi', '', false, '#ff0']]);
  assert.strictEqual(SF.plainText('X [[rs:s]]y[[rs:/s]] [[rs:align=right]]'), 'X y ');
  // markers never change what element a line is
  assert.deepStrictEqual(types('INT. A - DAY [[rs:align=center]]\n\nRAVI [[rs:c=#c00]]\n(beat) [[rs:align=right]]\nHi.\n\nCUT TO: [[rs:align=left]]\n'), ['scene_heading', 'dialogue', 'transition']);
  assert.deepStrictEqual(SF.parse('RAVI\n(beat) [[rs:align=right]]\nHi.').tokens[0].parts.map((p) => p.type), ['parenthetical', 'dialogue']);
  // they are not Fountain notes (scripts with them still open in Script view)
  assert.strictEqual(SF.editorFromFountain('Hi [[rs:s]]x[[rs:/s]]. [[rs:align=right]]\n').lost, false);
});

test('alignment: left / center / right / justify in the page layout', () => {
  const words = 'word '.repeat(20).trim();
  const lay = (a) => body(SF.layout(`${words} [[rs:align=${a}]]\n`), 0);
  assert.strictEqual(lay('left')[0].segs[0].x, 1.5);
  const c = lay('center');
  const lastC = c[c.length - 1];
  assert.ok(Math.abs(lastC.segs[0].x + (lineText(lastC).length * 0.1) / 2 - 4.5) < 0.06, 'centered in the 1.5"–7.5" column');
  const r = lay('right');
  assert.ok(Math.abs(r[0].segs[0].x + lineText(r[0]).length * 0.1 - 7.5) < 1e-9, 'flush right at 7.5"');
  const j = lay('justify');
  assert.strictEqual(lineText(j[0]).length, 60, 'justified lines fill the 60-char column');
  assert.ok(lineText(j[j.length - 1]).length < 60, 'last line not stretched');
  // transitions default right; can be set left
  assert.strictEqual(body(SF.layout('CUT TO: [[rs:align=left]]\n'), 0)[0].segs[0].x, 1.5);
});

test('formatting reaches Final Draft, Word and the page editor round trip', () => {
  const src = 'INT. A - DAY [[rs:align=center]]\n\nHi [[rs:c=#c00]]red[[rs:/c]] [[rs:s]]cut[[rs:/s]] [[rs:h=#ffeb3b]]mark[[rs:/h]]. [[rs:align=right]]\n\nRAVI\n(beat) [[rs:align=center]]\nHello [[rs:align=justify]]\n';
  const fdx = SF.toFDX(src);
  assert.ok(fdx.includes('<Paragraph Type="Scene Heading" Alignment="Center">'));
  assert.ok(fdx.includes('<Text Color="#CCCC00000000">red</Text>'));
  assert.ok(fdx.includes('<Text Style="Strikeout">cut</Text>'));
  assert.ok(fdx.includes('<Text Background="#FFFFEBEB3B3B">mark</Text>'));
  assert.ok(fdx.includes('<Paragraph Type="Dialogue" Alignment="Full">'));
  const docx = Buffer.from(SF.buildDOCX(src, {})).toString('utf8');
  ['<w:strike/>', '<w:color w:val="CC0000"/>', 'w:fill="FFEB3B"', '<w:jc w:val="both"/>', '<w:jc w:val="right"/>'].forEach((n) => assert.ok(docx.includes(n), n));
  const sig = (m) => m.pages.map((p) => p.items.map((i) => i.segs.map((sg) => sg.x.toFixed(2) + JSON.stringify(sg.runs)).join('|')).join('\n')).join('==');
  const { titleBlock, els } = SF.editorFromFountain(src);
  assert.strictEqual(sig(SF.layout(SF.editorToFountain(titleBlock, els).text)), sig(SF.layout(src)));
});

// ----------------------------------------------------------------
Promise.all(pending).then(() => {
  console.log(failures.join('\n'));
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
});
