# ReelScript — Screenplay Formatter

A browser-based screenplay editor and formatter with a live page preview and one-click, industry-standard PDF export. It's a static site with no backend, build step or API keys. Open `formatter/index.html` or host the folder anywhere (GitHub Pages, Netlify, S3…).

## Features

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
- **Final Draft**: `.fdx` export and import. **Fountain** `.fountain` export and import, plus `.txt`.
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
| `js/app.js` | Editor, storage, preview, dialogs |
| `vendor/jspdf.umd.min.js` | jsPDF 4.2.1 (MIT), vendored so the PDF export works offline |
| `tests/run.js` | Unit tests: `node tests/run.js` |

## Notes

- Scripts live only in the browser where they were written. Export `.fountain` or `.fdx` to back them up or move them between devices.
- The editor and preview use the Courier Prime web font when it's online, with Courier New as the fallback. Both have the same character width, so pagination doesn't change.
