import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the store at a temp dir BEFORE importing it (config reads env at import).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lectern-test-"));
process.env.LECTERN_WORKSPACES = tmp;
const store = await import("../server/store.js");

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("ensureWorkspace creates the /teach layout", () => {
  const dir = store.ensureWorkspace("kid-a");
  assert.ok(fs.statSync(path.join(dir, "lessons")).isDirectory());
  assert.ok(fs.statSync(path.join(dir, "learning-records")).isDirectory());
});

test("session id round-trips and survives absence", () => {
  assert.equal(store.loadSessionId("kid-a"), undefined);
  store.saveSessionId("kid-a", "sess-123");
  assert.equal(store.loadSessionId("kid-a"), "sess-123");
  assert.equal(store.loadSessionId("never-seen"), undefined);
});

test("transcript appends, survives corruption, and caps length", () => {
  store.ensureWorkspace("kid-b");
  assert.deepEqual(store.loadTranscript("kid-b"), []);

  store.appendTranscript("kid-b", [{ role: "user", text: "hi", t: 1 }]);
  store.appendTranscript("kid-b", [{ role: "tutor", text: "hello!", t: 2 }]);
  const t = store.loadTranscript("kid-b");
  assert.equal(t.length, 2);
  assert.equal(t[1].text, "hello!");

  // Corrupt file → empty transcript, not a crash.
  fs.writeFileSync(path.join(store.workspaceDir("kid-b"), ".chat.json"), "{nope");
  assert.deepEqual(store.loadTranscript("kid-b"), []);

  // Cap: keeps only the newest N entries.
  const many = Array.from({ length: 450 }, (_, i) => ({ role: "user", text: `m${i}`, t: i }));
  store.appendTranscript("kid-b", many);
  const capped = store.loadTranscript("kid-b");
  assert.equal(capped.length, 400);
  assert.equal(capped.at(-1).text, "m449");
});

test("listLessons reads titles from <title> and falls back to slug", () => {
  const dir = store.ensureWorkspace("kid-c");
  fs.writeFileSync(
    path.join(dir, "lessons", "0001-how-magnets-work.html"),
    "<!doctype html><html><head><title>How Magnets Work! 🧲</title></head><body></body></html>"
  );
  fs.writeFileSync(path.join(dir, "lessons", "0002-mystery-topic.html"), "<p>no title tag</p>");
  fs.writeFileSync(path.join(dir, "lessons", "notes.txt"), "ignored");

  const lessons = store.listLessons("kid-c");
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0].title, "How Magnets Work! 🧲");
  assert.equal(lessons[1].title, "Mystery Topic");
  assert.equal(lessons[0].url, "/workspaces/kid-c/lessons/0001-how-magnets-work.html");
  assert.ok(lessons[0].mtime > 0);
});

test("listLessons on a missing workspace returns []", () => {
  assert.deepEqual(store.listLessons("ghost"), []);
});

test("resolvesInside confines writes to the workspace", () => {
  const base = store.workspaceDir("kid-a");
  assert.ok(store.resolvesInside(base, "lessons/0001-x.html"));
  assert.ok(store.resolvesInside(base, path.join(base, "NOTES.md")));
  assert.ok(!store.resolvesInside(base, "../kid-b/lessons/steal.html"));
  assert.ok(!store.resolvesInside(base, "/etc/passwd"));
  assert.ok(!store.resolvesInside(base, ".."));
});
