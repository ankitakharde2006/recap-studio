import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs";
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
import { buildRecap, toMarkdown } from "./summarize.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";

mermaid.initialize({ startOnLoad: false, theme: "dark" });

const MAX_PAGES = 80;
const MAX_CHARS = 400000;

const $ = (id) => document.getElementById(id);

let currentRecap = null;
let currentFile = null; // manifest file of the deck displayed (null = upload/history)
let currentSelection = ""; // dropdown value matching what is on screen

// ---------- boot ----------

init();

async function init() {
  // Tell the inline watchdog in index.html that the module booted.
  window.__recapBooted = true;
  bindEvents();
  await loadManifest();
}

// ---------- manifest & recaps ----------

async function loadManifest() {
  try {
    const res = await fetch("recaps.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const manifest = await res.json();
    if (!Array.isArray(manifest) || manifest.length === 0) throw new Error("empty manifest");
    const select = $("deck-select");
    select.innerHTML = '<option value="">— Choose a recap —</option>';
    const demoGroup = document.createElement("optgroup");
    demoGroup.label = "Demo recaps";
    manifest.forEach((entry) => {
      const opt = document.createElement("option");
      opt.value = entry.file;
      opt.textContent = entry.label;
      demoGroup.appendChild(opt);
    });
    select.appendChild(demoGroup);
    renderHistoryOptions();
    // The home page stays empty: nothing renders until the user chooses.
  } catch (err) {
    $("deck-select").innerHTML = '<option value="">— Choose a recap —</option>';
    setStatus(
      "Could not load recaps.json. If you opened this page as a file:// URL, browsers block local JSON — serve this folder with a static server (npx serve . or python -m http.server) and reload.",
      "warn"
    );
  }
}

let loadToken = 0; // guards against out-of-order deck loads

async function loadRecap(file) {
  const token = ++loadToken;
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const recap = await res.json();
    const errors = validateRecap(recap);
    if (errors.length) throw new Error(errors[0]);
    if (token !== loadToken) return; // a newer load superseded this one
    currentRecap = recap;
    currentFile = file;
    currentSelection = file;
    renderAll();
    setStatus("");
  } catch (err) {
    if (token !== loadToken) return;
    // Revert the dropdown to the recap actually on screen.
    $("deck-select").value = currentSelection;
    setStatus("Could not load " + file + ": " + err.message, "err");
  }
}

function validateRecap(recap) {
  const errs = [];
  if (!recap || typeof recap !== "object") return ["not an object"];
  if (!Array.isArray(recap.summary) || recap.summary.length === 0)
    errs.push("summary must be a non-empty array");
  else {
    recap.summary.forEach((t) => {
      if (typeof t.topic !== "string") errs.push("topic must be a string");
      if (!Array.isArray(t.points) || t.points.length < 3 || t.points.length > 5)
        errs.push("points must have 3-5 bullets");
    });
  }
  if (!Array.isArray(recap.quiz) || recap.quiz.length !== 8)
    errs.push("quiz must have exactly 8 questions");
  else {
    recap.quiz.forEach((q) => {
      if (typeof q.q !== "string") errs.push("question text missing");
      if (!Array.isArray(q.options) || q.options.length !== 4)
        errs.push("each question needs 4 options");
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3)
        errs.push("answer index must be 0-3");
      if (typeof q.why !== "string") errs.push("question missing why");
    });
  }
  if (typeof recap.diagram !== "string" || !recap.diagram.includes("flowchart"))
    errs.push("diagram must be a Mermaid flowchart");
  return errs;
}

// ---------- rendering ----------

function renderAll() {
  $("empty-state").hidden = true;
  $("recap-view").hidden = false;
  $("recap-title").textContent = currentRecap.title || "Recap";
  renderSummary();
  renderQuiz();
  renderDiagram();
  switchTab("summary");
}

function renderSummary() {
  const wrap = $("tab-summary");
  wrap.innerHTML = "";
  if (!currentRecap.summary.length) {
    wrap.innerHTML = '<p class="upload-sub">No summary could be built from this file.</p>';
    return;
  }
  const grid = document.createElement("div");
  grid.className = "summary-grid";
  currentRecap.summary.forEach((topic) => {
    const card = document.createElement("article");
    card.className = "topic-card";
    const h3 = document.createElement("h3");
    h3.textContent = topic.topic;
    const ul = document.createElement("ul");
    topic.points.forEach((p) => {
      const li = document.createElement("li");
      li.textContent = p;
      ul.appendChild(li);
    });
    card.append(h3, ul);
    grid.appendChild(card);
  });
  wrap.appendChild(grid);
}

