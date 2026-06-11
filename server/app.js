// HTTP layer. createApp() is pure wiring — no listening, no process concerns —
// so tests can mount it with a stubbed runTurn and never touch the real agent.

import express from "express";
import { config } from "./config.js";
import * as store from "./store.js";
import * as education from "./education.js";

export function createApp({ profiles, runTurn }) {
  // Load the curriculum once; a broken/missing manifest degrades the portfolio
  // route to 503 but must never take down chat.
  let manifest = null;
  try {
    manifest = education.loadCurriculumManifest();
  } catch (err) {
    console.error("curriculum manifest unavailable:", err.message);
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(express.static(config.publicDir));

  // Lesson HTML (and anything else in a workspace) is served read-only.
  app.use(
    "/workspaces",
    express.static(config.workspacesDir, { dotfiles: "deny" })
  );

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
    if (profile) res.json(store.listLessons(profile.id));
  });

  // The learner's portfolio: lessons grouped by school subject, plus guided
  // "what next" suggestions from the local curriculum manifest. Read-only.
  app.get("/api/profiles/:id/portfolio", (req, res) => {
    const profile = findProfile(req, res);
    if (!profile) return;
    if (!manifest) return res.status(503).json({ error: "curriculum unavailable" });

    const portfolio = education.buildLessonPortfolio({
      manifest,
      lessons: store.listLessons(profile.id),
      lessonIndex: store.loadLessonIndex(profile.id),
    });
    const suggestions = education.suggestGuidedLearning({ profile, manifest, portfolio });
    res.json({ portfolio, suggestions });
  });

  app.get("/api/profiles/:id/history", (req, res) => {
    const profile = findProfile(req, res);
    if (profile) res.json(store.loadTranscript(profile.id));
  });

  // One chat turn, streamed back as Server-Sent Events (see ARCHITECTURE.md).
  app.post("/api/profiles/:id/chat", async (req, res) => {
    const profile = findProfile(req, res);
    if (!profile) return;

    const text = String(req.body?.message || "")
      .slice(0, config.messageMaxChars)
      .trim();
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
    }, config.heartbeatMs);

    // Cancel the turn (and the agent subprocess) if the browser goes away.
    // (Must watch the response — req "close" fires once the body arrives on Node 15+.)
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    try {
      await runTurn(profile, text, emit, abort);
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

  return app;
}
