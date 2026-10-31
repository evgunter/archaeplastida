"""IDs of plant taxa iNat considers endemic to California. Output: JSON list to argv[1]."""
import json, sys, time, urllib.request, urllib.parse
API = "https://api.inaturalist.org/v1/observations/species_counts"
ids, page = [], 1
while True:
    q = dict(place_id=14, taxon_id=47126, quality_grade="research", endemic="true", per_page=500, page=page)
    with urllib.request.urlopen(urllib.request.Request(API + "?" + urllib.parse.urlencode(q), headers={"User-Agent": "archaeplastida-game-builder"}), timeout=60) as r:
        d = json.load(r)
    ids += [x["taxon"]["id"] for x in d["results"]]
    if page * 500 >= d["total_results"]: break
    page += 1; time.sleep(1.1)
json.dump(ids, open(sys.argv[1], "w")); print(len(ids))
