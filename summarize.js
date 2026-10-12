// summarize.js — dependency-free, in-browser recap builder.
// Extractive only: every summary point, quiz answer, and diagram label comes
// verbatim from the input text. Nothing is invented, no network, no API key.

const STOP = new Set(
  "the and for are but not you all can had her was one our out day get has him his how man new now old see two way who did its put say she too use that with have this will your from they know want been good much some time very when come here just mean back like long make many about could people my than first been call who its now find day may part over new sound take only little work know place year live me back give most very after thing our just name good sentence man think say great where help through much before line right too mean old any same tell boy follow came want show also around form three small set put end does another well large must big even such because turn here why ask went men read need land different home us move try kind hand picture again change off play spell air away animal house point page letter mother answer found study still learn should world".split(" ")
);

function words(text) {
  return (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(
    (w) => !STOP.has(w)
  );
}

function termCounts(texts) {
  const counts = new Map();
  for (const t of texts) {
    for (const w of words(t)) counts.set(w, (counts.get(w) || 0) + 1);
  }
  return counts;
}

function topTerms(counts, n, minLen = 3) {
  return [...counts.entries()]
    .filter(([w]) => w.length >= minLen)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([w]) => w);
}

function linesOf(page) {
  return page
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function sentencesOf(text) {
  return text
    .split(/\n|(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 12);
}

function isHeading(line) {
  return (
    line.length >= 3 &&
    line.length <= 60 &&
    /^[A-Za-z0-9]/.test(line) &&
    !/[.!?]$/.test(line) &&
    line.split(" ").length <= 9
  );
}

function scoreSentence(sentence, counts) {
  const ws = words(sentence);
  if (ws.length === 0) return 0;
  const score = ws.reduce((sum, w) => sum + (counts.get(w) || 0), 0);
  return score / Math.sqrt(ws.length);
}

// Deterministic PRNG so quiz option order is stable for identical input.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, seed) {
  const rnd = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function sanitizeLabel(s) {
  return s
    .replace(/[[\](){}|#\\`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 26)
    .trim();
}

function capWords(s, n) {
  const parts = s.split(" ");
  return parts.length <= n ? s : parts.slice(0, n).join(" ") + "…";
}

// ---------- summary ----------

// ---------- sections ----------

// Real deck headings like "iii) Facial Expression:-" or "Silence:-" start a
// section; anything before the first marker continues the previous section.
const SECTION_RE =
  /^[ \t]*(?:[ivxl]+\)|\d+\))?[ \t]*([A-Z][A-Za-z][A-Za-z' ]{0,30}):[ \t]*-[ \t]*/gm;

export function splitSections(pages) {
  const sections = [];
  for (const page of pages) {
    const matches = [...page.matchAll(SECTION_RE)];
    const firstLine = linesOf(page)[0] || "";
    // A page starting lowercase continues the previous slide's section.
    const continuation = sections.length > 0 && /^[a-z]/.test(firstLine);

    if (matches.length === 0) {
      if (continuation) sections[sections.length - 1].text += "\n" + page;
      else sections.push({ heading: null, text: page });
      continue;
    }

    const lead = matches[0].index > 0 ? page.slice(0, matches[0].index) : "";
    if (lead.trim()) {
      if (continuation) sections[sections.length - 1].text += "\n" + lead;
      else sections.push({ heading: null, text: lead });
    }
    for (let i = 0; i < matches.length; i++) {
      const end = i + 1 < matches.length ? matches[i + 1].index : page.length;
      sections.push({
        heading: matches[i][1].trim(),
        text: page.slice(matches[i].index, end),
      });
    }
  }
  return sections.filter((s) => s.text.trim());
}

// Generic verbs/words that make terrible topic labels (they dominate TF
// counts in instructional text but name nothing).
const LABEL_SKIP = new Set(
  "indicates indicate indicated conveys convey conveyed shows show shown means mean called following considered using used important various different many another several while which their there these those than then too just also only avoid prevents ensure remember recognize demonstrate".split(
    " "
  )
);

function labelTerm(text, df, total) {
  const local = termCounts([text]);
  const cands = [...local.entries()]
    .filter(([w]) => w.length >= 4 && !LABEL_SKIP.has(w))
    .map(([w, c]) => ({
      w,
      // A word present in EVERY section (company/brand name) would label
      // every block identically — demote it unless nothing else exists.
      ubiquitous: total > 1 && (df.get(w) || 0) >= total,
      s: c * Math.log(1 + total / (df.get(w) || 1)),
    }))
    .sort(
      (a, b) =>
        Number(a.ubiquitous) - Number(b.ubiquitous) ||
        b.s - a.s ||
        a.w.localeCompare(b.w)
    );
  const word = cands.length ? cands[0].w : "Section";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// PDFs can embed control chars (e.g. \u001f) that survive whitespace trimming
// and would derail heading detection — strip them, keep newlines.
const CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f]/g;
function stripControls(s) {
  return s.replace(CONTROL_RE, " ");
}

function buildSummary(sections, counts) {
  const summary = [];
  const usedPoints = new Set();
  // Document frequency: how many sections contain each term at all.
  const df = new Map();
  for (const sec of sections) {
    for (const w of new Set(words(sec.text))) df.set(w, (df.get(w) || 0) + 1);
  }
  for (const sec of sections) {
    if (summary.length >= 8) break;
    let heading = sec.heading;
    if (!heading) {
      const first = linesOf(sec.text)[0];
      if (first && isHeading(first)) heading = first;
    }
    if (!heading) heading = labelTerm(sec.text, df, sections.length);
    const candidates = pointsForPage(sec.text, heading, counts);
    const points = [];
    for (const p of candidates) {
      const key = p.toLowerCase().replace(/\s+/g, " ").trim();
      if (usedPoints.has(key)) continue;
      usedPoints.add(key);
      points.push(p);
    }
    if (points.length === 0) continue;
    const topic = capWords(sanitizeLabel(heading) || "Section", 40);
    if (summary.some((t) => t.topic === topic)) continue;
    summary.push({ topic, points });
  }
  return summary;
}

// Split oversized blobs at word boundaries so nothing ever renders as
// one giant paragraph.
function chunkPoint(s, max = 240) {
  const text = String(s).replace(/\s+/g, " ").trim();
  if (text.length <= max) return [text];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < 60) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// Containment similarity: catches near-duplicate sentences (the same
// sentence repeated with a small extra clause).
function similarity(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

function pointsForPage(page, heading, counts) {
  const lines = linesOf(page);
  const body = lines.filter((l) => l !== heading);
  // The deck's own numbered/bullet lines are the best points available.
  const bullets = body.filter((l) => /^([-•*]|\d+[.)])\s/i.test(l.trim()));
  let raw;
  if (bullets.length >= 3) {
    raw = bullets.slice(0, 5);
  } else {
    // Prose: join wrapped lines into one flow, then score real sentences.
    const prose = body.join(" ").replace(/\s+/g, " ");
    const sorted = sentencesOf(prose)
      .map((s) => ({ s, v: scoreSentence(s, counts) }))
      .filter((x) => x.s.length >= 15)
      .sort((a, b) => b.v - a.v)
      .map((x) => x.s);
    // Diversify: skip sentences that mostly repeat one already picked.
    const picked = [];
    for (const sent of sorted) {
      if (picked.length >= 5) break;
      if (picked.some((p) => similarity(p, sent) > 0.6)) continue;
      picked.push(sent);
    }
    for (const sent of sorted) {
      if (picked.length >= 3) break;
      if (!picked.includes(sent)) picked.push(sent);
    }
    raw = picked.slice(0, 5);
    for (const b of bullets) {
      if (raw.length >= 3) break;
      if (!raw.includes(b)) raw.push(b);
    }
    if (raw.length === 0) raw = body.slice(0, 3);
  }
  return raw.flatMap((p) => chunkPoint(p)).slice(0, 5);
}



// ---------- quiz ----------

// Complete sentences only: lines are JOINED first, then split at real
// sentence endings — a sentence that wraps across PDF lines stays whole.
function fullSentences(text) {
  const flow = linesOf(text).join(" ");
  const parts = flow
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => x.length >= 30 && x.length <= 600);
  if (parts.length) return parts;
  // No punctuation in the source: a complete slide line is a statement.
  return linesOf(text).filter((l) => l.length >= 30 && l.length <= 600);
}

function buildQuiz(sections, counts) {
  const globalTerms = topTerms(counts, 40, 4);
  const candidates = [];

  // Pass 1: best sentence per section containing a key term of that section.
  for (let pi = 0; pi < sections.length && candidates.length < 8; pi++) {
    const sec = sections[pi];
    const secTerms = topTerms(termCounts([sec.text]), 8, 4);
    const sents = fullSentences(sec.text).sort(
      (a, b) => scoreSentence(b, counts) - scoreSentence(a, counts)
    );
    for (const sent of sents) {
      const target = secTerms.find((t) =>
        new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "s?\\b", "i").test(sent)
      );
      if (!target) continue;
      candidates.push({ sent, target, pi });
      break;
    }
  }
  // Pass 2: more sentences from sections that had none, if we still need 8.
  if (candidates.length < 8) {
    for (let pi = 0; pi < sections.length && candidates.length < 8; pi++) {
      if (candidates.some((c) => c.pi === pi)) continue;
      const sent = fullSentences(sections[pi].text)[0];
      if (!sent) continue;
      const target = topTerms(termCounts([sent]), 1, 4)[0];
      if (!target) continue;
      candidates.push({ sent, target, pi });
    }
  }

  const quiz = [];
  for (let i = 0; i < candidates.length && quiz.length < 8; i++) {
    const { sent, target } = candidates[i];
    const sentLower = " " + sent.toLowerCase() + " ";
    const distractors = globalTerms.filter(
      (t) =>
        t !== target &&
        !sentLower.includes(" " + t) &&
        Math.abs(t.length - target.length) <= 6
    );
    if (distractors.length < 3) continue;
    const options = shuffle([target, ...distractors.slice(0, 3)], i * 7919 + target.length);
    const answer = options.indexOf(target);
    const blanked = sent.replace(
      new RegExp("\\b" + target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "s?\\b", "gi"),
      "________"
    );
    quiz.push({
      q: "Fill in the blank: " + blanked,
      options,
      answer,
      why: "The document states: “" + sent + "”",
    });
  }
  return quiz;
}

// ---------- diagram ----------

function buildDiagram(summary, counts, title) {
  let labels = summary.map((t) => sanitizeLabel(t.topic)).filter(Boolean);
  labels = [...new Set(labels)].slice(0, 11);
  if (labels.length === 0) {
    labels = topTerms(counts, 7, 4).map(sanitizeLabel).filter(Boolean);
  }

  const rootLabel = sanitizeLabel(title || "Overview") || "Overview";
  const PALETTE = [
    "fill:#238636,stroke:#3fb950,color:#ffffff",
    "fill:#8957e5,stroke:#a371f7,color:#ffffff",
    "fill:#9e6a03,stroke:#d29922,color:#ffffff",
    "fill:#1f6feb,stroke:#58a6ff,color:#ffffff",
    "fill:#b3417f,stroke:#f778ba,color:#ffffff",
    "fill:#cf222e,stroke:#ff7b72,color:#ffffff",
  ];
  const ids = "ABCDEFGHIJKL";
  const lines = [`  ROOT(["${rootLabel}"])`];
  const edges = [];

  labels.forEach((l, i) => {
    // Alternate node shapes for visual variety.
    lines.push(i % 2 === 0 ? `  ${ids[i]}["${l}"]` : `  ${ids[i]}("${l}")`);
    edges.push({ from: "ROOT", to: ids[i], main: false });
  });
  // The document flow: sections chained in reading order.
  for (let i = 1; i < labels.length; i++) {
    edges.push({ from: ids[i - 1], to: ids[i], main: true });
  }
  for (const e of edges) {
    lines.push(e.main ? `  ${e.from} ==> ${e.to}` : `  ${e.from} --> ${e.to}`);
  }

  // Colorful node classes (dark-theme palette).
  lines.push(
    "  classDef root fill:#1f6feb,stroke:#79c0ff,stroke-width:2px,color:#ffffff",
    "  class ROOT root"
  );
  const byClass = new Map();
  labels.forEach((_, i) => {
    const c = i % PALETTE.length;
    if (!byClass.has(c)) byClass.set(c, []);
    byClass.get(c).push(ids[i]);
  });
  for (const [c, members] of byClass) lines.push(`  class ${members.join(",")} c${c}`);
  PALETTE.forEach((style, c) => lines.push(`  classDef c${c} ${style}`));

  // Flow arrows stand out, hub links stay subtle.
  edges.forEach((e, i) => {
    lines.push(
      e.main
        ? `  linkStyle ${i} stroke:#58a6ff,stroke-width:2.5px`
        : `  linkStyle ${i} stroke:#6e7681,stroke-width:1.5px`
    );
  });
  return "flowchart TD\n" + lines.join("\n");
}

// ---------- entry point ----------

// Escape a plain word for use inside a RegExp (no backslashes needed).
function escWord(t) {
  return t.replace(/[^A-Za-z0-9]/g, (c) => "[" + c + "]");
}

function redactTerm(text, tok) {
  return text
    .replace(new RegExp("\\b" + escWord(tok) + "\\b", "gi"), " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ");
}

// Remove watermark/branding noise: a word repeated in runs ("brand brand
// brand") is detected once, then redacted from the whole document so it
// can never reach the summary, quiz, diagram, or title.
function redactNoise(pages) {
  const noise = new Set();
  const runRe = /\b([A-Za-z][A-Za-z'-]+)(?:\s+\1){2,}/gi;
  let m;
  while ((m = runRe.exec(pages.join("\n")))) noise.add(m[1].toLowerCase());

  if (noise.size) {
    const counts = termCounts(pages);
    for (const tok of [...noise]) {
      // Only redact real (non-stopword) terms.
      if (!counts.get(tok)) noise.delete(tok);
    }
  }
  if (!noise.size) return { pages, noise };

  const clean = pages
    .map((page) =>
      page
        .split(/\n+/)
        .map((line) => {
          const had = [...noise].some((tok) =>
            new RegExp("\\b" + escWord(tok) + "\\b", "i").test(line)
          );
          let out = line;
          for (const tok of noise) out = redactTerm(out, tok);
          out = out.trim();
          // Drop lines that were watermark-only; keep every other line.
          if (had && !/[a-z]{3}/i.test(out)) return "";
          return out;
        })
        .filter((l) => l.length > 0)
        .join("\n")
    )
    .filter((p) => p.trim());
  return { pages: clean, noise };
}

function redactToken(text, noise) {
  let out = text;
  for (const tok of noise) out = redactTerm(out, tok);
  return out.trim();
}

export function buildRecap(pages, sourceName) {
  const cleanPages = (pages || [])
    .map((p) => stripControls(p || ""))
    .filter((p) => p.trim().length > 0);
  const { pages: docPages, noise } = redactNoise(cleanPages);
  const counts = termCounts(docPages);

  const noExt = redactToken((sourceName || "").replace(/\.pdf$/i, ""), noise);
  const firstHeading = docPages.length
    ? linesOf(docPages[0]).find(isHeading)
    : null;
  const title =
    (noExt && noExt.trim()) || (firstHeading ? firstHeading : "Document summary");

  const sections = splitSections(docPages);
  const summary = buildSummary(sections, counts);
  return {
    title: capWords(title, 80),
    summary,
    quiz: buildQuiz(sections, counts),
    diagram: buildDiagram(summary, counts, title),
    source: sourceName || null,
  };
}

// ---------- markdown export ----------

const LETTERS = "ABCDEFGH";

export function toMarkdown(recap) {
  const out = [];
  out.push("# " + recap.title);
  out.push("");
  if (recap.source) {
    out.push("_Summarized in your browser from `" + recap.source + "` — no AI, no upload; every quote below is taken verbatim from the PDF._");
  } else {
    out.push("_Pre-generated recap — every point is taken from the source slides._");
  }
  out.push("");

  out.push("## Summary");
  out.push("");
  for (const t of recap.summary) {
    out.push("### " + t.topic);
    for (const p of t.points) out.push("- " + p);
    out.push("");
  }

  if (recap.quiz && recap.quiz.length) {
    out.push("## Quiz");
    out.push("");
    recap.quiz.forEach((q, i) => {
      out.push("**Q" + (i + 1) + ". " + q.q + "**");
      out.push("");
      q.options.forEach((o, oi) => out.push("- " + LETTERS[oi] + ". " + o));
      out.push("");
      out.push(
        "**Answer: " + LETTERS[q.answer] + "** — " + q.why.replace(/"/g, "'")
      );
      out.push("");
    });
  }

  out.push("## Diagram");
  out.push("");
  out.push("```mermaid");
  out.push(recap.diagram);
  out.push("```");
  out.push("");
  return out.join("\n");
}
