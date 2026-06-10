import express from "express";
import fs from "node:fs";
import path from "node:path";
import { chatTurn, ensureWorkspace, listLessons, workspaceDir } from "./teacher.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = process.env.PORT || 3000;

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "\n⚠️  ANTHROPIC_API_KEY is not set. The tutor won't be able to respond.\n" +
      "   Get a key at https://platform.claude.com and run:\n" +
      "   ANTHROPIC_API_KEY=sk-ant-... npm start\n"
  );
}

const kids = JSON.parse(fs.readFileSync(path.join(ROOT, "kids.json"), "utf8")).kids;
for (const kid of kids) ensureWorkspace(kid);

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, "public")));

// Lesson HTML (and anything else in a workspace) is served read-only.
app.use("/workspaces", express.static(path.join(ROOT, "workspaces")));

app.get("/api/kids", (_req, res) => {
  res.json(kids.map(({ id, name, age, emoji, color }) => ({ id, name, age, emoji, color })));
});

app.get("/api/kids/:id/lessons", (req, res) => {
  const kid = kids.find((k) => k.id === req.params.id);
  if (!kid) return res.status(404).json({ error: "unknown kid" });
  res.json(listLessons(kid.id));
});

// One chat turn, streamed back as Server-Sent Events.
app.post("/api/kids/:id/chat", async (req, res) => {
  const kid = kids.find((k) => k.id === req.params.id);
  if (!kid) return res.status(404).json({ error: "unknown kid" });

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

  await chatTurn(kid, text, emit, { signal: abort.signal });
  res.end();
});

app.listen(PORT, () => {
  console.log(`\n📖 Lectern is ready!  →  http://localhost:${PORT}\n`);
  console.log(`   Kids: ${kids.map((k) => `${k.emoji} ${k.name} (${k.age})`).join("   ")}`);
  console.log(`   Workspaces: ${workspaceDir("<kid>")}\n`);
});
