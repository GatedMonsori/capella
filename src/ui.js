// Auriga+ — interface layer
// Parses Auriga (Aurion) API responses captured by capture.js and renders a
// clean, readable "bulletin": semester → UE → module tree with averages, and
// each exam nested under its module with its type and coefficient.
//
// Data sources (captured from the app's own authenticated requests):
//   /api/menuEntries/1144/searchResult  → "Mes notes (synthèse)": computed
//        averages for every node of the tree (+ per-exam rows with nice titles)
//   /api/menuEntries/1036/searchResult  → "Mes notes (éval)": individual exam
//        grades with coefficient (weight %) and exam type
//   /api/me                             → student identity
//   /api/globalPreferences              → academic year label

(function () {
  "use strict";
  if (document.getElementById("auriga-plus-fab")) return;

  var store = window.__AURIGA_PLUS__ || { responses: [] };

  // ------------------------------------------------------------------ config
  var EXAM_TYPES = {
    EXA: "Examen",
    EXF: "Examen final",
    EXO: "TP / Oral",
    EXP: "TP",
    FAF: "Éval. compétences",
    RATT: "Rattrapage",
    QCM: "QCM",
    CC: "Contrôle continu",
  };

  // Plain-French glossary for Auriga's cryptic wording.
  var GLOSSARY = [
    ["Composant pédagogique", "Module / matière"],
    ["Moy. (avant RATT)", "Moyenne provisoire (avant rattrapage)"],
    ["Moy. (finale)", "Moyenne finale (validée)"],
    ["Coef", "Poids de l'épreuve dans le module (%)"],
    ["EXA / EXF / EXO", "Examen / Examen final / TP-Oral"],
    ["RATT", "Rattrapage"],
    ["FISA", "Formation par apprentissage"],
  ];

  // Passing thresholds — editable in the UI, persisted in localStorage.
  // moduleThreshold = note éliminatoire d'une matière; ueThreshold = validation UE.
  var DEFAULTS = { moduleThreshold: 7, ueThreshold: 10 };
  var S = (function () {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem("capella.settings") || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  })();
  function saveSettings() {
    try { localStorage.setItem("capella.settings", JSON.stringify(S)); } catch (e) {}
  }

  // ---------------------------------------------------------------- helpers
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs)
      for (var k in attrs) {
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        else if (k === "html") n.innerHTML = attrs[k];
        else n.setAttribute(k, attrs[k]);
      }
    (kids || []).forEach(function (c) {
      if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function toast(msg) {
    var t = document.getElementById("auriga-plus-toast");
    if (!t) {
      t = el("div", { id: "auriga-plus-toast", class: "ap-toast" });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("ap-show");
    clearTimeout(t.__h);
    t.__h = setTimeout(function () { t.classList.remove("ap-show"); }, 1800);
  }

  function copy(text) {
    navigator.clipboard.writeText(text).then(
      function () { toast("Copié"); },
      function () { toast("Copie impossible"); }
    );
  }

  // Save an object as a downloaded JSON file (handles payloads too big to copy).
  function downloadJSON(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function toNum(v) {
    if (v == null) return NaN;
    return parseFloat(String(v).replace(",", "."));
  }
  function fmt(v) {
    var n = toNum(v);
    if (isNaN(n)) return v && String(v).trim() ? String(v) : "—";
    return (Math.round(n * 100) / 100).toString();
  }
  function nameOf(cap) {
    if (cap == null) return "";
    if (typeof cap === "string") return cap;
    return cap.fr || cap.en || cap.es || "";
  }

  // Colour scale on /20.
  function gradeColor(v) {
    var n = toNum(v);
    if (isNaN(n)) return "#5a6480";
    if (n >= 16) return "#1a7f45";
    if (n >= 14) return "#2d8f6f";
    if (n >= 12) return "#2b6cb0";
    if (n >= 10) return "#c07a1e";
    return "#c0392b";
  }
  // Threshold-based status (indicative — Auriga has its own jury/compensation rules).
  function moduleStatus(v) {
    var n = toNum(v);
    if (isNaN(n)) return null;
    if (n < S.moduleThreshold) return { t: "⚠ éliminatoire (<" + fmt(S.moduleThreshold) + ")", c: "red" };
    if (n < 10) return { t: "à rattraper", c: "orange" };
    return null; // validated modules stay clean; the green pill already says it
  }
  function ueStatus(v) {
    var n = toNum(v);
    if (isNaN(n)) return null;
    if (n < S.ueThreshold) return { t: "UE non validée (<" + fmt(S.ueThreshold) + ")", c: "red" };
    return { t: "UE validée", c: "green" };
  }

  function gradeTint(v) {
    var n = toNum(v);
    if (isNaN(n)) return "#eef1f7";
    if (n >= 16) return "#e6f4ec";
    if (n >= 14) return "#e7f2ee";
    if (n >= 12) return "#e8f0f9";
    if (n >= 10) return "#faf1e2";
    return "#f9e9e7";
  }

  // Normalise a code so exam codes and module codes line up.
  // Module:  2526_BSI_CYBER_FISA_S05_CYBER_BK       -> 2526_BSI_CYBER_S05_CYBER_BK
  // Exam:    2526_BSI_CYBER_S05_CYBER_BK_FISA_EXA_1 -> 2526_BSI_CYBER_S05_CYBER_BK
  function normCode(c) {
    return String(c || "")
      .replace("_FISA", "")
      .replace(/_(EXA|EXF|EXO|EXP|FAF|RATT|QCM|CC)(_\d+)?$/i, "");
  }

  // ------------------------------------------------------- response access
  function latest(urlPart) {
    for (var i = store.responses.length - 1; i >= 0; i--) {
      var r = store.responses[i];
      if (r.url && r.url.indexOf(urlPart) !== -1 && r.json) return r;
    }
    return null;
  }

  // Flatten Auriga's column tree to leaf columns, in the same order as `lines`.
  function flattenColumns(columns) {
    var leaves = [];
    (function walk(cols) {
      cols.forEach(function (c) {
        if (Array.isArray(c.children) && c.children.length) walk(c.children);
        else leaves.push(c);
      });
    })(columns || []);
    return leaves;
  }
  function labFr(l) {
    return (l.label && l.label.fr) || (l.defaultLabel && l.defaultLabel.fr) || "";
  }

  // --------------------------------------------------------- coefficients
  // Each obligation exposes obligationRelations[].coefficient = weight of a child
  // within its parent. We fetch /api/obligations once (replaying the app's auth),
  // extract every child→coef, and cache it. These weights reproduce Auriga's own
  // averages exactly, so they also power an accurate what-if simulator.
  var COEFS = {};
  var coefLoading = false;

  function readCoefCache() {
    try {
      var o = JSON.parse(localStorage.getItem("capella.coefs") || "null");
      if (o && o.map && Date.now() - o.t < 3 * 864e5) return o.map;
    } catch (e) {}
    return null;
  }
  function writeCoefCache(map) {
    try { localStorage.setItem("capella.coefs", JSON.stringify({ t: Date.now(), map: map })); } catch (e) {}
  }
  async function loadCoefficients() {
    if (Object.keys(COEFS).length) return false;
    var cached = readCoefCache();
    if (cached) { COEFS = cached; return false; }
    if (!store.auth || coefLoading) return false;
    coefLoading = true;
    var map = {};
    try {
      for (var page = 1; page <= 3; page++) {
        var r = await fetch("/api/obligations?size=2000&page=" + page, {
          headers: { Authorization: store.auth, Accept: "application/json" },
          credentials: "include",
        });
        if (!r.ok) break;
        var j = await r.json();
        (j.content || []).forEach(function (o) {
          (o.obligationRelations || []).forEach(function (rel) {
            var ch = (rel.obligationChild || {}).code;
            if (ch && rel.coefficient != null) map[ch] = rel.coefficient;
          });
        });
        if (!j.totalPages || j.currentPage >= j.totalPages) break;
      }
    } catch (e) { console.warn("[Capella] coef fetch failed", e); coefLoading = false; return false; }
    coefLoading = false;
    if (Object.keys(map).length) { COEFS = map; writeCoefCache(map); return true; }
    return false;
  }

  // ------------------------------------------------------------- parse data
  function parse() {
    var model = { name: "", year: "", semesters: [], hasTree: false, hasExams: false };

    // identity
    var me = latest("/api/me");
    if (me && me.json && me.json.person) {
      var p = me.json.person;
      model.name = ((p.currentFirstName || "") + " " + (p.currentLastName || "")).trim();
    }
    var gp = latest("/api/globalPreferences");
    if (gp && gp.json && gp.json.period && gp.json.period.caption) {
      model.year = nameOf(gp.json.period.caption).replace(/Ann[ée]e acad[ée]mique/i, "").trim();
    }

    // ---- synthesis (1144): tree nodes + exam captions ----
    var syn = latest("/menuEntries/1144/searchResult");
    var treeRows = [];
    var examCaptions = {}; // code -> nice title
    var period = "";
    if (syn && syn.json && syn.json.content) {
      var leaves = flattenColumns(syn.json.content.columns);
      var codeIdx = leaves.findIndex(function (l) { return l.field === "code"; });
      var capIdx = leaves.findIndex(function (l) { return l.field === "caption"; });
      var finalIdx = leaves.findIndex(function (l) { return /finale/i.test(labFr(l)); });
      var beforeIdx = leaves.findIndex(function (l) { return /avant/i.test(labFr(l)); });
      (syn.json.content.lines || []).forEach(function (line) {
        var code = line[codeIdx];
        if (!code) return;
        var m = /^(\d{4})_/.exec(code);
        if (m && (!period || m[1] > period)) period = m[1];
        var name = nameOf(line[capIdx]);
        if (/_FISA_S\d/.test(code)) {
          // module / UE / semester node
          treeRows.push({
            code: code,
            name: name,
            value: line[finalIdx] != null ? line[finalIdx] : line[beforeIdx],
            kind: line[finalIdx] != null ? "finale" : "provisoire",
          });
        } else {
          // exam-level row: keep its nice caption for later
          examCaptions[code] = name;
        }
      });
      model.hasTree = treeRows.length > 0;
    }

    // ---- exams (1036): grade + coefficient + type ----
    var ev = latest("/menuEntries/1036/searchResult");
    var exams = [];
    if (ev && ev.json && ev.json.content) {
      var el2 = flattenColumns(ev.json.content.columns);
      var markIdx = el2.findIndex(function (l) { return l.field === "calculatedField" && /note|mark/i.test(labFr(l)); });
      var coefIdx = el2.findIndex(function (l) { return l.field === "obligationRelationParentCoefficient"; });
      var eCodeIdx = el2.findIndex(function (l) { return l.field === "code" && !/type/i.test(labFr(l)); });
      var eTypeIdx = el2.findIndex(function (l) { return l.field === "code" && /type/i.test(labFr(l)); });
      (ev.json.content.lines || []).forEach(function (line) {
        var code = line[eCodeIdx];
        if (!code) return;
        exams.push({
          code: code,
          mark: line[markIdx],
          coef: coefIdx >= 0 ? line[coefIdx] : null,
          type: eTypeIdx >= 0 ? line[eTypeIdx] : "",
          title: examCaptions[code] || "",
          moduleKey: normCode(code),
        });
      });
      model.hasExams = exams.length > 0;
    }

    if (!model.hasTree) return model;

    // keep only current-year tree, dedupe by code (prefer a node that has a value)
    var byCode = {};
    treeRows.forEach(function (r) {
      if (period && r.code.indexOf(period + "_") !== 0) return;
      var ex = byCode[r.code];
      if (!ex || (ex.value == null && r.value != null)) byCode[r.code] = r;
    });
    var nodes = Object.keys(byCode).map(function (c) {
      return { code: c, name: byCode[c].name, value: byCode[c].value, kind: byCode[c].kind, coef: COEFS[c], children: [], exams: [] };
    });
    nodes.sort(function (a, b) { return a.code < b.code ? -1 : 1; });

    // nest by code prefix
    var index = {};
    nodes.forEach(function (n) { index[n.code] = n; });
    var roots = [];
    nodes.forEach(function (n) {
      var parent = null, best = -1;
      nodes.forEach(function (o) {
        if (o === n) return;
        if (n.code.indexOf(o.code + "_") === 0 && o.code.length > best) { parent = o; best = o.code.length; }
      });
      if (parent) parent.children.push(n);
      else roots.push(n);
    });

    // attach exams to leaf modules by normalised code
    var modByKey = {};
    nodes.forEach(function (n) { modByKey[normCode(n.code)] = n; });
    exams.forEach(function (x) {
      var mod = modByKey[x.moduleKey];
      if (mod) mod.exams.push(x);
    });
    nodes.forEach(function (n) {
      n.exams.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    });

    // roots = semesters, sorted by code (S05 before S06)
    roots.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    model.semesters = roots;
    if (!model.year && period) model.year = "20" + period.slice(0, 2) + "-20" + period.slice(2);
    return model;
  }

  // --------------------------------------------------------------- render
  function pill(value, kind) {
    var col = gradeColor(value);
    var box = el("span", { class: "ap-grade" });
    box.style.color = col;
    box.style.background = gradeTint(value);
    box.textContent = fmt(value);
    if (kind === "provisoire") {
      var s = el("span", { class: "ap-grade-note", text: " prov." });
      box.appendChild(s);
    }
    return box;
  }

  function renderExam(x) {
    var row = el("div", { class: "ap-exam" });
    var typeCode = String(x.type || "").toUpperCase();
    var typeLabel = EXAM_TYPES[typeCode] || typeCode || "Épreuve";
    var title = x.title || x.code.split("_").slice(-3).join(" ");
    row.appendChild(el("span", { class: "ap-exam-title", text: title }));
    var meta = el("span", { class: "ap-exam-meta" });
    meta.appendChild(el("span", { class: "ap-tag", text: typeLabel }));
    if (x.coef != null && x.coef !== "")
      meta.appendChild(el("span", { class: "ap-tag ap-tag-soft", text: "coef " + fmt(x.coef) + "%" }));
    row.appendChild(meta);
    var g = el("span", { class: "ap-exam-grade" });
    g.style.color = gradeColor(x.mark);
    g.textContent = x.mark != null && String(x.mark).trim() ? fmt(x.mark) : "—";
    row.appendChild(g);
    return row;
  }

  // Recursive node renderer. depth 0 = semester, 1 = UE, 2+ = module.
  function renderNode(node, depth) {
    if (depth === 0) {
      var card = el("div", { class: "ap-sem" });
      var head = el("div", { class: "ap-sem-head" });
      var titles = el("div", {});
      titles.appendChild(el("div", { class: "ap-sem-title", text: node.name || node.code }));
      titles.appendChild(el("div", { class: "ap-sem-sub", text: node.kind === "finale" ? "Moyenne finale" : "Moyenne provisoire (semestre en cours)" }));
      // ECTS: total = sum of UE weights; acquis = UEs with avg ≥ seuil UE and no ECUE below seuil matière.
      var totalECTS = node.children.reduce(function (s, c) { return s + (toNum(c.coef) || 0); }, 0);
      if (totalECTS) {
        var acqECTS = node.children.reduce(function (s, c) {
          var n = toNum(c.value);
          var okChildren = c.children.every(function (m) { var mn = toNum(m.value); return isNaN(mn) || mn >= S.moduleThreshold; });
          return s + (!isNaN(n) && n >= S.ueThreshold && okChildren ? (toNum(c.coef) || 0) : 0);
        }, 0);
        titles.appendChild(el("div", { class: "ap-sem-ects", text: "ECTS : " + acqECTS + " / " + totalECTS + " validés" }));
      }
      head.appendChild(titles);
      var big = el("div", { class: "ap-sem-avg" });
      big.style.color = gradeColor(node.value);
      big.textContent = fmt(node.value);
      big.appendChild(el("span", { class: "ap-sem-avg-max", text: "/20" }));
      head.appendChild(big);
      card.appendChild(head);
      var body = el("div", { class: "ap-sem-body" });
      node.children.forEach(function (c) { body.appendChild(renderNode(c, 1)); });
      card.appendChild(body);
      return card;
    }

    var box = el("div", { class: "ap-node ap-node-d" + Math.min(depth, 3) });
    var row = el("div", { class: "ap-node-row" });
    var hasKids = node.children.length || node.exams.length;
    var caret = el("span", { class: "ap-caret", text: hasKids ? "▾" : "" });
    row.appendChild(caret);
    row.appendChild(el("span", { class: "ap-node-name", text: node.name || node.code }));
    var isUE = depth === 1 && node.children.length;
    // A UE's weight within the semester equals its ECTS credits; deeper nodes
    // (ECUE / modules) carry an internal coefficient.
    if (node.coef != null)
      row.appendChild(el("span", { class: "ap-coef", text: isUE ? fmt(node.coef) + " ECTS" : "coef " + fmt(node.coef) }));
    var st = isUE ? ueStatus(node.value) : moduleStatus(node.value);
    if (st) row.appendChild(el("span", { class: "ap-status ap-status-" + st.c, text: st.t }));
    row.appendChild(pill(node.value, node.kind));
    box.appendChild(row);

    var sub = el("div", { class: "ap-node-sub" });
    node.children.forEach(function (c) { sub.appendChild(renderNode(c, depth + 1)); });
    if (node.exams.length) {
      var exWrap = el("div", { class: "ap-exams" });
      node.exams.forEach(function (x) { exWrap.appendChild(renderExam(x)); });
      sub.appendChild(exWrap);
    }
    box.appendChild(sub);

    if (hasKids) {
      row.style.cursor = "pointer";
      row.onclick = function () {
        var hidden = sub.style.display === "none";
        sub.style.display = hidden ? "" : "none";
        caret.textContent = hidden ? "▾" : "▸";
      };
    }
    return box;
  }

  function buildGradesPanel(model) {
    var panel = el("div", { class: "ap-panel ap-active", "data-panel": "grades" });
    if (!model.hasTree) {
      var empty = el("div", { class: "ap-empty" });
      empty.appendChild(el("p", { text:
        "Notes pas encore chargées. Ouvre « Mes notes (éval) » puis « Mes notes (synthèse) » dans le menu Auriga — Capella les affichera automatiquement." }));
      var btn = el("button", { class: "ap-btn", text: "Réessayer" });
      btn.onclick = function () { rerender(); };
      empty.appendChild(btn);
      panel.appendChild(empty);
      return panel;
    }
    // editable passing thresholds
    var bar = el("div", { class: "ap-settings" });
    bar.appendChild(el("span", { class: "ap-settings-lbl", text: "Seuils :" }));
    function numField(label, key) {
      var wrap = el("label", { class: "ap-settings-field" });
      wrap.appendChild(el("span", { text: label }));
      var inp = el("input", { type: "number", step: "0.5", min: "0", max: "20", value: String(S[key]) });
      inp.onchange = function () {
        var v = parseFloat(inp.value);
        if (!isNaN(v)) { S[key] = v; saveSettings(); rerender(); }
      };
      wrap.appendChild(inp);
      return wrap;
    }
    bar.appendChild(numField("matière éliminatoire <", "moduleThreshold"));
    bar.appendChild(numField("UE validée ≥", "ueThreshold"));
    panel.appendChild(bar);

    model.semesters.forEach(function (s) { panel.appendChild(renderNode(s, 0)); });

    // glossary
    var gl = el("div", { class: "ap-card ap-gloss" });
    var glHead = el("div", { class: "ap-gloss-head", text: "ℹ️ Traduction des termes Auriga" });
    var glBody = el("div", { class: "ap-gloss-body", style: "display:none" });
    var tbl = el("table", { class: "ap-table" });
    GLOSSARY.forEach(function (g) {
      tbl.appendChild(el("tr", {}, [el("td", { text: g[0] }), el("td", { text: g[1] })]));
    });
    glBody.appendChild(tbl);
    glHead.onclick = function () { glBody.style.display = glBody.style.display === "none" ? "" : "none"; };
    gl.appendChild(glHead);
    gl.appendChild(glBody);
    panel.appendChild(gl);
    return panel;
  }

  // Try likely endpoints for the obligation tree with coefficients, replaying the
  // page's own auth. Dumps results so we can find where module→UE coefs live.
  function shapeOf(j) {
    if (j == null) return "null";
    if (Array.isArray(j)) return "Array(" + j.length + ")";
    if (typeof j === "object") return "{ " + Object.keys(j).slice(0, 14).join(", ") + " }";
    return typeof j;
  }
  async function probeCoefficients() {
    var candidates = [
      "/api/viewObligationTrees?size=2000&page=1",
      "/api/viewObligationTrees?size=2000&page=1&sort=code",
      "/api/obligations?size=2000&page=1",
      "/api/obligationRelations?size=2000&page=1",
      "/api/obligationTrees?size=2000&page=1",
    ];
    var headers = { Accept: "application/json" };
    if (store.auth) headers.Authorization = store.auth;
    var out = [];
    for (var i = 0; i < candidates.length; i++) {
      var u = candidates[i];
      try {
        var r = await fetch(u, { headers: headers, credentials: "include" });
        var txt = await r.text();
        var j = null;
        try { j = JSON.parse(txt); } catch (e) {}
        out.push({ url: u, status: r.status, shape: j ? shapeOf(j) : txt.slice(0, 200), sample: j });
      } catch (e) {
        out.push({ url: u, error: String(e) });
      }
    }
    console.log("%c[Capella] probe results", "color:#1a2b6b;font-weight:bold", out);
    downloadJSON("capella-probe.json", out);
    toast("Sondage terminé — fichier téléchargé (capella-probe.json)");
    return out;
  }

  function buildDebugPanel() {
    var panel = el("div", { class: "ap-panel", "data-panel": "debug" });

    var probe = el("div", { class: "ap-card" });
    probe.appendChild(el("h2", { text: "Chercher les coefficients (module → UE)" }));
    probe.appendChild(el("p", { class: "ap-muted", html:
      "Teste les endpoints probables de l'arbre des obligations en réutilisant ta session. " +
      "Clique : un fichier <b>capella-probe.json</b> est téléchargé (assez gros pour ne pas passer par le presse-papier)." }));
    var pb = el("button", { class: "ap-btn", text: "🔍 Sonder les coefficients" });
    pb.onclick = function () { probeCoefficients(); };
    probe.appendChild(pb);
    probe.appendChild(el("div", { class: "ap-muted", style: "margin-top:8px", text:
      "Token capté : " + (store.auth ? "oui" : "pas encore (navigue un peu dans Auriga puis réessaie)") }));
    panel.appendChild(probe);

    var card = el("div", { class: "ap-card" });
    card.appendChild(el("h2", { text: "Données brutes captées (" + store.responses.length + ")" }));
    var b = el("button", { class: "ap-btn", text: "Tout copier (JSON)" });
    b.onclick = function () { copy(JSON.stringify(store.responses, null, 2)); };
    card.appendChild(b);
    panel.appendChild(card);
    return panel;
  }

  // ----------------------------------------------------------------- shell
  var root = null;
  function build(model) {
    root = el("div", { id: "auriga-plus-root" });

    var header = el("div", { class: "ap-header" });
    var brand = el("div", {});
    brand.appendChild(el("h1", { text: "Capella" }));
    brand.appendChild(el("span", { class: "ap-sub", text: (model.name || "") + (model.year ? " · " + model.year : "") }));
    header.appendChild(brand);
    header.appendChild(el("div", { class: "ap-spacer" }));
    var refresh = el("button", { text: "↻ Recharger" });
    refresh.onclick = function () { rerender(); toast("Actualisé"); };
    var close = el("button", { text: "✕ Auriga original" });
    close.onclick = function () { toggle(false); };
    header.appendChild(refresh);
    header.appendChild(close);
    root.appendChild(header);

    var tabs = el("div", { class: "ap-tabs" });
    var tG = el("button", { class: "ap-tab ap-active", text: "Mes notes" });
    var tD = el("button", { class: "ap-tab", text: "Debug" });
    tabs.appendChild(tG);
    tabs.appendChild(tD);
    root.appendChild(tabs);

    var body = el("div", { class: "ap-body" });
    var gPanel = buildGradesPanel(model);
    var dPanel = buildDebugPanel();
    body.appendChild(gPanel);
    body.appendChild(dPanel);
    root.appendChild(body);

    function activate(tab, name) {
      [tG, tD].forEach(function (t) { t.classList.remove("ap-active"); });
      tab.classList.add("ap-active");
      [gPanel, dPanel].forEach(function (p) {
        p.classList.toggle("ap-active", p.getAttribute("data-panel") === name);
      });
    }
    tG.onclick = function () { activate(tG, "grades"); };
    tD.onclick = function () { activate(tD, "debug"); };

    document.body.appendChild(root);
  }

  function parseSafe() {
    try { return parse(); }
    catch (e) { console.warn("[Capella] parse error", e); return { hasTree: false, hasExams: false, semesters: [], name: "", year: "" }; }
  }

  function rerender() {
    try {
      var open = root && root.classList.contains("ap-open");
      if (root) root.remove();
      build(parseSafe());
      if (open) root.classList.add("ap-open");
    } catch (e) { console.warn("[Capella] render error", e); }
  }

  function toggle(open) {
    if (!root) build(parse());
    var show = open === undefined ? !root.classList.contains("ap-open") : open;
    root.classList.toggle("ap-open", show);
    if (!show) sessionStorage.setItem("apDismissed", "1");
  }

  // NOTE: Capella never navigates the Angular app itself — that risked blanking
  // the page. It only renders from data the app has already loaded, and takes
  // over only once real grade data is present.

  // ------------------------------------------------------------------ init
  try {
    var fab = el("button", { id: "auriga-plus-fab", text: "Capella" });
    fab.onclick = function () {
      sessionStorage.removeItem("apDismissed");
      toggle();
    };
    document.body.appendChild(fab);

    COEFS = readCoefCache() || {};
    build(parseSafe());

    function maybeAutoOpen() {
      if (!root) return;
      if (sessionStorage.getItem("apDismissed") === "1") return;
      if (parseSafe().hasTree && !root.classList.contains("ap-open")) root.classList.add("ap-open");
    }
    function ensureCoefs() {
      loadCoefficients().then(function (changed) { if (changed && root) rerender(); });
    }

    // Re-render as the app loads more data; auto-open only when grades exist.
    window.addEventListener("auriga-plus:capture", function () {
      try {
        if (root && root.classList.contains("ap-open")) rerender();
        maybeAutoOpen();
        ensureCoefs();
      } catch (e) { console.warn("[Capella]", e); }
    });

    maybeAutoOpen();
    ensureCoefs();
    console.log("%c[Capella] UI ready", "color:#1a2b6b;font-weight:bold");
  } catch (e) {
    console.warn("[Capella] init failed (Auriga left untouched):", e);
  }
})();
