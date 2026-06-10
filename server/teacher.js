import { query } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import { buildSystemPrompt } from "./prompt.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WORKSPACES = path.join(ROOT, "workspaces");

export function workspaceDir(kidId) {
  return path.join(WORKSPACES, kidId);
}

export function ensureWorkspace(kid) {
  const dir = workspaceDir(kid.id);
  fs.mkdirSync(path.join(dir, "lessons"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning-records"), { recursive: true });
  return dir;
}

function sessionFile(kidId) {
  return path.join(workspaceDir(kidId), ".session.json");
}

function loadSessionId(kidId) {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(kidId), "utf8")).sessionId;
  } catch {
    return undefined;
  }
}

function saveSessionId(kidId, sessionId) {
  fs.writeFileSync(sessionFile(kidId), JSON.stringify({ sessionId }));
}

export function listLessons(kidId) {
  const dir = path.join(workspaceDir(kidId), "lessons");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
  } catch {
    return [];
  }
  return files
    .sort()
    .map((f) => ({
      file: f,
      title: titleFromFilename(f),
      url: `/workspaces/${kidId}/lessons/${f}`,
    }));
}

function titleFromFilename(f) {
  return f
    .replace(/\.html$/, "")
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Friendly labels for tool activity, shown in the chat while the tutor works.
const TOOL_STATUS = {
  WebSearch: "🔎 Looking things up…",
  WebFetch: "📖 Reading a source…",
  Write: "✏️ Making something for you…",
  Edit: "✏️ Polishing…",
  Read: "📂 Checking my notes…",
  Glob: "📂 Checking my notes…",
  Grep: "📂 Checking my notes…",
};

/**
 * Run one chat turn for a kid. Emits events via the `emit` callback:
 *   emit("text",   { text })            — streamed assistant text delta
 *   emit("status", { text })            — friendly tool-activity status line
 *   emit("lesson", { url, title, file })— a lesson file was written/updated
 *   emit("done",   { })                 — turn finished
 *   emit("error",  { message })
 */
export async function chatTurn(kid, userMessage, emit, { signal } = {}) {
  const cwd = ensureWorkspace(kid);
  const resume = loadSessionId(kid.id);

  // Deny any file mutation outside this kid's workspace.
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

  // Surface freshly written lessons to the UI the moment they exist.
  const announceLessons = async (input) => {
    const target = input.tool_input?.file_path;
    if (!target) return {};
    const abs = path.resolve(cwd, String(target));
    const lessonsDir = path.join(cwd, "lessons") + path.sep;
    if (abs.startsWith(lessonsDir) && abs.endsWith(".html")) {
      const file = path.basename(abs);
      emit("lesson", {
        file,
        title: titleFromFilename(file),
        url: `/workspaces/${kid.id}/lessons/${file}`,
      });
    }
    return {};
  };

  let sessionId = resume;

  try {
    for await (const message of query({
      prompt: userMessage,
      options: {
        cwd,
        resume,
        model: process.env.LECTERN_MODEL || undefined,
        systemPrompt: buildSystemPrompt(kid),
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
      if (signal?.aborted) break;

      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }

      if (message.type === "stream_event") {
        const event = message.event;
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
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
          emit("error", { message: `The tutor hit a snag (${message.subtype}). Try again!` });
        }
        break;
      }
    }

    if (sessionId) saveSessionId(kid.id, sessionId);
    emit("done", {});
  } catch (err) {
    console.error("chatTurn failed:", err);
    emit("error", { message: "Something went wrong talking to the tutor. Try again!" });
    emit("done", {});
  }
}
