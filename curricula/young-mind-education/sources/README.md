# Local source texts

Put local curriculum materials here, following the manifest's
`suggestedFileLayout`:

```txt
sources/
  literature/
    aesop-fables-vernon-jones.md
    colum-adventures-odysseus-tales-troy.md
  history/
    famous-men-greece-haaren-poland.md
    boys-girls-herodotus-white.md
  math/
    pre-euclid-geometry-cards.json
    euclid-book1-casey-byrne.md
  science/
    comstock-nature-study-selected.json
  languages/
    greek-latin-starter-cards.json
  beauty/
    greek-picture-study-pack.json
```

Each source's expected path is recorded in its `local.path` in
`../manifest.json`. Use plain Markdown, HTML, or JSON. Keep front matter
simple when you add it:

```yaml
---
id: colum-adventures-odysseus-tales-troy
title: The Adventures of Odysseus and The Tales of Troy
author: Padraic Colum
license: public-domain-us
upstream: Project Gutenberg eBook 16867
---
```

For scans and curated assets, add a sidecar record under `../attribution/`
using the `sidecarMetadataShape` from the manifest's `localSourcePolicy`.

Do not add copyrighted texts unless the family has the right to store and use
them locally (`owned-required` sources stay metadata-only forever).
