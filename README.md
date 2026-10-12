# Recap Studio

A static website that turns course-deck PDFs into exam-ready recaps: a per-topic
**summary**, an interactive **quiz**, and a **Mermaid diagram** — rendered from a
single JSON file. Zero backend, zero frameworks, all files flat in one folder.

## What it does

- **Demo recaps** — pick a deck from the dropdown; it swaps instantly and renders
  as three tabs: Summary / Quiz / Diagram.
- **Interactive quiz** — 8 MCQs with instant ✓/✗ feedback, explanation per
  question, and a running score.
- **Mermaid diagram** — a `flowchart TD` rendered from text via CDN, dark theme,
  scrollable on mobile.
- **Upload your own PDF** — drag & drop; `pdf.js` extracts text in your browser
  (truncated to 12,000 chars), then **one** OpenRouter LLM call produces a recap
  in the same schema.
- **Your own API key** — pasted into Settings, stored only in the browser's
  `localStorage`, sent only to OpenRouter. Demo recaps work with no key at all.
- **Download JSON** — save any rendered recap.

```bash
npx serve .          # or: python -m http.server
```

Then open the shown URL (browsers block `fetch()` on `file://` pages).

## Why these planning decisions

The full trade-off record lives in [`PLAN.md`](PLAN.md); the reasoning in short:

| Decision | Why |
|----------|-----|
| **Hybrid: pre-generated recaps by default, upload as secondary** | The demo works offline, loads instantly, needs no API key, and costs nothing at runtime. Uploading is the escape hatch for *your* decks. |
| **Static site, no backend, no frameworks** | Hosts free anywhere (GitHub Pages), nothing to build or maintain, no server that could leak a key. |
| **User's own OpenRouter key in `localStorage` only** | The site never embeds a key and there is no proxy — so no shared secret to expose. Without a key, demos still work and the UI explains what to do. |
| **Exactly one LLM call, no retry loops** | Predictable cost; a failed call shows a friendly error instead of burning credits (the `quota-safe` discipline). |
| **One shared JSON schema for both paths** | One renderer serves pre-generated and generated recaps — no special cases. |
| **Truncate extracted text to ~12k chars** | Bounds tokens and cost on long decks; image-only PDFs get a clear "OCR not supported" error instead of a giant prompt. |
| **Mermaid `flowchart TD`, max 12 nodes, short labels** | Directional and exam-friendly; renders from text so no image assets are needed. |
| **Dark theme (`#0d1117` / `#e6edf3` / `#58a6ff`), mobile-first** | GitHub-style dark UI that reads well on phones; 480/768px breakpoints. |
| **Non-goals: no OCR, no auth, no database, no persistence beyond `localStorage`** | Keeps one clean implementation pass honest — scope stays shippable. |

## Toolchain: MCP servers

Recap generation runs inside OpenCode with three MCP servers
(configured in [`opencode.json`](opencode.json)):

| Server | Command | What it does |
|--------|---------|--------------|
| **pdf-reader** | built-in | Reads PDF content: page count, metadata, and **extracted text** (per page or full). This is the workhorse — it pulls the slide text a recap is built from. *Quirk: local paths fail on this machine (`Uint8Array` bug), so the PDF is served over `http://localhost` and passed as a URL.* |
| **pdf** | `mcp-pdf-server --stdio` (official `@modelcontextprotocol/server-pdf`) | Low-level PDF access: list available PDFs, read byte ranges (base64), save/inspect PDF files. Used for discovery and raw byte operations. |
| **mermaid** | `mermaid-mcp-server` | Serves the official Mermaid syntax reference and examples per diagram type. Used to **validate** a recap's `flowchart TD` against real syntax (direction, node shapes, link forms). *Its Windows path bug (`C:\C:\…` from `new URL().pathname`) was fixed with `fileURLToPath`.* |

## Sub-agent: `recap-reviewer`

A read-only review agent defined in `opencode.json` with its rules in
[`reviewer-prompt.md`](reviewer-prompt.md) (permissions: `edit`, `bash`,
`webfetch`, `websearch` all **denied** — it can only read and report).

**Role:** check the generated recap against the *ground-truth slide text* for
exactly three failure modes:

