# 📖 Lectern

A learning companion for kids, built on the methodology of the
[`/teach` skill](https://github.com/mattpocock/skills/tree/main/skills/productivity/teach).

Your kid types in a chat box. A Claude tutor chats back, researches real facts, and writes
a **beautiful, interactive HTML lesson** that appears instantly in a panel right beside
the chat — no terminal, no separate browser tabs.

![How it works](GOAL.md) — see `GOAL.md` for the full design.

## Quick start

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Then open **http://localhost:3000**, pick a kid, and ask for a lesson:

> "teach me about volcanoes!" 🌋

Requirements: Node 18+, an Anthropic API key from https://platform.claude.com.

## Set up your kids

Edit `kids.json` with your kids' real names, ages, and favorite emoji:

```json
{
  "kids": [
    { "id": "maya", "name": "Maya", "age": 9, "emoji": "🦊", "color": "#7c5cff" },
    { "id": "leo",  "name": "Leo",  "age": 6, "emoji": "🐸", "color": "#00b894" }
  ]
}
```

The tutor adapts everything to each kid's age — reading level, lesson length, quiz
difficulty, and tone. The 6-year-old gets huge text, emoji answers, and 3-minute lessons;
the 9-year-old gets real mechanisms, diagrams, and proper quizzes.

## How it works

- The server uses the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) to run a
  tutor agent with the same tools Claude Code has (Read, Write, Edit, WebSearch, …).
- Each kid gets a persistent **workspace** at `workspaces/<kid>/` using the /teach
  skill's file layout:
  - `MISSION.md` — what they're currently curious about
  - `lessons/*.html` — every lesson ever made (browsable from the 📚 shelf in the app)
  - `learning-records/*.md` — what they've genuinely understood, so each session teaches
    the *next* thing, not the same thing
  - `NOTES.md` — the tutor's notes on how your kid likes to learn
- Sessions **resume automatically** — the tutor remembers the conversation across
  messages and server restarts.
- When the agent writes a lesson file, a hook pushes it to the browser over SSE and the
  lesson pans into view immediately.
- Safety rails: the agent has no Bash access, can only write inside the kid's own
  workspace, lessons render in a sandboxed iframe, and the system prompt enforces
  kid-appropriate content.

Because workspaces are plain /teach-style directories, you can also open one in Claude
Code yourself (`cd workspaces/maya && claude`) and teach from the terminal — same state,
two doors.

## Options

| Env var | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. API key for the tutor. |
| `PORT` | `3000` | Web server port. |
| `LECTERN_MODEL` | SDK default | Override the model, e.g. `claude-sonnet-4-6` to lower cost. |
