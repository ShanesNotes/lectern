import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatTurn, ensureWorkspace, listLessons, loadTranscript } from "./teacher.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0"; // reachable from every device in the house

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
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(ROOT, "public")));

// Lesson HTML (and anything else in a workspace) is served read-only.
app.use("/workspaces", express.static(path.join(ROOT, "workspaces"), { dotfiles: "deny" }));

const findProfile = (req, res) => {
  const profile = profiles.find((p) => p.id === req.params.id);
  if (!profile) res.status(404).json({ error: "unknown profile" });
  return profile;
};

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/profiles", (_req, res) => {
  res.json(
    profiles.map(({ id, name, age, adult, emoji, color }) => ({
      id, name, age, adult: !!adult, emoji, color,
    }))
  );
});

app.get("/api/profiles/:id/lessons", (req, res) => {
  const profile = findProfile(req, res);
  if (profile) res.json(listLessons(profile.id));
});

app.get("/api/profiles/:id/history", (req, res) => {
  const profile = findProfile(req, res);
  if (profile) res.json(loadTranscript(profile.id));
});

// One chat turn, streamed back as Server-Sent Events.
app.post("/api/profiles/:id/chat", async (req, res) => {
  const profile = findProfile(req, res);
  if (!profile) return;

  const text = String(req.body?.message || "").slice(0, 2000).trim();
  if (!text) return res.status(400).json({ error: "empty message" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const emit = (event, data) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Keep the stream alive through proxies and sleepy wifi.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15000);

  // Cancel the turn (and the agent subprocess) if the browser goes away.
  // (Must watch the response — req "close" fires once the body arrives on Node 15+.)
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    await chatTurn(profile, text, emit, abort);
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// JSON for unknown API routes; never leak stack traces.
app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));
app.use((err, _req, res, _next) => {
  console.error("server error:", err);
  if (!res.headersSent) res.status(500).json({ error: "server error" });
  else res.end();
});

const server = app.listen(PORT, HOST, () => {
  console.log(`\n📖 Lectern is ready!`);
  console.log(`   This machine:  http://localhost:${PORT}`);
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal);
  if (lan) console.log(`   Around the house:  http://${lan.address}:${PORT}`);
  console.log(
    `\n   Profiles: ${profiles
      .map((p) => `${p.emoji} ${p.name}${p.adult ? "" : ` (${p.age})`}`)
      .join("   ")}\n`
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n✖ Port ${PORT} is already in use. Is Lectern already running?\n` +
        `  Start on another port with: PORT=${PORT + 1} npm start\n`
    );
    process.exit(1);
  }
  throw err;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log("\n📖 Lectern closing up. Bye!");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
