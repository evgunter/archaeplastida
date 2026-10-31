"use strict";
// ---------------------------------------------------------------- data
let N, parent, depth, end, isTip, tips, size, tipByName = new Map();
const PHOTO = { o: "https://inaturalist-open-data.s3.amazonaws.com/photos/", s: "https://static.inaturalist.org/photos/" };
const RANK_ORDER = ["genus", "subtribe", "tribe", "subfamily", "family", "superfamily", "suborder", "order",
  "superorder", "subclass", "class", "superclass", "subphylum", "phylum", "subkingdom", "kingdom"];

function photoUrl(code, kind = "medium") {
  if (!code) return "";
  const [k, rest] = [code[0], code.slice(2)];
  return (PHOTO[k] || "") + rest.replace("/medium.", `/${kind}.`);
}

async function load() {
  const res = await fetch("data/game.json");
  const d = await res.json();
  N = d.nodes;
  const n = N.length;
  parent = new Int32Array(n); depth = new Int32Array(n); end = new Int32Array(n);
  isTip = new Uint8Array(n); size = new Int32Array(n);
  tips = [];
  for (let i = 0; i < n; i++) {
    parent[i] = N[i][0];
    depth[i] = parent[i] < 0 ? 0 : depth[parent[i]] + 1;
    if (!Array.isArray(N[i][1])) {
      isTip[i] = 1;
      const [, sci, common, means, count, id, photo, attr, src, family] = N[i];
      const t = { node: i, sci, common, means, count, id, photo, attr, src, family,
                  key: (common + " " + sci).toLowerCase() };
      tips.push(t);
      tipByName.set(sci, t);
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    if (isTip[i]) size[i] += 1;
    if (parent[i] >= 0) size[parent[i]] += size[i];
  }
  // preorder: subtree of i is [i, end[i])
  for (let i = 0; i < n; i++) end[i] = i + 1;
  for (let i = n - 1; i > 0; i--) end[parent[i]] = Math.max(end[parent[i]], end[i]);
  tips.forEach(t => (t.tipNode = t.node));
  tipOfNode = new Map(tips.map(t => [t.node, t]));
  document.getElementById("data-built").textContent =
    `${tips.length.toLocaleString()} species · data built ${d.built}`;
}
let tipOfNode;

function mrca(a, b) {
  while (a !== b) {
    if (depth[a] > depth[b]) a = parent[a]; else b = parent[b];
  }
  return a;
}
const isAnc = (a, b) => a <= b && b < end[a];   // a is ancestor-or-self of b

function namesOf(i) { return isTip[i] ? [] : N[i][1]; }
function primaryName(i) {
  const ns = namesOf(i);
  return ns.length ? ns[0] : null;
}
function namedAncestor(i) {
  for (let x = parent[i]; x >= 0; x = parent[x]) if (namesOf(x).length) return x;
  return -1;
}
function cladeLabelHTML(i, { short = false } = {}) {
  const ns = namesOf(i);
  if (ns.length) {
    const [nm, rank, common] = ns[0];
    const it = ["genus", "subgenus", "section", "species"].includes(rank) ? `<i>${nm}</i>` : nm;
    let s = `${ns[0].length > 3 ? `<span class="approx" title="${esc(approxNote(ns[0]))}">≈</span>` : ""}<span class="n">${it}</span>`;
    if (!short && rank && rank !== "clade") s += ` <span class="cnt">${rank}</span>`;
    if (common && !short) s += ` <span class="cnt">· ${esc(common)}</span>`;
    if (!short && ns.length > 1) s += ` <span class="cnt">(= ${ns.slice(1).map(x => x[0]).join(", ")})</span>`;
    return s;
  }
  const a = namedAncestor(i);
  const an = a >= 0 ? primaryName(a)[0] : "Archaeplastida";
  return `<span class="n unnamed">unnamed clade in ${esc(an)}</span>`;
}
// names stored as [name, rank, common, inClade, total, cladeSize] are approximate:
// the taxon isn't exactly a clade in this tree
const approxNote = n => `≈ ${n[0]} isn't exactly a clade in this tree: ${n[3]} of its ${n[4]} California species fall in this clade` +
  (n[5] > n[3] ? `, along with ${n[5] - n[3]} species from other groups` : "") + ".";
function cladeTitle(i) {
  const ns = namesOf(i);
  let t = ns.map(n => `${n[0]}${n[1] ? " (" + n[1] + ")" : ""}${n[2] ? " – " + n[2] : ""}${n.length > 3 ? "\n  " + approxNote(n) : ""}`).join("\n");
  return t + (t ? "\n" : "") + `${size[i]} CA species`;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const badge = m => m ? `<span class="badge ${m}">${{ e: "endemic", n: "native", i: "introduced" }[m]}</span>` : "";
function tipHTML(t, thumb = true) {
  const c = t.common ? `<span class="common">${esc(t.common)} ${badge(t.means)}</span><span class="sci">${esc(t.sci)}</span>`
                     : `<span class="common"><i>${esc(t.sci)}</i> ${badge(t.means)}</span>`;
  const img = thumb ? (t.photo ? `<img class="thumb" loading="lazy" src="${photoUrl(t.photo, "square")}" title="${esc(t.attr)}" alt="">` : `<span class="thumb"></span>`) : "";
  return `${img}<span class="names">${c}</span>`;
}

// ---------------------------------------------------------------- pools & seeding
function pool(kind) {
  const natives = tips.filter(t => t.means === "n" || t.means === "e").sort((a, b) => b.count - a.count || (a.sci < b.sci ? -1 : 1));
  const inGroup = (t, names) => { for (let x = t.node; x >= 0; x = parent[x]) if (namesOf(x).some(n => names.includes(n[0]))) return true; return false; };
  switch (kind) {
    case "easy": return natives.slice(0, 300);
    case "medium": return natives.slice(0, 1500);
    case "hard": return natives;
    case "algae": return tips.filter(t => inGroup(t, ["Rhodophyta", "Chlorophyta", "Charophyta", "Charophyceae", "Zygnematophyceae"]));
    case "nonvascular": return tips.filter(t => !inGroup(t, ["Tracheophyta"]));
    default: return tips.slice();
  }
}
// Secret selection: pick a family (weighted by spread), then a species in it.
// "species": every species equally likely (big families dominate);
// "balanced": family weight = sqrt(#species in pool) (default);
// "family": every family equally likely.
const familyOf = t => t.family || t.sci.split(" ")[0];
function pickSecret(p, spread, rnd) {
  const fams = new Map();
  for (const t of p) { const f = familyOf(t); if (!fams.has(f)) fams.set(f, []); fams.get(f).push(t); }
  const groups = [...fams.values()];
  const w = groups.map(g => spread === "family" ? 1 : spread === "species" ? g.length : Math.sqrt(g.length));
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < groups.length; i++) {
    r -= w[i];
    if (r < 0 || i === groups.length - 1) return groups[i][Math.floor(rnd() * groups[i].length)];
  }
}
function seededRandom(seed) {  // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function dailySecret(dateStr) {
  const p = pool("medium").slice(0, 600).sort((a, b) => a.id - b.id);
  return pickSecret(p, "balanced", seededRandom(hashStr("archaeplastida:" + dateStr)));
}

// ---------------------------------------------------------------- game state
let G; // {mode, secret, guesses:[tip], hints:int, over:bool, won:bool, date}
const $ = id => document.getElementById(id);

function newGame(mode) {
  if (mode === "daily") {
    const date = today();
    const saved = JSON.parse(localStorage.getItem("arch-daily-v2") || "null");
    const secret = dailySecret(date);
    G = { mode, date, secret, guesses: [], hints: 0, over: false, won: false };
    if (saved && saved.date === date) {
      G.guesses = saved.guesses.map(s => tipByName.get(s)).filter(Boolean);
      G.hints = saved.hints; G.hintLog = saved.hintLog || []; G.over = saved.over; G.won = saved.won;
    }
  } else {
    const p = pool($("pool").value);
    G = { mode, secret: pickSecret(p, $("spread").value, Math.random), guesses: [], hints: 0, over: false, won: false };
  }
  $("btn-daily").classList.toggle("active", mode === "daily");
  $("btn-practice").classList.toggle("active", mode === "practice");
  $("pool").disabled = $("spread").disabled = mode === "daily";
  $("guess").value = ""; hideSuggestions();
  render();
}
function save() {
  if (G.mode !== "daily") return;
  localStorage.setItem("arch-daily-v2", JSON.stringify({ date: G.date, guesses: G.guesses.map(t => t.sci), hints: G.hints, hintLog: G.hintLog || [], over: G.over, won: G.won }));
}

function makeGuess(t) {
  if (G.over || G.guesses.includes(t)) return;
  G.guesses.push(t);
  if (t === G.secret) { G.over = true; G.won = true; }
  save(); render();
}

function bestClade() {
  let best = 0;
  for (const g of G.guesses) { const m = mrca(g.node, G.secret.node); if (depth[m] > depth[best]) best = m; }
  return best;
}

// genera hint: every genus in a clade, with species counts
function generaIn(i) {
  const g = new Map();
  for (let x = i; x < end[i]; x++) if (isTip[x]) { const k = N[x][1].split(" ")[0]; g.set(k, (g.get(k) || 0) + 1); }
  return [...g.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}
function generaHTML(i) {
  const g = generaIn(i), MAX = 60;
  const s = g.slice(0, MAX).map(([k, n]) => `<i>${esc(k)}</i>${n > 1 ? ` <span class="cnt">${n}</span>` : ""}`).join(", ");
  return s + (g.length > MAX ? ` <span class="cnt">… and ${g.length - MAX} more genera</span>` : "");
}
const GENERA_HINT_MAX = 50;
const generaHintUsed = n => (G.hintLog || []).some(h => h.t === "g" && h.n === n);

// hints: successive named clades containing the secret, below the current best
function nextHint() {
  const best = bestClade();
  const chain = [];
  for (let x = parent[G.secret.node]; x >= 0 && x !== best; x = parent[x]) if (namesOf(x).length) chain.push(x);
  // reveal roughly halfway down the remaining named chain (at least one step)
  if (!chain.length) return null;
  return chain[Math.floor(chain.length / 2)];
}

// ---------------------------------------------------------------- render
function render() {
  const s = G.secret, best = bestClade();
  const st = $("status");
  const gcount = G.guesses.length;
  if (G.won) {
    st.innerHTML = `<div class="big">🎉 Got it in ${gcount} guess${gcount === 1 ? "" : "es"}${G.hints ? ` (${G.hints} hint${G.hints > 1 ? "s" : ""})` : ""}!</div>`;
  } else if (G.over) {
    st.innerHTML = `<div class="big">The answer was revealed.</div>`;
  } else if (!gcount) {
    st.innerHTML = `<div class="big">${G.mode === "daily" ? "Today's plant" : "A secret plant"} is waiting.</div>
      <div class="sub">It's one of ${tips.length.toLocaleString()} species. Start with any plant you know.</div>`;
  } else {
    st.innerHTML = `<div class="big">The secret is in: ${cladeLabelHTML(best)}</div>
      <div class="sub">${size[best].toLocaleString()} California species in this clade · ${gcount} guess${gcount === 1 ? "" : "es"}</div>
      <div class="crumbs">${lineageHTML(best)}</div>`;
  }
  $("guess").disabled = G.over;
  $("btn-hint").disabled = G.over || !nextHint();
  const ng = generaIn(best).length;
  $("btn-genera").disabled = G.over || generaHintUsed(best) || ng < 2 || ng > GENERA_HINT_MAX;
  $("btn-genera").title = ng > GENERA_HINT_MAX
    ? `Narrow it down to a clade with at most ${GENERA_HINT_MAX} genera first (currently ${ng})`
    : "List every genus in the clade you've narrowed it to";
  $("btn-giveup").hidden = G.over;
  $("btn-new").hidden = !(G.over && G.mode === "practice");
  $("btn-share").hidden = !G.over;

  $("hints").innerHTML = (G.hintLog || []).map(h => h.t === "c"
    ? `💡 The secret is in ${cladeLabelHTML(h.n)} <span class="cnt">(${size[h.n]} species)</span>`
    : `💡 Genera in ${cladeLabelHTML(h.n, { short: true })} <span class="cnt">(${size[h.n]} species)</span>: ${generaHTML(h.n)}`).join("<br>");

  // reveal
  const rv = $("reveal");
  if (G.over) {
    rv.hidden = false;
    const lineage = [];
    for (let x = parent[s.node]; x >= 0; x = parent[x]) if (namesOf(x).length) lineage.push(namesOf(x)[0][0]);
    rv.innerHTML = `${s.photo ? `<img src="${photoUrl(s.photo)}" title="${esc(s.attr)}" alt="">` : ""}
      <div><div style="font-size:1.3rem">${tipHTML(s, false)}</div>
      <div>${s.count.toLocaleString()} research-grade observations in California</div>
      <div><a href="https://www.inaturalist.org/taxa/${s.id}" target="_blank" rel="noopener">iNaturalist</a> ·
           <a href="https://www.calflora.org/app/taxon?crn=&taxon=${encodeURIComponent(s.sci)}" target="_blank" rel="noopener">Calflora</a> ·
           <a href="https://ucjeps.berkeley.edu/eflora/search_eflora.php?name=${encodeURIComponent(s.sci)}" target="_blank" rel="noopener">Jepson eFlora</a></div>
      <div class="lineage">${lineage.reverse().join(" › ")}</div>
      ${s.src === "g" ? `<div class="lineage">Not in the Open Tree synthesis; placed using taxonomy.</div>` : ""}</div>`;
  } else rv.hidden = true;

  renderList(best);
  renderTree();
}

// every named clade from the root down to node i (inclusive)
function lineageHTML(i) {
  const out = [];
  for (let x = i; x >= 0; x = parent[x]) if (namesOf(x).length) out.push(x);
  return out.reverse().map(x => `<span title="${esc(cladeTitle(x))}">${cladeLabelHTML(x, { short: true })}</span>`).join(" › ");
}

function renderList(best) {
  const sec = $("list-section"), ol = $("guess-list");
  sec.hidden = !G.guesses.length;
  const rows = G.guesses.map(g => ({ g, m: mrca(g.node, G.secret.node) }))
    .sort((a, b) => depth[b.m] - depth[a.m] || size[a.m] - size[b.m]);
  const maxLog = Math.log(tips.length);
  ol.innerHTML = rows.map(({ g, m }) => {
    const win = g === G.secret;
    const pct = win ? 120 : Math.max(6, 120 * (1 - Math.log(size[m]) / maxLog));
    return `<li class="${win ? "win" : ""}">${tipHTML(g)}
      <div class="clade" title="${esc(cladeTitle(m))}">${win ? "<span class='cname'>✔ correct!</span>" :
        `<div class="cname">${cladeLabelHTML(m, { short: true })}</div><div class="csize">${size[m].toLocaleString()} species</div>`}
        <div class="bar" style="width:${pct.toFixed(0)}px"></div></div></li>`;
  }).join("");
}

// induced ("virtual") tree on the guessed tips plus the secret
function renderTree() {
  const sec = $("tree-section");
  sec.hidden = !G.guesses.length;
  if (!G.guesses.length) return;
  const set = new Set(G.guesses.map(g => g.node)); set.add(G.secret.node);
  let pts = [...set].sort((a, b) => a - b);
  const all = new Set(pts);
  for (let i = 0; i + 1 < pts.length; i++) all.add(mrca(pts[i], pts[i + 1]));
  const nodes = [...all].sort((a, b) => a - b);
  const kids = new Map(nodes.map(x => [x, []]));
  const stack = []; let root = nodes[0];
  for (const x of nodes) {
    while (stack.length && !isAnc(stack[stack.length - 1], x)) stack.pop();
    if (stack.length) kids.get(stack[stack.length - 1]).push(x); else root = x;
    stack.push(x);
  }
  const secret = G.secret.node;
  const html = x => {
    const onPath = isAnc(x, secret);
    let row;
    if (x === secret && !G.won && !G.over) {
      row = `<span class="tnode secret">??? secret plant</span>`;
    } else if (isTip[x]) {
      const t = tipOfNode.get(x);
      row = `<span class="tnode ${x === secret ? "secret found" : ""}">${tipHTML(t)}</span>`;
    } else {
      row = `<span class="tnode internal ${onPath ? "path" : ""}" title="${esc(cladeTitle(x))}">${cladeLabelHTML(x)} <span class="cnt">${size[x].toLocaleString()} spp.</span></span>`;
    }
    const ch = kids.get(x) || [];
    // show the secret's branch first
    ch.sort((a, b) => (isAnc(b, secret) ? 1 : 0) - (isAnc(a, secret) ? 1 : 0));
    return `<li class="${onPath ? "path" : ""}">${row}${ch.length ? `<ul>${ch.map(c => withChain(x, c)).join("")}</ul>` : ""}</li>`;
  };
  // named clades lying between induced node u and its induced child v, shown
  // as intermediate rows. Never below the deepest known clade of the secret.
  const withChain = (u, v) => {
    let inner = html(v);
    if (v === secret && !G.over) return inner;
    const chain = [];
    for (let x = parent[v]; x !== u && x >= 0; x = parent[x]) if (namesOf(x).length) chain.push(x);
    if (chain.length) {
      chain.reverse();  // top-down
      const onPath = isAnc(chain[chain.length - 1], secret);
      const label = chain.map(x => `<span title="${esc(cladeTitle(x))}">${cladeLabelHTML(x, { short: true })}</span>`).join(" › ");
      inner = `<li class="${onPath ? "path" : ""}"><span class="tnode internal inter ${onPath ? "path" : ""}">${label}</span><ul>${inner}</ul></li>`;
    }
    return inner;
  };
  $("tree").innerHTML = `<ul>${withChain(-1, root)}</ul>`;
}

// ---------------------------------------------------------------- autocomplete
let sugg = [], sel = -1;
function search(q) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const out = [];
  for (const t of tips) {
    if (!words.every(w => t.key.includes(w))) continue;
    let score = 0;
    const cm = t.common.toLowerCase(), sc = t.sci.toLowerCase();
    if (cm === q || sc === q) score += 100;
    if (cm.startsWith(q) || sc.startsWith(q)) score += 40;
    if (words.every(w => (" " + t.key).includes(" " + w))) score += 20;
    score += Math.log10(t.count + 1) * 3;
    out.push([score, t]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, 12).map(x => x[1]);
}
function showSuggestions() {
  const ul = $("suggestions");
  sugg = search($("guess").value); sel = sugg.length ? 0 : -1;
  if (!sugg.length) {
    const q = $("guess").value.trim();
    if (q.length >= 3) {
      ul.innerHTML = `<li class="none">No California plant matches “${esc(q)}”. (Kelps and other brown algae, fungi and lichens aren't in Archaeplastida.)</li>`;
      ul.hidden = false;
    } else hideSuggestions();
    return;
  }
  ul.innerHTML = sugg.map((t, i) => `<li data-i="${i}" class="${i === sel ? "sel" : ""} ${G.guesses.includes(t) ? "used" : ""}">${tipHTML(t)}</li>`).join("");
  ul.hidden = false;
}
function hideSuggestions() { $("suggestions").hidden = true; $("suggestions").innerHTML = ""; sugg = []; sel = -1; }
function pick(i) {
  const t = sugg[i]; if (!t) return;
  $("guess").value = ""; hideSuggestions(); makeGuess(t);
}

// ---------------------------------------------------------------- wiring
function wire() {
  const inp = $("guess");
  inp.addEventListener("input", showSuggestions);
  inp.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!sugg.length) return;
      e.preventDefault();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + sugg.length) % sugg.length;
      [...$("suggestions").children].forEach((li, i) => li.classList.toggle("sel", i === sel));
      $("suggestions").children[sel].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
    else if (e.key === "Escape") hideSuggestions();
  });
  $("suggestions").addEventListener("mousedown", e => {
    const li = e.target.closest("li"); if (li) { e.preventDefault(); pick(+li.dataset.i); }
  });
  inp.addEventListener("blur", () => setTimeout(hideSuggestions, 100));
  $("btn-daily").onclick = () => newGame("daily");
  $("btn-practice").onclick = () => newGame("practice");
  $("btn-new").onclick = () => newGame("practice");
  $("pool").onchange = $("spread").onchange = () => { if (G.mode === "practice") newGame("practice"); };
  $("btn-help").onclick = () => $("help").showModal();
  $("btn-giveup").onclick = () => { if (confirm("Reveal the answer?")) { G.over = true; save(); render(); } };
  $("btn-hint").onclick = () => {
    const h = nextHint(); if (h == null) return;
    G.hints++; (G.hintLog = G.hintLog || []).push({ t: "c", n: h }); save(); render();
  };
  $("btn-genera").onclick = () => {
    const b = bestClade(); if (generaHintUsed(b)) return;
    G.hints++; (G.hintLog = G.hintLog || []).push({ t: "g", n: b }); save(); render();
  };
  $("btn-share").onclick = () => {
    const rows = G.guesses.map(g => {
      if (g === G.secret) return "🌸";
      const sz = size[mrca(g.node, G.secret.node)];
      return sz <= 10 ? "🟩" : sz <= 100 ? "🟨" : sz <= 1000 ? "🟧" : "🟫";
    }).join("");
    const head = G.mode === "daily" ? `Archaeplastida ${G.date}` : "Archaeplastida (practice)";
    const txt = `${head}: ${G.won ? G.guesses.length + " guesses" : "gave up"}${G.hints ? `, ${G.hints} hint(s)` : ""}\n${rows}\n${location.href.split("#")[0]}`;
    navigator.clipboard.writeText(txt).then(() => { $("btn-share").textContent = "Copied!"; setTimeout(() => ($("btn-share").textContent = "Copy result"), 1500); });
  };
}

load().then(() => {
  wire();
  newGame("daily");
  if (!localStorage.getItem("arch-seen-help")) { localStorage.setItem("arch-seen-help", "1"); $("help").showModal(); }
});
