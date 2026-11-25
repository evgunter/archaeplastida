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

Modes: **Daily** (same plant for everyone each day, changing at midnight California time)
and **Practice**, with pools from "easy" up to everything, plus algae-only and non-vascular pools.

**Answers** are species or small clades. Each pool has an observation threshold T: the
count of its Nth most-observed native (600th for daily, 300th for easy, 1500th for medium;
hard and everything have no threshold). A native with at least T research-grade California
observations is an answer by itself. Rarer natives are pooled, bottom-up, into the smallest
clade whose observations reach T, where a clade's observations are its natives' plus those
identified only to a genus, section, family, etc. lying entirely inside it. A clade that already
holds one answer absorbs it; one holding two or more is never pooled, so no existing answers
are forced together. Guessing any species in the secret answer wins. At the daily threshold
this gives 765 answers (466 of them groups) covering 70% of natives, against 600 single
species (11%) without pooling.

The secret is picked by choosing a family first, then an answer in it. By default
families are weighted by the square root of their size, so Asteraceae makes up about 5%
of secrets rather than about 15%, and ferns, conifers and algae turn up more often. Practice mode
can switch to "even across families" or "even across species".

Hints: **narrower clade** names a smaller group containing the secret, and **list genera**
lists every genus in the clade you've narrowed it to.

When changing `app.js`, `style.css` or `data/game.json`, bump the version number in
`index.html` (`?v=` on both links) and `ASSET_VERSION` at the top of `app.js`. Otherwise
browsers, especially on phones, may keep using cached old files.
