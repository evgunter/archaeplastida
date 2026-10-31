"""Extract the Archaeplastida (red + green plant MRCA) subtree from the Open Tree
synthesis newick. Usage: otol_extract.py labelled_supertree_ottnames.tre OUT.pkl"""
import os, sys, pickle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import newick
txt = open(sys.argv[1]).read()
parent, label = newick.parse(txt)
print(len(parent))
idx = {l: i for i, l in enumerate(label) if l.startswith(('Chloroplastida_ott', 'Rhodophyta_ott', 'Glaucophyta', 'Archaeplastida'))}
print(idx)
# MRCA of Chloroplastida and Rhodophyta
def anc(i):
    out = []
    while i != -1: out.append(i); i = parent[i]
    return out
a = anc(idx['Chloroplastida_ott361838']); b = set(anc(idx['Rhodophyta_ott878953']))
m = next(x for x in a if x in b)
print('mrca', m, label[m], 'path', [label[x] for x in anc(m)][:10])
# children lists, extract subtree of m
ch = [[] for _ in parent]
for i, p in enumerate(parent):
    if p >= 0: ch[p].append(i)
print('children of mrca', [label[c] for c in ch[m]])
newp, newl, stack = [], [], [(m, -1)]
while stack:
    n, p = stack.pop()
    newp.append(p); newl.append(label[n]); me = len(newp) - 1
    for c in ch[n]: stack.append((c, me))
pickle.dump((newp, newl), open(sys.argv[2], 'wb'))
print('sub size', len(newp))
