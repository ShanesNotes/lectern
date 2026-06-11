import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MASTERY_STATES,
  buildLessonPortfolio,
  buildPromptDigest,
  loadCurriculumManifest,
  normalizeLessonIndex,
  suggestGuidedLearning,
  validateManifest,
} from "../server/education.js";

test("hellenic seed manifest loads and validates", () => {
  const manifest = loadCurriculumManifest();

  assert.equal(manifest.id, "young-mind-education.hellenic-seed");
  assert.equal(manifest.subjects.length, 7);
  assert.equal(manifest.sourceTexts.length, 9); // the eight-anchor seed (math split in two)
  assert.equal(manifest.seedBundle.sourceTextIds.length, 9);

  const subjectIds = new Set(manifest.subjects.map((subject) => subject.id));
  for (const id of ["language-arts-literature", "math-logic", "science-nature", "civics-virtue"]) {
    assert.ok(subjectIds.has(id), `expected subject ${id}`);
  }

  for (const source of manifest.sourceTexts) {
    assert.equal(source.tier, "seed-anchor", `${source.id} should be a seed anchor`);
    assert.ok(source.local.path, `${source.id} should have a local path`);
  }

  // Expansion candidates are a separate tier, never duplicated into the seed.
  const seedIds = new Set(manifest.sourceTexts.map((source) => source.id));
  for (const candidate of manifest.nearExpansionCandidates) {
    assert.ok(!seedIds.has(candidate.id), `${candidate.id} must not be in the seed`);
  }
});

test("validateManifest rejects broken catalogs", () => {
  const minimal = {
    subjects: [{ id: "math-logic", schoolLabel: "Math", title: "Math" }],
    sourceTexts: [
      {
        id: "euclid",
        title: "Euclid",
        subjects: ["math-logic"],
        local: { path: "sources/math/euclid.md", status: "public-domain-download" },
      },
    ],
  };
  validateManifest(minimal); // sane baseline passes

  assert.throws(
    () => validateManifest({ ...minimal, sourceTexts: [] }),
    /non-empty/
  );
  assert.throws(
    () =>
      validateManifest({
        ...minimal,
        sourceTexts: [{ ...minimal.sourceTexts[0], subjects: ["nope"] }],
      }),
    /unknown subject/
  );
  assert.throws(
    () =>
      validateManifest({
        ...minimal,
        sourceTexts: [
          { ...minimal.sourceTexts[0], local: { path: "x", status: "pirated" } },
        ],
      }),
    /unknown local.status/
  );
  assert.throws(
    () =>
      validateManifest({
        ...minimal,
        nearExpansionCandidates: [{ id: "euclid" }],
      }),
    /both a seed source and an expansion candidate/
  );
});

test("lesson index normalization tolerates missing optional fields", () => {
  const index = normalizeLessonIndex({
    lessons: [
      {
        file: "lessons/0001-wine-dark-sea.html",
        subjects: [{ id: "language-arts-literature", strand: "epithets", weight: 0.8 }],
        operationIds: ["narrate"],
        mastery: "narrated",
      },
      { file: "lessons/0002-x.html", mastery: "not-a-state" },
      { nope: true },
    ],
  });

  assert.equal(index.version, 1);
  assert.equal(index.lessons.length, 2);
  assert.equal(index.lessons[0].lessonId, "0001-wine-dark-sea");
  assert.equal(index.lessons[0].subjects[0].strand, "epithets");
  assert.deepEqual(index.lessons[0].operationIds, ["narrate"]);
  assert.equal(index.lessons[1].mastery, undefined, "unknown mastery states are dropped");
});

test("portfolio groups lessons by school subject and keeps untagged lessons visible", () => {
  const manifest = loadCurriculumManifest();

  const portfolio = buildLessonPortfolio({
    manifest,
    lessons: [
      { file: "0001-homer.html", title: "Homer", url: "/workspaces/hazel/lessons/0001-homer.html" },
      { file: "0002-volcanoes.html", title: "Volcanoes", url: "/workspaces/hazel/lessons/0002-volcanoes.html" },
    ],
    lessonIndex: {
      lessons: [
        {
          file: "lessons/0001-homer.html",
          title: "Homeric Epithets",
          subjects: [{ id: "language-arts-literature", strand: "Homeric-retelling", weight: 1 }],
          sourceTextIds: ["colum-adventures-odysseus-tales-troy"],
          mastery: "narrated",
        },
      ],
    },
  });

  const literature = portfolio.subjects.find((s) => s.id === "language-arts-literature");
  const unsorted = portfolio.subjects.find((s) => s.id === "unsorted");

  assert.equal(literature.count, 1);
  assert.equal(literature.lessons[0].title, "Homeric Epithets");
  assert.deepEqual(literature.sourceTextIds, ["colum-adventures-odysseus-tales-troy"]);
  assert.equal(unsorted.count, 1);
  assert.equal(unsorted.lessons[0].title, "Volcanoes");
});

