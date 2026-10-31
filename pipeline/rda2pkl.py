"""Convert an ape 'phylo' object stored in an R .rda (e.g. V.PhyloMaker2's
GBOTB.extended.WP.rda) into a pickle of {edge, tip.label, ...} numpy arrays.
Usage: rda2pkl.py IN.rda OUT.pkl   (needs `pip install rdata`)"""
import sys, pickle
import numpy as np, rdata
d = rdata.conversion.convert(rdata.parser.parse_file(sys.argv[1]))
(name, t), = d.items()
pickle.dump({k: (list(map(str, t[k])) if k == "tip.label" else np.asarray(t[k])) for k in t}, open(sys.argv[2], "wb"))
print(name, len(t["tip.label"]), "tips")