function renderQuiz() {
  const wrap = $("tab-quiz");
  wrap.innerHTML = "";

  const quiz = currentRecap.quiz || [];
  if (quiz.length === 0) {
    wrap.innerHTML =
      '<p class="upload-sub">No quiz could be built from this document — it may be too short.</p>';
    return;
  }

  const header = document.createElement("div");
  header.className = "quiz-header";
  const h3 = document.createElement("h3");
  h3.textContent = "Quiz";
  const score = document.createElement("span");
  score.className = "score";
  score.textContent = `0/${quiz.length}`;
  header.append(h3, score);
  wrap.appendChild(header);

  const note = document.createElement("p");
  note.className = "upload-sub";
  note.textContent =
    "Every question and answer is quoted directly from the document — nothing is invented.";
  wrap.appendChild(note);

  let answered = 0;
  let correct = 0;

  quiz.forEach((q, qi) => {
    const fs = document.createElement("fieldset");
    fs.className = "quiz-q";
    const legend = document.createElement("legend");
    legend.textContent = `Q${qi + 1}. ${q.q}`;
    fs.appendChild(legend);

    q.options.forEach((opt, oi) => {
      const label = document.createElement("label");
      label.className = "quiz-opt";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "q" + qi;
      input.value = String(oi);
      label.appendChild(input);
      label.appendChild(document.createTextNode(opt));

      input.addEventListener("change", () => {
        if (fs.classList.contains("answered")) return;
        fs.classList.add("answered");
        answered += 1;
        const isCorrect = oi === q.answer;
        if (isCorrect) correct += 1;

        fs.querySelectorAll(".quiz-opt").forEach((el, i) => {
          if (i === q.answer) el.classList.add("correct");
          else if (i === oi && !isCorrect) el.classList.add("incorrect");
          el.querySelector("input").disabled = true;
        });

        const why = document.createElement("p");
        why.className = "quiz-why";
        why.textContent = (isCorrect ? "✓ " : "✗ ") + q.why;
        fs.appendChild(why);

        score.textContent = `${correct}/${quiz.length}` +
          (answered === quiz.length ? " final" : "");
      });

      fs.appendChild(label);
    });

    wrap.appendChild(fs);
  });
}

let diagramState = { recap: null, html: "" }; // cache: render once per deck
let mermaidSeq = 0; // collision-free element ids

async function renderDiagram() {
  const wrap = $("tab-diagram");
  const recap = currentRecap;
  if (diagramState.recap === recap && diagramState.html) {
    wrap.innerHTML = diagramState.html;
    return;
  }
  wrap.innerHTML = "";
  const box = document.createElement("div");
  box.className = "diagram-wrap";
  wrap.appendChild(box);
  try {
    const { svg } = await mermaid.render("mermaid-" + ++mermaidSeq, recap.diagram);
    if (recap !== currentRecap) return; // deck switched mid-render
    box.innerHTML = svg;
    diagramState = { recap, html: wrap.innerHTML };
  } catch (err) {
    if (recap !== currentRecap) return;
    const pre = document.createElement("pre");
    pre.className = "diagram-fallback";
    pre.textContent = recap.diagram;
    box.replaceWith(pre);
    diagramState = { recap, html: wrap.innerHTML };
    setStatus("Diagram could not be rendered — raw source shown.", "warn");
  }
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((btn) => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  ["summary", "quiz", "diagram"].forEach((t) => {
    $("tab-" + t).hidden = t !== name;
  });
  if (name === "diagram") renderDiagram();
}

// ---------- upload: PDF -> summary, quiz, diagram (all in-browser) ----------

function bindEvents() {
  const zone = $("upload-zone");
  const input = $("file-input");

  $("browse-btn").addEventListener("click", () => input.click());
  zone.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    input.click();
  });
  input.addEventListener("change", () => {
    const file = input.files[0];
    input.value = ""; // allow re-selecting the same file
    handleFile(file);
  });

  ["dragover", "dragenter"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add("drag");
    })
  );
  ["dragleave", "dragend"].forEach((ev) =>
    zone.addEventListener(ev, () => zone.classList.remove("drag"))
  );
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag");
    handleFile(e.dataTransfer.files[0]);
  });

  document.querySelectorAll(".tab").forEach((btn) =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab))
  );

  $("deck-select").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v.indexOf("history:") === 0) {
      currentSelection = v;
      loadHistory(v.slice(8));
      return;
    }
    if (v) {
      loadRecap(v);
      return;
    }
    // Placeholder chosen: restore whatever is actually on screen.
    e.target.value = currentSelection;
  });

  $("download-btn").addEventListener("click", downloadMd);
}

