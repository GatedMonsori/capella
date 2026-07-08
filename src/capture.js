// Auriga+ — capture layer
// Runs in the MAIN world at document_start, BEFORE Aurion's Angular app boots,
// so it can wrap fetch/XHR and record every JSON response the app receives.
//
// Captured payloads are stored on window.__AURIGA_PLUS__ and also broadcast via
// a CustomEvent ("auriga-plus:capture") that the UI layer listens to.

(function () {
  "use strict";

  if (window.__AURIGA_PLUS__) return; // avoid double-install on SPA re-inject

  const store = {
    // every captured response, newest last
    responses: [],
    // responses that look grade-related, keyed by url
    grades: [],
    // most recent Authorization header seen on an /api/ request (Bearer token).
    // Used by the coefficient probe to replay authenticated requests. Tokens are
    // short-lived, so we always keep the latest.
    auth: null,
    version: "1.1.0",
  };
  window.__AURIGA_PLUS__ = store;

  const MAX = 200; // cap memory

  // Heuristics: does this URL / payload look like it carries grades?
  const GRADE_URL_HINTS = /note|grade|eval|synth|releve|bulletin|resultat|scolar|module|ects|moyenne|mark/i;

  function looksGradeUrl(url) {
    return GRADE_URL_HINTS.test(url || "");
  }

  function summarize(value, depth) {
    // Build a shallow shape summary so the debug panel can show structure
    depth = depth || 0;
    if (value === null) return "null";
    if (Array.isArray(value)) {
      return (
        "Array(" +
        value.length +
        ")" +
        (value.length && depth < 2 ? " of " + summarize(value[0], depth + 1) : "")
      );
    }
    const t = typeof value;
    if (t === "object") {
      if (depth >= 2) return "{…}";
      return (
        "{ " +
        Object.keys(value).slice(0, 12).join(", ") +
        (Object.keys(value).length > 12 ? ", …" : "") +
        " }"
      );
    }
    return t;
  }

  function record(url, method, status, body) {
    let json = null;
    let text = null;
    try {
      json = typeof body === "string" ? JSON.parse(body) : body;
    } catch (e) {
      text = typeof body === "string" ? body.slice(0, 2000) : null;
    }
    const entry = {
      url: url,
      method: method || "GET",
      status: status,
      at: new Date().toISOString(),
      json: json,
      text: text,
      shape: json != null ? summarize(json) : text ? "text(" + text.length + ")" : "empty",
    };
    store.responses.push(entry);
    if (store.responses.length > MAX) store.responses.shift();

    if (json != null && (looksGradeUrl(url) || jsonLooksGrade(json))) {
      store.grades.push(entry);
      if (store.grades.length > MAX) store.grades.shift();
    }

    try {
      window.dispatchEvent(new CustomEvent("auriga-plus:capture", { detail: { url: url } }));
    } catch (e) {}
  }

  // Very loose structural heuristic: an array of objects whose keys mention grades,
  // or objects with obvious grade-ish keys.
  function jsonLooksGrade(json) {
    const keyRe =
      /note|moyenne|coef|coeff|ects|credit|module|matiere|ue$|libell|resultat|mark|grade|semestre/i;
    function scan(v, d) {
      if (d > 4 || v == null) return false;
      if (Array.isArray(v)) return v.slice(0, 5).some((x) => scan(x, d + 1));
      if (typeof v === "object") {
        const keys = Object.keys(v);
        if (keys.some((k) => keyRe.test(k))) return true;
        return keys.slice(0, 20).some((k) => scan(v[k], d + 1));
      }
      return false;
    }
    return scan(json, 0);
  }

  function grabAuth(input, init) {
    try {
      var h = (init && init.headers) || (input && input.headers);
      if (!h) return;
      var v = null;
      if (typeof h.get === "function") v = h.get("Authorization") || h.get("authorization");
      else for (var k in h) if (String(k).toLowerCase() === "authorization") v = h[k];
      if (v) store.auth = v;
    } catch (e) {}
  }

  // ---- Hook fetch ----
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = (init && init.method) || (input && input.method) || "GET";
      grabAuth(input, init);
      return origFetch.apply(this, arguments).then((res) => {
        try {
          res
            .clone()
            .text()
            .then((body) => record(url, method, res.status, body))
            .catch(() => {});
        } catch (e) {}
        return res;
      });
    };
  }

  // ---- Hook XMLHttpRequest ----
  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    const setHeader = XHR.prototype.setRequestHeader;
    XHR.prototype.setRequestHeader = function (name, value) {
      if (String(name).toLowerCase() === "authorization" && value) store.auth = value;
      return setHeader.apply(this, arguments);
    };
    XHR.prototype.open = function (method, url) {
      this.__ap_method = method;
      this.__ap_url = url;
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      this.addEventListener("load", function () {
        try {
          const ct = this.getResponseHeader && this.getResponseHeader("content-type");
          let body = null;
          if (this.responseType === "" || this.responseType === "text") {
            body = this.responseText;
          } else if (this.responseType === "json") {
            body = this.response;
          }
          if (body != null || (ct && /json/i.test(ct))) {
            record(this.__ap_url, this.__ap_method, this.status, body);
          }
        } catch (e) {}
      });
      return send.apply(this, arguments);
    };
  }

  // Console helper so the user can copy captured data easily.
  store.dump = function () {
    console.log("%c[Capella] captured responses", "color:#3355ff;font-weight:bold");
    console.log(store.responses);
    return store.responses;
  };
  store.dumpGrades = function () {
    console.log("%c[Capella] grade-like responses", "color:#3355ff;font-weight:bold");
    console.log(store.grades);
    return store.grades;
  };

  console.log("%c[Capella] capture installed", "color:#3355ff;font-weight:bold");
})();
