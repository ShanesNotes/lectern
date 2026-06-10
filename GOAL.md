# Goal: Lectern — a kids' learning companion built on the /teach skill

## The idea

Take the experience of Matt Pocock's [`/teach` skill](https://github.com/mattpocock/skills/tree/main/skills/productivity/teach)
— where Claude acts as a personal tutor and produces beautiful, interactive HTML lessons —
and consolidate it into a single application that kids can open and use on their own.

Today the workflow is: parent runs Claude Code in a terminal, the skill writes HTML
artifacts, and the parent opens them in a browser. Lectern collapses that into one window:

> The kid types in a chat box → the tutor replies in the chat → the HTML lesson appears
> right next to the chat, inside the app.

## Who it's for

- A 9-year-old daughter — reads well, can handle multi-step lessons, quizzes, and projects.
- A 6-year-old son — early reader; needs very short sentences, big text, lots of pictures
  and emoji, and one idea at a time.

Each kid gets their own profile and their own persistent learning workspace, so the tutor
remembers what they've learned across sessions.

## Success looks like

- [ ] Kid picks their profile from a friendly start screen (no logins, no typing names).
- [ ] Kid types "teach me about volcanoes" and sees the tutor's reply stream in live.
- [ ] When the tutor finishes writing a lesson, it automatically appears in the lesson
      panel beside the chat — no terminal, no file manager, no separate browser tab.
- [ ] Past lessons are browsable from a "My Lessons" shelf and reopen instantly.
- [ ] The tutor adapts to each kid's age (reading level, lesson length, tone) and keeps
      per-kid learning records so each session builds on the last (zone of proximal
      development, exactly like the /teach skill).
- [ ] A parent can run the whole thing with: `npm install`, set `ANTHROPIC_API_KEY`,
      `npm start`, open `http://localhost:3000`.

## Architecture

```
┌──────────────────────────── Browser (kid-facing) ───────────────────────────┐
│  Profile picker  →  Chat panel (SSE stream)  │  Lesson panel (iframe)       │
└───────────────────────────────┬──────────────────────────────┬──────────────┘
                                │ POST /api/chat (SSE)         │ GET /workspaces/…
┌───────────────────────────────▼──────────────────────────────▼──────────────┐
│  Node + Express server (server/)                                            │
│   • teacher.js — wraps @anthropic-ai/claude-agent-sdk query()               │
│       - per-kid system prompt derived from the /teach skill, age-adapted    │
│       - cwd = workspaces/<kid>/   (MISSION.md, lessons/, learning-records/) │
│       - session resume per kid (multi-turn memory across server restarts)   │
│       - PostToolUse hook: Write/Edit of lessons/*.html → push "lesson"      │
│         event over SSE so the UI loads it in the iframe immediately         │
│       - PreToolUse hook: deny any file write outside the kid's workspace    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Key decisions:

- **Claude Agent SDK, not raw API.** The /teach skill's value comes from agentic file
  workspace management (lessons, learning records, mission) — the Agent SDK gives us the
  same Read/Write/Edit/Glob/Grep/WebSearch tools Claude Code uses, plus session resume.
- **The /teach methodology is embedded as the system prompt**, adapted per kid: mission
  grounding, zone of proximal development via learning records, retrieval-practice
  quizzes, self-contained beautiful HTML lessons — but with kid-appropriate reading
  levels and no expectation that a 6-year-old articulates a "mission."
- **Workspaces are plain directories** (`workspaces/<kid>/`) using the /teach file
  layout, so a parent can always open them in Claude Code directly and the state is
  fully portable.
- **No build step.** Plain ESM Node server + static vanilla-JS frontend, so it's easy
  to run and easy to tinker with.

## Out of scope (for now)

- Accounts/auth (it runs on the family machine/network).
- Voice input, image upload.
- Parental dashboard (the workspace files *are* the dashboard).
