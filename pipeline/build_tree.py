"""Build the game's phylogeny of California plants.

Inputs (paths given on the command line, see pipeline/README.md):
  --inat      JSON from fetch_inat.py (California research-grade species counts)
  --endemic   JSON from fetch_endemic.py
  --taxa      iNaturalist open-data taxa.csv.gz (for ancestor names / ranks)
  --otol      pickle of the Archaeplastida subtree of the Open Tree synthesis
              (from otol_extract.py)
  --gbotb     pickle of GBOTB.extended.WP (V.PhyloMaker2 megatree; from rda2pkl.py)
  --ott       directory of the Open Tree Taxonomy (taxonomy.tsv, synonyms.tsv),
              used to match megatree names to species through synonymy
  --tnrs-cache JSON cache for Open Tree TNRS lookups (created if missing)
  --out       output JSON for the web app

Method
  1. Species list: every iNat species (infraspecific taxa folded into their
     species) with research-grade observations in California.
  2. Backbone: the Open Tree of Life synthetic tree, induced on those species.
     Names are matched exactly, falling back to Open Tree's TNRS (synonyms).
  3. Species missing from Open Tree are grafted at the MRCA of the members of
     their lowest iNat taxon (genus, then tribe, family, ...) that is present.
  4. Polytomies are refined, in priority order, with clades that are
     compatible with everything already in the tree from
       a) the GBOTB seed plant + pteridophyte megatree (Smith & Brown 2018,
          extended by Jin & Qian 2022), then
       b) iNaturalist taxonomy (subgenera, sections, tribes, ...).
     A clade is only added if it groups whole children of a polytomy, so
     nothing in Open Tree is ever contradicted.
  5. Every node is named with all taxa (Open Tree or iNat) whose California
     membership is exactly that node's species set.
"""
import argparse, csv, gzip, io, json, pickle, random, re, sys, time, urllib.request
from collections import defaultdict

ap = argparse.ArgumentParser()
for a in ["inat", "endemic", "taxa", "otol", "gbotb", "ott", "tnrs-cache", "out"]:
    ap.add_argument("--" + a, required=True)
ap.add_argument("--taxon-common", help="JSON {iNat taxon id: common name} from fetch_taxon_names.py")
ap.add_argument("--min-count", type=int, default=2,
                help="minimum research-grade CA observations for non-native-flagged species")
args = ap.parse_args()

def log(*a):
    print(*a, file=sys.stderr)

# ---------------------------------------------------------------- iNat taxa
log("loading iNat taxa")
TAXA = {}  # id -> (name, rank, rank_level, ancestor list)
with gzip.open(args.taxa, "rt") as f:
    rd = csv.reader(f, delimiter="\t")
    next(rd)
    for tid, ancestry, rank_level, rank, name, active in rd:
        if ancestry.startswith("48460/47126") or tid == "47126":
            TAXA[int(tid)] = (name, rank, float(rank_level or 0),
                              [int(x) for x in ancestry.split("/")] if ancestry else [])

INFRA = {"subspecies", "variety", "form", "infrahybrid"}
recs = json.load(open(args.inat))
endemic_ids = set(json.load(open(args.endemic)))
species = {}  # sid -> dict
for r in recs:
    tid, rank = r["id"], r["rank"]
    if rank == "species":
        sid = tid
    elif rank in INFRA:
        sid = next((a for a in r["ancestor_ids"] if a in TAXA and TAXA[a][1] == "species"), None)
        if sid is None:
            continue
    else:
        continue  # hybrids, genus-level leaves, ...
    s = species.get(sid)
    if s is None:
        anc = r["ancestor_ids"]
        if rank != "species":
            anc = anc[: anc.index(sid) + 1]
        s = species[sid] = dict(id=sid, name=TAXA[sid][0] if sid in TAXA else r["name"],
                                anc=[a for a in anc if a != sid], count=0, common=None,
                                means=None, photo=None, attr=None, endemic=False)
    s["count"] += r["count"]
    if tid in endemic_ids:
        s["endemic"] = True
    own = rank == "species"
    for k_src, k_dst in [("common", "common"), ("means", "means"), ("photo", "photo"), ("photo_attr", "attr")]:
        if r.get(k_src) and (own or not s[k_dst]):
            s[k_dst] = r[k_src]

before = len(species)
species = {k: v for k, v in species.items()
           if v["count"] >= args.min_count or v["means"] in ("native", "endemic") or v["endemic"]}
log(f"species: {before} -> {len(species)} after min-count filter")

