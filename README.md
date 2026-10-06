# ReelScript — Screenplay Formatter

A browser-based screenplay editor and formatter with a live page preview and one-click, industry-standard PDF export. It's a static site with no backend, build step or API keys. Open `index.html` locally, or host this repo on any static host (GitHub Pages, Netlify, S3…).

## Features

- **Formatting styles** for 13 formatters: ReelScript, Final Draft, WriterDuet, Fade In, Highland 2, Arc Studio Pro, Celtx, Movie Magic Screenwriter, StudioBinder, KIT Scenarist, Trelby, Beat, and BBC / UK (A4).
  - A style sets the font (Courier Prime or Courier), one or two blank lines before scene headings, underlining, and paper size for BBC.
  - **Bold is never part of a style.** Every one of these apps leaves bold up to the writer, so the toolbar's **Bold: Scene headings / Names** toggles control it, and switching styles never changes them.
  - PDFs embed Courier Prime when a style uses it.
- **Import from and export to other screenwriting apps**:

  | App | Import | Export |
  |---|---|---|
  | Final Draft | `.fdx` | `.fdx` |
  | Fade In | `.fadein` (Open Screenplay Format) | `.fadein` |
  | Highland 2 | `.highland` (zipped TextBundle), `.fountain` | `.highland` |
  | Celtx | `.celtx` (classic zip with script HTML), or Celtx online's PDF / `.fdx` | `.celtx` |
  | Trelby | `.trelby` | `.trelby` |
  | WriterDuet, Arc Studio Pro, Movie Magic Screenwriter, StudioBinder, KIT Scenarist | their `.fdx` / `.fountain` / PDF exports | `.fdx` (each app's Final Draft import) |
  | Beat, Slugline | `.fountain` | `.fountain` |
  | Any app | PDF with selectable text | PDF, Word `.docx` |

- **Paste from ChatGPT** or other AI chats: Markdown such as `## EPISODE 01 — "TITLE"`, `### EXT. PLACE – NIGHT`, `**KARTHIK**`, `**KARTHIK — O.S.**` and `**CUT TO BLACK.**` is converted into a proper script.
  - The title page is built from the `#` title, "Written by", Format and Genre.
  - ChatGPT's commentary (intro, "Dramatic movement", "Emotional high", closing notes) is left out, or kept as hidden notes if you choose.
- **Word export (.docx)** with real screenplay paragraph styles, so the script stays editable in Word, Google Docs or Pages. Indian scripts keep their own fonts.

- **Write in plain text ([Fountain](https://fountain.io/syntax))**: scene headings, action, characters, parentheticals, dialogue, dual dialogue, transitions, centered text, lyrics, page breaks, notes, boneyard, sections and *italic* / **bold** / _underline_.
- **Live paginated preview** that matches the PDF line for line (both are drawn from the same layout engine).
- **Industry-standard layout**:
  - Courier 12pt, 1.5″ left margin, 1″ top and bottom.
  - Dialogue at 2.5″, parentheticals at 3.1″, character cues at 3.7″, transitions flush right.
  - Page numbers top right from page 2.
  - US Letter (54 lines per page) or A4 (58 lines per page).
- **Pagination rules**:
  - Scene headings and cues are never left alone at the bottom of a page.
  - Long speeches break with `(MORE)` / `(CONT'D)`.
  - Action breaks at sentence boundaries.
  - Optional automatic `(CONT'D)`.
- **PDF export**: vector text with Courier embedded, plus a title page, scene numbers (left, right or both), page header text and a watermark. Scripts in Devanagari, Telugu, Tamil and other non-Latin scripts use *Print / Save as PDF*, which keeps every glyph.
- **Final Draft**: `.fdx` export and import. Episodes map to New Act. **Fountain** `.fountain` export and import, plus `.txt`.
- **Smart clean-up** for text pasted from Word, Docs, a PDF or a chat:
  - Normalises scene headings.
  - Turns `NAME: line` into proper cues.
  - Removes page numbers, `(MORE)` and `CONTINUED`.
  - Re-joins wrapped lines.
- **Editor helpers**:
  - Element toolbar.
  - <kbd>Tab</kbd> cycles the current line's element; <kbd>Ctrl</kbd>+<kbd>1–7</kbd> sets it directly.
  - Smart <kbd>Enter</kbd>.
  - Clicking a line in the preview jumps to it in the editor, and the preview follows the caret.
  - Outline panel (scenes, characters, stats).
- **Multiple scripts**, autosaved to the browser's local storage, with search, duplicate and delete. Dark and light themes. Responsive down to phone width.

## Files

| Path | Purpose |
| --- | --- |
| `index.html`, `styles.css` | UI |
| `js/parser.js` | Fountain parser, inline emphasis, smart clean-up, title-page helpers |
| `js/layout.js` | Geometry and pagination → page model (inches) |
| `js/export.js` | PDF (jsPDF), Final Draft export/import |
| `js/formats.js` | Highland 2, Fade In, Celtx, Trelby writers (+ Fade In / Trelby readers) |
| `js/importers.js` | Highland 2, Celtx, PDF (pdf.js) and other importers; tiny ZIP reader |
| `js/markdown.js` | ChatGPT / Markdown → Fountain converter |
| `js/docx.js` | Word .docx writer (includes a tiny ZIP writer) |
| `js/editor.js` | Final Draft–style page editor (element model ⇄ Fountain) |
| `js/app.js` | Editor, storage, preview, dialogs |
| `vendor/jspdf.umd.min.js` | jsPDF 4.2.1 (MIT), vendored so the PDF export works offline |
| `vendor/pdfjs/` | pdf.js 4.10 (Apache-2.0), loaded only when importing a PDF |
| `vendor/fonts/` | Courier Prime (SIL OFL 1.1), embedded in PDFs for Courier Prime styles |
| `tests/run.js` | Unit tests: `node tests/run.js` |

## Notes

- Scripts live only in the browser where they were written. Export `.fountain` or `.fdx` to back them up or move them between devices.
- The editor and preview use the Courier Prime web font when it's online, with Courier New as the fallback. Both have the same character width, so pagination doesn't change.
