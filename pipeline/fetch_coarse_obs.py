"""Fetch how many California plant observations are identified only to a
taxon above species (genus, section, family, ...), for pooling rare species
into higher-taxon answers.

Uses iNat's /observations/taxonomy, which returns every taxon with California
observations, its parent, and direct_obs_count: observations whose
community taxon is exactly that taxon. Fetched twice: verifiable
(research grade + needs ID) and research grade only.

Output (argv[1]): JSON list of {id, parent, rank, name, direct, direct_rg}.
"""
import json, sys, time, urllib.request, urllib.parse

API = "https://api.inaturalist.org/v1/observations/taxonomy"

def get(params):
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "archaeplastida-game-builder"})
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.load(r)
        except Exception as e:  # rate limits / transient errors
            print("retry", attempt, e, file=sys.stderr)
            time.sleep(2 ** attempt * 2)
    raise RuntimeError(url)

out = {}
for key, q in [("direct", dict(verifiable="true")), ("direct_rg", dict(quality_grade="research"))]:
    d = get(dict(place_id=14, taxon_id=47126, **q))
    rs = d["results"]
    if d.get("size") is not None and d["size"] != len(rs):
        raise SystemExit(f"{key}: got {len(rs)} of {d['size']} taxa")
    for t in rs:
        o = out.setdefault(t["id"], dict(id=t["id"], parent=t.get("parent_id"), rank=t["rank"],
                                         name=t["name"], direct=0, direct_rg=0))
        o[key] = t.get("direct_obs_count") or 0
    print(key, len(rs), "taxa", file=sys.stderr)
    time.sleep(1.1)
json.dump(sorted(out.values(), key=lambda t: t["id"]), open(sys.argv[1], "w"))
