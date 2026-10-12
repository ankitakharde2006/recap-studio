---
name: pdf-recap
description: Turn extracted slide text into a consistent recap - summary, quiz, Mermaid diagram - as recap.json
---
Given slide text, output JSON with:
- "summary": array of {topic, points[3-5 short bullets]}
- "quiz": 8 MCQs {q, options[4], answer(index), why}
- "diagram": Mermaid flowchart TD, max 12 nodes, short labels
Rules: only use facts from the slides. No invented concepts. Keep it exam-ready.
