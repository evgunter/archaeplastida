# Data pipeline

Builds `data/game.json`: the species list and phylogeny the game uses.

## Sources

| What | Source |
|---|---|
| Species list, native/endemic/introduced status, common names, photos | iNaturalist API: research-grade observations in California (place 14), kingdom Plantae. iNat's Plantae is Archaeplastida: land plants, green algae (incl. charophytes), red algae, glaucophytes |
| Higher-taxon ranks/names | iNaturalist open-data `taxa.csv.gz` (S3) |
| Backbone phylogeny | Open Tree of Life synthesis v16.1, `labelled_supertree_ottnames.tre` |
| Synonymy | Open Tree Taxonomy 3.7.3 + Open Tree TNRS API |
| Polytomy refinement | `GBOTB.extended.WP` from [V.PhyloMaker2](https://github.com/jinyizju/V.PhyloMaker2): Smith & Brown 2018 GBOTB seed plant tree plus pteridophytes, standardized to World Plants names (Jin & Qian 2022) |

## How the tree is built (`build_tree.py`)

1. **Species.** iNat leaf taxa are folded into species. A species is kept if it has
   at least 2 research-grade CA observations, or iNat lists it as native or endemic in California. Status comes from the iNat California listing of each taxon.
2. **Open Tree induced subtree.** Species are matched to Open Tree by exact name,
   then via TNRS (synonyms). The synthetic tree is pruned to the matched species,
   and unary nodes are collapsed. Open Tree has resolved nodes for which there is no
   formal name. These are kept, so the game shows unnamed clades.
3. **Re-anchoring dumped taxa.** Open Tree places species without sequence data
   at the MRCA of their genus. When the genus is non-monophyletic, that can
   be a family-level polytomy, which would make two *Erigeron* species
   look only distantly related. Any single-genus child of a polytomy is moved down
   to the smallest clade below that polytomy holding ≥75% of its other
   congeners there (or ≥90% of its tribe/subfamily/family). Moves only go toward the tips.
4. **Grafting.** Species absent from Open Tree are attached at the MRCA of the
   members of their lowest iNat taxon that is present, with iNat taxonomy
   structuring the grafted part.
5. **Forced clades** (`clade_defs.FORCED`). There's a short list of relationships with
   strong modern support that Open Tree 16.1 does not recover: monophyletic
   bryophytes, and monophyletic Zygnematophyceae sister to land plants.
6. **Polytomy refinement.** For each remaining polytomy, clades from GBOTB
   that group whole children of the polytomy are added. Then the same is done with iNat
   taxonomy (subgenera, sections, tribes, …). A clade is only ever added if
   it is compatible with everything already in the tree.
7. **Naming.** A node gets every iNat or Open Tree taxon whose California
   membership equals its species set exactly. It also gets the node-based names in
   `clade_defs.CLADES` (eudicots, rosids, lamiids, …), applied only when
   the excluded taxa really fall outside that node.
   An iNat genus, family, or order that matches no node exactly gets an
   *approximate* label on the deepest node holding ≥80% of its California species,
   provided ≥80% of that node's species belong to it. The game marks these with ≈ and
   gives the counts in a tooltip, e.g. *Quercus* when the tree nests tanoak inside the oaks.

## Running

Inputs that are large downloads go in their own directory, outside the repo.

```bash
D=/tmp/dl; W=/tmp/work; mkdir -p $D/{inat,otol,ott,phylo} $W
curl -o $D/inat/taxa.csv.gz https://inaturalist-open-data.s3.amazonaws.com/taxa.csv.gz
curl -o $D/otol/labelled_supertree_ottnames.tre https://files.opentreeoflife.org/synthesis/opentree16.1/output/labelled_supertree/labelled_supertree_ottnames.tre
curl https://files.opentreeoflife.org/ott/ott3.7.3/ott3.7.3.tgz | tar xz -C $D/ott
curl -o $D/phylo/GBOTB.extended.WP.rda https://raw.githubusercontent.com/jinyizju/V.PhyloMaker2/master/data/GBOTB.extended.WP.rda

python -m venv $W/venv && $W/venv/bin/pip install rdata numpy
python3 pipeline/fetch_inat.py $W/inat_ca.json
python3 pipeline/fetch_taxon_names.py $W/inat_ca.json $W/taxon_common.json
$W/venv/bin/python pipeline/rda2pkl.py $D/phylo/GBOTB.extended.WP.rda $W/gbotb.pkl
python3 pipeline/otol_extract.py $D/otol/labelled_supertree_ottnames.tre $W/otol_arch.pkl
$W/venv/bin/python pipeline/build_tree.py --inat $W/inat_ca.json \
  --taxa $D/inat/taxa.csv.gz --otol $W/otol_arch.pkl --gbotb $W/gbotb.pkl \
  --ott $D/ott/ott3.7.3 --tnrs-cache $W/tnrs_cache.json \
  --taxon-common $W/taxon_common.json --out data/game.json
```

## Output format (`data/game.json`)

`nodes` is in preorder, so a parent always comes before its children. Each entry is one of:

- internal: `[parent, [[name, rank, common_name], ...]]` (an empty list means unnamed).
  Approximate names carry three more numbers: `[name, rank, common, in_clade, taxon_total, clade_size]`
- species: `[parent, scientific_name, common_name, status, n_obs, inat_id, photo, photo_attribution, source, family]`
  where status is `e`ndemic / `n`ative / `i`ntroduced / empty, and source is `o`
  (placed by Open Tree) or `g` (grafted by taxonomy).

Set `DEBUG_SPECIES="Genus species"` to trace one species through the re-anchoring step.
