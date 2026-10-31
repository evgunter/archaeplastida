"""Fetch every plant (iNat kingdom Plantae = Archaeplastida: land plants, green
algae, red algae, glaucophytes) with research-grade observations in California
(iNat place 14), along with establishment means, common names and photos.

Output: JSON list written to argv[1].
"""
import json, sys, time, urllib.request, urllib.parse

API = "https://api.inaturalist.org/v1/observations/species_counts"
BASE = dict(place_id=14, quality_grade="research", per_page=500, locale="en")

def get(params):
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "archaeplastida-game-builder"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # rate limits / transient errors
            print("retry", attempt, e, file=sys.stderr)
            time.sleep(2 ** attempt * 2)
    raise RuntimeError(url)

def fetch(taxon_id):
    out, page = [], 1
    while True:
        d = get(dict(BASE, taxon_id=taxon_id, page=page))
        out += d["results"]
        print(taxon_id, page, len(out), d["total_results"], file=sys.stderr)
        if page * 500 >= d["total_results"]:
            return out, d["total_results"]
        page += 1
        time.sleep(1.1)

# Split into chunks that stay well below the 10k-result paging cap.
# Tracheophyta(211194) is split into Magnoliopsida(47124), Liliopsida(47163) and the rest.
results, seen = [], set()
def add(rs):
    for r in rs:
        if r["taxon"]["id"] not in seen:
            seen.add(r["taxon"]["id"]); results.append(r)

total = get(dict(BASE, taxon_id=47126, per_page=1))["total_results"]
for tid in [47124, 47163, 211194, 311249, 64615, 56327, 57774, 50863, 311313, 311312, 47126]:
    sub = get(dict(BASE, taxon_id=tid, per_page=1))["total_results"]
    if sub > 9500:
        raise SystemExit(f"taxon {tid} has {sub} results; split further")
    rs, _ = fetch(tid)
    add(rs)
print("total", total, "fetched", len(results), file=sys.stderr)

slim = []
for r in results:
    t = r["taxon"]
    ph = t.get("default_photo") or {}
    em = (t.get("establishment_means") or {})
    slim.append(dict(
        id=t["id"], name=t["name"], rank=t["rank"], count=r["count"],
        ancestor_ids=t["ancestor_ids"], common=t.get("preferred_common_name"),
        means=em.get("establishment_means"), means_place=(em.get("place") or {}).get("id"),
        photo=ph.get("medium_url"), photo_attr=ph.get("attribution"),
        wikipedia=t.get("wikipedia_url"), obs_total=t.get("observations_count"),
    ))
json.dump(slim, open(sys.argv[1], "w"))
