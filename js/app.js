/* Интерфейс: вкладки, язык, атлас, тест, AI-разбор, терминология, профиль. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("aat_" + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("aat_" + k, v); } catch (e) { /* хранилище недоступно */ } },
  };
  const ORGANS = window.ORGANS;
  const state = {
    lang: store.get("lang", "kk") === "ru" ? "ru" : "kk",
    score: parseInt(store.get("score", "0"), 10) || 0,
    organ: null, selected: null, labelMode: "full", quiz: null,
  };
  const S = k => window.I18N[state.lang][k] || k;
  const L = o => (o ? o[state.lang] : "");

  /* ---------- язык ---------- */
  function applyI18n() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = S(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = S(el.dataset.i18nPh); });
    document.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = S(el.dataset.i18nTitle); el.setAttribute("aria-label", S(el.dataset.i18nTitle)); });
    document.querySelectorAll(".lang button").forEach(b => b.classList.toggle("is-on", b.dataset.lang === state.lang));
    $("navName").textContent = store.get("name", "") || S("student");
  }
  function setLang(l) {
    state.lang = l; store.set("lang", l);
    applyI18n(); renderOrganTabs(); renderOrganHead(); renderChips(); renderList(); renderInfo(); renderTerms(); renderQuiz();
    viewer.refreshLabelText();
  }
  function addScore(n) { state.score += n; store.set("score", String(state.score)); $("navScore").textContent = state.score; }

  /* ---------- озвучивание латыни ---------- */
  function speak(text) {
    if (!text || !("speechSynthesis" in window)) { alert(S("noSpeech")); return; }
    const synth = window.speechSynthesis; synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[()]/g, ", "));
    const voices = synth.getVoices();
    const v = voices.find(x => /^la/i.test(x.lang)) || voices.find(x => /^it/i.test(x.lang)) || voices.find(x => /^es/i.test(x.lang));
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "it-IT";
    u.rate = 0.82;
    synth.speak(u);
  }

  /* ---------- вкладки ---------- */
  const secs = { atlas: $("secAtlas"), ai: $("secAi"), terms: $("secTerms") };
  function switchTab(tab) {
    Object.entries(secs).forEach(([k, el]) => { el.hidden = k !== tab; });
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("is-on", b.dataset.tab === tab));
    if (tab !== "atlas") stopQuiz();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  document.querySelectorAll(".lang button").forEach(b => b.addEventListener("click", () => setLang(b.dataset.lang)));

  /* ---------- атлас ---------- */
  const viewer = new window.AnatomyViewer($("stage"), {
    labelText: def => L(def.name),
    onPick: id => { if (state.quiz) quizAnswer(id); else select(id && id === state.selected ? null : id, false); },
    onView: view => {
      $("opacity").value = Math.round((1 - viewer.shellOpacity) * 100);
      renderChips(); renderList();
    },
  });
  window.__viewer = viewer;

  function renderOrganTabs() {
    const box = $("organTabs"); box.textContent = "";
    ORGANS.forEach(o => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "organ-tab" + (state.organ && state.organ.id === o.id ? " is-on" : "");
      const n = document.createElement("b"); n.textContent = L(o.name);
      const i = document.createElement("i"); i.textContent = o.latin;
      b.append(n, i);
      b.addEventListener("click", () => loadOrgan(o.id));
      box.appendChild(b);
    });
  }
  function renderOrganHead() {
    const o = state.organ; if (!o) return;
    $("organLatin").textContent = o.latin; $("organName").textContent = L(o.name); $("organIntro").textContent = L(o.intro);
  }
  function renderChips() {
    const box = $("viewChips"); box.textContent = "";
    const o = state.organ; if (!o || !viewer.view) return;
    o.views.forEach(v => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip" + (viewer.view.id === v.id ? " is-on" : ""); b.textContent = L(v.name);
      b.addEventListener("click", () => { stopQuiz(); viewer.setView(v.id); select(null); });
      box.appendChild(b);
    });
  }
  function structDef(id) { return state.organ ? state.organ.structures.find(s => s.id === id) : null; }
  function renderList() {
    const ol = $("structList"); ol.textContent = "";
    if (!state.organ || !viewer.view) return;
    viewer.visibleStructIds().forEach(id => {
      const d = structDef(id);
      const li = document.createElement("li"), b = document.createElement("button");
      b.type = "button"; if (id === state.selected) b.className = "is-on";
      const n = document.createElement("span"); n.className = "n"; n.textContent = viewer.numberOf(id);
      const w = document.createElement("span");
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = state.quiz ? "• • •" : L(d.name);
      const lt = document.createElement("span"); lt.className = "lt"; lt.textContent = state.quiz ? "" : d.latin;
      w.append(nm, lt); b.append(n, w);
      b.addEventListener("click", () => { if (!state.quiz) select(id, true); });
      li.appendChild(b); ol.appendChild(li);
    });
  }
  function renderInfo() {
    const d = state.selected ? structDef(state.selected) : null;
    $("infoEmpty").hidden = !!d; $("infoBody").hidden = !d;
    if (!d) return;
    $("infoNum").textContent = viewer.numberOf(d.id) || "•";
    $("infoName").textContent = L(d.name); $("infoLatin").textContent = d.latin; $("infoDesc").textContent = L(d.desc);
  }
  function select(id, focus) {
    state.selected = id || null;
    viewer.select(state.selected);
    if (id && focus) viewer.focus(id);
    renderInfo();
    document.querySelectorAll("#structList button").forEach((b, i) => b.classList.toggle("is-on", viewer.visibleStructIds()[i] === state.selected));
  }
  $("infoSpeak").addEventListener("click", () => { const d = structDef(state.selected); if (d) speak(d.latin); });

  async function loadOrgan(id, viewId, structId) {
    const def = ORGANS.find(o => o.id === id) || ORGANS[0];
    stopQuiz();
    state.organ = def; state.selected = null;
    store.set("organ", def.id);
    renderOrganTabs(); renderOrganHead(); renderInfo();
    const ld = $("stageLoading");
    ld.hidden = false; ld.lastElementChild.textContent = S("loading");
    try {
      await new Promise(r => setTimeout(r, 30));
      await viewer.loadOrgan(def);
      if (viewId) viewer.setView(viewId, true);
      ld.hidden = true;
      if (structId) select(structId, true);
    } catch (e) {
      console.error(e);
      ld.lastElementChild.textContent = S("loadError");
    }
  }
  function openStructure(organId, structId) {
    const o = ORGANS.find(x => x.id === organId); if (!o) return;
    const view = o.views.find(v => v.labels.includes(structId)) || o.views[0];
    switchTab("atlas");
    if (state.organ && state.organ.id === organId) { stopQuiz(); viewer.setView(view.id); select(structId, true); }
    else loadOrgan(organId, view.id, structId);
  }

  $("opacity").addEventListener("input", e => viewer.setShellOpacity(1 - e.target.value / 100));
  $("btnLabels").addEventListener("click", () => {
    state.labelMode = { full: "dots", dots: "off", off: "full" }[state.labelMode];
    viewer.setLabelMode(state.labelMode);
    $("btnLabels").setAttribute("aria-pressed", state.labelMode !== "off");
  });
  $("btnRotate").addEventListener("click", e => {
    const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
    e.currentTarget.setAttribute("aria-pressed", on); viewer.setAutoRotate(on);
  });
  $("btnReset").addEventListener("click", () => viewer.resetCamera());

  /* ---------- тест «найди структуру» ---------- */
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function startQuiz() {
    const ids = shuffle(viewer.visibleStructIds().slice());
    if (!ids.length) return;
    select(null);
    state.quiz = { ids, i: 0, right: 0, tries: 0, lock: false, done: false, msg: "", cls: "" };
    viewer.setQuiz(true);
    if (state.labelMode === "off") { state.labelMode = "full"; viewer.setLabelMode("full"); $("btnLabels").setAttribute("aria-pressed", true); }
    $("btnQuiz").setAttribute("aria-pressed", true);
    renderQuiz(); renderList();
  }
  function stopQuiz() {
    if (!state.quiz) return;
    state.quiz = null; viewer.setQuiz(false);
    $("btnQuiz").setAttribute("aria-pressed", false);
    $("quizBar").hidden = true;
    select(null); renderList();
  }
  function renderQuiz() {
    const q = state.quiz; $("quizBar").hidden = !q; if (!q) return;
    const msg = $("quizMsg"); msg.textContent = q.msg ? S(q.msg) : ""; msg.className = q.cls;
    $("quizAgain").hidden = !q.done;
    if (q.done) {
      $("quizLabel").textContent = S("quizDone") + ":"; $("quizName").textContent = q.right + " " + S("quizOf") + " " + q.ids.length; $("quizLatin").textContent = "";
      $("quizProg").textContent = ""; return;
    }
    const d = structDef(q.ids[q.i]);
    $("quizLabel").textContent = S("quizFind"); $("quizName").textContent = L(d.name); $("quizLatin").textContent = d.latin;
    $("quizProg").textContent = (q.i + 1) + " " + S("quizOf") + " " + q.ids.length;
  }
  function quizNext(delay) {
    const q = state.quiz; q.lock = true;
    setTimeout(() => {
      if (state.quiz !== q) return;
      q.i++; q.tries = 0; q.lock = false; q.msg = ""; q.cls = "";
      viewer.select(null);
      if (q.i >= q.ids.length) q.done = true;
      renderQuiz();
    }, delay);
  }
  function quizAnswer(id) {
    const q = state.quiz; if (!q || q.lock || q.done || !id) return;
    const target = q.ids[q.i];
    if (id === target) {
      if (q.tries === 0) { q.right++; addScore(10); q.msg = "quizRight"; } else q.msg = "";
      q.cls = "ok"; viewer.flash(id, "ok"); viewer.select(id); renderQuiz(); quizNext(900);
    } else {
      q.tries++; viewer.flash(id, "bad");
      if (q.tries >= 2) { q.msg = "quizShown"; q.cls = "bad"; viewer.select(target); viewer.focus(target); renderQuiz(); quizNext(1900); }
      else { q.msg = "quizWrong"; q.cls = "bad"; renderQuiz(); }
    }
  }
  $("btnQuiz").addEventListener("click", () => (state.quiz ? stopQuiz() : startQuiz()));
  $("quizExit").addEventListener("click", stopQuiz);
  $("quizAgain").addEventListener("click", () => { stopQuiz(); startQuiz(); });

  /* ---------- терминология ---------- */
  function renderTerms() {
    const box = $("termsBox"); box.textContent = "";
    const q = $("termSearch").value.trim().toLowerCase();
    let total = 0;
    ORGANS.forEach(o => {
      const items = [{ id: null, latin: o.latin, name: o.name }].concat(o.structures)
        .filter(s => !q || (s.latin + " " + s.name.kk + " " + s.name.ru).toLowerCase().includes(q));
      if (!items.length) return;
      total += items.length;
      const g = document.createElement("div"); g.className = "term-group";
      const h = document.createElement("h3"); h.textContent = L(o.name);
      const hl = document.createElement("span"); hl.className = "latin"; hl.textContent = o.latin; h.appendChild(hl);
      const grid = document.createElement("div"); grid.className = "term-grid";
      items.forEach(s => {
        const row = document.createElement("div"); row.className = "term";
        const main = document.createElement("button"); main.type = "button"; main.className = "term-main";
        const lt = document.createElement("span"); lt.className = "lt"; lt.textContent = s.latin;
        const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = L(s.name);
        main.append(lt, nm);
        main.addEventListener("click", () => (s.id ? openStructure(o.id, s.id) : (switchTab("atlas"), loadOrgan(o.id))));
        const sp = document.createElement("button"); sp.type = "button"; sp.className = "icon-btn"; sp.title = S("listen"); sp.setAttribute("aria-label", S("listen"));
        sp.innerHTML = '<svg viewBox="0 0 20 20"><path d="M3.5 7.8v4.4h3L10.5 16V4L6.5 7.8h-3ZM13.5 7.2a4 4 0 0 1 0 5.6M15.6 5a7 7 0 0 1 0 10"/></svg>';
        sp.addEventListener("click", () => speak(s.latin));
        row.append(main, sp); grid.appendChild(row);
      });
      g.append(h, grid); box.appendChild(g);
    });
    $("termsEmpty").hidden = total > 0;
  }
  $("termSearch").addEventListener("input", renderTerms);

  /* ---------- AI-разбор изображения (Gemini, ключ пользователя) ---------- */
  const ai = { b64: null, mime: "", answer: null, organ: null, latin: "" };
  function aiNotice(el, text, cls) { el.hidden = !text; el.textContent = text || ""; el.className = "notice" + (cls ? " " + cls : ""); }
  function aiLoadFile(file) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return aiNotice($("aiNotice"), S("aiBadType"), "bad");
    if (file.size > 10 * 1024 * 1024) return aiNotice($("aiNotice"), S("aiBig"), "bad");
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      ai.b64 = url.split(",")[1] || null; ai.mime = file.type;
      $("aiPreview").src = url; $("aiPreviewBox").hidden = false; $("aiResult").hidden = true; aiNotice($("aiNotice"), "");
    };
    r.readAsDataURL(file);
  }
  $("aiFile").addEventListener("change", e => aiLoadFile(e.target.files && e.target.files[0]));
  const drop = $("aiDrop");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("is-over"); }));
  drop.addEventListener("drop", e => aiLoadFile(e.dataTransfer.files && e.dataTransfer.files[0]));

  function aiPrompt() {
    const langName = state.lang === "kk" ? "казахском" : "русском";
    return "Ты преподаватель анатомии медицинского университета. Внимательно разбери изображение, опираясь только на то, что на нём видно.\n" +
      "1. Определи анатомический орган или структуру.\n2. Дай название и международное латинское название.\n" +
      "3. Объясни расположение, строение и основную функцию (3–5 предложений).\n" +
      "4. Составь один тестовый вопрос с четырьмя вариантами, ровно один из которых верный.\n" +
      "Если изображение не относится к анатомии или орган нельзя уверенно определить, верни isAnatomy=false.\n" +
      "Поле organ: heart, lungs, kidneys, brain или other.\n" +
      'Верни только JSON вида {"isAnatomy":true,"organ":"heart","latin":"Cor","title":"...","desc":"...","question":"...","options":[{"text":"...","correct":true},{"text":"...","correct":false},{"text":"...","correct":false},{"text":"...","correct":false}]}.\n' +
      "Все тексты (кроме latin) — на " + langName + " языке.";
  }
  async function aiAnalyze() {
    const key = store.get("key", "").trim();
    if (!ai.b64) return aiNotice($("aiNotice"), S("aiNoImg"), "bad");
    if (key.length < 10) { aiNotice($("aiNotice"), S("aiNoKey"), "bad"); openProfile(); return; }
    const btn = $("aiAnalyze"); btn.disabled = true; btn.textContent = S("aiBusy"); aiNotice($("aiNotice"), "");
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: aiPrompt() }, { inline_data: { mime_type: ai.mime, data: ai.b64 } }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body.error && body.error.message) || ("HTTP " + res.status));
      const text = (((body.candidates || [])[0] || {}).content || {}).parts;
      const data = JSON.parse(String(text && text[0] && text[0].text || "{}").replace(/^```(?:json)?|```$/g, "").trim());
      if (!data.isAnatomy || !Array.isArray(data.options) || data.options.length < 2) { $("aiResult").hidden = true; return aiNotice($("aiNotice"), S("aiNotAnatomy"), "bad"); }
      aiShow(data);
    } catch (e) {
      aiNotice($("aiNotice"), S("aiError") + ": " + (e && e.message ? e.message : e), "bad");
    } finally { btn.disabled = false; btn.textContent = S("aiAnalyze"); }
  }
  function aiShow(d) {
    ai.latin = String(d.latin || ""); ai.organ = ORGANS.some(o => o.id === d.organ) ? d.organ : null; ai.answer = null;
    $("aiName").textContent = String(d.title || ""); $("aiLatin").textContent = ai.latin; $("aiDesc").textContent = String(d.desc || "");
    $("aiOpen3d").hidden = !ai.organ;
    $("aiQuestion").textContent = String(d.question || "");
    const box = $("aiOptions"); box.textContent = "";
    shuffle(d.options.slice(0, 4)).forEach((o, i) => {
      const lab = document.createElement("label"), inp = document.createElement("input"), sp = document.createElement("span");
      inp.type = "radio"; inp.name = "aiOpt"; inp.value = String(i); lab.dataset.correct = o.correct ? "1" : "0";
      sp.textContent = String(o.text || ""); lab.append(inp, sp); box.appendChild(lab);
    });
    aiNotice($("aiQuizMsg"), ""); $("aiCheck").disabled = false; $("aiResult").hidden = false;
    $("aiResult").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  $("aiAnalyze").addEventListener("click", aiAnalyze);
  $("aiSpeak").addEventListener("click", () => speak(ai.latin));
  $("aiOpen3d").addEventListener("click", () => { if (ai.organ) { switchTab("atlas"); loadOrgan(ai.organ); } });
  $("aiCheck").addEventListener("click", () => {
    const sel = document.querySelector('input[name="aiOpt"]:checked');
    if (!sel) return aiNotice($("aiQuizMsg"), S("aiPick"), "");
    const labels = [...document.querySelectorAll("#aiOptions label")];
    const chosen = sel.closest("label"), right = labels.find(l => l.dataset.correct === "1");
    labels.forEach(l => { l.querySelector("input").disabled = true; });
    if (right) right.classList.add("right");
    if (chosen === right) { addScore(10); aiNotice($("aiQuizMsg"), S("aiRight"), "ok"); }
    else { chosen.classList.add("wrong"); aiNotice($("aiQuizMsg"), S("aiWrongAns") + " " + (right ? right.textContent : ""), "bad"); }
    $("aiCheck").disabled = true;
  });

  /* ---------- профиль ---------- */
  const dlg = $("profile");
  function openProfile() {
    $("pfName").value = store.get("name", ""); $("pfGroup").value = store.get("group", ""); $("pfKey").value = store.get("key", "");
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  $("btnProfile").addEventListener("click", openProfile);
  $("pfClose").addEventListener("click", () => dlg.close());
  $("pfReset").addEventListener("click", () => { state.score = 0; addScore(0); });
  $("profileForm").addEventListener("submit", () => {
    store.set("name", $("pfName").value.trim()); store.set("group", $("pfGroup").value.trim()); store.set("key", $("pfKey").value.trim());
    applyI18n();
  });

  /* ---------- запуск ---------- */
  $("navScore").textContent = state.score;
  applyI18n(); renderTerms();
  loadOrgan(store.get("organ", "heart"));
})();
