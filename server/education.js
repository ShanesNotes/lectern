// Curriculum layer: loads the Young Mind Education manifest, groups a learner's
// lessons into a school-subject portfolio, and computes guided suggestions.
//
// Pure functions over plain data, except loadCurriculumManifest (the one reader).
// Knows nothing about HTTP, the SDK, or workspace layout — callers hand it the
// lesson list and lesson-index they got from store.js.
//
// Manifest shape: curricula/young-mind-education/manifest.json (v0.3.x) — the
// "eight-anchor Hellenic seed". Source texts are tiered: seed anchors are
// suggested freely; nearExpansionCandidates unlock only after every age-eligible
// seed anchor shows evidence of work (see seedBundle.completionEvidence).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_MANIFEST_PATH = path.join(
  ROOT,
  "curricula",
  "young-mind-education",
  "manifest.json"
);

export const LESSON_INDEX_SCHEMA_VERSION = 1;

// Order matters: index = how far along the learner is with a source.
export const MASTERY_STATES = [
  "introduced",
  "narrated",
  "discussed",
  "demonstrated",
  "review-ready",
  "secure",
];

// local.status values the tutor may suggest without parent action.
const SUGGESTIBLE_STATUSES = new Set([
  "local-original",
  "public-domain-download",
  "public-domain-scan",
  "curated-public-domain-assets",
]);

export const UNSORTED_SUBJECT = {
  id: "unsorted",
  schoolLabel: "Unsorted",
  title: "Unsorted lessons",
  habit: "",
  seedSourceIds: [],
};

/* ---------- manifest loading & validation ---------- */

export function loadCurriculumManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateManifest(manifest, manifestPath);
  return manifest;
}

export function validateManifest(manifest, label = "manifest") {
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`${label}: manifest must be an object`);
  }
  if (!Array.isArray(manifest.subjects) || manifest.subjects.length === 0) {
    throw new Error(`${label}: subjects must be a non-empty array`);
  }
  if (!Array.isArray(manifest.sourceTexts) || manifest.sourceTexts.length === 0) {
    throw new Error(`${label}: sourceTexts must be a non-empty array`);
  }

  assertUniqueIds(manifest.subjects, `${label}: subjects`);
  assertUniqueIds(manifest.sourceTexts, `${label}: sourceTexts`);

  const allowedStatuses = new Set([
    ...Object.keys(manifest.localSourcePolicy?.statuses || {}),
    ...SUGGESTIBLE_STATUSES,
    "metadata-only",
    "owned-required",
  ]);
  const subjectIds = new Set(manifest.subjects.map((s) => s.id));
  const sourceIds = new Set(manifest.sourceTexts.map((s) => s.id));

  for (const source of manifest.sourceTexts) {
    if (!Array.isArray(source.subjects) || source.subjects.length === 0) {
      throw new Error(`${label}: source ${source.id} needs at least one subject`);
    }
    for (const subjectId of source.subjects) {
      if (!subjectIds.has(subjectId)) {
        throw new Error(
          `${label}: source ${source.id} references unknown subject ${subjectId}`
        );
      }
    }
    if (!source.local?.path || !source.local?.status) {
      throw new Error(`${label}: source ${source.id} needs local.path and local.status`);
    }
    if (!allowedStatuses.has(source.local.status)) {
      throw new Error(
        `${label}: source ${source.id} has unknown local.status ${source.local.status}`
      );
    }
  }

  for (const seedId of manifest.seedBundle?.sourceTextIds || []) {
    if (!sourceIds.has(seedId)) {
      throw new Error(`${label}: seedBundle references unknown source ${seedId}`);
    }
  }

  const expansion = manifest.nearExpansionCandidates || [];
  assertUniqueIds(expansion, `${label}: nearExpansionCandidates`);
  for (const candidate of expansion) {
    if (sourceIds.has(candidate.id)) {
      throw new Error(
        `${label}: ${candidate.id} cannot be both a seed source and an expansion candidate`
      );
    }
  }
}

/* ---------- per-learner lesson index ---------- */

