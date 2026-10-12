# Recap Studio

A fast, static website that renders course-deck recaps — per-topic summary, interactive quiz, and a Mermaid diagram — from a single `recap.json`.

## Quick start

Browsers block `fetch()` on `file://` pages, so serve the folder with any static server:

```bash
npx serve .
# or
python -m http.server
```

Then open http://localhost:3000 (or the port shown).

## Features

- **Demo recaps** — pick a deck from the dropdown; renders instantly as tabs: Summary / Quiz / Diagram.
- **Interactive quiz** — 8 MCQs, instant feedback per question, explanations, running score.
- **Mermaid diagram** — flowchart rendered via CDN, dark theme, scrollable on mobile.
- **Upload your PDF** — drag & drop; `pdf.js` extracts text in your browser (truncated to 12,000 chars), then one OpenRouter LLM call produces a recap in the shared schema.
- **Your own API key** — paste it in Settings; it lives only in your browser's `localStorage` and is sent only to OpenRouter. No key needed for the demo recaps.
- **Download JSON** — save any rendered recap as `recap.json`.

## Files (all flat, no subfolders)

| File | Purpose |
|------|---------|
| `index.html` | Page structure: dropdown, upload zone, tabs, settings, boot watchdog |
| `style.css` | Dark theme, responsive layout |
| `app.js` | Recap loading, quiz, Mermaid, pdf.js upload, OpenRouter call |
| `recaps.json` | Manifest of demo recaps |
| `recap-day1.json` | Sample recap (shared schema) |
| `recap.json` | Body Language Codes recap, generated from `day1.pdf` |
| `day1.pdf` | Source deck for `recap.json` |
| `PLAN.md` | Design plan |
| `opencode.json` | MCP servers + `recap-reviewer` agent for offline generation |
| `reviewer-prompt.md` | Recap review rules (missed concepts / misrepresentation / diagram) |

## Generating recaps offline (demo decks)

Demo recaps are produced without any browser key:

1. OpenCode reads the deck PDF via the PDF MCP server.
2. The `pdf-recap` skill produces `summary` / `quiz` / `diagram` JSON.
3. The `recap-reviewer` sub-agent checks it against the slide text and returns fixes.
4. Save the result (e.g. `recap-day1.json`) and list it in `recaps.json`.

Notes from real runs:

- **pdf-reader rejects local paths** (`Please provide binary data as Uint8Array`).
  Workaround: serve the folder over HTTP (`python -m http.server`) and pass the
  PDF as `http://localhost:<port>/day1.pdf` instead of a file path.
- **Sub-agent blocked by the free-tier limit?** Skip spawning: review inline in
  the same turn per `reviewer-prompt.md`, apply fixes once, no loops.

## Recap schema

```json
{
  "title": "string",
  "summary": [{ "topic": "string", "points": ["3-5 bullets"] }],
  "quiz": [{ "q": "string", "options": ["A", "B", "C", "D"], "answer": 0, "why": "string" }],
  "diagram": "flowchart TD\n  A --> B"
}
```
