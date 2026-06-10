# 📖 Lectern

A family learning companion built on the methodology of the
[`/teach` skill](https://github.com/mattpocock/skills/tree/main/skills/productivity/teach).

You (or your kid) type in a chat box. A Claude tutor chats back, researches real facts,
and writes a **beautiful, interactive HTML lesson** that appears instantly in a panel
right beside the chat — no terminal, no separate browser tabs.

Docs: `GOAL.md` (original design) · `GOAL-POLISH.md` (polish-pass user stories) ·
`UX-PASSES.md` (kid playtests) · `ARCHITECTURE.md` (system design + protocols).
Run the test suite with `npm test`. The harness UI follows the "symbolic illuminated design" language from
[ShanesNotes/symbolic-world](https://github.com/ShanesNotes/symbolic-world) — a calm,
bounded page on warm paper that stays out of the way and lets the lessons do the work.

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3000**, pick a profile, and ask for a lesson:

> "teach me about volcanoes!" 🌋

The server also binds to your LAN and prints an `http://192.168.x.x:3000` address on
startup — open that from the kids' tablet or any device in the house. Conversations and
lessons persist per profile, so refreshing the page (or coming back tomorrow) drops you
right back where you left off.

Requirements: Node 18+ and a machine where you're logged into Claude Code.

## Auth: uses your Claude subscription, not API credits

Lectern runs on the **Claude Agent SDK**, which launches the Claude Code CLI under the
hood — so it authenticates exactly like your terminal does:

1. **Already use Claude Code on this machine?** You're done. Lectern picks up your
   existing login automatically. No API key, no extra billing — it draws from your
   Claude subscription's usage limits like any Claude Code session.
2. **Fresh machine / headless box?** Run `claude` once and `/login`, or create a
   long-lived token with `claude setup-token` and export it as `CLAUDE_CODE_OAUTH_TOKEN`.
3. **Don't set `ANTHROPIC_API_KEY`** — if it's set, it takes precedence and bills
   pay-as-you-go API credits. The server warns you on startup if it sees one.

## Profiles

Three profiles ship out of the box — edit `profiles.json` to taste:

```json
{
  "profiles": [
    { "id": "dad",    "name": "Dad",    "adult": true, "emoji": "🦉", "color": "#3867d6" },
    { "id": "hazel",  "name": "Hazel",  "age": 9,      "emoji": "🦊", "color": "#7c5cff" },
    { "id": "willem", "name": "Willem", "age": 6,      "emoji": "🐸", "color": "#00b894" }
  ]
}
```

Each profile gets its **own workspace, own lessons, own learning records, and own
resumable tutor session** — progress and portfolios never mix.

- **Kids** get the age-adapted tutor: Willem (6) gets huge text, emoji answer choices,
  and 3-minute lessons; Hazel (9) gets real mechanisms, diagrams, and proper quizzes.
- **Adults** (`"adult": true`) get the full /teach methodology: mission interviews,
  curated `RESOURCES.md` with citations, reference docs and glossaries alongside
  lessons, and learning records that drive spaced, interleaved practice.

## How it works

- Each profile has a persistent **workspace** at `workspaces/<id>/` using the /teach
  skill's file layout:
  - `MISSION.md` — what they're currently curious about (or, for adults, the real
    /teach mission format)
  - `lessons/*.html` — every lesson ever made (browsable from the 📚 shelf in the app)
  - `learning-records/*.md` — what they've genuinely understood, so each session teaches
    the *next* thing, not the same thing
  - `NOTES.md` — the tutor's notes on how this learner likes to learn
- Sessions **resume automatically** — the tutor remembers the conversation across
  messages and server restarts, separately per profile.
- When the agent writes a lesson file, a hook pushes it to the browser over SSE and the
  lesson appears immediately.
- Safety rails: the agent has no Bash access, can only write inside the active profile's
  workspace, lessons render in a sandboxed iframe, and the kid prompts enforce
  age-appropriate content.

Because workspaces are plain /teach-style directories, you can also open one in Claude
Code yourself (`cd workspaces/hazel && claude`) and teach from the terminal — same
state, two doors.

## Options

| Env var | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Web server port. |
| `LECTERN_MODEL` | Claude Code default | Override the model, e.g. `claude-sonnet-4-6`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Subscription token from `claude setup-token` (for machines without an interactive login). |
