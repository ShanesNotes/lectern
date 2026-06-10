// All knobs in one place. Environment is read here and nowhere else.
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

export const config = {
  root: ROOT,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || "0.0.0.0", // reachable from every device in the house
  workspacesDir: process.env.LECTERN_WORKSPACES || path.join(ROOT, "workspaces"),
  profilesFile: path.join(ROOT, "profiles.json"),
  publicDir: path.join(ROOT, "public"),

  // Tutor behavior
  model: process.env.LECTERN_MODEL || undefined, // undefined → Claude Code default
  turnTimeoutMs: 10 * 60 * 1000, // age-9 lessons are legitimately big
  maxTurns: 50,

  // Limits
  messageMaxChars: 2000,
  transcriptLimit: 400, // messages kept per profile
  bodyLimit: "16kb",
  heartbeatMs: 15000,
};
