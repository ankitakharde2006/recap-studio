# Recap Studio — Plan

> **Status:** Revision 2 is in effect (see the bottom of this file): uploads are
> now summarized **in the browser with no API key**. OpenRouter references below
> describe the original Revision 1 design, kept as a trade-off record.

## Intent
A fast, attractive static website that renders course-deck recaps from pre-generated JSON files or user-uploaded PDFs. Zero backend, flat files only.

## Constraints
- All files flat in repo root: index.html, style.css, app.js, recaps.json, recap-day1.json, README.md, PLAN.md
- No frameworks, no bundlers, no subfolders
- Dark theme, clean, mobile-first responsive
- Single clean implementation pass

## Decisions (recorded as chosen trade-offs)

### 1. PDF Reading
- Pre-generated recaps (default): Produced offline by OpenCode using the PDF MCP server + pdf-recap skill + recap-reviewer sub-agent. Output files: recap-day1.json, recap-day2.json, etc. Listed in recaps.json manifest.
- User uploads: Browser file input -> pdf.js v4 extracts text client-side -> single OpenRouter call with user's own API key (stored in localStorage only, never in code). No proxy, no backend.

### 2. Summary Structure
Per-topic objects with 3-5 concise bullets:
{ "topic": "string", "points": ["bullet1", "bullet2", "bullet3"] }

### 3. Diagram Type
Mermaid flowchart TD (directional, exam-friendly), max 12 nodes, short labels. Fallback to concept map if content is non-linear.

### 4. Quiz Format
8 MCQs with explanations:
{ "q": "string", "options": ["A","B","C","D"], "answer": 0, "why": "string" }
Answer is 0-based index.

### 5. Shared JSON Schema
{
  "title": "string",
  "summary": [{ "topic": "string", "points": ["string"] }],
  "quiz": [{ "q": "string", "options": ["string","string","string","string"], "answer": 0, "why": "string" }],
  "diagram": "flowchart TD\n  A --> B"
}
Both pre-generated and upload paths produce this exact schema.

### 6. Long Decks & Image-Only PDFs
- Truncate extracted text to ~12k chars (~3k tokens) before LLM call.
- Image-only PDFs (no selectable text): show error "No selectable text found — OCR not supported", offer to try another file.

### 7. Design Style
- Dark theme: --bg: #0d1117, --fg: #e6edf3, --accent: #58a6ff
- System font stack, CSS Grid/Flex, mobile-first breakpoints: 480px, 768px, 1024px
- Mermaid dark theme
- Subtle transitions only (0.15s)

### 8. Error States
- No API key: inline prompt to paste key into localStorage
- Bad PDF: "Could not read file — try a text-based PDF"
- Invalid JSON from model: "Model returned invalid format — retry or use a pre-generated recap"
- Rate limit: "OpenRouter rate limited — wait and retry"

## UI Layout (single page)

HEADER: Recap Studio  [pre-generated dropdown]
UPLOAD ZONE: drag/drop or click to select PDF
SUMMARY (grid: 1 col <768px, 2 col >=768px)
QUIZ (8 questions, accordion rationale)
DIAGRAM (Mermaid flowchart TD, responsive)
FOOTER

### Interaction Details
- Pre-generated dropdown: Instant client-side swap on change (no Load button)
- Upload zone: File input accepts .pdf, shows filename, Generate Recap button
- Quiz: Radio buttons per question, Check reveals green/red + why text, score counter updates
- Diagram: div class=mermaid with overflow-x:auto, max-width 100%

## File Responsibilities

| File | Purpose |
|------|---------|
| recaps.json | Manifest: [{ "id": "day1", "label": "Day 1", "file": "recap-day1.json" }, ...] |
| recap-day1.json | Pre-generated recap data (shared schema) |
| index.html | Semantic structure, dropdown, upload zone, containers |
| style.css | Dark theme, responsive layout, Mermaid-friendly |
| app.js | Load manifest, handle dropdown swap, upload -> pdf.js -> OpenRouter -> render, quiz logic, Mermaid init |
| README.md | Usage, offline generation hint, API key setup |
| PLAN.md | This file |

## Non-Goals
- No OCR, no server, no auth, no database
- No export/download (browser Save As works)
- No persistence beyond localStorage (API key, last viewed recap)

## Builder Discretion (my calls)
- Mermaid CDN: https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs
- pdf.js CDN: https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs
- OpenRouter model default: openrouter/auto (user can override in localStorage)
- Favicon: inline SVG data URI
- Missing recaps.json/pre-generated files: graceful degradation (upload only)

## Revision 2 (current)

Prompted by the user: *"browse a PDF and instantly see summary + diagram, no
API key, no extra steps — one download button"* plus *"add the quiz also
without hallucination"*.

### Revised decisions
- **Uploads: no LLM at all.** `pdf.js` extracts text (EOL-aware, up to 80 pages
  / 400k chars) → `summarize.js` builds the recap extractively in-browser.
  No Settings, no key, no Generate button, no JSON in the UI.
- **Summary:** one topic per PDF page (slide = page), heading = first line when
  it looks like one, points = bullet lines or top-scored sentences (quoted).
- **Quiz:** cloze style — a real sentence with a key term blanked; the correct
  answer and every distractor are terms that actually appear in the document.
  Up to 8 questions; `why` quotes the source sentence verbatim. Hallucination is
  impossible by construction.
- **Diagram:** nodes = section headings (fallback: top terms), chained in
  document order; ≤12 nodes; labels sanitized.
- **Download:** one button exports the whole recap as Markdown
  (`<title>-summary.md`: summary + quiz + Mermaid block).
- **Demo dropdown:** kept — instant examples with zero cost.
- **localStorage:** removed entirely (nothing left to persist).
