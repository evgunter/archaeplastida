"""Minimal, fast-enough Newick parser producing parent/label arrays."""
import re

TOKEN = re.compile(r"'(?:[^']|'')*'|[(),;:]|[^(),;:']+")

def parse(text):
    """Return (parent, label) lists; node 0 is the root. Branch lengths ignored."""
    parent, label = [-1], [""]
    stack, cur = [], 0
    after_colon = False
    for m in TOKEN.finditer(text):
        tok = m.group(0)
        if tok == "(":
            parent.append(cur); label.append("")
            stack.append(cur); cur = len(parent) - 1
        elif tok == ",":
            p = stack[-1]
            parent.append(p); label.append("")
            cur = len(parent) - 1
        elif tok == ")":
            cur = stack.pop()
        elif tok == ":":
            after_colon = True; continue
        elif tok == ";":
            break
        else:
            if after_colon:
                after_colon = False; continue
            tok = tok.strip()
            if tok.startswith("'"):
                tok = tok[1:-1].replace("''", "'")
            label[cur] = tok
        after_colon = False
    return parent, label
