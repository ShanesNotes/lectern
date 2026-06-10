import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatTurn, ensureWorkspace, listLessons } from "./teacher.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = process.env.PORT || 3000;

// Auth: the Agent SDK launches the Claude Code CLI, which uses your existing
// Claude Code login (subscription) — no API key needed. Headless machines can
// use a token from `claude setup-token` via CLAUDE_CODE_OAUTH_TOKEN instead.
const hasLogin =
  fs.existsSync(path.join(os.homedir(), ".claude", ".credentials.json")) ||
  process.env.CLAUDE_CODE_OAUTH_TOKEN ||
  process.platform === "darwin"; // macOS stores credentials in the Keychain
if (process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "\n⚠️  ANTHROPIC_API_KEY is set, so the tutor will bill API credits instead of\n" +
      "   using your Claude subscription. Unset it to use your Claude Code login.\n"
  );
} else if (!hasLogin) {
  console.warn(
    "\n⚠️  No Claude credentials found. Either log into Claude Code first\n" +
      "   (run `claude`, then /login), or create a long-lived token with\n" +
      "   `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN.\n"
  );
}

const profiles = JSON.parse(
  fs.readFileSync(path.join(ROOT, "profiles.json"), "utf8")
).profiles;
for (const profile of profiles) ensureWorkspace(profile);

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, "public")));

// Lesson HTML (and anything else in a workspace) is served read-only.
app.use("/workspaces", express.static(path.join(ROOT, "workspaces")));

app.get("/api/profiles", (_req, res) => {
  res.json(
    profiles.map(({ id, name, age, adult, emoji, color }) => ({
      id, name, age, adult: !!adult, emoji, color,
    }))
  );
});

app.get("/api/profiles/:id/lessons", (req, res) => {
  const profile = profiles.find((p) => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: "unknown profile" });
  res.json(listLessons(profile.id));
});

// One chat turn, streamed back as Server-Sent Events.
app.post("/api/profiles/:id/chat", async (req, res) => {
  const profile = profiles.find((p) => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: "unknown profile" });

  const text = String(req.body?.message || "").slice(0, 2000).trim();
  if (!text) return res.status(400).json({ error: "empty message" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const emit = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Stop the turn if the browser goes away. (Must watch the response/socket —
  // req "close" fires as soon as the request body is received on Node 15+.)
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  await chatTurn(profile, text, emit, { signal: abort.signal });
  res.end();
});

app.listen(PORT, () => {
  console.log(`\n📖 Lectern is ready!  →  http://localhost:${PORT}\n`);
  console.log(
    `   Profiles: ${profiles
      .map((p) => `${p.emoji} ${p.name}${p.adult ? "" : ` (${p.age})`}`)
      .join("   ")}\n`
  );
});
