// Entry point: process concerns only — load and validate config/profiles,
// startup diagnostics, listen, signals. All behavior lives in app.js and below.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { ensureWorkspace } from "./store.js";
import { runTurn } from "./tutor.js";

/* ---------- profiles: validate loudly, fail with what-to-do ---------- */

function loadProfiles() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(config.profilesFile, "utf8"));
  } catch (err) {
    console.error(`✖ Couldn't read ${config.profilesFile}: ${err.message}`);
    process.exit(1);
  }
  const profiles = parsed?.profiles;
  if (!Array.isArray(profiles) || !profiles.length) {
    console.error('✖ profiles.json must contain { "profiles": [ ... ] } with at least one profile.');
    process.exit(1);
  }
  const seen = new Set();
  for (const p of profiles) {
    // id becomes a directory name and a URL segment — keep it strictly boring.
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(p.id || "")) {
      console.error(`✖ profiles.json: bad id ${JSON.stringify(p.id)} — use lowercase letters, digits, dashes.`);
      process.exit(1);
    }
    if (seen.has(p.id)) {
      console.error(`✖ profiles.json: duplicate id "${p.id}".`);
      process.exit(1);
    }
    seen.add(p.id);
    if (!p.name) {
      console.error(`✖ profiles.json: profile "${p.id}" needs a name.`);
      process.exit(1);
    }
    if (!p.adult && !(Number.isFinite(p.age) && p.age >= 3 && p.age <= 17)) {
      console.error(`✖ profiles.json: profile "${p.id}" needs an age (3-17), or "adult": true.`);
      process.exit(1);
    }
  }
  return profiles;
}

/* ---------- auth diagnostics ---------- */
// The Agent SDK launches the Claude Code CLI, which uses your existing Claude Code
// login (subscription) — no API key needed. Headless machines can use a token from
// `claude setup-token` via CLAUDE_CODE_OAUTH_TOKEN instead.

function checkAuth() {
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
}

/* ---------- boot ---------- */

const profiles = loadProfiles();
checkAuth();
for (const p of profiles) ensureWorkspace(p.id);

const app = createApp({ profiles, runTurn });

const server = app.listen(config.port, config.host, () => {
  console.log(`\n📖 Lectern is ready!`);
  console.log(`   This machine:  http://localhost:${config.port}`);
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal);
  if (lan) console.log(`   Around the house:  http://${lan.address}:${config.port}`);
  console.log(
    `\n   Profiles: ${profiles
      .map((p) => `${p.emoji ?? ""} ${p.name}${p.adult ? "" : ` (${p.age})`}`.trim())
      .join("   ")}\n`
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n✖ Port ${config.port} is already in use. Is Lectern already running?\n` +
        `  Start on another port with: PORT=${config.port + 1} npm start\n`
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
