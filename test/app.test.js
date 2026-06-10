import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lectern-app-test-"));
process.env.LECTERN_WORKSPACES = tmp;

const { createApp } = await import("../server/app.js");
const store = await import("../server/store.js");

const profiles = [
  { id: "hazel", name: "Hazel", age: 9, emoji: "🦊", color: "#7c5cff" },
  { id: "dad", name: "Dad", adult: true, emoji: "🦉", color: "#3867d6" },
];

// Stub tutor: scripted events, no SDK, no network.
async function stubRunTurn(profile, text, emit) {
  emit("status", { text: "making your lesson…" });
  emit("text", { text: `You said: ${text}` });
  emit("lesson", { file: "0001-x.html", title: "X", mtime: 1, url: `/workspaces/${profile.id}/lessons/0001-x.html` });
  emit("done", {});
}

let server, base;

before(async () => {
  for (const p of profiles) store.ensureWorkspace(p.id);
  const app = createApp({ profiles, runTurn: stubRunTurn });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("health and profiles endpoints", async () => {
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });

  const got = await (await fetch(`${base}/api/profiles`)).json();
  assert.equal(got.length, 2);
  assert.deepEqual(got[1], { id: "dad", name: "Dad", adult: true, emoji: "🦉", color: "#3867d6" });
});

test("unknown profile is a JSON 404 on every route", async () => {
  for (const url of ["/api/profiles/ghost/lessons", "/api/profiles/ghost/history"]) {
    const res = await fetch(`${base}${url}`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "unknown profile" });
  }
  const res = await fetch(`${base}/api/profiles/ghost/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
  });
  assert.equal(res.status, 404);
});

test("empty and whitespace messages are rejected", async () => {
  for (const message of ["", "   "]) {
    const res = await fetch(`${base}/api/profiles/hazel/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    assert.equal(res.status, 400);
  }
});

test("chat streams the SSE protocol in order and ends the stream", async () => {
  const res = await fetch(`${base}/api/profiles/hazel/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "teach me!" }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);

  const raw = await res.text(); // resolves only because the server ends the stream
  const events = [...raw.matchAll(/^event: (\w+)\ndata: (.*)$/gm)].map(
    ([, event, data]) => ({ event, data: JSON.parse(data) })
  );
  assert.deepEqual(
    events.map((e) => e.event),
    ["status", "text", "lesson", "done"]
  );
  assert.equal(events[1].data.text, "You said: teach me!");
  assert.equal(events[2].data.file, "0001-x.html");
});

test("unknown API routes return JSON, not HTML", async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not found" });
});

test("workspace dotfiles are not served", async () => {
  store.saveSessionId("hazel", "secret-session");
  const res = await fetch(`${base}/workspaces/hazel/.session.json`);
  assert.notEqual(res.status, 200);
});

test("oversized message is truncated server-side, not fatal", async () => {
  const res = await fetch(`${base}/api/profiles/hazel/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "x".repeat(5000) }),
  });
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.match(raw, /event: done/);
});
