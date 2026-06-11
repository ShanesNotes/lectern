# Young Mind Education — Hellenic Seed Curriculum

This folder is the local source-text spine for guided learning in Lectern.

- `manifest.json` is the machine-readable curriculum manifest (v0.3.0,
  `young-mind-education.hellenic-seed`). It is the single source of truth:
  subjects, the seed bundle, source texts, expansion candidates, and the
  guided-suggestion rules all live there.
- `sources/` is the local text root. Add public-domain texts, family-owned
  transcriptions, original primers, card decks, and curated assets there.
- `attribution/` (create as needed) holds sidecar metadata for imported scans
  and curated public-domain assets, in the `sidecarMetadataShape` from the
  manifest's `localSourcePolicy`.

## The eight-anchor seed

The manifest deliberately starts with one high-yield anchor per intellectual
habit — story, moral judgment, history, proof, observation, language, beauty —
nine source records in all (the Pre-Euclid cards and Euclid visual proof pack
are one mathematical anchor split into preparation and source tradition).
Audience: ages 8–12, ideal age 10, late Grammar / early Logic stage.

A source belongs in the seed only if it can generate many short guided lessons
and can be stored locally. Expansion candidates (`nearExpansionCandidates`)
wait until the learner shows the completion evidence listed in
`seedBundle.completionEvidence`. Commercial curricula are never imported —
they appear only in `doNotImportAsSeed`.

## Local sourcing policy

`local.status` on each source text governs what the tutor may do with it:

| Status | Tutor behavior |
|---|---|
| `local-original` | Use directly; authored for Lectern. |
| `public-domain-download` | Use once imported under `sources/` with attribution. |
| `public-domain-scan` | Use a locally cleaned OCR edition; keep scan attribution sidecar. |
| `curated-public-domain-assets` | Use; store per-asset attribution. |
| `metadata-only` | Suggest as a parent sourcing task only — never claim to have read it. |
| `owned-required` | Family-owned reminder; never quote or redistribute. |

## Why this list is small

Too many source texts create noisy suggestions. The seed is rails, not a cage:
curiosity steers the path, the catalog keeps the suggestions grounded, local,
and few. Expansion is earned by evidence, not appetite.