# ---------------------------------------------------------------- tree structure
class Tree:
    def __init__(self):
        self.par, self.kids, self.lab, self.sid = [], [], [], []
    def add(self, parent, label="", sid=None):
        i = len(self.par)
        self.par.append(parent); self.kids.append([]); self.lab.append(label); self.sid.append(sid)
        if parent >= 0:
            self.kids[parent].append(i)
        return i
    def move(self, n, newp):
        old = self.par[n]
        if old >= 0:
            self.kids[old].remove(n)
        self.par[n] = newp
        self.kids[newp].append(n)
    def depth(self, n):
        d = 0
        while self.par[n] >= 0:
            n = self.par[n]; d += 1
        return d
    def mrca(self, nodes):
        nodes = list(nodes)
        cur = nodes[0]
        anc = []
        x = cur
        while x >= 0:
            anc.append(x); x = self.par[x]
        pos = {a: i for i, a in enumerate(anc)}
        best = 0
        for n in nodes[1:]:
            x = n
            while x not in pos:
                x = self.par[x]
            best = max(best, pos[x])
        return anc[best]
    def leaves_under(self, n):
        out, st = [], [n]
        while st:
            x = st.pop()
            if self.sid[x] is not None:
                out.append(self.sid[x])
            st.extend(self.kids[x])
        return out

# ---------------------------------------------------------------- Open Tree
log("loading Open Tree subtree")
opar, olab = pickle.load(open(args.otol, "rb"))
OTT_RE = re.compile(r"^(.*)_ott(\d+)$")
name2node, ott2node = {}, {}
for i, l in enumerate(olab):
    m = OTT_RE.match(l)
    if m:
        nm = m.group(1).replace("_", " ")
        ott2node[int(m.group(2))] = i
        name2node.setdefault(nm, i)

matched = {}  # sid -> otol node
unmatched_names = []
for sid, s in species.items():
    n = name2node.get(s["name"])
    if n is not None:
        matched[sid] = n
    else:
        unmatched_names.append(s["name"])
log(f"exact Open Tree matches: {len(matched)}; trying TNRS for {len(unmatched_names)}")

try:
    cache = json.load(open(args.tnrs_cache))
except FileNotFoundError:
    cache = {}
