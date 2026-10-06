# ReelScript — Screenplay Formatter

A browser-based screenplay editor and formatter with a live page preview and one-click, industry-standard PDF export. It's a static site with no backend, build step or API keys. Open `index.html` locally, or host this repo on any static host (GitHub Pages, Netlify, S3…).

## Features

- **Formatting styles**: pick **ReelScript**, **Final Draft**, **Highland 2** or **Celtx** from the Style menu. Each one matches that app's default output:
  - bold or plain scene headings,
  - bold or plain character names,
  - one or two blank lines before a scene heading,
  - Courier Prime or Courier.

  Every option can still be changed afterwards, which shows up as "Custom". PDFs embed Courier Prime when a style uses it, so curly quotes and dashes are kept.
- **Import from other apps**:
  - Final Draft (`.fdx`)
  - Highland 2 (`.highland`, a zipped TextBundle, or its `.fountain`)
  - classic Celtx (`.celtx`)
  - any screenplay **PDF** with selectable text, including Celtx's PDF export. pdf.js reads the page layout and rebuilds scene headings, action, characters, parentheticals, dialogue, transitions and the title page.

- **Final Draft-style Script view**: you type straight onto a formatted page, and each paragraph is a screenplay element.
  - **Enter** moves to the next element, as in Final Draft: Scene Heading goes to Action, Character to Dialogue, Dialogue to Action, Transition to Scene Heading.
  - **Tab** changes the element: Action becomes Character, Character becomes Transition, and Tab at the end of a speech adds a Parenthetical.
  - An element dropdown in the toolbar shows and sets the current element.
  - SmartType suggests character names, INT./EXT., locations, times of day, (V.O.)/(O.S.) and transitions.
  - Undo and redo, and printed page boundaries are marked on the page.
- **Episodes** (Final Draft's "New Act"):
  - Written as `EPISODE 1`, `Episode 2: Title`, `EP 04 - LOST`, `ఎపిసోడ్ 3`, `एपिसोड 5`, `ACT ONE`, or anything after `#!`.
  - They print centered, bold and underlined, start a new page, restart scene numbers and appear in the outline.
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
