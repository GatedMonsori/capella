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

  // Normalise a code so exam codes and module codes line up, program-agnostic.
  // Removes the study-track token (FISA/FISE/…) wherever it sits and strips a
  // trailing exam-type suffix, so both sides collapse to the same module path.
  //   Module: 2526_BSI_CYBER_FISA_S05_CYBER_BK        -> 2526_BSI_CYBER_S05_CYBER_BK
  //   Exam:   2526_BSI_CYBER_S05_CYBER_BK_FISA_EXA_1  -> 2526_BSI_CYBER_S05_CYBER_BK
  function normCode(c) {
    return String(c || "")
      .replace(/_(FISA|FISE|FISEA|APP)(?=_|$)/gi, "")
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

  // Identify a captured searchResult by its column signature rather than by a
  // hardcoded menu-entry id — so it works for any program/profile.
  //   exams:     has an obligationRelationParentCoefficient column
  //   synthesis: has a caption column (module/UE labels) + no coef column
  function classifyResult(resp) {
    if (!resp.json || !resp.json.content || !resp.json.content.columns) return null;
    var leaves = flattenColumns(resp.json.content.columns);
    var hasCoef = leaves.some(function (l) { return l.field === "obligationRelationParentCoefficient"; });
    var hasCaption = leaves.some(function (l) { return l.field === "caption"; });
    var hasCode = leaves.some(function (l) { return l.field === "code"; });
    if (hasCoef && hasCode) return "exams";
    if (hasCaption && hasCode) return "synthesis";
    return null;
  }
  function findResult(kind) {
    for (var i = store.responses.length - 1; i >= 0; i--) {
      if (classifyResult(store.responses[i]) === kind) return store.responses[i];
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

  // ---------------------------------------------- obligation structure (OB)
  // /api/obligations exposes, for every program, the full tree via
  // obligationRelations (parent → child + coefficient). We fetch it once
  // (replaying the app's auth), cache it, and use it to build the hierarchy for
  // ANY program (no code-pattern guessing). A child's coefficient within its
  // parent equals its ECTS at the UE level and reproduces Auriga's averages.
  var OB = { parent: {}, children: {}, coef: {}, caption: {}, loaded: false };
  var COEFS = OB.coef; // alias kept for readability
  var obLoading = false;

  function readObCache() {
    try {
      var o = JSON.parse(localStorage.getItem("capella.ob") || "null");
      if (o && o.ob && Date.now() - o.t < 3 * 864e5) return o.ob;
    } catch (e) {}
    return null;
  }
  function writeObCache() {
    try { localStorage.setItem("capella.ob", JSON.stringify({ t: Date.now(), ob: OB })); } catch (e) {}
  }
  function useOb(ob) { OB = ob; OB.loaded = true; COEFS = OB.coef; }

  async function loadCoefficients() {
    if (OB.loaded) return false;
    var cached = readObCache();
    if (cached) { useOb(cached); return true; }
    if (!store.auth || obLoading) return false;
    obLoading = true;
    var ob = { parent: {}, children: {}, coef: {}, caption: {}, loaded: true };
    try {
      for (var page = 1; page <= 3; page++) {
        var r = await fetch("/api/obligations?size=2000&page=" + page, {
          headers: { Authorization: store.auth, Accept: "application/json" },
          credentials: "include",
        });
        if (!r.ok) break;
        var j = await r.json();
        (j.content || []).forEach(function (o) {
          var code = o.code;
          if (!code) return;
          var cap = o.caption || {};
          ob.caption[code] = cap.fr || cap.en || code;
          (o.obligationRelations || []).forEach(function (rel) {
            var ch = (rel.obligationChild || {}).code;
            if (!ch) return;
            ob.parent[ch] = code;
            (ob.children[code] = ob.children[code] || []).push(ch);
            if (rel.coefficient != null) ob.coef[ch] = rel.coefficient;
          });
        });
        if (!j.totalPages || j.currentPage >= j.totalPages) break;
      }
    } catch (e) { console.warn("[Capella] obligations fetch failed", e); obLoading = false; return false; }
    obLoading = false;
    if (Object.keys(ob.parent).length) { useOb(ob); writeObCache(); return true; }
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

    // ---- locate the two notes result sets by SHAPE (no hardcoded menu ids) ----
    var syn = findResult("synthesis");
    var ev = findResult("exams");

    // ---- synthesis rows: structure nodes (with averages) + exam captions ----
    var synRows = [];
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
        synRows.push({
          code: code,
          name: nameOf(line[capIdx]),
          value: finalIdx >= 0 && line[finalIdx] != null ? line[finalIdx] : (beforeIdx >= 0 ? line[beforeIdx] : null),
          kind: finalIdx >= 0 && line[finalIdx] != null ? "finale" : "provisoire",
        });
      });
    }

    // A synthesis row is a structure node (semester/UE/module) if the obligation
    // tree knows it; otherwise it's an exam-level row (kept for its nice title).
    // Fall back to the code pattern only when obligations aren't loaded yet.
    function isStructure(code) {
      if (OB.loaded) return !!(OB.parent[code] || OB.children[code]);
      return /_FISA_S\d/.test(code);
    }
    var treeRows = [];
    synRows.forEach(function (r) {
      if (isStructure(r.code)) treeRows.push(r);
      else examCaptions[r.code] = r.name;
    });
    model.hasTree = treeRows.length > 0;

    // ---- exams: grade + coefficient + type ----
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
          mark: markIdx >= 0 ? line[markIdx] : null,
          coef: coefIdx >= 0 ? line[coefIdx] : null,
          type: eTypeIdx >= 0 ? line[eTypeIdx] : "",
          title: examCaptions[code] || "",
          moduleKey: normCode(code),
        });
      });
      model.hasExams = exams.length > 0;
    }

    if (!model.hasTree) return model;

    // keep only the current year, dedupe by code (prefer a node that has a value)
    var byCode = {};
    treeRows.forEach(function (r) {
      if (period && r.code.indexOf(period + "_") !== 0) return;
      var ex = byCode[r.code];
      if (!ex || (ex.value == null && r.value != null)) byCode[r.code] = r;
    });
    var nodes = Object.keys(byCode).map(function (c) {
      return { code: c, name: OB.caption[c] || byCode[c].name, value: byCode[c].value, kind: byCode[c].kind, coef: OB.coef[c], children: [], exams: [] };
    });
    var index = {};
    nodes.forEach(function (n) { index[n.code] = n; });

    // nest: authoritative parent from the obligation tree, else longest prefix
    var roots = [];
    nodes.forEach(function (n) {
      var parent = null;
      if (OB.loaded && OB.parent[n.code] && index[OB.parent[n.code]]) {
        parent = index[OB.parent[n.code]];
      } else if (!OB.loaded) {
        var best = -1;
        nodes.forEach(function (o) {
          if (o !== n && n.code.indexOf(o.code + "_") === 0 && o.code.length > best) { parent = o; best = o.code.length; }
        });
      }
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
      n.children.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
      n.exams.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    });

    roots.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    model.semesters = roots;
    if (!model.year && period) model.year = "20" + period.slice(0, 2) + "-20" + period.slice(2);
    return model;
  }

  // ------------------------------------------------------------ simulation
  // In simulation mode the user types hypothetical grades into modules and the
  // UE + semester averages recompute live, using the real coefficients (which
  // reproduce Auriga's own averages exactly).
  var SIM = {};             // module code -> hypothetical grade (/20), as string
  var simMode = false;
  var currentModel = null;
  var projPills = {};       // node code -> grade pill (updated live)
  var semAvgBoxes = {};     // semester code -> big average box
  var semEctsBoxes = {};    // semester code -> ECTS line

  // Effective /20 value of a node given the current overrides. Leaves take the
  // override (or the actual grade); parents are the coefficient-weighted mean of
  // their children, skipping any that are ungraded.
  function effectiveValue(node) {
    if (!node.children.length) {
      var ov = SIM[node.code];
      if (ov != null && String(ov).trim() !== "") return toNum(ov);
      return toNum(node.value);
    }
    var num = 0, den = 0;
    node.children.forEach(function (child) {
      var v = effectiveValue(child);
      var w = toNum(child.coef);
      if (!isNaN(v) && !isNaN(w)) { num += v * w; den += w; }
    });
    return den ? num / den : NaN;
  }
  function displayValue(node) { return simMode ? effectiveValue(node) : toNum(node.value); }

  // --------------------------------------------------------------- render
  function paintPill(box, value, kind) {
    box.textContent = fmt(value);
    box.style.color = gradeColor(value);
    box.style.background = gradeTint(value);
    if (kind === "provisoire") box.appendChild(el("span", { class: "ap-grade-note", text: " prov." }));
  }
  function pill(value, kind) {
    var box = el("span", { class: "ap-grade" });
    paintPill(box, value, kind);
    return box;
  }
  function setSemAvg(box, value) {
    box.textContent = fmt(value);
    box.style.color = gradeColor(value);
    box.appendChild(el("span", { class: "ap-sem-avg-max", text: "/20" }));
  }
  function semesterEcts(sem) {
    var total = sem.children.reduce(function (s, c) { return s + (toNum(c.coef) || 0); }, 0);
    var acquired = sem.children.reduce(function (s, c) {
      var v = displayValue(c);
      var okChildren = c.children.every(function (m) {
        var mv = displayValue(m);
        return isNaN(mv) || mv >= S.moduleThreshold;
      });
      return s + (!isNaN(v) && v >= S.ueThreshold && okChildren ? (toNum(c.coef) || 0) : 0);
    }, 0);
    return { total: total, acquired: acquired };
  }

  // Live-update projected averages/ECTS in place (no full re-render, keeps focus).
  function recompute() {
    if (!currentModel) return;
    (function walk(nodes) {
      nodes.forEach(function (n) {
        walk(n.children);
        if (projPills[n.code]) paintPill(projPills[n.code], effectiveValue(n), null);
      });
    })(currentModel.semesters);
    currentModel.semesters.forEach(function (sem) {
      if (semAvgBoxes[sem.code]) setSemAvg(semAvgBoxes[sem.code], effectiveValue(sem));
      if (semEctsBoxes[sem.code]) {
        var e = semesterEcts(sem);
        semEctsBoxes[sem.code].textContent = "ECTS : " + e.acquired + " / " + e.total + " validés";
      }
    });
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

  // Number input a learner can type a hypothetical grade into (leaf modules).
  function simInput(node) {
    var inp = el("input", {
      class: "ap-sim-input", type: "number", step: "0.5", min: "0", max: "20",
      placeholder: node.value != null ? fmt(node.value) : "—",
      value: SIM[node.code] != null ? SIM[node.code] : "",
    });
    inp.oninput = function () {
      var v = inp.value.trim();
      if (v === "") delete SIM[node.code]; else SIM[node.code] = v;
      recompute();
    };
    return inp;
  }

  // Recursive node renderer. depth 0 = semester, 1 = UE, 2+ = module.
  function renderNode(node, depth) {
    if (depth === 0) {
      var card = el("div", { class: "ap-sem" });
      var head = el("div", { class: "ap-sem-head" });
      var titles = el("div", {});
      titles.appendChild(el("div", { class: "ap-sem-title", text: node.name || node.code }));
      titles.appendChild(el("div", { class: "ap-sem-sub", text: node.kind === "finale" ? "Moyenne finale" : "Moyenne provisoire (semestre en cours)" }));
      var ects = semesterEcts(node);
      if (ects.total) {
        var ectsBox = el("div", { class: "ap-sem-ects", text: "ECTS : " + ects.acquired + " / " + ects.total + " validés" });
        semEctsBoxes[node.code] = ectsBox;
        titles.appendChild(ectsBox);
      }
      head.appendChild(titles);
      var big = el("div", { class: "ap-sem-avg" });
      setSemAvg(big, displayValue(node));
      semAvgBoxes[node.code] = big;
      head.appendChild(big);
      card.appendChild(head);
      var body = el("div", { class: "ap-sem-body" });
      node.children.forEach(function (c) { body.appendChild(renderNode(c, 1)); });
      card.appendChild(body);
      return card;
    }

    var isLeaf = !node.children.length;
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
    var st = isUE ? ueStatus(displayValue(node)) : moduleStatus(displayValue(node));
    if (st) row.appendChild(el("span", { class: "ap-status ap-status-" + st.c, text: st.t }));
    if (simMode && isLeaf) row.appendChild(simInput(node));
    var gradePill = pill(displayValue(node), node.kind);
    projPills[node.code] = gradePill;
    row.appendChild(gradePill);
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

    // reset live-update registries for this render
    currentModel = model;
    projPills = {};
    semAvgBoxes = {};
    semEctsBoxes = {};

    if (simMode) {
      var simbar = el("div", { class: "ap-simbar" });
      simbar.appendChild(el("span", { text:
        "🎯 Simulation : saisis des notes hypothétiques dans les modules ; les moyennes UE, semestre et ECTS se recalculent en direct." }));
      var reset = el("button", { class: "ap-btn ap-btn-soft", text: "Réinitialiser" });
      reset.onclick = function () { SIM = {}; rerender(); };
      simbar.appendChild(reset);
      panel.appendChild(simbar);
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
    if (model.hasTree) {
      var simBtn = el("button", { class: simMode ? "ap-btn-on" : "", text: simMode ? "🎯 Simulation activée" : "🎯 Simuler" });
      simBtn.onclick = function () { simMode = !simMode; if (!simMode) SIM = {}; rerender(); };
      header.appendChild(simBtn);
    }
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
