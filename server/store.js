// Workspace persistence. Everything Lectern remembers lives in plain files under
// workspaces/<profileId>/ in the /teach skill's layout, so a parent can open any
// workspace in Claude Code directly. This module is the only code that touches them.
//
// Deliberately synchronous fs: at family scale (a handful of users, kilobyte files)
// sync I/O is simpler to reason about and impossible to interleave incorrectly.

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export function workspaceDir(profileId) {
  return path.join(config.workspacesDir, profileId);
}

export function ensureWorkspace(profileId) {
  const dir = workspaceDir(profileId);
  fs.mkdirSync(path.join(dir, "lessons"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning-records"), { recursive: true });
  return dir;
}

/** True if `target` (relative or absolute) resolves inside `baseDir`. */
export function resolvesInside(baseDir, target) {
  return path.resolve(baseDir, String(target)).startsWith(baseDir + path.sep);
}

/* ---------- agent session (multi-turn memory) ---------- */

function sessionFile(profileId) {
  return path.join(workspaceDir(profileId), ".session.json");
}

export function loadSessionId(profileId) {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(profileId), "utf8")).sessionId;
  } catch {
    return undefined;
  }
}

export function saveSessionId(profileId, sessionId) {
  fs.writeFileSync(sessionFile(profileId), JSON.stringify({ sessionId }));
}

/* ---------- chat transcript (refresh-proof conversations) ---------- */

function transcriptFile(profileId) {
  return path.join(workspaceDir(profileId), ".chat.json");
}

export function loadTranscript(profileId) {
  try {
    const messages = JSON.parse(fs.readFileSync(transcriptFile(profileId), "utf8"));
    return Array.isArray(messages) ? messages : [];
  } catch {
    return [];
  }
}

export function appendTranscript(profileId, entries) {
  const messages = [...loadTranscript(profileId), ...entries].slice(
    -config.transcriptLimit
  );
  fs.writeFileSync(transcriptFile(profileId), JSON.stringify(messages));
}

/* ---------- lessons ---------- */

export function listLessons(profileId) {
  const dir = path.join(workspaceDir(profileId), "lessons");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
  } catch {
    return [];
  }
  return files.sort().map((f) => lessonInfo(profileId, path.join(dir, f)));
}

export function lessonInfo(profileId, absPath) {
  const file = path.basename(absPath);
  let title = titleFromFilename(file);
  let mtime = null;
  try {
    mtime = fs.statSync(absPath).mtimeMs;
    // Prefer the lesson's own <title> — the tutor names lessons better than slugs do.
    const head = fs.readFileSync(absPath, "utf8").slice(0, 2048);
    const m = head.match(/<title>([^<]{1,120})<\/title>/i);
    if (m) title = m[1].trim();
  } catch {
    // file may be mid-write; the slug title is fine
  }
  return { file, title, mtime, url: `/workspaces/${profileId}/lessons/${file}` };
}

export function titleFromFilename(f) {
  return f
    .replace(/\.html$/, "")
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