todo = [n for n in unmatched_names if n not in cache]
for i in range(0, len(todo), 200):
    batch = todo[i:i + 200]
    body = json.dumps({"names": batch, "do_approximate_matching": False}).encode()
    for attempt in range(5):
        try:
            req = urllib.request.Request("https://api.opentreeoflife.org/v3/tnrs/match_names", data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                res = json.load(r)
            break
        except Exception as e:
            log("tnrs retry", e); time.sleep(3 * (attempt + 1))
    else:
        raise RuntimeError("TNRS failed")
    for nm in batch:
        cache[nm] = None
    for rr in res["results"]:
        ms = [m for m in rr["matches"] if not m.get("is_approximate_match")]
        if ms:
            cache[rr["name"]] = [m["taxon"]["ott_id"] for m in ms]
    json.dump(cache, open(args.tnrs_cache, "w"))
    log("tnrs", i + len(batch), "/", len(todo))

used_nodes = defaultdict(list)
for sid, n in matched.items():
    used_nodes[n].append(sid)
for sid, s in species.items():
    if sid in matched:
        continue
    for ott in cache.get(s["name"]) or []:
        n = ott2node.get(ott)
        if n is not None and n not in used_nodes:
            matched[sid] = n; used_nodes[n].append(sid)
            break
# two iNat species on one Open Tree node: keep the first, graft the rest
for n, sids in used_nodes.items():
    for sid in sids[1:]:
        matched.pop(sid, None)
log(f"matched to Open Tree after TNRS: {len(matched)} / {len(species)}")

# induce
T = Tree()
keep = set()
for n in matched.values():
    while n >= 0 and n not in keep:
        keep.add(n); n = opar[n]
okids = defaultdict(list)
for n in keep:
    if opar[n] >= 0:
        okids[opar[n]].append(n)
leaves_at = defaultdict(list)
for sid, n in matched.items():
    leaves_at[n].append(sid)
root_o = next(n for n in keep if opar[n] < 0 or opar[n] not in keep)

def build(on, tp):
    """Copy OT node `on` under tree parent `tp`, collapsing unary nodes."""
    stack = [(on, tp)]
    while stack:
        on, tp = stack.pop()
        items = [("o", c) for c in okids[on]] + [("s", s) for s in leaves_at[on]]
        if len(items) == 1 and tp != -1:
            kind, x = items[0]
            if kind == "o":
                stack.append((x, tp))
            else:
                T.add(tp, "", x)
            continue
        me = T.add(tp, olab[on])
        for kind, x in items:
            if kind == "o":
                stack.append((x, me))
            else:
                T.add(me, "", x)
build(root_o, -1)
log("induced Open Tree nodes:", len(T.par))

# ---------------------------------------------------------------- re-anchor "dumped" species
# Open Tree places species that lack phylogenetic data at the MRCA of their
# genus; when the genus is non-monophyletic ("broken") that MRCA can be a
# family-level polytomy. Such species (or small single-genus clusters) sit as
# direct children of a polytomy. Move each such child down to the smallest
# clade below that polytomy holding >= 75% of its genus's other members there
# (or, failing that, >= 90% of its tribe's / subfamily's / family's). Moves are
# only ever toward the tips, so nothing resolved is overridden.
genus_of = {sid: next((a for a in reversed(s["anc"]) if TAXA.get(a, ("", ""))[1] == "genus"), None)
            for sid, s in species.items()}

DEBUG = __import__("os").environ.get("DEBUG_SPECIES")
def reanchor():
    leaf_node = {T.sid[i]: i for i in range(len(T.par)) if T.sid[i] is not None and T.par[i] != -2}
    moves = []
    for P in range(len(T.par)):
        if len(T.kids[P]) < 3:
            continue
        def lct_of(ls):
            ca = set(species[ls[0]]["anc"])
            for x in ls[1:]:
                ca &= set(species[x]["anc"])
            return min((a for a in ca if a in TAXA), key=lambda a: TAXA[a][2], default=None)
        lct_P = lct_of(T.leaves_under(P))
        suspects = []
        for c in T.kids[P]:
            ls = T.leaves_under(c)
            lct = lct_of(ls)
            # c is "dumped" if its species share a genus..tribe that is strictly
            # below the lowest taxon spanning the whole polytomy
            if lct is not None and lct != lct_P and TAXA[lct][2] <= 25:
                suspects.append((c, ls, lct))
        if not suspects:
            continue
        # single-species suspects are the typical taxonomy-only "dumps"; they
        # never count as evidence of where their relatives are
        lone = {ls[0] for _, ls, _ in suspects if len(ls) == 1}
        by_taxon = defaultdict(list)
        for x in T.leaves_under(P):
            if x not in lone:
                for a in species[x]["anc"]:
                    by_taxon[a].append(leaf_node[x])
        for c, ls, lct in suspects:
            anc = species[ls[0]]["anc"]
            dbg = DEBUG and any(species[x]["name"] == DEBUG for x in ls)
            if dbg:
                log("DEBUG suspect", DEBUG, "P", P, "lct_P", TAXA.get(lct_P), "lct", TAXA.get(lct), "nkids", len(T.kids[P]))
            for a in reversed(anc[: anc.index(lct) + 1]):
                if a == lct_P or TAXA.get(a, ("", "", 99))[2] > 30:  # stay below P's taxon / family
                    break
                is_genus = TAXA[a][1] == "genus"
                mine = {leaf_node[x] for x in ls}
                core = [l for l in by_taxon.get(a, []) if l not in mine]
                if len(core) < max(1, len(ls)):  # evidence must outweigh what is moved
                    continue
                cnt = defaultdict(int)
                for leaf in core:
                    x = leaf
                    while x != P:
                        cnt[x] += 1; x = T.par[x]
                need = (0.75 if is_genus else 0.9) * len(core)
                best = max((n for n, k in cnt.items() if k >= need), key=T.depth, default=None)
                if dbg:
                    log("DEBUG  level", TAXA[a][:2], "core", len(core), "best", best, "maxcnt", max(cnt.values()) if cnt else 0)
                if best is not None:
                    moves.append((c, best))
                    break
    done = 0
    for c, target in moves:
        x = target
        while x >= 0 and x != c:
            x = T.par[x]
        if x == c:  # target ended up inside c after earlier moves
            continue
        done += 1
        if T.sid[target] is not None:
            x = T.add(T.par[target], "")
            T.move(target, x)
            target = x
        T.move(c, target)
    return done

def cleanup():
    """Drop empty internal nodes and collapse unary ones (keeping the root)."""
    changed = True
    while changed:
        changed = False
        order, st = [], [0]
        while st:
            x = st.pop(); order.append(x); st.extend(T.kids[x])
        for n in reversed(order):
            if n == 0 or T.sid[n] is not None:
                continue
            k = T.kids[n]
            if len(k) == 0 or len(k) == 1:
                p = T.par[n]
                for c in list(k):
                    T.move(c, p)
                    if not T.lab[c] and T.lab[n]:
                        T.lab[c] = T.lab[n]
                T.kids[p].remove(n)
                T.par[n] = -2
                changed = True

for it in range(30):
    k = reanchor()
    log("re-anchored dumped clusters:", k)
    if not k:
        break
cleanup()

# ---------------------------------------------------------------- grafting
leaf_of = {T.sid[i]: i for i in range(len(T.par)) if T.sid[i] is not None}
members = defaultdict(list)  # iNat taxon -> matched leaves
for sid in matched:
    for a in species[sid]["anc"]:
        members[a].append(leaf_of[sid])
groups = defaultdict(list)
for sid, s in species.items():
    if sid in matched:
        continue
    anchor_taxon = next((a for a in reversed(s["anc"]) if members.get(a)), None)
    groups[anchor_taxon].append(sid)
n_graft = 0
for at, sids in groups.items():
    anchor = T.mrca(members[at]) if at is not None else 0
    if T.sid[anchor] is not None:  # a leaf: put a new node in its place
        x = T.add(T.par[anchor], "")
        T.move(anchor, x)
        anchor = x
    # taxonomy subtree below `at`
    sub = {}
    for sid in sids:
        anc = species[sid]["anc"]
        path = anc[anc.index(at) + 1:] if at in anc else anc
        d = sub
        for a in path:
            d = d.setdefault(("t", a), {})
        d[("s", sid)] = {}
    def attach(d, tp):
        for (kind, x), ch in d.items():
            if kind == "s":
                T.add(tp, "", x)
                leaf_of[x] = len(T.par) - 1
                continue
            while len(ch) == 1 and next(iter(ch))[0] == "t":
                ch = next(iter(ch.values()))
            if len(ch) == 1:
                attach(ch, tp)
            else:
                attach(ch, T.add(tp, ""))
    attach(sub, anchor)
    n_graft += len(sids)
log("grafted", n_graft, "species by taxonomy")
for it in range(30):
    k = reanchor()
    log("re-anchored (post-graft):", k)
    if not k:
        break
cleanup()

# ---------------------------------------------------------------- forced clades
sys.path.insert(0, __import__("os").path.dirname(__file__))
from clade_defs import CLADES, FORCED, GLOSS
tax_by_name = defaultdict(list)
for sid, s_ in species.items():
    for a in s_["anc"] + [sid]:
        if a in TAXA:
            tax_by_name[TAXA[a][0]].append(sid)
for fname, inc in FORCED:
    leaf_node = {T.sid[i]: i for i in range(len(T.par)) if T.sid[i] is not None and T.par[i] != -2}
    L = {sid for t in inc for sid in tax_by_name.get(t, [])}
    if len(L) < 2:
        continue
    m = T.mrca([leaf_node[x] for x in L])
    # maximal pure subtrees under m
    pure = {}
    order, st = [], [m]
    while st:
        x = st.pop(); order.append(x); st.extend(T.kids[x])
    for x in reversed(order):
        pure[x] = (T.sid[x] in L) if T.sid[x] is not None else all(pure[c] for c in T.kids[x])
    units = [x for x in order if pure[x] and x != m and not pure[T.par[x]]]
    if pure[m] or len(units) < 2:
        log("forced clade already present:", fname); continue
    X = T.add(m, "")
    for u in units:
        T.move(u, X)
    cleanup()
    log("forced clade:", fname, "from", len(units), "subtrees")

# ---------------------------------------------------------------- polytomy refinement
def refine(src_parent, sid2src, label):
    """src_parent: dict/list mapping src node -> parent (root -> None/-1);
    sid2src: species id -> src leaf node."""
    added = 0
    polys = [n for n in range(len(T.par)) if len(T.kids[n]) >= 3]
    for P in polys:
        kids = list(T.kids[P])
        lab = {}
        sizes = defaultdict(int)
        for i, c in enumerate(kids):
            for sid in T.leaves_under(c):
                if sid in sid2src:
                    lab[sid] = i; sizes[i] += 1
        if len(sizes) < 3:
            continue
        cnt, labs = defaultdict(int), defaultdict(set)
        for sid, i in lab.items():
            x = sid2src[sid]
            while x is not None and x != -1:
                cnt[x] += 1; labs[x].add(i)
                x = src_parent.get(x) if isinstance(src_parent, dict) else src_parent[x]
        sets = set()
        for v, ls in labs.items():
            if 2 <= len(ls) < len(kids) and cnt[v] == sum(sizes[i] for i in ls):
                sets.add(frozenset(ls))
        rep = {i: c for i, c in enumerate(kids)}
        for S in sorted(sets, key=len):
            N = T.add(P, "")
            for c in {rep[i] for i in S}:
                T.move(c, N)
            for i in S:
                rep[i] = N
            added += 1
    log(f"refinement with {label}: added {added} clades")

# a) GBOTB megatree
g = pickle.load(open(args.gbotb, "rb"))
edge = g["edge"]
gpar = {}
for p, c in edge:
    gpar[int(c)] = int(p)
tip_by_name = {str(n).replace("_", " "): i + 1 for i, n in enumerate(g["tip.label"])}
sid2g = {sid: tip_by_name[s["name"]] for sid, s in species.items() if s["name"] in tip_by_name}
log("species in GBOTB by exact name:", len(sid2g))
# match the rest through Open Tree Taxonomy ids (handles synonyms)
sid_ott = {}
node_ott = {n: int(OTT_RE.match(olab[n]).group(2)) for n in matched.values()}
for sid, s in species.items():
    if sid in matched:
        sid_ott[sid] = node_ott[matched[sid]]
    elif cache.get(s["name"]):
        sid_ott[sid] = cache[s["name"]][0]
want = set(tip_by_name)
name_uids = defaultdict(set)
for fn, ncol, ucol in [("taxonomy.tsv", 2, 0), ("synonyms.tsv", 0, 1)]:
    with open(f"{args.ott}/{fn}") as f:
        for line in f:
            parts = line.split("\t|\t")
            if parts[ncol] in want:
                name_uids[parts[ncol]].add(int(parts[ucol]))
ott2g = {}
for nm, uids in name_uids.items():
    inside = [u for u in uids if u in ott2node] or list(uids)
    if len(inside) == 1:
        ott2g.setdefault(inside[0], tip_by_name[nm])
for sid in species:
    if sid not in sid2g and sid_ott.get(sid) in ott2g:
        sid2g[sid] = ott2g[sid_ott[sid]]
log("species in GBOTB:", len(sid2g))
refine(gpar, sid2g, "GBOTB megatree")

# b) iNat taxonomy
tpar = {}
sid2t = {}
for sid, s in species.items():
    chain = s["anc"] + [sid]
    for a, b in zip(chain, chain[1:]):
        tpar[("t", b)] = ("t", a)
    sid2t[sid] = ("t", sid)
refine(tpar, sid2t, "iNat taxonomy")

# ---------------------------------------------------------------- final cleanup
cleanup()

# preorder renumbering
order, st = [], [0]
while st:
    x = st.pop()
    order.append(x)
    st.extend(reversed(T.kids[x]))
new = {o: i for i, o in enumerate(order)}

# naming by exact species-set equality
rnd = random.Random(1)
key = {sid: rnd.getrandbits(64) for sid in species}
h = [0] * len(T.par); sz = [0] * len(T.par)
for o in reversed(order):
    if T.sid[o] is not None:
        h[o] = key[T.sid[o]]; sz[o] = 1
    for c in T.kids[o]:
        h[o] ^= h[c]; sz[o] += sz[c]
taxsets = defaultdict(lambda: [0, 0])
for sid, s in species.items():
    for a in s["anc"]:
        taxsets[a][0] ^= key[sid]; taxsets[a][1] += 1
names_by_hash = defaultdict(list)
for a, (hh, n) in taxsets.items():
    if a in TAXA and a != 47126:
        nm, rank, rl, _ = TAXA[a]
        names_by_hash[(hh, n)].append((rl, nm, rank, a))
common = {int(k): v for k, v in json.load(open(args.taxon_common)).items()} if args.taxon_common else {}

# curated node-based clade names
name2taxon = defaultdict(list)
for a in taxsets:
    if a in TAXA:
        name2taxon[TAXA[a][0]].append(a)
leaf_of = {T.sid[i]: i for i in order if T.sid[i] is not None}
tax_leaves = defaultdict(list)
for sid, s in species.items():
    for a in s["anc"]:
        tax_leaves[a].append(leaf_of[sid])
curated = defaultdict(list)
for cname, inc, exc in CLADES:
    inc_leaves = [l for t in inc for a in name2taxon.get(t, []) for l in tax_leaves[a]]
    present = [t for t in inc if any(tax_leaves[a] for a in name2taxon.get(t, []))]
    if len(present) < 2:
        log("clade skipped (too few taxa present):", cname); continue
    # deepest node holding >= 97% of the included species and at least one
    # species of every included taxon (tolerates a stray misplaced species)
    cnt = defaultdict(int)
    for l in inc_leaves:
        x = l
        while x >= 0:
            cnt[x] += 1; x = T.par[x]
    m = None
    for x in sorted((n for n, k in cnt.items() if k >= 0.97 * len(inc_leaves)), key=T.depth, reverse=True):
        inside = set(T.leaves_under(x))
        if all(any(T.sid[l] in inside for a in name2taxon.get(t, []) for l in tax_leaves[a]) for t in present):
            m = x; break
    exc_leaves = [T.sid[l] for t in exc for a in name2taxon.get(t, []) for l in tax_leaves[a]]
    n_bad = sum(1 for x in exc_leaves if x in inside)
    if n_bad > 0.03 * len(exc_leaves) or n_bad > 0.03 * len(inside):
        bad = sorted({t for t in exc for a in name2taxon.get(t, []) if any(T.sid[l] in inside for l in tax_leaves[a])})
        log("clade not supported by tree:", cname, "contains", bad); continue
    curated[m].append(cname)

RANKS_SKIP = {"stateofmatter"}
out_nodes = []
for o in order:
    p = new[T.par[o]] if T.par[o] >= 0 else -1
    names = []
    if T.sid[o] is None:
        cand = sorted(names_by_hash.get((h[o], sz[o]), []))
        seen = set()
        for rl, nm, rank, a in cand:
            if nm.lower() not in seen and rank not in RANKS_SKIP:
                names.append([nm, rank, common.get(a, "")]); seen.add(nm.lower())
        for cname in curated.get(o, []):
            if not any(x in cname.lower() for x in seen):
                names.append([cname, "clade", ""]); seen.add(cname.lower())
        m = OTT_RE.match(T.lab[o] or "")
        if m:
            nm = m.group(1).replace("_", " ")
            # Open Tree labels only for names iNat lacks (iNat taxa are matched
            # exactly above; an Open Tree label may be stale after grafting)
            if (nm not in name2taxon and not any(nm.lower() in x for x in seen)
                    and not nm.startswith("mrca") and not nm.lower().startswith("unclassified")):
                names.append([nm, "clade", ""]); seen.add(nm.lower())
        if p == -1 and not any(n[0] == "Archaeplastida" for n in names):
            names.insert(0, ["Archaeplastida", "clade", ""])
        for n_ in names:
            if not n_[2] and n_[0] in GLOSS:
                n_[2] = GLOSS[n_[0]]
        out_nodes.append([p, names])
    else:
        s = species[T.sid[o]]
        means = "e" if s["endemic"] else {"native": "n", "endemic": "e", "introduced": "i"}.get(s["means"], "")
        photo = s["photo"] or ""
        photo = photo.replace("https://inaturalist-open-data.s3.amazonaws.com/photos/", "o:") \
                     .replace("https://static.inaturalist.org/photos/", "s:")
        src = "o" if s["id"] in matched else "g"
        out_nodes.append([p, s["name"], s["common"] or "", means, s["count"], s["id"], photo, s["attr"] or "", src])

# stats
n_int = sum(1 for x in out_nodes if isinstance(x[1], list))
kids_count = defaultdict(int)
for x in out_nodes:
    if x[0] >= 0:
        kids_count[x[0]] += 1
poly = sum(1 for i, x in enumerate(out_nodes) if isinstance(x[1], list) and kids_count[i] > 2)
n_tip = len(out_nodes) - n_int
log(f"final: {n_tip} species, {n_int} internal nodes ({n_int/(n_tip-1):.1%} of fully resolved), {poly} polytomies")

json.dump({
    "built": time.strftime("%Y-%m-%d"),
    "sources": {
        "species": "iNaturalist research-grade observations in California (place 14)",
        "phylogeny": "Open Tree of Life synthesis v16.1",
        "refinement": ["GBOTB.extended.WP (Smith & Brown 2018; Jin & Qian 2022)", "iNaturalist taxonomy"],
    },
    "nodes": out_nodes,
}, open(args.out, "w"), separators=(",", ":"), ensure_ascii=False)