export function normalizeLessonIndex(raw = {}) {
  const lessons = Array.isArray(raw.lessons) ? raw.lessons : [];
  return {
    version: Number(raw.version) || LESSON_INDEX_SCHEMA_VERSION,
    learnerId: typeof raw.learnerId === "string" ? raw.learnerId : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    lessons: lessons.map(normalizeLessonRecord).filter(Boolean),
  };
}

function normalizeLessonRecord(record) {
  if (!record || typeof record !== "object" || !record.file) return null;
  const subjects = Array.isArray(record.subjects)
    ? record.subjects
        .filter((subject) => subject && typeof subject.id === "string")
        .map((subject) => ({
          id: subject.id,
          strand: typeof subject.strand === "string" ? subject.strand : undefined,
          weight: typeof subject.weight === "number" ? subject.weight : undefined,
        }))
    : [];

  return {
    lessonId:
      typeof record.lessonId === "string"
        ? record.lessonId
        : String(record.file).replace(/^lessons\//, "").replace(/\.html$/, ""),
    file: String(record.file),
    title: typeof record.title === "string" ? record.title : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
    ageAtLesson: typeof record.ageAtLesson === "number" ? record.ageAtLesson : undefined,
    subjects,
    sourceTextIds: Array.isArray(record.sourceTextIds) ? record.sourceTextIds : [],
    operationIds: Array.isArray(record.operationIds) ? record.operationIds : [],
    skills: Array.isArray(record.skills) ? record.skills : [],
    knowledge: Array.isArray(record.knowledge) ? record.knowledge : [],
    evidence: record.evidence && typeof record.evidence === "object" ? record.evidence : undefined,
    mastery: MASTERY_STATES.includes(record.mastery) ? record.mastery : undefined,
    lastPracticedAt:
      typeof record.lastPracticedAt === "string" ? record.lastPracticedAt : undefined,
    nextReviewAt: typeof record.nextReviewAt === "string" ? record.nextReviewAt : undefined,
  };
}

/* ---------- portfolio: lessons grouped by school subject ---------- */

export function buildLessonPortfolio({ manifest, lessons = [], lessonIndex = {} }) {
  const subjectsSpec = manifest?.subjects?.length ? manifest.subjects : [];
  const normalizedIndex = normalizeLessonIndex(lessonIndex);
  const indexedByFile = new Map();
  for (const record of normalizedIndex.lessons) {
    indexedByFile.set(record.file, record);
    indexedByFile.set(stripLessonsPrefix(record.file), record);
  }

  const subjects = new Map();
  for (const subject of [...subjectsSpec, UNSORTED_SUBJECT]) {
    subjects.set(subject.id, {
      id: subject.id,
      schoolLabel: subject.schoolLabel,
      title: subject.title,
      habit: subject.habit,
      lessons: [],
      sourceTextIds: [],
    });
  }

  for (const lesson of lessons) {
    const record =
      indexedByFile.get(lesson.file) || indexedByFile.get(`lessons/${lesson.file}`);
    const subjectTags = record?.subjects?.length
      ? record.subjects
      : [{ id: UNSORTED_SUBJECT.id, strand: "untagged", weight: 1 }];

    for (const tag of subjectTags) {
      const group = subjects.get(tag.id) || subjects.get(UNSORTED_SUBJECT.id);
      const portfolioLesson = {
        file: lesson.file,
        title: record?.title || lesson.title,
        url: lesson.url,
        mtime: lesson.mtime,
        lessonId: record?.lessonId || lesson.file?.replace(/\.html$/, ""),
        strand: tag.strand,
        weight: tag.weight,
        mastery: record?.mastery,
        operationIds: record?.operationIds || [],
        sourceTextIds: record?.sourceTextIds || [],
        evidence: record?.evidence,
        nextReviewAt: record?.nextReviewAt,
      };
      group.lessons.push(portfolioLesson);
      for (const sourceTextId of portfolioLesson.sourceTextIds) {
        if (!group.sourceTextIds.includes(sourceTextId)) {
          group.sourceTextIds.push(sourceTextId);
        }
      }
    }
  }

  return {
    version: LESSON_INDEX_SCHEMA_VERSION,
    updatedAt: normalizedIndex.updatedAt,
    subjects: [...subjects.values()]
      .filter((subject) => subject.lessons.length > 0 || subject.id !== UNSORTED_SUBJECT.id)
      .map((subject) => ({ ...subject, count: subject.lessons.length })),
  };
}

/* ---------- guided suggestions: seed first, expansion when earned ---------- */

/**
 * Suggest what to study next, per subject, following the manifest's
 * guidedSuggestionRules: resume started seed anchors first, then untouched
 * seed anchors by priority. Sources the learner has secured drop out.
 * metadata-only sources are excluded unless `includeMetadataOnly` (a parent
 * decision); owned-required sources are never suggested.
 *
 * Expansion candidates are reported separately with an `unlocked` flag: they
 * unlock when every age-eligible seed anchor has at least one recorded lesson.
 */
export function suggestGuidedLearning({
  profile = {},
  manifest,
  portfolio,
  limitPerSubject = 2,
  includeMetadataOnly = false,
}) {
  const age = Number(profile.age) || undefined;
  const progress = sourceProgress(portfolio);

  const suggestible = (source) =>
    SUGGESTIBLE_STATUSES.has(source.local?.status) ||
    (includeMetadataOnly && source.local?.status === "metadata-only");

  const eligibleSeeds = manifest.sourceTexts.filter(
    (source) => suggestible(source) && supportsAge(source, age)
  );

  const subjects = manifest.subjects
    .map((subject) => {
      const suggestions = eligibleSeeds
        .filter((source) => source.subjects.includes(subject.id))
        .filter((source) => masteryIndex(progress.get(source.id)) < MASTERY_STATES.length - 1)
        .sort((a, b) => rankSeed(a, b, progress))
        .slice(0, limitPerSubject)
        .map((source) => ({
          id: source.id,
          title: source.displayTitle || source.title,
          author: source.author,
          role: source.role,
          tier: source.tier,
          started: progress.has(source.id),
          mastery: progress.get(source.id),
          why: source.whyDistilled || source.why,
          guidedPrompts: source.guidedPrompts || [],
          defaultOperations: source.unitShape?.defaultOperations || [],
          local: source.local,
        }));

      return {
        subjectId: subject.id,
        subjectTitle: subject.title,
        schoolLabel: subject.schoolLabel,
        habit: subject.habit,
        suggestions,
      };
    })
    .filter((subject) => subject.suggestions.length > 0);

  const unlocked =
    eligibleSeeds.length > 0 && eligibleSeeds.every((source) => progress.has(source.id));

  const expansion = {
    unlocked,
    completionEvidence: manifest.seedBundle?.completionEvidence || [],
    candidates: (manifest.nearExpansionCandidates || [])
      .filter((candidate) => suggestible(candidate))
      .map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        author: candidate.author,
        addWhen: candidate.addWhen,
        local: candidate.local,
      })),
  };

  return {
    subjects,
    expansion,
    weeklyLoop: manifest.seedBundle?.weeklyLoop || [],
  };
}