async function handleFile(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    setStatus("Please choose a PDF file.", "warn");
    return;
  }
  $("file-name").textContent = file.name;
  setProgress("Extracting text…");
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages = [];
    let text = "";
    const maxPages = Math.min(pdf.numPages, MAX_PAGES);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        pageText += item.str;
        pageText += item.hasEOL ? "\n" : " ";
      }
      pages.push(pageText);
      text += pageText;
      setProgress(`Extracting text… page ${i}/${maxPages}`);
      if (text.length >= MAX_CHARS) break;
    }
    if (!text.trim()) {
      setStatus(
        "No selectable text found — OCR is not supported. Try a text-based PDF.",
        "err"
      );
      return;
    }
    setProgress("Building summary, quiz and diagram…");
    const recap = buildRecap(pages, file.name);
    if (!recap.summary.length) {
      setStatus("Could not build a summary from this file — try a text-based PDF.", "err");
      return;
    }
    currentRecap = recap;
    currentFile = null;
    currentSelection = "";
    saveHistory(recap);
    renderHistoryOptions();
    renderAll();
    setStatus(
      "Summary ready — generated in your browser. Nothing was uploaded, no API key needed.",
      "ok"
    );
  } catch (err) {
    setStatus("Could not read this file — try a text-based PDF. (" + err.message + ")", "err");
  } finally {
    setProgress(null);
  }
}

// ---------- history: past generated recaps, only via the dropdown ----------
const HISTORY_KEY = "recapHistory";

function readHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function writeHistory(list) {
  for (const n of [10, 3]) {
    // Cap entries; retry smaller on quota errors.
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, n)));
      return;
    } catch (e) {
      /* try fewer entries */
    }
  }
}

function saveHistory(recap) {
  const list = readHistory();
  list.unshift({
    id: String(Date.now()),
    title: recap.title || "Recap",
    source: recap.source || "",
    savedAt: new Date().toISOString(),
    recap,
  });
  writeHistory(list);
}

function renderHistoryOptions() {
  const select = $("deck-select");
  const old = select.querySelector("optgroup[data-history]");
  if (old) old.remove();
  const list = readHistory();
  if (list.length === 0) return;
  const group = document.createElement("optgroup");
  group.label = "History";
  group.dataset.history = "1";
  list.forEach((h) => {
    const opt = document.createElement("option");
    opt.value = "history:" + h.id;
    const day = (h.savedAt || "").slice(0, 10);
    opt.textContent = (h.title || "Recap") + (day ? " · " + day : "");
    group.appendChild(opt);
  });
  select.appendChild(group);
}

function loadHistory(id) {
  const entry = readHistory().find((x) => x.id === id);
  if (!entry || !entry.recap) {
    setStatus("History entry not found.", "warn");
    $("deck-select").value = currentSelection;
    return;
  }
  currentRecap = entry.recap;
  currentFile = null;
  renderAll();
  setStatus("");
}

// ---------- download: readable markdown ----------

function slug(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "summary"
  );
}

function downloadMd() {
  if (!currentRecap) return;
  const blob = new Blob([toMarkdown(currentRecap)], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = slug(currentRecap.title) + "-summary.md";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- UI helpers ----------

function setStatus(msg, kind) {
  const el = $("status");
  if (!msg) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.className = "status " + (kind || "ok");
}

function setProgress(msg) {
  const el = $("progress");
  if (!msg) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  $("progress-text").textContent = msg;
}