1. **Missed concepts** — slide topics/terms absent or underrepresented.
2. **Misrepresentation** — bullets, questions, answers, or rationales that
   contradict the slides or invent outside concepts.
3. **Unfaithful diagram** — nodes/edges/labels that don't match the slides.

It returns a list of `{where, target, problem, fix}` entries, each citing the
slide text it came from. Fixes are applied **once, no loops**; if the free-tier
limit blocks spawning it, the same review runs inline in the main session.

## Custom skill: `pdf-recap`

The format contract for every recap, installed at
`~/.config/opencode/skills/pdf-recap/SKILL.md` — verbatim copy in this repo:
[`skill-pdf-recap.md`](skill-pdf-recap.md).

```
Given slide text, output JSON with:
- "summary": array of {topic, points[3-5 short bullets]}
- "quiz": 8 MCQs {q, options[4], answer(index), why}
- "diagram": Mermaid flowchart TD, max 12 nodes, short labels
Rules: only use facts from the slides. No invented concepts. Keep it exam-ready.
```

It serves **both** paths:

- **Offline generation** — instructions the assistant follows to shape extracted
  slide text into `recap-*.json`.
- **Browser upload** — the same rules are pasted verbatim as the system prompt of
  the single OpenRouter call, so generated recaps match the demos.

## Example run

**Input:** [`day1.pdf`](day1.pdf) — 5 pages, *"Unit-5: Body Language Codes"*
(postures, gestures, facial expressions, eye contact, dress, vocalic + silence,
haptics).

**Pipeline:**

1. `pdf-reader` extracts all 5 pages of slide text.
2. The `pdf-recap` skill shapes it into [`recap.json`](recap.json) — 5 topics,
   8 MCQs, an 11-node flowchart.
3. The Mermaid MCP's flowchart reference validates the diagram syntax (PASS).
4. The `recap-reviewer` checks it against the slides → 1 fix found: quiz option
   `"Kinesics"` appears nowhere in the slides → replaced with `"Silence"`.
5. Schema validation passes → committed as `feat: generated recap from day1.pdf`.

**Output excerpt** (`recap.json`):

```json
{
  "title": "Body Language Codes (Unit 5)",
  "summary": [
    {
      "topic": "Haptics (Touch)",
      "points": [
        "Haptics is derived from Greek meaning \"to touch or grasp\"; it conveys emotions like affection, anger and encouragement",
        "Negative haptics convey anger, displeasure, hate and violence (slap, prick, handshake with pressure)",
        "A handshake with pressure indicates domination",
        "Positive haptics convey love, affection, respect and encouragement (pat on back, handshake, touching feet, touching shoulder)"
      ]
    }
  ],
  "diagram": "flowchart TD\n  A[Body Language] --> B[Postures]\n  A --> C[Gestures]\n  A --> D[Facial Expressions]\n  A --> E[Eye Contact]\n  A --> F[Dress and Appearance]\n  A --> G[Vocalic]\n  A --> H[Haptics]\n  G --> I[Silence]\n  H --> J[Negative Haptics]\n  H --> K[Positive Haptics]"
}
```

The rendered result appears in the site's dropdown as
**Demo: Body Language Codes (Unit 5)**.

## Recap schema

```json
{
  "title": "string",
  "summary": [{ "topic": "string", "points": ["3-5 bullets"] }],
  "quiz": [{ "q": "string", "options": ["A", "B", "C", "D"], "answer": 0, "why": "string" }],
  "diagram": "flowchart TD\n  A --> B"
}
```

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
| `skill-pdf-recap.md` | Copy of the `pdf-recap` skill (format contract) |
| `PLAN.md` | Design plan and recorded trade-offs |
| `opencode.json` | MCP servers + `recap-reviewer` agent for offline generation |
| `reviewer-prompt.md` | Recap review rules (missed concepts / misrepresentation / diagram) |

## Offline generation notes

- **pdf-reader rejects local paths** (`Please provide binary data as Uint8Array`).
  Workaround: serve the folder over HTTP and pass
  `http://localhost:<port>/day1.pdf` instead of a file path.
- **Sub-agent blocked by the free-tier limit?** Skip spawning: review inline in
  the same turn per `reviewer-prompt.md`, apply fixes once, no loops.
