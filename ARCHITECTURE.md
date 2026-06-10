# Lectern Architecture

A small system with sharp edges in the right places. Two processes talk over two thin
protocols; everything Lectern remembers is plain files.

```
┌─ Browser ────────────────────────────────────────────────────────────┐
│ public/app.js (single-file, no build)                                │
│   chat panel ◄── SSE ──┐            lesson iframe (sandboxed)        │
│   choice chips         │              │ lecternAsk postMessage       │
└────────┬───────────────┴──────────────┴──────────────────────────────┘
         │ HTTP + SSE
┌────────▼─────────────────────────────────────────────────────────────┐
│ server/                                                              │
│   index.js   entry: validate profiles, diagnostics, listen, signals  │
│   app.js     HTTP layer — createApp({profiles, runTurn}), pure       │
│   tutor.js   one agent turn: lock → SDK query → events → persist     │
│   prompt.js  /teach methodology per profile (kid- or adult-flavored) │
│   store.js   ALL filesystem persistence (the only fs in the system)  │
│   config.js  ALL knobs and env (the only process.env in the system)  │
└────────┬─────────────────────────────────────────────────────────────┘
         │ Claude Agent SDK (spawns Claude Code CLI; subscription auth)
┌────────▼─────────────────────────────────────────────────────────────┐
│ workspaces/<profileId>/   — a literal /teach skill workspace         │
│   MISSION.md, NOTES.md, lessons/*.html, learning-records/*.md        │
│   .session.json (agent session id), .chat.json (transcript)          │
└──────────────────────────────────────────────────────────────────────┘
```

## Layers and their rules

| Module | Owns | Must not |
|---|---|---|
| `config.js` | Every knob, every `process.env` read | — |
| `store.js` | Every `fs` call; workspace layout knowledge | Know about HTTP, the SDK, or prompts |
| `prompt.js` | The /teach methodology, per-profile | Do I/O |
| `tutor.js` | The turn lifecycle: lock → query → emit → persist → unlock | Touch `res`/HTTP; read env |
| `app.js` | Routes, SSE framing, heartbeats, abort wiring | Call the SDK directly (gets `runTurn` injected) |
| `index.js` | Process concerns: validation, diagnostics, listen, signals | Contain behavior worth testing |

The injection seam (`createApp({ profiles, runTurn })`) is what makes the HTTP layer
testable with a scripted stub — `npm test` exercises routes, SSE framing, and error
shapes without ever spawning an agent.

## Contract 1: the SSE turn protocol

`POST /api/profiles/:id/chat` streams exactly these events. Every turn ends with
`done`, no matter what happened — the client may rely on it.

| Event | Data | Meaning |
|---|---|---|
| `text` | `{ text }` | Assistant text delta — append to the current bubble |
| `status` | `{ text }` | Quiet tool-activity line ("making your lesson…") |
| `lesson` | `{ file, title, mtime, url }` | A lesson file was written — show it now |
| `error` | `{ message, retryable }` | Friendly failure; `retryable` ⇒ offer Try again |
| `done` | `{}` | Terminal. Always last. |

`: ping` comment lines flow every 15s as heartbeats; SSE parsers ignore them.

## Contract 2: the lecternAsk bridge

Lessons run in `<iframe sandbox="allow-scripts">` — scripts yes, same-origin no. Their
only channel out is `postMessage`. One verb:

```js
parent.postMessage({ lectern: "ask", text: "Can volcanoes erupt underwater? 🌊" }, "*");
```

The app validates `event.source` against the lesson iframe's window (origin is opaque
under this sandbox), truncates to 300 chars, and sends the text as the learner's chat
message. Quiz scores, next-topic choices, and finish reports are all just *messages in
the learner's voice* — one verb, and the transcript stays a faithful human-readable
record. The prompt obligates the tutor to end every lesson with buttons using this
helper (the "What's next?" footer).

Chat-side choices use a text convention, not a protocol: trailing lines starting with
`» ` render as tappable chips and degrade to plain text if malformed.

## Invariants

- **Every turn terminates.** Client disconnect and a 10-minute timeout share one
  `AbortController`, passed into the SDK so the subprocess dies with the turn.
- **One turn per profile at a time** (in-memory lock in `tutor.js`); concurrent sends
  get a friendly, non-retryable error.
- **Writes are confined.** A PreToolUse hook denies any file mutation resolving outside
  the profile's workspace (`store.resolvesInside`); Bash is disallowed entirely.
- **Profile ids are boring by force** (`^[a-z0-9][a-z0-9-]{0,40}$`, validated at boot)
  because they become directory names and URL segments.
- **Dotfiles are never served** from `/workspaces` (session ids, transcripts).

## Deliberate simplicities

These are decisions, not omissions:

- **Plain files over a database.** Kilobyte-scale JSON + HTML for a handful of users;
  the workspace doubles as the /teach skill's native format, so `cd workspaces/hazel
  && claude` works from the terminal against identical state.
- **Synchronous fs in `store.js`.** At this scale it's simpler and cannot interleave.
- **Single-file vanilla frontend, no build step.** ~330 lines is under the threshold
  where modules pay for themselves, and zero toolchain means a parent can read and
  tweak everything.
- **Chips as a text convention.** Worst case is readable text, not a parse failure.

## Testing

`npm test` — `node:test`, no added dependencies.

- `test/store.test.js`: workspace layout, session/transcript round-trips, corruption
  tolerance, transcript cap, `<title>` extraction, the write-confinement predicate.
- `test/app.test.js`: every route's happy path and error shape, SSE event ordering and
  stream termination, dotfile denial, oversized-input truncation — all against a
  stubbed `runTurn`.

What still requires a human (or a real session): the agent turn itself, prompt
behavior, and the browser side of the bridge. Those are exercised by the live passes
documented in `UX-PASSES.md`.
