import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs";
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";

mermaid.initialize({ startOnLoad: false, theme: "dark" });

const MAX_TEXT_CHARS = 12000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `You turn slide text into a recap JSON.

Output a single JSON object with exactly these keys:
- "summary": array of {topic, points[3-5 short bullets]}
- "quiz": 8 MCQs {q, options[4], answer(index), why}
- "diagram": Mermaid flowchart TD, max 12 nodes, short labels

Rules: only use facts from the slides. No invented concepts. Keep it exam-ready.
Output ONLY the JSON object — no markdown fences, no commentary.`;

const $ = (id) => document.getElementById(id);

let currentRecap = null;
let extractedText = "";

// ---------- boot ----------

init();

async function init() {
  bindEvents();
  loadSettings();
  await loadManifest();
}

// ---------- manifest & recaps ----------

async function loadManifest() {
  try {
    const res = await fetch("recaps.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const manifest = await res.json();
    const select = $("deck-select");
    select.innerHTML = "";
    if (!Array.isArray(manifest) || manifest.length === 0) throw new Error("empty manifest");
    manifest.forEach((entry) => {
      const opt = document.createElement("option");
      opt.value = entry.file;
      opt.textContent = entry.label;
      select.appendChild(opt);
    });
    await loadRecap(manifest[0].file);
  } catch (err) {
    $("deck-select").innerHTML = '<option value="">No demo recaps</option>';
    setStatus(
      "Could not load recaps.json. If you opened this page as a file:// URL, browsers block local JSON — serve this folder with a static server (npx serve . or python -m http.server) and reload.",
      "warn"
    );
  }
}

async function loadRecap(file) {
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const recap = await res.json();
    const errors = validateRecap(recap);
    if (errors.length) throw new Error(errors[0]);
    currentRecap = recap;
    renderAll();
    setStatus("");
  } catch (err) {
    setStatus("Could not load " + file + ": " + err.message, "err");
  }
}

// ---------- rendering ----------

function renderAll() {
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

  const header = document.createElement("div");
  header.className = "quiz-header";
  const h3 = document.createElement("h3");
  h3.textContent = "Quiz";
  const score = document.createElement("span");
  score.className = "score";
  score.id = "score";
  score.textContent = `0/${currentRecap.quiz.length}`;
  header.append(h3, score);
  wrap.appendChild(header);

  let answered = 0;
  let correct = 0;

  currentRecap.quiz.forEach((q, qi) => {
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

        // mark all options: correct answer green, picked wrong answer red
        fs.querySelectorAll(".quiz-opt").forEach((el, i) => {
          if (i === q.answer) el.classList.add("correct");
          else if (i === oi && !isCorrect) el.classList.add("incorrect");
          el.querySelector("input").disabled = true;
        });

        const why = document.createElement("p");
        why.className = "quiz-why";
        why.textContent = (isCorrect ? "✓ " : "✗ ") + q.why;
        fs.appendChild(why);

        score.textContent = `${correct}/${currentRecap.quiz.length}`;
        if (answered === currentRecap.quiz.length) {
          score.textContent = `${correct}/${currentRecap.quiz.length} final`;
        }
      });

      fs.appendChild(label);
    });

    wrap.appendChild(fs);
  });
}

