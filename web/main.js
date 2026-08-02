/* Booboo landing — device gating, copy buttons, readout.
   The viewer has no WebGL detection and no weak-GPU fallback (SCALE.md lists
   both as roadmap), so the guards live here. A public demo must never hand a
   visitor a black rectangle or crash their phone. */

(function () {
  "use strict";

  var stage  = document.getElementById("stage");
  var frame  = document.getElementById("brain");

  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function hasWebGL() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext &&
        (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) { return false; }
  }

  // Rough capability tier. navigator.deviceMemory / hardwareConcurrency are
  // absent on Safari, so unknown is treated as capable and the width check
  // carries the decision.
  function tier() {
    var w = window.innerWidth;
    var cores = navigator.hardwareConcurrency || 8;
    var mem = navigator.deviceMemory || 8;
    var coarse = matchMedia("(pointer: coarse)").matches;
    if (w >= 1024 && !coarse && cores >= 6 && mem >= 4) return "high";
    if (w >= 768 && cores >= 4) return "mid";
    return "low";
  }

  // Hero is a background — it stays light so first paint is fast.
  // The CTA is the flex, and it scales too: a million nodes on a phone is a
  // crashed tab, which is a worse outcome than a smaller honest number.
  var HERO = { high: 60000, mid: 24000, low: 8000 };
  var FULL = { high: 1000000, mid: 250000, low: 60000 };

  var fmt = function (n) { return n.toLocaleString("en-GB"); };

  var t = tier();
  var gl = hasWebGL();

  // Three grounds, in descending order of what the device can carry.
  //
  // The old branch was binary — live WebGL, or a pair of faint CSS radials
  // that GAPS generously called "a starfield" and that render as very nearly
  // nothing. So every phone visitor read "It's turning behind these words,
  // live" over an empty rectangle: the claim was not just unsupported, it was
  // contradicted, on the page whose entire pitch is that its numbers are real.
  //
  // The middle ground is a PRE-RENDERED LOOP of the real cosmos (GOALS G1).
  // It is the same house, recorded from the same viewer, and it closes the
  // weak-GPU hole (C7) in the same move: a device that cannot carry a second
  // WebGL context gets 450KB of h264 instead of a black rectangle or a
  // crashed tab.
  function drop(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }
  var claim = document.getElementById("hero-claim");

  if (reduced) {
    // Never autoplay at someone who asked for stillness. The poster is the
    // loop's own first frame, so they see the same house, held.
    stage.classList.add("still");
    drop(frame);
    if (claim) claim.textContent = "It turns behind these words when you ask it to.";
  } else if (!gl || t === "low") {
    var v = document.createElement("video");
    v.src = "./img/cosmos-loop.mp4";
    v.poster = "./img/cosmos-loop.jpg";
    v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
    v.setAttribute("muted", ""); v.setAttribute("playsinline", "");   // iOS wants the attributes, not just the props
    v.setAttribute("aria-hidden", "true");
    v.tabIndex = -1;
    v.addEventListener("loadeddata", function () { v.classList.add("ready"); });
    // If autoplay is refused anyway (low-power mode), the poster is already
    // painted underneath, so the failure mode is a still image and not a hole.
    stage.appendChild(v);
    drop(frame);
    if (claim) claim.textContent = "This is it turning: recorded from the same graph you can open below.";
  } else {
    // The hero is the Pemberton Grand — 2,414 nodes, readable on any GPU tier.
    // Scale proves itself behind the proof link; comprehension is the front door.
    frame.addEventListener("load", function () { frame.classList.add("ready"); });
    frame.src = "./viewer/?file=/pemberton.booboo.json&chrome=0";
  }

  // Retarget the scale-proof link to something this device survives.
  var full = FULL[t];
  Array.prototype.forEach.call(
    document.querySelectorAll('a[href="./viewer/?n=1000000"]'),
    function (a) {
      a.setAttribute("href", "./viewer/?n=" + full);
      if (full !== 1000000) {
        a.textContent = "see it hold at " + fmt(full) + " →";
        a.title = "Scaled to this device. Open on a desktop for the full million.";
      }
    }
  );

  // ── Ask the house, from the page. Real JSON-RPC against /mcp — the same
  // endpoint a claude.ai connector talks to. Stateless, so one POST per call.
  var QUESTIONS = {
    failures: {
      ask: "Major failures this week",
      call: { name: "booboo_count", arguments: { where: { "data.kind": "incident", "data.severity": "major" }, since: isoDaysAgo(7) } },
      render: function (r) {
        return "booboo_count · major incidents, last 7 days\n\n→ " + r.total + " major failures this week.\n" +
          "  Room 407 water leak · Lift E2 entrapment · ballroom power failure.\n  Engineering is running amber.";
      },
    },
    absence: {
      ask: "Worst absence record, 5 years",
      call: { name: "booboo_count", arguments: { where: { "data.kind": "absence" }, groupBy: "data.subject", limit: 3 } },
      render: function (r) {
        var g = r.groups || [];
        var lines = g.map(function (x, i) {
          return "  " + (i + 1) + ". " + x.key.replace("agent:", "") + " — " + x.count;
        }).join("\n");
        return "booboo_count · absences grouped by subject\n\n→ " + (g[0] ? g[0].key.replace("agent:", "") : "—") +
          ", by a distance.\n\n" + lines + "\n\n  (" + r.total + " absences on the ledger)";
      },
    },
    "incidents-by-dept": {
      ask: "Incidents by department",
      call: { name: "booboo_count", arguments: { where: { "data.kind": "incident" }, groupBy: "cluster", limit: 5 } },
      render: function (r) {
        return "booboo_count · incidents grouped by department\n\n" +
          (r.groups || []).map(function (x) { return "  " + pad(x.key, 22) + x.count; }).join("\n") +
          "\n\n  (" + r.total + " incidents total)";
      },
    },
    boot: {
      ask: "What does Housekeeping boot with?",
      call: { name: "booboo_boot", arguments: { agent: "housekeeping" } },
      render: function (r) {
        return "booboo_boot(\"housekeeping\")\n\n" +
          "  persona   " + (r.agent && r.agent.role ? r.agent.role : "—") + "\n" +
          "  chain     " + (r.chain || []).map(function (c) { return c.id; }).join(" → ") + "\n" +
          "  rules     " + (r.rules || []).join("\n            ") + "   ← ancestors first\n" +
          "  buckets   " + (r.buckets || []).join(" · ") + "\n" +
          "  reports   " + ((r.children || []).length) + " roles";
      },
    },
  };

  function pad(s, n) { s = String(s); while (s.length < n) s += " "; return s; }
  function isoDaysAgo(d) { return new Date(Date.now() - d * 864e5).toISOString().slice(0, 10); }

  var answer = document.getElementById("answer");
  var chips = document.getElementById("chips");
  if (answer && chips) {
    chips.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-q]");
      if (!b) return;
      var q = QUESTIONS[b.dataset.q];
      if (!q) return;
      Array.prototype.forEach.call(chips.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
      answer.firstChild.textContent = "asking the house…";
      fetch("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: q.call }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var text = d && d.result && d.result.content && d.result.content[0] && d.result.content[0].text;
          if (!text) throw new Error("no content");
          answer.firstChild.textContent = q.render(JSON.parse(text));
        })
        .catch(function () {
          answer.firstChild.textContent =
            "The house didn't answer just now.\nThe endpoint is live at /mcp — try it from your own MCP client.";
        });
    });
  }

  // Copy buttons
  Array.prototype.forEach.call(document.querySelectorAll(".copy"), function (btn) {
    btn.addEventListener("click", function () {
      var el = document.querySelector(btn.dataset.copy);
      if (!el) return;
      navigator.clipboard.writeText(el.textContent.trim()).then(function () {
        var was = btn.textContent;
        btn.textContent = "Copied";
        btn.classList.add("done");
        setTimeout(function () { btn.textContent = was; btn.classList.remove("done"); }, 1600);
      }).catch(function () {
        btn.textContent = "Copy failed";
        setTimeout(function () { btn.textContent = "Copy"; }, 1600);
      });
    });
  });

  // Scroll reveal. Progressive enhancement in both directions: without
  // IntersectionObserver, or under prefers-reduced-motion, everything is shown
  // immediately rather than left invisible — a reveal that never fires is a
  // blank page, which is a worse failure than no animation at all.
  var revealables = document.querySelectorAll(".reveal");
  var noMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!("IntersectionObserver" in window) || noMotion) {
    Array.prototype.forEach.call(revealables, function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        io.unobserve(e.target); // reveal once; re-animating on scroll-back is noise
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
    Array.prototype.forEach.call(revealables, function (el) { io.observe(el); });
  }
})();
