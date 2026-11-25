"""Attach coarse observation counts (identified only above species) to the
tree in data/game.json, so the game can pool rare species into higher-taxon
answers.

Each iNat taxon above species with direct California observations is mapped
to the smallest tree node holding all of its California species (their MRCA),
and its count is added there. A clade's coarse total is then the sum over the
nodes inside it, so observations only count toward clades that contain every
species they could be. Taxa with no species in the tree are dropped.

Internal nodes become [parent, names, coarse] (coarse omitted when 0).

usage: add_coarse_obs.py coarse_obs.json game.json [--rg]
  --rg  count research-grade observations only (default: verifiable, i.e.
        research grade + needs ID)
"""
import json, sys

SPECIES_RANKS = {"species", "subspecies", "variety", "form", "hybrid", "infrahybrid"}

def coarse_by_node(nodes, taxa, key="direct"):
    """{node index: coarse obs}, plus a small report."""
    tax = {t["id"]: t for t in taxa}
    parent = [n[0] for n in nodes]
    depth = []
    for i, p in enumerate(parent):
        depth.append(0 if p < 0 else depth[p] + 1)
    def mrca(a, b):
        while a != b:
            if depth[a] > depth[b]: a = parent[a]
            else: b = parent[b]
        return a
    # MRCA node of each iNat taxon's species in the tree
    where = {}
    for i, n in enumerate(nodes):
        if isinstance(n[1], list):
            continue
        t = tax.get(n[5])
        while t is not None:
            tid = t["id"]
            where[tid] = i if tid not in where else mrca(where[tid], i)
            t = tax.get(t["parent"])
    out, dropped, used = {}, 0, 0
    for t in taxa:
        c = t.get(key) or 0
        if not c or t["rank"] in SPECIES_RANKS:
            continue
        if t["id"] not in where:
            dropped += c
            continue
        out[where[t["id"]]] = out.get(where[t["id"]], 0) + c
        used += c
    return out, dict(used=used, dropped=dropped)

if __name__ == "__main__":
    taxa = json.load(open(sys.argv[1]))
    game = json.load(open(sys.argv[2]))
    key = "direct_rg" if "--rg" in sys.argv else "direct"
    coarse, rep = coarse_by_node(game["nodes"], taxa, key)
    for i, n in enumerate(game["nodes"]):
        if isinstance(n[1], list):
            del n[2:]
            if coarse.get(i):
                n.append(coarse[i])
    game["sources"]["coarse_obs"] = ("iNaturalist /observations/taxonomy, California, " +
                                     ("research grade" if key == "direct_rg" else "verifiable (research grade + needs ID)") +
                                     ": observations identified only above species")
    print(f"coarse observations: {rep['used']:,} attached, {rep['dropped']:,} dropped (no species in tree)", file=sys.stderr)
    with open(sys.argv[2], "w") as f:
        json.dump(game, f, ensure_ascii=False, separators=(",", ":"))