/** Highest mastery recorded against each source text across the portfolio. */
function sourceProgress(portfolio) {
  const progress = new Map();
  for (const subject of portfolio?.subjects || []) {
    for (const lesson of subject.lessons || []) {
      for (const sourceTextId of lesson.sourceTextIds || []) {
        const current = progress.get(sourceTextId);
        if (masteryIndex(lesson.mastery) >= masteryIndex(current)) {
          progress.set(sourceTextId, lesson.mastery || MASTERY_STATES[0]);
        }
      }
    }
  }
  return progress;
}

function masteryIndex(state) {
  return MASTERY_STATES.indexOf(state); // -1 = never touched / no mastery yet
}

// "resume-unfinished-seed-anchor" beats starting something new; ties break by
// manifest priority, then title — so suggestions are stable and deliberate.
function rankSeed(a, b, progress) {
  const aStarted = progress.has(a.id) ? 0 : 1;
  const bStarted = progress.has(b.id) ? 0 : 1;
  return (
    aStarted - bStarted ||
    (Number(a.priority) || 999) - (Number(b.priority) || 999) ||
    String(a.displayTitle || a.title).localeCompare(String(b.displayTitle || b.title))
  );
}

/* ---------- prompt digest: the curriculum as the tutor sees it ---------- */

/**
 * A compact, static plain-text digest of the curriculum for the system prompt.
 * Filtered to the learner's age band. Returns "" when nothing applies (e.g. a
 * learner younger than every seed anchor) so callers can simply omit it.
 */
