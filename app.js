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
// Practice pools. `scope` is null (everything), a clade node, or one of the
// non-clade presets below. Difficulty is scaled to the scope: "easy" is the
// most-observed ~5% of its natives (at least 10), "medium" ~25% (at least 25).
const PRESETS = {
  algae: { label: "algae (red + green; not a clade)",
           test: t => inGroup(t, ["Rhodophyta", "Chlorophyta", "Charophyceae", "Zygnematophyceae"]) },
  nonvascular: { label: "non-vascular plants (algae + bryophytes; not a clade)",
                 test: t => !inGroup(t, ["Tracheophyta"]) },
};
function inGroup(t, names) {
  for (let x = t.node; x >= 0; x = parent[x]) if (namesOf(x).some(n => names.includes(n[0]))) return true;
  return false;
}
function pool(kind, scope = null) {
  let all = tips;
  if (typeof scope === "number") all = tips.filter(t => isAnc(scope, t.node));
  else if (scope && PRESETS[scope]) all = tips.filter(PRESETS[scope].test);
  const natives = all.filter(t => t.means === "n" || t.means === "e").sort((a, b) => b.count - a.count || (a.sci < b.sci ? -1 : 1));
  if (!natives.length || kind === "all") return all.slice();
  const global = !scope;
  switch (kind) {
    case "easy": return natives.slice(0, global ? 300 : Math.max(10, Math.round(natives.length * 0.05)));
    case "medium": return natives.slice(0, global ? 1500 : Math.max(25, Math.round(natives.length * 0.25)));
    default: return natives;
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
    const p = pool($("pool").value, scope);
    G = { mode, secret: pickSecret(p, $("spread").value, Math.random), guesses: [], hints: 0, over: false, won: false,
          start: typeof scope === "number" ? scope : 0, poolSize: p.length };
  }
  $("btn-daily").classList.toggle("active", mode === "daily");
  $("btn-practice").classList.toggle("active", mode === "practice");
  $("pool").disabled = $("spread").disabled = mode === "daily";
  $("scope-box").hidden = mode === "daily";
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

// deepest clade known to contain the secret: from guesses, or the clade
// practice mode was limited to
function bestClade() {
  let best = G.start || 0;
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
  } else if (!gcount && !G.start) {
    st.innerHTML = `<div class="big">${G.mode === "daily" ? "Today's plant" : "A secret plant"} is waiting.</div>
      <div class="sub">It's one of ${(G.poolSize || tips.length).toLocaleString()} possible species${scope && PRESETS[scope] ? ` (${esc(PRESETS[scope].label)})` : ""}. Start with any plant you know.</div>`;
  } else {
    st.innerHTML = `<div class="big">The secret is in: ${cladeLabelHTML(best)}</div>
      <div class="sub">${size[best].toLocaleString()} California species in this clade${gcount ? ` · ${gcount} guess${gcount === 1 ? "" : "es"}` : ""}${G.start && best === G.start && G.poolSize < size[best] ? ` · secret drawn from ${G.poolSize.toLocaleString()} of them` : ""}</div>
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

// induced ("virtual") tree on a set of guessed tips plus the secret
function inducedTree(guessNodes) {
  const set = new Set(guessNodes); set.add(G.secret.node);
  if (G.start) set.add(G.start);
  const pts = [...set].sort((a, b) => a - b);
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
  return { root, kids };
}
// named clades strictly between induced node u and its induced child v (top-down);
// never below the deepest known clade of the secret
function chainBetween(u, v) {
  if (v === G.secret.node && !G.over) return [];
  const chain = [];
  for (let x = parent[v]; x !== u && x >= 0; x = parent[x]) if (namesOf(x).length) chain.push(x);
  return chain.reverse();
}
// the most recent guess is highlighted in the tree until the next one
function freshNodes() {
  const n = G.guesses.length;
  return new Set(n ? [G.guesses[n - 1].node] : []);
}

function renderTree() {
  const sec = $("tree-section");
  sec.hidden = !G.guesses.length;
  if (!G.guesses.length) return;
  const { root, kids } = inducedTree(G.guesses.map(g => g.node));
  const fresh = G.over ? new Set() : freshNodes();
  const fr = x => fresh.has(x) ? " fresh" : "";
  const secret = G.secret.node;
  const html = x => {
    const onPath = isAnc(x, secret);
    let row;
    if (x === secret && !G.won && !G.over) {
      row = `<span class="tnode secret${fr(x)}">??? secret plant</span>`;
    } else if (isTip[x]) {
      const t = tipOfNode.get(x);
      row = `<span class="tnode ${x === secret ? "secret found" : ""}${fr(x)}">${tipHTML(t)}</span>`;
    } else {
      row = `<span class="tnode internal ${onPath ? "path" : ""}${fr(x)}" title="${esc(cladeTitle(x))}">${cladeLabelHTML(x)} <span class="cnt">${size[x].toLocaleString()} spp.</span></span>`;
    }
    const ch = kids.get(x) || [];
    // show the secret's branch first
    ch.sort((a, b) => (isAnc(b, secret) ? 1 : 0) - (isAnc(a, secret) ? 1 : 0));
    return `<li class="${onPath ? "path" : ""}">${row}${ch.length ? `<ul>${ch.map(c => withChain(x, c)).join("")}</ul>` : ""}</li>`;
  };
  // named clades between branch points, on one compact row
  const withChain = (u, v) => {
    let inner = html(v);
    const chain = chainBetween(u, v);
    if (chain.length) {
      const onPath = isAnc(chain[chain.length - 1], secret);
      const label = chain.map(x => `<span class="${fr(x).trim()}" title="${esc(cladeTitle(x))}">${cladeLabelHTML(x, { short: true })}</span>`).join(" › ");
      inner = `<li class="${onPath ? "path" : ""}"><span class="tnode internal inter ${onPath ? "path" : ""}">${label}</span><ul>${inner}</ul></li>`;
    }
    return inner;
  };
  $("tree").innerHTML = `<ul>${withChain(-1, root)}</ul>`;
}

// ---------------------------------------------------------------- limit-to-clade (practice)
let scope = null;  // null | clade node | preset key
let cladeIndex = null;
function buildCladeIndex() {
  cladeIndex = [];
  for (let i = 0; i < N.length; i++) {
    if (isTip[i] || size[i] < 2) continue;
    for (const n of namesOf(i)) cladeIndex.push({ node: i, name: n[0], rank: n[1], common: n[2] || "",
                                                 key: (n[0] + " " + (n[2] || "")).toLowerCase() });
  }
}
function scopeLabel() {
  if (scope === null) return "";
  if (PRESETS[scope]) return PRESETS[scope].label;
  const n = primaryName(scope);
  return n[0] + (n[2] ? ` (${n[2]})` : "");
}
function setScope(v) {
  scope = v;
  localStorage.setItem("arch-scope", JSON.stringify(v === null ? null : typeof v === "number" ? { node: primaryName(v)[0] } : { preset: v }));
  $("scope").value = scopeLabel();
  $("scope-clear").hidden = scope === null;
  $("scope-sugg").hidden = true;
  if (G && G.mode === "practice") newGame("practice");
}
function wireScope() {
  buildCladeIndex();
  try {  // restore by name, since node numbers change between data builds
    const s = JSON.parse(localStorage.getItem("arch-scope") || "null");
    if (s && s.preset && PRESETS[s.preset]) scope = s.preset;
    else if (s && s.node) { const e = cladeIndex.find(c => c.name === s.node); if (e) scope = e.node; }
  } catch (e) {}
  $("scope").value = scopeLabel(); $("scope-clear").hidden = scope === null;
  const inp = $("scope"), ul = $("scope-sugg");
  let items = [], sel = 0;
  const show = () => {
    const q = inp.value.trim().toLowerCase();
    if (q.length < 2) { ul.hidden = true; return; }
    const words = q.split(/\s+/);
    const seen = new Set(), out = [];
    for (const [k, p] of Object.entries(PRESETS)) if (words.every(w => p.label.includes(w))) out.push({ preset: k, score: 1000 });
    for (const c of cladeIndex) {
      if (!words.every(w => c.key.includes(w)) || seen.has(c.node)) continue;
      seen.add(c.node);
      const nm = c.name.toLowerCase(), cm = c.common.toLowerCase();
      const score = (nm === q || cm === q ? 100 : 0) + (nm.startsWith(q) || cm.startsWith(q) ? 40 : 0) + Math.log10(size[c.node]);
      out.push({ ...c, score });
    }
    items = out.sort((a, b) => b.score - a.score).slice(0, 10); sel = 0;
    ul.innerHTML = items.map((c, i) => c.preset
      ? `<li data-i="${i}" class="${i === sel ? "sel" : ""}"><span class="names"><span class="common">${esc(PRESETS[c.preset].label)}</span></span></li>`
      : `<li data-i="${i}" class="${i === sel ? "sel" : ""}"><span class="names"><span class="common">${["genus", "subgenus", "section"].includes(c.rank) ? `<i>${esc(c.name)}</i>` : esc(c.name)} <span class="cnt">${esc(c.rank)}</span></span><span class="sci">${esc(c.common)}${c.common ? " · " : ""}${size[c.node].toLocaleString()} species</span></span></li>`).join("")
      || `<li class="none">No named clade matches.</li>`;
    ul.hidden = false;
  };
  const pickItem = i => { const c = items[i]; if (c) setScope(c.preset || c.node); };
  inp.addEventListener("input", show);
  inp.addEventListener("focus", () => inp.select());
  inp.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); if (!items.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      [...ul.children].forEach((li, i) => li.classList.toggle("sel", i === sel));
    } else if (e.key === "Enter") { e.preventDefault(); pickItem(sel); inp.blur(); }
    else if (e.key === "Escape") { ul.hidden = true; inp.value = scopeLabel(); }
  });
  ul.addEventListener("mousedown", e => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); pickItem(+li.dataset.i); inp.blur(); } });
  inp.addEventListener("blur", () => setTimeout(() => { ul.hidden = true; inp.value = scopeLabel(); }, 100));
  $("scope-clear").onclick = () => setScope(null);
}

// common "plants" that aren't in Archaeplastida, so searching them explains why
const BROWN = "is a brown alga (a stramenopile, closer to diatoms and water molds than to plants), so it isn't in Archaeplastida.";
const NOT_PLANTS = [
  [["sea palm", "postelsia"], `Sea palm (<i>Postelsia</i>) ${BROWN}`],
  [["giant kelp", "macrocystis"], `Giant kelp (<i>Macrocystis</i>) ${BROWN}`],
  [["bull kelp", "nereocystis"], `Bull kelp (<i>Nereocystis</i>) ${BROWN} (Bull kelp nori, <i>Pyropia nereocystis</i>, is a red alga that grows on it, and is in the game.)`],
  [["feather boa", "egregia"], `Feather boa kelp (<i>Egregia</i>) ${BROWN}`],
  [["rockweed", "fucus", "pelvetia", "silvetia"], `Rockweeds (<i>Fucus</i>, <i>Silvetia</i>, …) are brown algae (stramenopiles), so they aren't in Archaeplastida.`],
  [["sargassum", "sargasso"], `<i>Sargassum</i> ${BROWN}`],
  [["oar weed", "laminaria", "kelp"], `Kelps ${BROWN.replace("is a brown alga", "are brown algae")}`],
  [["diatom"], "Diatoms are stramenopiles, not Archaeplastida."],
  [["lichen"], "Lichens are fungi partnered with algae or cyanobacteria, so they aren't counted as plants here."],
  [["mushroom", "fungus", "fungi"], "Fungi are more closely related to animals than to plants."],
];

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
      const ql = q.toLowerCase();
      const hit = NOT_PLANTS.find(([keys]) => keys.some(k => ql.includes(k) || (ql.length >= 4 && k.includes(ql))));
      ul.innerHTML = `<li class="none">${hit ? hit[1] : `No California plant matches “${esc(q)}”. (Kelps and other brown algae, fungi and lichens aren't in Archaeplastida.)`}</li>`;
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
  wireScope();
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