test("suggestions resume started seed anchors first and respect age bands", () => {
  const manifest = loadCurriculumManifest();
  const portfolio = buildLessonPortfolio({
    manifest,
    lessons: [{ file: "0001-homer.html", title: "Homer", url: "/x" }],
    lessonIndex: {
      lessons: [
        {
          file: "lessons/0001-homer.html",
          subjects: [{ id: "language-arts-literature" }],
          sourceTextIds: ["colum-adventures-odysseus-tales-troy"],
          mastery: "introduced",
        },
      ],
    },
  });

  const guided = suggestGuidedLearning({ profile: { id: "hazel", age: 9 }, manifest, portfolio });

  const literature = guided.subjects.find((s) => s.subjectId === "language-arts-literature");
  assert.ok(literature, "literature should have suggestions");
  // Started-but-unfinished Colum outranks untouched Aesop (priority 10 vs 20).
  assert.equal(literature.suggestions[0].id, "colum-adventures-odysseus-tales-troy");
  assert.equal(literature.suggestions[0].started, true);
  assert.equal(literature.suggestions[0].mastery, "introduced");

  // Age 9 excludes Herodotus (10+) and Euclid Book I (10+) from every subject.
  const all = guided.subjects.flatMap((s) => s.suggestions.map((x) => x.id));
  assert.ok(!all.includes("boys-girls-herodotus-white"));
  assert.ok(!all.includes("euclid-book1-casey-byrne"));

  // Expansion stays locked until every age-eligible seed anchor has evidence.
  assert.equal(guided.expansion.unlocked, false);
  // Seed tier never leaks expansion candidates into subject suggestions.
  assert.ok(!all.includes("tanglewood-tales-hawthorne"));
  // metadata-only expansion candidates are excluded by default.
  assert.ok(!guided.expansion.candidates.some((c) => c.local?.status === "metadata-only"));
  assert.ok(guided.weeklyLoop.length >= 5);
});

test("secured sources drop out of suggestions; expansion unlocks after full seed coverage", () => {
  const manifest = loadCurriculumManifest();
  const age = 10; // every seed anchor is age-eligible at 10
  const lessons = manifest.sourceTexts.map((source, i) => ({
    file: `000${i}-x.html`,
    title: source.id,
    url: "/x",
  }));
  const lessonIndex = {
    lessons: manifest.sourceTexts.map((source, i) => ({
      file: `lessons/000${i}-x.html`,
      subjects: [{ id: source.subjects[0] }],
      sourceTextIds: [source.id],
      mastery: source.id === "aesop-fables-vernon-jones" ? "secure" : "narrated",
    })),
  };

  const portfolio = buildLessonPortfolio({ manifest, lessons, lessonIndex });
  const guided = suggestGuidedLearning({ profile: { age }, manifest, portfolio });

  const all = guided.subjects.flatMap((s) => s.suggestions.map((x) => x.id));
  assert.ok(!all.includes("aesop-fables-vernon-jones"), "secure sources are done");
  assert.equal(guided.expansion.unlocked, true);
  assert.ok(guided.expansion.candidates.some((c) => c.id === "tanglewood-tales-hawthorne"));
});

test("prompt digest is age-filtered, compact, and includes index-keeping rules", () => {
  const manifest = loadCurriculumManifest();

  const hazel = buildPromptDigest({ manifest, profile: { name: "Hazel", age: 9 } });
  assert.match(hazel, /Guided curriculum/);
  assert.match(hazel, /aesop-fables-vernon-jones/);
  assert.match(hazel, /lesson-index\.json/);
  assert.match(hazel, new RegExp(MASTERY_STATES[MASTERY_STATES.length - 1]));
  assert.ok(!hazel.includes("boys-girls-herodotus-white"), "10+ sources hidden from age 9");

  // Willem (6) is younger than every seed anchor: digest disappears entirely.
  assert.equal(buildPromptDigest({ manifest, profile: { name: "Willem", age: 6 } }), "");
});