export function buildPromptDigest({ manifest, profile = {} }) {
  const age = Number(profile.age) || undefined;
  const seeds = manifest.sourceTexts.filter((source) => supportsAge(source, age));
  if (seeds.length === 0) return "";

  const bySubject = manifest.subjects
    .map((subject) => {
      const anchors = seeds
        .filter((source) => source.subjects.includes(subject.id))
        .sort((a, b) => (Number(a.priority) || 999) - (Number(b.priority) || 999))
        .map((source) => {
          const usable = SUGGESTIBLE_STATUSES.has(source.local?.status);
          return `  - ${source.displayTitle || source.title} (id: ${source.id})${
            usable ? "" : " [parent must source this first]"
          } — ${source.role || source.whyDistilled || ""}`;
        });
      return anchors.length
        ? `- ${subject.schoolLabel} (${subject.id}): ${subject.habit}\n${anchors.join("\n")}`
        : null;
    })
    .filter(Boolean);

  const operations = (manifest.lessonOperations || [])
    .map((op) => `${op.id} (${op.description})`)
    .join("; ");

  const avoid = (manifest.guidedSuggestionRules?.avoid || [])
    .map((rule) => `- ${rule}`)
    .join("\n");

  const weeklyLoop = (manifest.seedBundle?.weeklyLoop || [])
    .map((item) => `- ${item}`)
    .join("\n");

  return `# Guided curriculum (${manifest.title || manifest.id})

When curiosity needs a direction — especially "what should I learn next?" — draw from
this local curriculum rather than inventing a syllabus. Curiosity still steers; these
are rails, not a cage. Sources by school subject:

${bySubject.join("\n")}

A healthy week mixes:
${weeklyLoop}

Lesson operations to build activities around: ${operations}.

Never:
${avoid}

# The lesson portfolio (lesson-index.json)

Maintain \`lesson-index.json\` in this workspace. After a lesson shows real evidence of
learning (a finish-button report, a narration in their own words), append a record:

  { "lessonId": "<file minus .html>", "file": "lessons/<file>", "title": "...",
    "createdAt": "<ISO date>", "subjects": [{ "id": "<subject id>", "strand": "..." }],
    "sourceTextIds": ["<source id, when the lesson drew on one>"],
    "operationIds": ["narrate" | "ask-why" | "map-or-timeline" | "copy-or-memorize" | "draw-or-demonstrate" | "compare"],
    "evidence": { "type": "quiz|narration|demonstration", "learnerWords": "<their own words>" },
    "mastery": "${MASTERY_STATES.join('" | "')}" }

The top-level shape is { "version": 1, "learnerId": "<id>", "updatedAt": "<ISO date>",
"lessons": [...] }. A generated lesson is NOT a learned lesson — only record it after
evidence. Raise mastery only as evidence accumulates across lessons.`;
}

/* ---------- helpers ---------- */

function supportsAge(source, age) {
  if (!age || !source.ageBand) return true;
  const min = Number(source.ageBand.min) || 0;
  const max = Number(source.ageBand.max) || 99;
  return age >= min && age <= max;
}

function assertUniqueIds(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (!item?.id || typeof item.id !== "string") {
      throw new Error(`${label}: every item needs a string id`);
    }
    if (seen.has(item.id)) throw new Error(`${label}: duplicate id ${item.id}`);
    seen.add(item.id);
  }
}

function stripLessonsPrefix(file) {
  return String(file).replace(/^lessons\//, "");
}
