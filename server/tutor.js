// Agent orchestration: one chat turn through the Claude Agent SDK.
// Persistence lives in store.js; prompts in prompt.js; HTTP in app.js.
// This module owns the turn lifecycle: lock → run → emit events → persist → unlock.

import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { config } from "./config.js";
import { buildSystemPrompt } from "./prompt.js";
import { loadCurriculumManifest, buildPromptDigest } from "./education.js";
import * as store from "./store.js";

// The curriculum manifest is static for the life of the process. If it's broken
// or absent the tutor simply teaches without a guided spine — never fatal.
let curriculumManifest = null;
try {
  curriculumManifest = loadCurriculumManifest();
} catch (err) {
  console.error("tutor: curriculum manifest unavailable:", err.message);
}

function curriculumDigestFor(profile) {
  if (!curriculumManifest || profile.adult) return "";
  try {
    return buildPromptDigest({ manifest: curriculumManifest, profile });
  } catch {
    return "";
  }
}

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

const activeTurns = new Set();

export function isBusy(profileId) {
  return activeTurns.has(profileId);
}

/**
 * Run one chat turn for a profile. Emits SSE-shaped events via `emit(event, data)` —
 * see ARCHITECTURE.md → "SSE protocol" for the contract.
 *
 * `abort` is an AbortController: aborted when the client disconnects. A server-side
 * timeout also aborts it. The controller is passed to the SDK so the agent subprocess
 * is actually terminated, not orphaned. Every call ends by emitting "done".
 */
export async function runTurn(profile, userMessage, emit, abort = new AbortController()) {
  if (activeTurns.has(profile.id)) {
    emit("error", {
      message: "One moment — I'm still working on your last message!",
      retryable: false,
    });
    emit("done", {});
    return;
  }
  activeTurns.add(profile.id);

  const cwd = store.ensureWorkspace(profile.id);
  const resume = store.loadSessionId(profile.id);

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, config.turnTimeoutMs);

  // Deny any file mutation outside this profile's workspace.
  const guardWrites = async (input) => {
    const target = input.tool_input?.file_path;
    if (target && !store.resolvesInside(cwd, target)) {
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
      const lesson = store.lessonInfo(profile.id, abs);
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
        model: config.model,
        systemPrompt: buildSystemPrompt(profile, curriculumDigestFor(profile)),
        allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
        disallowedTools: ["Bash", "Agent", "AskUserQuestion"],
        // acceptEdits + allowedTools auto-approves everything the tutor needs
        // without prompts ("bypassPermissions" is refused when running as root).
        permissionMode: "acceptEdits",
        includePartialMessages: true,
        maxTurns: config.maxTurns,
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
      console.error(`[${profile.id}] turn failed:`, err);
      emit("error", {
        message: "Something went wrong talking to the tutor. Try again!",
        retryable: true,
      });
    }
  } finally {
    clearTimeout(timeout);
    activeTurns.delete(profile.id);
    if (sessionId) store.saveSessionId(profile.id, sessionId);

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
      store.appendTranscript(profile.id, entries);
    } catch (err) {
      console.error(`[${profile.id}] transcript save failed:`, err);
    }

    emit("done", {});
  }
}

function dedupeLessons(lessons) {
  return [...new Map(lessons.map((l) => [l.file, l])).values()];
}
