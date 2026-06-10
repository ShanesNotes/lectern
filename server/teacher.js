import { query } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import { buildSystemPrompt } from "./prompt.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WORKSPACES = path.join(ROOT, "workspaces");

const TURN_TIMEOUT_MS = 10 * 60 * 1000;
const TRANSCRIPT_LIMIT = 400; // messages kept per profile

export function workspaceDir(profileId) {
  return path.join(WORKSPACES, profileId);
}

export function ensureWorkspace(profile) {
  const dir = workspaceDir(profile.id);
  fs.mkdirSync(path.join(dir, "lessons"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning-records"), { recursive: true });
  return dir;
}

/* ---------- session persistence ---------- */

function sessionFile(profileId) {
  return path.join(workspaceDir(profileId), ".session.json");
}

function loadSessionId(profileId) {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(profileId), "utf8")).sessionId;
  } catch {
    return undefined;
  }
}

function saveSessionId(profileId, sessionId) {
  fs.writeFileSync(sessionFile(profileId), JSON.stringify({ sessionId }));
}

/* ---------- chat transcript persistence ---------- */

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

function appendTranscript(profileId, entries) {
  const messages = [...loadTranscript(profileId), ...entries].slice(-TRANSCRIPT_LIMIT);
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

function lessonInfo(profileId, absPath) {
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

function titleFromFilename(f) {
  return f
    .replace(/\.html$/, "")
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---------- turn lock ---------- */

const activeTurns = new Set();

export function isBusy(profileId) {
  return activeTurns.has(profileId);
}

/* ---------- the chat turn ---------- */

// Friendly labels for tool activity, shown quietly in the chat while the tutor works.
const TOOL_STATUS = {
  WebSearch: "looking things up…",
  WebFetch: "reading a source…",
  Write: "making your lesson…",
  Edit: "polishing…",
  Read: "checking notes…",
  Glob: "checking notes…",
  Grep: "checking notes…",
};

/**
 * Run one chat turn for a profile. Emits events via the `emit` callback:
 *   emit("text",   { text })                    — streamed assistant text delta
 *   emit("status", { text })                    — tool-activity status line
 *   emit("lesson", { url, title, file, mtime }) — a lesson file was written/updated
 *   emit("done",   { })                         — turn finished
 *   emit("error",  { message, retryable })
 *
 * `abort` is an AbortController: aborted when the client disconnects. A server-side
 * timeout also aborts it. The controller is passed to the SDK so the agent subprocess
 * is actually terminated, not orphaned.
 */
export async function chatTurn(profile, userMessage, emit, abort = new AbortController()) {
  if (activeTurns.has(profile.id)) {
    emit("error", {
      message: "One moment — I'm still working on your last message!",
      retryable: false,
    });
    emit("done", {});
    return;
  }
  activeTurns.add(profile.id);

  const cwd = ensureWorkspace(profile);
  const resume = loadSessionId(profile.id);

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, TURN_TIMEOUT_MS);

  // Deny any file mutation outside this profile's workspace.
  const guardWrites = async (input) => {
    const target = input.tool_input?.file_path;
    if (target && !path.resolve(cwd, String(target)).startsWith(cwd + path.sep)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Files may only be written inside this workspace.",
        },
      };
    }
    return {};
  };

  const lessonsTouched = [];

  // Surface freshly written lessons to the UI the moment they exist.
  const announceLessons = async (input) => {
    const target = input.tool_input?.file_path;
    if (!target) return {};
    const abs = path.resolve(cwd, String(target));
    const lessonsDir = path.join(cwd, "lessons") + path.sep;
    if (abs.startsWith(lessonsDir) && abs.endsWith(".html")) {
      const lesson = lessonInfo(profile.id, abs);
      lessonsTouched.push(lesson);
      emit("lesson", lesson);
    }
    return {};
  };

  let sessionId = resume;
  let assistantText = "";

  try {
    for await (const message of query({
      prompt: userMessage,
      options: {
        cwd,
        resume,
        abortController: abort,
        model: process.env.LECTERN_MODEL || undefined,
        systemPrompt: buildSystemPrompt(profile),
        allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
        disallowedTools: ["Bash", "Agent", "AskUserQuestion"],
        // acceptEdits + allowedTools auto-approves everything the tutor needs
        // without prompts ("bypassPermissions" is refused when running as root).
        permissionMode: "acceptEdits",
        includePartialMessages: true,
        maxTurns: 50,
        settingSources: [],
        hooks: {
          PreToolUse: [{ matcher: "Write|Edit", hooks: [guardWrites] }],
          PostToolUse: [{ matcher: "Write|Edit", hooks: [announceLessons] }],
        },
      },
    })) {
      if (abort.signal.aborted) break;

      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }

      if (message.type === "stream_event") {
        const event = message.event;
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          assistantText += event.delta.text;
          emit("text", { text: event.delta.text });
        }
        if (
          event.type === "content_block_start" &&
          event.content_block?.type === "tool_use"
        ) {
          const label = TOOL_STATUS[event.content_block.name];
          if (label) emit("status", { text: label });
        }
      }

      if (message.type === "result") {
        sessionId = message.session_id || sessionId;
        if (message.subtype !== "success") {
          emit("error", {
            message: "The tutor hit a snag there. Try sending that again!",
            retryable: true,
          });
        }
        break;
      }
    }

    if (timedOut) {
      emit("error", {
        message: "That one took too long and I had to stop. Try asking again!",
        retryable: true,
      });
    }
  } catch (err) {
    // AbortError is expected on disconnect/timeout; anything else is a real failure.
    if (!abort.signal.aborted) {
      console.error(`[${profile.id}] chatTurn failed:`, err);
      emit("error", {
        message: "Something went wrong talking to the tutor. Try again!",
        retryable: true,
      });
    }
  } finally {
    clearTimeout(timeout);
    activeTurns.delete(profile.id);
    if (sessionId) saveSessionId(profile.id, sessionId);

    // Persist the exchange so a page refresh restores the conversation.
    try {
      const now = Date.now();
      const entries = [{ role: "user", text: userMessage, t: now }];
      if (assistantText) {
        entries.push({
          role: "tutor",
          text: assistantText,
          lessons: dedupeLessons(lessonsTouched),
          t: now,
        });
      }
      appendTranscript(profile.id, entries);
    } catch (err) {
      console.error(`[${profile.id}] transcript save failed:`, err);
    }

    emit("done", {});
  }
}

function dedupeLessons(lessons) {
  return [...new Map(lessons.map((l) => [l.file, l])).values()];
}
