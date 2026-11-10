"use strict";
// Must match the ?v= on app.js in index.html; bump both on every change.
const ASSET_VERSION = 17;
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
  const res = await fetch("data/game.json?v=" + ASSET_VERSION);
  const d = await res.json();
  N = d.nodes; DATA_BUILT = d.built;
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
  // iNat rarely lists a California status for algae and bryophytes; treat
  // unlisted non-vascular species as "probably native" so they can be secrets
  TRACH = N.findIndex(x => Array.isArray(x[1]) && x[1].some(n => n[0] === "Tracheophyta"));
  for (const t of tips) if (!t.means && !isVascular(t)) t.means = "p";
  document.getElementById("data-built").textContent =
    `${tips.length.toLocaleString()} species · data built ${d.built}`;
}
let tipOfNode, DATA_BUILT, TRACH = -1;
const isVascular = t => TRACH >= 0 && isAnc(TRACH, t.node);

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
  (n[5] > n[3] ? `, along with ${n[5] - n[3]} species from other groups` : "") + "." +
  (["genus", "family"].includes(n[1]) ? " " + groupNote(n[1], n[0]) : "");
function cladeTitle(i) {
  const ns = namesOf(i);
  let t = ns.map(n => `${n[0]}${n[1] ? " (" + n[1] + ")" : ""}${n[2] ? " – " + n[2] : ""}${n.length > 3 ? "\n  " + approxNote(n) : ""}`).join("\n");
  return t + (t ? "\n" : "") + `${size[i]} CA species`;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const badge = m => m ? `<span class="badge ${m}"${m === "p" ? ` title="iNaturalist lists no California status for this species; most unlisted algae and bryophytes are native"` : ""}>${{ e: "endemic", n: "native", i: "introduced", p: "probably native" }[m]}</span>` : "";
// ---------------------------------------------------------------- monophyly of genera & families
// Is a genus's (or family's) set of California species a clade in this tree?
// It's flagged when the smallest clade containing all of them also contains
// other species, so guesses can narrow to a clade spanning several groups.
const groupCache = new Map();
const genusOf = t => t.sci.split(" ")[0];
let groupIndex = null;
function groupStatus(rank, name) {
  const key = rank + ":" + name;
  if (groupCache.has(key)) return groupCache.get(key);
  if (!groupIndex) {
    groupIndex = new Map();
    for (const t of tips) for (const k of ["genus:" + genusOf(t), "family:" + t.family]) {
      if (!groupIndex.has(k)) groupIndex.set(k, []);
      groupIndex.get(k).push(t);
    }
  }
  const members = groupIndex.get(key) || [];
  let res = { mono: true, n: members.length };
  if (members.length >= 2) {
    // flagged when the smallest clade holding the whole group also holds other
    // species, i.e. a guess can narrow things to a clade spanning several groups
    const C = members.map(t => t.node).reduce(mrca);
    if (size[C] > members.length) {
      const isMember = new Set(members.map(t => t.node)), others = new Map();
      for (let x = C; x < end[C]; x++) if (isTip[x] && !isMember.has(x)) {
        const t = tipOfNode.get(x), g = rank === "genus" ? genusOf(t) : t.family || genusOf(t);
        others.set(g, (others.get(g) || 0) + 1);
      }
      res = { mono: false, n: members.length, clade: C, kind: "non-monophyletic",
              outsiders: size[C] - members.length, others: [...others.entries()].sort((a, b) => b[1] - a[1]) };
    }
  }
  groupCache.set(key, res);
  return res;
}
function groupNote(rank, name) {
  const g = groupStatus(rank, name);
  if (g.mono) return "";
  const list = g.others.slice(0, 6).map(([k, c]) => `${k}${c > 1 ? ` (${c})` : ""}`).join(", ") + (g.others.length > 6 ? ", …" : "");
  return `${name} is non-monophyletic in this tree: the smallest clade containing all ${g.n} of its California species ` +
    `also contains ${g.outsiders} species of other ${rank === "genus" ? "genera" : "families"}: ${list}.`;
}
function monoBadge(t) {
  const g = groupStatus("genus", genusOf(t));
  return g.mono ? "" : `<span class="badge np" title="${esc(groupNote("genus", genusOf(t)))}">${g.kind} genus</span>`;
}

function tipHTML(t, thumb = true) {
  const c = t.common ? `<span class="common">${esc(t.common)} ${badge(t.means)}</span><span class="sci">${esc(t.sci)} ${monoBadge(t)}</span>`
                     : `<span class="common"><i>${esc(t.sci)}</i> ${badge(t.means)} ${monoBadge(t)}</span>`;
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
// native, endemic, or "probably native" (see load()) species can be secrets
const isNativeish = t => t.means === "n" || t.means === "e" || t.means === "p";
function pool(kind, scope = null) {
  let all = tips;
  if (typeof scope === "number") all = tips.filter(t => isAnc(scope, t.node));
  else if (scope && PRESETS[scope]) all = tips.filter(PRESETS[scope].test);
  const natives = all.filter(t => isNativeish(t)).sort((a, b) => b.count - a.count || (a.sci < b.sci ? -1 : 1));
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
// Family groups of pool p and their weights. With capNV, if non-vascular
// species (algae, bryophytes) would get more than NV_CAP of the probability,
// their families' weights are scaled down to exactly NV_CAP, so in ordinary
// games the secret is vascular at least 90% of the time. Below the cap the
// weights are untouched.
const NV_CAP = 0.1;
function familyWeights(p, spread, capNV) {
  const fams = new Map();
  for (const t of p) { const f = familyOf(t); if (!fams.has(f)) fams.set(f, []); fams.get(f).push(t); }
  const groups = [...fams.values()];
  const w = groups.map(g => spread === "family" ? 1 : spread === "species" ? g.length : Math.sqrt(g.length));
  if (capNV && spread !== "family") {  // "even across families" stays literally even
    const nv = groups.map(g => !isVascular(g[0]));
    let V = 0, NV = 0;
    groups.forEach((g, i) => { if (nv[i]) NV += w[i]; else V += w[i]; });
    if (V > 0 && NV / (V + NV) > NV_CAP) {
      const k = NV_CAP / (1 - NV_CAP) * V / NV;
      groups.forEach((g, i) => { if (nv[i]) w[i] *= k; });
    }
  }
  return { groups, w };
}
function pickSecret(p, spread, rnd, capNV = true) {
  const { groups, w } = familyWeights(p, spread, capNV);
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < groups.length; i++) {
    r -= w[i];
    if (r < 0 || i === groups.length - 1) return groups[i][Math.floor(rnd() * groups[i].length)];
  }
}
// the probability pickSecret gives each species in pool p
function secretDistribution(p, spread, capNV = true) {
  const { groups, w } = familyWeights(p, spread, capNV);
  const W = w.reduce((a, b) => a + b, 0), prob = new Map();
  groups.forEach((g, i) => { for (const t of g) prob.set(t, w[i] / W / g.length); });
  return prob;
}
function seededRandom(seed) {  // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
// the daily plant changes at midnight California time, for everyone
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const dailyPool = () => pool("medium").slice(0, 600).sort((a, b) => a.id - b.id);
function dailySecret(dateStr) {
  return pickSecret(dailyPool(), "balanced", seededRandom(hashStr("archaeplastida:" + dateStr)));
}

// ---------------------------------------------------------------- game state
let G; // {mode, secret, guesses:[tip], hints:int, over:bool, won:bool, date}
const $ = id => document.getElementById(id);

function newGame(mode, seed = null) {
  if (mode === "daily") {
    const date = today();
    const saved = JSON.parse(localStorage.getItem("arch-daily-v2") || "null");
    let secret = dailySecret(date);
    const resume = saved && saved.date === date;
    // a game already started today keeps its plant even if the data was updated since
    if (resume && saved.secret && tipByName.get(saved.secret)) secret = tipByName.get(saved.secret);
    const dp = dailyPool();
    G = { mode, date, secret, guesses: [], hints: 0, over: false, won: false, secretPool: dp, poolSize: dp.length, spread: "balanced", capNV: true };
    if (resume) {
      G.guesses = saved.guesses.map(s => tipByName.get(s)).filter(Boolean);
      G.hints = saved.hints; G.over = saved.over; G.won = saved.won;
      // hint entries refer to tree nodes, which are only valid for the same data build
      G.hintLog = saved.built === DATA_BUILT ? saved.hintLog || [] : [];
    }
  } else {
    // practice games come from a seed, so a shared link recreates the same game
    if (seed === null) seed = Math.floor(Math.random() * 2 ** 32);
    const p = pool($("pool").value, scope);
    // the non-vascular cap applies to unrestricted games, not to a chosen clade or preset
    const capNV = scope === null;
    G = { mode, seed, secret: pickSecret(p, $("spread").value, seededRandom(seed), capNV), guesses: [], hints: 0, over: false, won: false,
          secretPool: p, spread: $("spread").value, capNV,
          start: typeof scope === "number" ? scope : 0, poolSize: p.length, scope };
  }
  $("btn-daily").classList.toggle("active", mode === "daily");
  $("btn-practice").classList.toggle("active", mode === "practice");
  // practice-only settings are hidden in daily mode
  $("pool").hidden = $("spread").hidden = mode === "daily";
  $("scope-box").hidden = mode === "daily";
  $("guess").value = ""; hideSuggestions();
  $("guess").placeholder = G.scope != null ? `Type a plant in ${scopeLabel()}…` : "Type a plant (common or scientific name)…";
  render();
}
function save() {
  if (G.mode !== "daily") return;
  localStorage.setItem("arch-daily-v2", JSON.stringify({ date: G.date, secret: G.secret.sci, built: DATA_BUILT, guesses: G.guesses.map(t => t.sci), hints: G.hints, hintLog: G.hintLog || [], over: G.over, won: G.won }));
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
    st.innerHTML = `<div class="big">${plantEmoji(s)} Got it in ${gcount} guess${gcount === 1 ? "" : "es"}${G.hints ? ` (${G.hints} hint${G.hints > 1 ? "s" : ""})` : ""}!</div>
      <div class="sub">Play quality ${pct(playQuality().overall)}: how close your guesses came, on average, to the most informative guess available at each step.</div>`;
  } else if (G.over) {
    st.innerHTML = `<div class="big">The answer was revealed.</div>
      ${gcount ? `<div class="sub">Play quality ${pct(playQuality().overall)}: how close your guesses came, on average, to the most informative guess available at each step.</div>` : ""}`;
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
    rv.innerHTML = `${s.photo ? `<img src="${photoUrl(s.photo)}" title="${esc(s.attr)}" alt="" data-tip="${s.node}">` : ""}
      <div><div style="font-size:1.3rem" data-tip="${s.node}">${tipHTML(s, false)}</div>
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

// ---------------------------------------------------------------- plant emoji
// The most specific emoji for a species: species, then genus, family, and the
// named clades above it.
const EMOJI = {
  // species
  "Helianthus annuus": "🌻", "Solanum lycopersicum": "🍅", "Solanum tuberosum": "🥔", "Solanum melongena": "🍆",
  "Capsicum annuum": "🌶️", "Zea mays": "🌽", "Daucus carota": "🥕", "Allium sativum": "🧄", "Allium cepa": "🧅",
  "Citrullus lanatus": "🍉", "Cucumis melo": "🍈", "Cucumis sativus": "🥒", "Persea americana": "🥑",
  "Olea europaea": "🫒", "Cocos nucifera": "🥥", "Ananas comosus": "🍍", "Lactuca sativa": "🥬",
  "Arachis hypogaea": "🥜", "Zingiber officinale": "🫚", "Coffea arabica": "☕", "Camellia sinensis": "🍵",
  "Darlingtonia californica": "🐍", "Sequoia sempervirens": "🌲", "Sequoiadendron giganteum": "🌲",
  "Brassica oleracea": "🥦", "Pisum sativum": "🫛", "Phaseolus vulgaris": "🫘", "Prunus persica": "🍑",
  "Prunus avium": "🍒", "Citrus × sinensis": "🍊", "Citrus sinensis": "🍊", "Citrus limon": "🍋",
  "Eschscholzia californica": "🧡", "Toxicodendron diversilobum": "🍂", "Cannabis sativa": "🍃",
  // genera
  Helianthus: "🌻", Rosa: "🌹", Tulipa: "🌷", Hibiscus: "🌺", Prunus: "🌸", Malus: "🍎", Pyrus: "🍐",
  Fragaria: "🍓", Vitis: "🍇", Citrus: "🍋", Rubus: "🫐", Vaccinium: "🫐", Acer: "🍁", Quercus: "🌳",
  Castanea: "🌰", Aesculus: "🌰", Juglans: "🌰", Corylus: "🌰", Notholithocarpus: "🌰", Trifolium: "☘️",
  Oxalis: "☘️", Iris: "⚜️", Lilium: "⚜️", Lupinus: "🪻", Salvia: "🪻", Lavandula: "🪻", Delphinium: "🪻",
  Hyacinthus: "🪻", Nymphaea: "🪷", Nuphar: "🪷", Nelumbo: "🪷", Mentha: "🌿", Cucurbita: "🎃", Phaseolus: "🫘",
  Pisum: "🫛", Allium: "🧅", Brassica: "🥦", Opuntia: "🌵", Cylindropuntia: "🌵", Agave: "🌵", Yucca: "🌵",
  Washingtonia: "🌴", Phoenix: "🌴", Eucalyptus: "🐨", Typha: "🌾", Musa: "🍌", Actinidia: "🥝", Mangifera: "🥭",
  Cannabis: "🍃", Pinus: "🌲",
  // families
  Asteraceae: "🌼", Poaceae: "🌾", Cyperaceae: "🌾", Juncaceae: "🌾", Typhaceae: "🌾", Pinaceae: "🌲",
  Cupressaceae: "🌲", Taxaceae: "🌲", Cactaceae: "🌵", Arecaceae: "🌴", Rosaceae: "🌸", Fabaceae: "🫛",
  Lamiaceae: "🌿", Apiaceae: "🌿", Orchidaceae: "🌺", Liliaceae: "🌷", Iridaceae: "⚜️", Fagaceae: "🌳",
  Salicaceae: "🌳", Betulaceae: "🌳", Platanaceae: "🌳", Sapindaceae: "🍁", Cucurbitaceae: "🎃",
  Brassicaceae: "🥬", Solanaceae: "🍅", Vitaceae: "🍇", Ericaceae: "🫐", Grossulariaceae: "🫐",
  Crassulaceae: "🪴", Nymphaeaceae: "🪷", Ephedraceae: "🌵",
  // broader groups
  Polypodiopsida: "🌿", Lycopodiopsida: "🌿", Bryophyta: "🌱", Marchantiophyta: "🌱", Anthocerotophyta: "🌱",
  Rhodophyta: "🌊", Ulvophyceae: "🌊", Chlorophyta: "💧", Charophyceae: "💧", Zygnematophyceae: "💧",
  Acrogymnospermae: "🌲", Angiospermae: "🌸",
};
function plantEmoji(t) {
  for (const k of [t.sci, genusOf(t), t.family]) if (k && EMOJI[k]) return EMOJI[k];
  for (let x = parent[t.node]; x >= 0; x = parent[x]) for (const n of namesOf(x)) if (EMOJI[n[0]]) return EMOJI[n[0]];
  return "🌱";
}

// ---------------------------------------------------------------- play quality
// Candidates are weighted by their actual chance of having been picked as the
// secret (the game's pool and family weighting), restricted to what's still
// consistent with the guesses so far. A guess's quality compares how much of
// that probability it would rule out on average (before knowing the answer)
// with the best possible guess at that point.
function scopeTips(sc) {
  if (sc === null || sc === undefined) return tips;
  return typeof sc === "number" ? tips.filter(t => isAnc(sc, t.node)) : tips.filter(PRESETS[sc].test);
}
// expected fraction of candidate probability ruled out by guessing tip node g,
// given prefix sums P of candidate probability over preorder
// (mass in subtree v = P[end[v]] - P[v]) and total mass M
function expectedRuledOut(g, P, M) {
  const mass = v => P[end[v]] - P[v];
  let sumSq = 0, prev = g;
  // each ancestor v is one possible outcome (shared clade = v), holding the
  // candidates below v but not on g's side; g itself (a correct guess) leaves nothing
  for (let v = parent[g]; v >= 0; prev = v, v = parent[v]) { const c = mass(v) - mass(prev); sumSq += c * c; }
  return 1 - sumSq / (M * M);
}
let qualityCache = null;
function playQuality() {
  const key = G.secret.node + "|" + G.guesses.map(g => g.node).join(",") + "|" + (G.hintLog || []).map(h => h.n + "@" + h.at).join(",");
  if (qualityCache && qualityCache.key === key) return qualityCache.val;
  const guessable = scopeTips(G.mode === "practice" ? G.scope : null);
  const w = new Float64Array(N.length);
  for (const [t, pr] of secretDistribution(G.secretPool, G.spread, G.capNV)) w[t.node] = pr;
  if (!w[G.secret.node]) w[G.secret.node] = 1e-9;  // e.g. a resumed daily after a data update
  const P = new Float64Array(N.length + 1);
  const total = () => { let m = 0, n = 0; for (let i = 0; i < N.length; i++) { P[i] = m; m += w[i]; if (w[i] > 0) n++; } P[N.length] = m; return [m, n]; };
  const restrict = (keep) => { for (let i = 0; i < N.length; i++) if (w[i] && !keep(i)) w[i] = 0; };
  const per = [];
  G.guesses.forEach((g, i) => {
    for (const h of G.hintLog || []) if (h.t === "c" && h.at === i) restrict(x => isAnc(h.n, x));
    const [M, nLeft] = total();
    let best = 0;
    for (const t of guessable) { const e = expectedRuledOut(t.node, P, M); if (e > best) best = e; }
    const mine = expectedRuledOut(g.node, P, M);
    // what this guess actually told the player
    if (g === G.secret) restrict(() => false);
    else {
      const m = mrca(g.node, G.secret.node);
      let side = g.node; while (parent[side] !== m) side = parent[side];
      restrict(x => isAnc(m, x) && !isAnc(side, x));
    }
    const [after] = total();
    per.push({ before: nLeft, ruledOut: M ? 1 - after / M : 0, expected: mine, best,
               quality: best > 0 ? Math.min(1, mine / best) : 1 });
  });
  const val = { per, overall: per.length ? per.reduce((a, b) => a + b.quality, 0) / per.length : null };
  qualityCache = { key, val };
  return val;
}
const pct = x => `${Math.round(100 * x)}%`;
const qualityEmoji = q => q >= 0.97 ? "🟩" : q >= 0.8 ? "🟨" : q > 0 ? "🟧" : "🟥";  // red: rules nothing out

function renderList(best) {
  const sec = $("list-section"), ol = $("guess-list");
  sec.hidden = !G.guesses.length;
  const Q = playQuality();
  const rows = G.guesses.map((g, i) => ({ g, i, m: mrca(g.node, G.secret.node), q: Q.per[i] }));  // guess order
  ol.innerHTML = rows.map(({ g, i, m, q }) => {
    const win = g === G.secret;
    const qTitle = `Guess ${i + 1}: ruled out ${pct(q.ruledOut)} of the remaining chance (${q.before.toLocaleString()} possible secrets were left, ` +
      `weighted by how the game picks them). On average, before knowing the answer, it would rule out ${pct(q.expected)}; ` +
      `the best possible guess, ${pct(q.best)}. Quality ${pct(q.quality)}.`;
    return `<li class="${win ? "win" : ""}" data-tip="${g.node}">${tipHTML(g)}
      <div class="clade">${win ? "<span class='cname'>✔ correct!</span>" :
        `<div class="cname" title="${esc(cladeTitle(m))}">${cladeLabelHTML(m, { short: true })}</div><div class="csize">${size[m].toLocaleString()} species</div>`}
        <div class="qual" title="${esc(qTitle)}">#${i + 1} · ruled out ${pct(q.ruledOut)} · quality ${pct(q.quality)}</div>
        <div class="bar" style="width:${Math.max(4, 120 * q.quality).toFixed(0)}px"></div></div></li>`;
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
      row = `<span class="tnode ${x === secret ? "secret found" : ""}${fr(x)}" data-tip="${x}">${tipHTML(t)}</span>`;
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

// ---------------------------------------------------------------- species info popup
// Opens instantly with what's already loaded; photos and the Wikipedia summary
// are fetched from iNaturalist only when a plant is clicked (cached after).
const infoCache = new Map();
function safeSummary(html) {  // keep text plus italics/bold only
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const walk = n => [...n.childNodes].map(c => {
    if (c.nodeType === 3) return esc(c.textContent);
    if (c.nodeType !== 1) return "";
    const tag = c.tagName.toLowerCase(), inner = walk(c);
    return ["i", "em", "b", "strong"].includes(tag) ? `<${tag}>${inner}</${tag}>` : inner;
  }).join("");
  return walk(doc.body);
}
function openInfo(t) {
  const dlg = $("info"), body = $("info-body");
  const lineage = [];
  for (let x = parent[t.node]; x >= 0; x = parent[x]) if (namesOf(x).length) lineage.push(x);
  const g = groupStatus("genus", genusOf(t)), f = t.family ? groupStatus("family", t.family) : { mono: true };
  const notes = [g.mono ? "" : groupNote("genus", genusOf(t)), f.mono ? "" : groupNote("family", t.family)].filter(Boolean);
  const q = encodeURIComponent(t.sci);
  body.innerHTML = `
    <div class="info-head">${tipHTML(t, false)}</div>
    <div class="gallery"><div class="main">${t.photo ? `<img src="${photoUrl(t.photo)}" alt=""><div class="attr">${esc(t.attr)}</div>` : ""}</div>
      <div class="thumbs"></div></div>
    <p class="facts">${t.family ? `Family ${esc(t.family)} · ` : ""}${t.count.toLocaleString()} research-grade observations in California</p>
    ${notes.map(n => `<p class="mono-note">⚠ ${esc(n)}</p>`).join("")}
    <div class="summary"><span class="cnt">Loading…</span></div>
    <p class="links"><a href="https://www.inaturalist.org/taxa/${t.id}" target="_blank" rel="noopener">iNaturalist</a> ·
      <a href="https://www.inaturalist.org/observations?taxon_id=${t.id}&place_id=14" target="_blank" rel="noopener">California observations</a> ·
      <a href="https://www.calflora.org/app/taxon?crn=&taxon=${q}" target="_blank" rel="noopener">Calflora</a> ·
      <a href="https://ucjeps.berkeley.edu/eflora/search_eflora.php?name=${q}" target="_blank" rel="noopener">Jepson eFlora</a>
      <span class="wiki"></span></p>
    <div class="lineage">${lineage.reverse().map(x => `<span title="${esc(cladeTitle(x))}">${cladeLabelHTML(x, { short: true })}</span>`).join(" › ")}</div>`;
  if (!dlg.open) dlg.showModal();
  const fill = d => {
    if (body.dataset.showing !== String(t.node)) return;  // a different plant was opened meanwhile
    const photos = (d.taxon_photos || []).map(p => p.photo).filter(p => p && p.medium_url).slice(0, 12);
    const main = body.querySelector(".gallery .main");
    const show = p => { main.innerHTML = `<img src="${esc(p.medium_url)}" alt=""><div class="attr">${esc(p.attribution || "")}</div>`; };
    if (photos.length) {
      show(photos[0]);
      body.querySelector(".thumbs").innerHTML = photos.map((p, i) => `<img loading="lazy" src="${esc(p.square_url)}" data-i="${i}" title="${esc(p.attribution || "")}" alt="">`).join("");
      const thumbs = body.querySelector(".thumbs");
      const select = i => { show(photos[i]); thumbs.querySelectorAll("img").forEach(im => im.classList.toggle("on", +im.dataset.i === i)); };
      thumbs.onclick = e => { const i = e.target.dataset.i; if (i !== undefined) select(+i); };
      select(0);
    }
    body.querySelector(".summary").innerHTML = d.wikipedia_summary ? `<p>${safeSummary(d.wikipedia_summary)}</p>` : "";
    if (d.wikipedia_url) body.querySelector(".wiki").innerHTML = ` · <a href="${esc(d.wikipedia_url)}" target="_blank" rel="noopener">Wikipedia</a>`;
  };
  body.dataset.showing = t.node;
  if (infoCache.has(t.id)) return fill(infoCache.get(t.id));
  fetch(`https://api.inaturalist.org/v1/taxa/${t.id}?locale=en`)
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(j => { const d = (j.results || [])[0] || {}; infoCache.set(t.id, d); fill(d); })
    .catch(() => { if (body.dataset.showing === String(t.node)) body.querySelector(".summary").innerHTML = `<span class="cnt">Couldn't load more from iNaturalist.</span>`; });
}

// ---------------------------------------------------------------- autocomplete
let sugg = [], sel = -1;
// in practice mode with a clade limit, guesses are restricted to that clade
function inScope(t) {
  const sc = G && G.mode === "practice" ? G.scope : null;
  if (sc === null || sc === undefined) return true;
  return typeof sc === "number" ? isAnc(sc, t.node) : PRESETS[sc].test(t);
}
// "include non-native" toggle: off hides species iNat lists as introduced
// (species with no listed status, like most algae, stay visible)
let includeIntroduced = true;
function search(q, scoped = true, filtered = true) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const out = [];
  for (const t of tips) {
    if (scoped && !inScope(t)) continue;
    if (filtered && !includeIntroduced && t.means === "i") continue;
    if (!words.every(w => t.key.includes(w))) continue;
    let score = 0;
    const cm = t.common.toLowerCase(), sc = t.sci.toLowerCase();
    if (cm === q || sc === q) score += 100;
    if (cm.startsWith(q) || sc.startsWith(q)) score += 40;
    if (words.every(w => (" " + t.key).includes(" " + w))) score += 20;
    score += Math.log10(t.count + 1) * 3;
    out.push([score, t]);
  }
  // already-guessed species go below the rest
  const used = t => G && G.guesses.includes(t) ? 1 : 0;
  out.sort((a, b) => used(a[1]) - used(b[1]) || b[0] - a[0]);
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
      const introduced = !hit && !includeIntroduced && search(q, true, false)[0];
      const outside = !hit && !introduced && search(q, false)[0];
      ul.innerHTML = `<li class="none">${hit ? hit[1]
        : introduced ? `Only introduced species match (e.g. ${introduced.common ? esc(introduced.common) + ", " : ""}<i>${esc(introduced.sci)}</i>). Turn on “include non-native” to see them.`
        : outside ? `No match in ${esc(scopeLabel())}. (${outside.common ? esc(outside.common) + ", " : ""}<i>${esc(outside.sci)}</i>, is outside it.)`
        : `No California plant matches “${esc(q)}”. (Kelps and other brown algae, fungi and lichens aren't in Archaeplastida.)`}</li>`;
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
  try { includeIntroduced = localStorage.getItem("arch-include-introduced") !== "0"; } catch (e) {}
  $("include-introduced").checked = includeIntroduced;
  $("include-introduced").onchange = () => {
    includeIntroduced = $("include-introduced").checked;
    try { localStorage.setItem("arch-include-introduced", includeIntroduced ? "1" : "0"); } catch (e) {}
    if ($("guess").value.trim()) showSuggestions();
  };
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
  // hide on blur, unless focus came back (e.g. typing right after clicking a button)
  inp.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== inp) hideSuggestions(); }, 100));
  $("btn-daily").onclick = () => newGame("daily");
  $("btn-practice").onclick = () => newGame("practice");
  $("btn-new").onclick = () => newGame("practice");
  $("pool").onchange = $("spread").onchange = () => { if (G.mode === "practice") newGame("practice"); };
  wireScope();
  $("btn-help").onclick = () => $("help").showModal();
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-tip]");
    if (!el || e.target.closest("a, .badge, .approx")) return;
    const t = tipOfNode.get(+el.dataset.tip);
    if (t) openInfo(t);
  });
  $("info-close").onclick = () => $("info").close();
  $("info").addEventListener("click", e => { if (e.target === $("info")) $("info").close(); });  // backdrop
  $("btn-giveup").onclick = () => { if (confirm("Reveal the answer?")) { G.over = true; save(); render(); } };
  $("btn-hint").onclick = () => {
    const h = nextHint(); if (h == null) return;
    G.hints++; (G.hintLog = G.hintLog || []).push({ t: "c", n: h, at: G.guesses.length }); save(); render();
  };
  $("btn-genera").onclick = () => {
    const b = bestClade(); if (generaHintUsed(b)) return;
    G.hints++; (G.hintLog = G.hintLog || []).push({ t: "g", n: b, at: G.guesses.length }); save(); render();
  };
  $("btn-share").onclick = () => {
    const Q = playQuality();
    // 🔍 narrower-clade hint, 📋 genera hint, placed where they were taken
    const HINT = { c: "🔍", g: "📋" };
    const hintsAt = i => (G.hintLog || []).filter(h => (h.at ?? G.guesses.length) === i).map(h => HINT[h.t] || "").join("");
    const rows = G.guesses.map((g, i) => hintsAt(i) + (g === G.secret ? plantEmoji(g) : qualityEmoji(Q.per[i].quality))).join("") +
      hintsAt(G.guesses.length) + (G.won ? "" : "🏳️");
    let head, link = location.origin + location.pathname;
    if (G.mode === "daily") head = `Archaeplastida ${G.date}`;
    else {
      const prm = new URLSearchParams({ seed: G.seed.toString(36), pool: $("pool").value, spread: $("spread").value });
      if (G.scope != null) prm.set("clade", typeof G.scope === "number" ? primaryName(G.scope)[0] : G.scope);
      head = `Archaeplastida practice${G.scope != null ? ` (${scopeLabel()})` : ""}`;
      link += "?" + prm.toString();
    }
    const txt = `${head}: ${G.won ? G.guesses.length + " guess" + (G.guesses.length === 1 ? "" : "es") : "gave up"}` +
      `${G.hints ? `, ${G.hints} hint${G.hints > 1 ? "s" : ""}` : ""}, play quality ${pct(Q.overall)}\n${rows}\n${link}`;
    navigator.clipboard.writeText(txt).then(() => { $("btn-share").textContent = "Copied!"; setTimeout(() => ($("btn-share").textContent = "Copy result"), 1500); });
  };
}

// a shared practice link: ?seed=…&pool=…&spread=…&clade=…
function gameFromURL() {
  const prm = new URLSearchParams(location.search);
  if (!prm.has("seed")) return false;
  const seed = parseInt(prm.get("seed"), 36);
  if (!Number.isFinite(seed)) return false;
  if ([...$("pool").options].some(o => o.value === prm.get("pool"))) $("pool").value = prm.get("pool");
  if ([...$("spread").options].some(o => o.value === prm.get("spread"))) $("spread").value = prm.get("spread");
  const c = prm.get("clade");
  scope = null;
  if (c && PRESETS[c]) scope = c;
  else if (c) { const e = cladeIndex.find(x => x.name === c); if (e) scope = e.node; }
  $("scope").value = scopeLabel(); $("scope-clear").hidden = scope === null;
  history.replaceState(null, "", location.pathname);  // a reload starts a fresh game
  newGame("practice", seed);
  return true;
}

load().then(() => {
  wire();
  if (!gameFromURL()) newGame("daily");
  if (!localStorage.getItem("arch-seen-help")) { localStorage.setItem("arch-seen-help", "1"); $("help").showModal(); }
});
