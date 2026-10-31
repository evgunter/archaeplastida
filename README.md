# 🌿 Archaeplastida

A Metazooa/Metaflora-style guessing game for **California plants**. A secret
species is chosen. Each guess shows the smallest clade it shares with the secret,
and how many California species that clade holds.

- **Species:** 7,819 species with research-grade iNaturalist observations in
  California, across all of Archaeplastida: flowering plants, conifers, ferns,
  lycophytes, mosses, liverworts, hornworts, charophytes, and green and red algae.
  Native, endemic, and introduced status is shown. The secret is drawn only from natives.
- **Phylogeny:** the Open Tree of Life synthetic tree, which includes resolved but
  unnamed nodes. Its polytomies are refined with the GBOTB seed plant megatree and
  iNat taxonomy, and its "dumped" taxonomy-only species are cleaned up. The result is
  about 75% resolved, compared with a fully bifurcating tree. Big named clades without
  ranks (eudicots, lamiids, commelinids, …) are labeled when the tree supports them.
  See [`pipeline/README.md`](pipeline/README.md) for methods.

## Play

It's a static site: open `index.html` through any web server, e.g.

```bash
python3 -m http.server
```

then visit http://localhost:8000. It can be hosted on GitHub Pages as is.

Modes: **Daily** (same plant for everyone each day, drawn from the 600 most-observed natives)
and **Practice**, with pools from "300 most-observed natives" up to everything, plus
algae-only and non-vascular pools.

The secret is picked by choosing a family first, then a species in it. By default
families are weighted by the square root of their size, so Asteraceae makes up about 5%
of secrets rather than about 15%, and ferns, conifers and algae turn up more often. Practice mode
can switch to "even across families" or "even across species".

Hints: **narrower clade** names a smaller group containing the secret, and **list genera**
lists every genus in the clade you've narrowed it to.
