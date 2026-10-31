"""English common names for every higher taxon (genus and above) that appears
as an ancestor of a California species. Input: fetch_inat.py output (argv[1]);
output: JSON {taxon_id: common name} (argv[2])."""
import json, sys, time, urllib.request
recs = json.load(open(sys.argv[1]))
ids = sorted({a for r in recs for a in r["ancestor_ids"]} - {r["id"] for r in recs if r["rank"] == "species"})
try:
    out = json.load(open(sys.argv[2]))
except FileNotFoundError:
    out = {}
todo = [i for i in ids if str(i) not in out]
print(len(ids), "taxa,", len(todo), "to fetch", file=sys.stderr)
for k in range(0, len(todo), 30):
    chunk = todo[k:k + 30]
    url = "https://api.inaturalist.org/v1/taxa/" + ",".join(map(str, chunk)) + "?locale=en&per_page=30"
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "archaeplastida-game-builder"}), timeout=60) as r:
                d = json.load(r)
            break
        except Exception as e:
            print("retry", e, file=sys.stderr); time.sleep(2 ** attempt * 2)
    for i in chunk:
        out.setdefault(str(i), "")
    for t in d["results"]:
        out[str(t["id"])] = t.get("preferred_common_name") or ""
    if k // 30 % 20 == 0:
        print(k, file=sys.stderr); json.dump(out, open(sys.argv[2], "w"))
    time.sleep(1.0)
json.dump(out, open(sys.argv[2], "w"))