async function renderDiagram() {
  const wrap = $("tab-diagram");
  wrap.innerHTML = "";
  const box = document.createElement("div");
  box.className = "diagram-wrap";
  wrap.appendChild(box);
  try {
    const { svg } = await mermaid.render(
      "mermaid-" + Date.now(),
      currentRecap.diagram
    );
    box.innerHTML = svg;
  } catch (err) {
    const pre = document.createElement("pre");
    pre.className = "diagram-fallback";
    pre.textContent = currentRecap.diagram;
    box.replaceWith(pre);
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

// ---------- validation ----------

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

// ---------- upload ----------

function bindEvents() {
  const zone = $("upload-zone");
  const input = $("file-input");

  $("browse-btn").addEventListener("click", () => input.click());
  zone.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    input.click();
  });
  input.addEventListener("change", () => handleFile(input.files[0]));

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

  $("generate-btn").addEventListener("click", generateRecap);

  document.querySelectorAll(".tab").forEach((btn) =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab))
  );

  $("deck-select").addEventListener("change", (e) => {
    if (e.target.value) loadRecap(e.target.value);
  });

  $("download-btn").addEventListener("click", downloadJson);

  $("api-key").addEventListener("change", (e) => {
    localStorage.setItem("openrouter_key", e.target.value.trim());
  });
  $("model").addEventListener("change", (e) => {
    localStorage.setItem("openrouter_model", e.target.value.trim());
  });
}

async function handleFile(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    setStatus("Please choose a PDF file.", "warn");
    return;
  }
  $("file-name").textContent = file.name;
  $("generate-btn").disabled = true;
  setProgress("Extracting text…");
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n";
      setProgress(`Extracting text… page ${i}/${pdf.numPages}`);
      if (text.length >= MAX_TEXT_CHARS) break;
    }
    text = text.trim();
    if (!text) {
      setStatus(
        "No selectable text found — OCR is not supported. Try a text-based PDF.",
        "err"
      );
      return;
    }
    extractedText = text.slice(0, MAX_TEXT_CHARS);
    $("generate-btn").disabled = false;
    setStatus(
      `Extracted ${extractedText.length.toLocaleString()} characters. Click Generate Recap.`,
      "ok"
    );
  } catch (err) {
    setStatus("Could not read this file — try a text-based PDF. (" + err.message + ")", "err");
  } finally {
    setProgress(null);
  }
}

// ---------- LLM generate (one call) ----------

async function generateRecap() {
  const key = localStorage.getItem("openrouter_key") || "";
  if (!key) {
    setStatus(
      "Add your OpenRouter API key in Settings to generate recaps from PDFs. The demo recaps above stay available.",
      "warn"
    );
    $("settings").open = true;
    $("api-key").focus();
    return;
  }
  if (!extractedText) {
    setStatus("Drop a PDF first.", "warn");
    return;
  }
  const model = localStorage.getItem("openrouter_model") || "openrouter/auto";

  setProgress(`Generating recap with ${model} (one call)…`);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "Slide text:\n\n" + extractedText }
        ]
      })
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || "HTTP " + res.status;
      if (res.status === 402 || /credit/i.test(msg))
        setStatus("OpenRouter: insufficient credits. Add credits or pick a free model in Settings.", "err");
      else if (res.status === 401 || res.status === 403)
        setStatus("OpenRouter rejected the API key — check it in Settings.", "err");
      else if (res.status === 429)
        setStatus("OpenRouter rate limited — wait a moment and retry.", "err");
      else setStatus("OpenRouter error: " + msg, "err");
      return;
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      setStatus("The model returned no content — try again.", "err");
      return;
    }

    const recap = parseModelJson(content);
    const errs = validateRecap(recap);
    if (errs.length) {
      setStatus(
        "The model returned an invalid format (" + errs[0] + ") — try again or use a demo recap.",
        "err"
      );
      return;
    }

    currentRecap = recap;
    renderAll();
    setStatus("Recap generated from your PDF.", "ok");
  } catch (err) {
    setStatus("Request failed — check your connection and retry. (" + err.message + ")", "err");
  } finally {
    setProgress(null);
  }
}

function parseModelJson(content) {
  let raw = content.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) raw = raw.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON from model");
  }
}

// ---------- download ----------

function downloadJson() {
  if (!currentRecap) return;
  const blob = new Blob([JSON.stringify(currentRecap, null, 2)], {
    type: "application/json"
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "recap.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- settings & UI helpers ----------

function loadSettings() {
  $("api-key").value = localStorage.getItem("openrouter_key") || "";
  $("model").value = localStorage.getItem("openrouter_model") || "openrouter/auto";
}

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
