"""Node-based names for well-known clades that have no Linnaean rank (so they
are absent from iNat) and whose Open Tree label may be missing.

Each entry: (name, include, exclude). The name is attached to the MRCA of all
California members of the `include` taxa, but only if no member of an
`exclude` taxon falls inside it -- so a name is never applied to a node the
tree doesn't support. Taxon names refer to iNaturalist taxa.
"""
CLADES = [
    ("green plants (Viridiplantae)", ["Chlorophyta", "Tracheophyta"], ["Rhodophyta"]),
    ("Streptophyta", ["Charophyceae", "Tracheophyta"], ["Chlorophyta"]),
    ("Phragmoplastophyta", ["Charophyceae", "Zygnematophyceae", "Tracheophyta"], ["Chlorophyta", "Klebsormidiophyceae"]),
    ("Zygnematophyceae + land plants", ["Zygnematophyceae", "Tracheophyta"], ["Charophyceae", "Coleochaetophyceae"]),
    ("bryophytes", ["Anthocerotophyta", "Bryophyta", "Marchantiophyta"], ["Tracheophyta"]),
    ("Setaphyta (mosses + liverworts)", ["Bryophyta", "Marchantiophyta"], ["Anthocerotophyta", "Tracheophyta"]),
    ("ferns + seed plants (Euphyllophyta)", ["Polypodiopsida", "Pinales"], ["Lycopodiopsida"]),
    ("conifers", ["Pinaceae", "Cupressaceae"], ["Ephedraceae", "Ginkgoaceae"]),
    ("conifers + gnetophytes", ["Pinaceae", "Cupressaceae", "Ephedraceae"], ["Ginkgoaceae", "Cycadaceae"]),
    ("Cupressophyta", ["Cupressaceae", "Taxaceae"], ["Pinaceae"]),
    ("magnoliids", ["Lauraceae", "Aristolochiaceae"], ["Liliopsida", "Ranunculales", "Nymphaeales"]),
    ("monocots + eudicots + magnoliids (Mesangiospermae)", ["Lauraceae", "Poaceae", "Asteraceae"], ["Nymphaeaceae", "Cabombaceae"]),
    ("commelinids", ["Arecaceae", "Poaceae", "Commelinaceae"], ["Asparagaceae", "Orchidaceae", "Liliaceae"]),
    ("BOP clade", ["Pooideae", "Oryzoideae", "Bambusoideae"], ["Panicoideae", "Chloridoideae"]),
    ("PACMAD clade", ["Panicoideae", "Chloridoideae", "Arundinoideae", "Aristidoideae", "Danthonioideae"], ["Pooideae"]),
    ("eudicots", ["Ranunculaceae", "Asteraceae", "Rosaceae"], ["Lauraceae", "Poaceae", "Aristolochiaceae"]),
    ("core eudicots (Gunneridae)", ["Gunneraceae", "Asteraceae", "Rosaceae"], ["Ranunculaceae", "Platanaceae", "Buxaceae"]),
    ("Pentapetalae", ["Rosaceae", "Asteraceae", "Caryophyllaceae"], ["Gunneraceae", "Ranunculaceae", "Platanaceae"]),
    ("superrosids", ["Saxifragaceae", "Rosaceae", "Brassicaceae"], ["Asteraceae", "Caryophyllaceae"]),
    ("rosids", ["Vitaceae", "Rosaceae", "Brassicaceae"], ["Saxifragaceae", "Crassulaceae"]),
    ("eurosids", ["Rosaceae", "Brassicaceae", "Myrtaceae", "Fabaceae"], ["Saxifragaceae", "Vitaceae"]),
    ("fabids", ["Fabaceae", "Rosaceae", "Fagaceae", "Cucurbitaceae", "Celastraceae"], ["Brassicaceae", "Malvaceae", "Vitaceae"]),
    ("nitrogen-fixing clade", ["Fabaceae", "Rosaceae", "Fagaceae", "Cucurbitaceae"], ["Celastraceae", "Euphorbiaceae", "Brassicaceae"]),
    ("malvids", ["Brassicaceae", "Malvaceae", "Sapindaceae"], ["Fabaceae", "Rosaceae", "Vitaceae"]),
    ("superasterids", ["Caryophyllaceae", "Asteraceae", "Santalaceae"], ["Rosaceae", "Saxifragaceae"]),
    ("asterids", ["Cornaceae", "Ericaceae", "Asteraceae", "Lamiaceae"], ["Caryophyllaceae", "Polygonaceae"]),
    ("core asterids (Gentianidae)", ["Asteraceae", "Lamiaceae"], ["Ericaceae", "Cornaceae"]),
    ("lamiids", ["Lamiaceae", "Boraginaceae", "Gentianaceae", "Solanaceae"], ["Asteraceae", "Apiaceae"]),
    ("campanulids", ["Asteraceae", "Apiaceae", "Campanulaceae"], ["Lamiaceae", "Solanaceae"]),
]

# Topology corrections: clades with strong modern support that the Open Tree
# synthesis does not recover. Each is forced by gathering the maximal subtrees
# made only of the listed taxa under a new node at their MRCA. Applied in order.
FORCED = [
    # Bryophyte monophyly: Puttick et al. 2018 Curr Biol; One Thousand Plant
    # Transcriptomes Initiative 2019 Nature; Harris et al. 2020 Curr Biol.
    ("bryophytes", ["Anthocerotophyta", "Bryophyta", "Marchantiophyta"]),
    ("Setaphyta (mosses + liverworts)", ["Bryophyta", "Marchantiophyta"]),
    # Zygnematophyceae are monophyletic and sister to land plants:
    # Wickett et al. 2014 PNAS; 1KP 2019.
    ("Zygnematophyceae", ["Zygnematophyceae"]),
    ("Zygnematophyceae + land plants", ["Zygnematophyceae", "Anthocerotophyta", "Bryophyta", "Marchantiophyta", "Tracheophyta"]),
    # Chlorophyceae (incl. Hydrodictyaceae/Sphaeropleales) are monophyletic:
    # Fang et al. 2017 BMC Evol Biol; Fučíková et al. 2019 J Phycol.
    ("Chlorophyceae", ["Chlorophyceae"]),
]

# Plain-English glosses for clade names that have no iNat common name.
GLOSS = {
    "Archaeplastida": "red algae, green algae and land plants",
    "Chloroplastida": "green plants",
    "Embryophyta": "land plants",
    "Spermatophyta": "seed plants",
    "Angiospermae": "flowering plants",
    "Acrogymnospermae": "living gymnosperms",
    "Tracheophyta": "vascular plants",
    "Euphyllophyta": "ferns + seed plants",
    "Polypodiopsida": "ferns",
    "Polypodiidae": "leptosporangiate ferns",
    "Mesangiospermae": "magnoliids, monocots and eudicots",
    "Pentapetalae": "core eudicots with five-part flowers",
    "Gunneridae": "core eudicots",
    "Rhodophyta": "red algae",
    "Eurhodophytina": "red algae excluding the extremophile Cyanidiophyceae",
    "Florideophyceae": "most seaweed-sized red algae",
    "Chlorophyta": "green algae (most)",
}
