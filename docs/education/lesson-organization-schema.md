# Lesson organization and guided curriculum schema

Lectern already stores every learner's work as plain files under `workspaces/<profile-id>/`. This proposal keeps that local-first shape and adds two small, auditable layers:

1. `workspaces/<profile-id>/lesson-index.json` — a per-learner portfolio index that groups completed lessons into school subjects, strands, source texts, and review state.
2. `curricula/young-mind-education/manifest.json` — a local source-text catalog that can guide suggestions without depending on a network service.

The goal is not to turn Lectern into a school LMS. It is to make the lessons a child has genuinely learned easier to browse, review, and extend.

## Subject taxonomy

The school-subject grouping should be stable enough for a parent to understand, but flexible enough for classical and curiosity-driven lessons. The initial taxonomy is:

| Subject id | Parent-facing label | Typical strands |
| --- | --- | --- |
| `language-arts-literature` | Language Arts & Literature | narration, vocabulary, myth, poetry, close reading |
| `history-geography` | History & Geography | biography, ancient history, maps, chronology, civilizations |
| `math-logic` | Mathematics & Logic | arithmetic, geometry, proof, patterns, formal logic |
| `science-nature` | Science & Nature | observation, animals, plants, earth science, astronomy, mechanisms |
| `classical-languages` | Classical Languages | Greek alphabet, Latin roots, grammar, translation habits |
| `art-music-beauty` | Art, Music & Beauty | picture study, architecture, sculpture, music, design |
| `civics-virtue` | Civics & Virtue | justice, courage, citizenship, moral imagination, discussion |

A lesson may belong to multiple subjects with weights. For example, a lesson on Achilles could be `language-arts-literature` and `civics-virtue`, while a lesson on Euclid could be `math-logic` and `art-music-beauty`.

## `lesson-index.json`

Each workspace may contain this file:

```json
{
  "version": 1,
  "learnerId": "hazel",
  "updatedAt": "2026-06-10T00:00:00.000Z",
  "lessons": [
    {
      "lessonId": "0001-wine-dark-sea",
      "file": "lessons/0001-wine-dark-sea.html",
      "title": "Why Homer Says Wine-Dark Sea",
      "createdAt": "2026-06-10T00:00:00.000Z",
      "ageAtLesson": 9,
      "subjects": [
        {
          "id": "language-arts-literature",
          "strand": "homeric-epithets",
          "weight": 0.75
        },
        {
          "id": "art-music-beauty",
          "strand": "poetic-language",
          "weight": 0.25
        }
      ],
      "sourceTextIds": ["colum-adventures-odysseus-tales-troy"],
      "operationIds": ["narrate", "copy-or-memorize"],
      "skills": ["notice repeated epithets", "retell a scene in order"],
      "knowledge": [
        "An epithet is a repeated describing phrase that helps oral poetry remember and sing a story."
      ],
      "evidence": {
        "type": "quiz",
        "score": 4,
        "max": 5,
        "learnerWords": "Rosy-fingered dawn means morning is coming."
      },
      "mastery": "narrated",
      "lastPracticedAt": "2026-06-10T00:00:00.000Z",
      "nextReviewAt": "2026-06-13T00:00:00.000Z"
    }
  ]
}
```

The tutor should only add a lesson after there is evidence that the learner engaged with it. A generated lesson is not a learned lesson until the child finishes a quiz, explains it back, or otherwise shows understanding.

## Field rules

`lessonId` should usually mirror the lesson filename without `.html`. `file` should be relative to the workspace and start with `lessons/`. `subjects[].id` must be one of the manifest subject ids or `unsorted`. `weight` is optional, but if present it should be between `0` and `1`. `sourceTextIds` should refer to entries in `curricula/young-mind-education/manifest.json`. `operationIds` (optional) name the lesson operations used, from the manifest's `lessonOperations`: `narrate`, `ask-why`, `map-or-timeline`, `copy-or-memorize`, `draw-or-demonstrate`, `compare`. `mastery` follows the manifest's ladder: `introduced`, `narrated`, `discussed`, `demonstrated`, `review-ready`, `secure`.

## Guided source catalog

The source manifest is intentionally metadata-first and **tiered**: the nine `seed-anchor` source texts are the suggestion spine; `nearExpansionCandidates` unlock only after the seed shows the completion evidence in `seedBundle.completionEvidence`; `doNotImportAsSeed` records what is deliberately excluded (commercial curricula, modern-copyright texts). Each source text points to a local path under `curricula/young-mind-education/sources/` and carries a `local.status`:

- `local-original` — authored for Lectern; use directly.
- `public-domain-download` — import into `sources/` after a license check, with attribution.
- `public-domain-scan` — use a locally cleaned OCR edition; keep scan attribution in a sidecar.
- `curated-public-domain-assets` — images/music metadata from public-domain collections, attributed per asset.
- `metadata-only` — a future sourcing target; suggest it only as a parent task.
- `owned-required` — useful pedagogically, but never quoted or redistributed; available only if the family owns a copy.

A tutor must never claim to have read material whose text is not locally present.

## Suggested tutor behavior

At the start of a turn, the tutor should skim recent lesson files and `lesson-index.json` in addition to `MISSION.md`, `NOTES.md`, and learning records. When the child asks “what should I learn next?”, the tutor should use the local curriculum catalog as a suggestion spine, filtered by age, past lessons, and curiosity. After a lesson is completed, the tutor should update `lesson-index.json` with subject tags, source links, evidence, and the next review date.
