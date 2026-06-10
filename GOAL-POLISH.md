# Goal: Polish Pass — package Lectern like it's shipping

The prototype works. This pass treats Lectern as if it were being professionally
deployed to its production environment: a family. Robustness and user experience take
priority over features. The harness should be simple, calm, and intuitively designed —
the /teach skill's HTML lessons do the visual grunt work; the app around them is the
quiet, well-made frame.

## UI/UX reference: symbolic-world

The design language comes from [ShanesNotes/symbolic-world](https://github.com/ShanesNotes/symbolic-world)
— a "symbolic illuminated design" system. The principles adopted for Lectern's harness:

- **The page is an object.** The app is a bounded, placed page on warm paper — not
  components floating in a generic responsive grid. Panels are fields with borders;
  the header is a plaque; quiet space is charged, not empty.
- **Ornament behaves.** A border or accent appears only when it does a job: the gold
  left rule on the lesson panel marks "where the work appears"; a brief gold pulse
  announces a new lesson; the status line is a small italic witness to what the tutor
  is doing. No decoration without duty.
- **Materials remember.** Palette from the canon: paper `#fbf6ea`, ink `#201c18`,
  muted `#6b6255`, oxblood `#7f1f2b`, deep blue `#243f64`, gold `#a77c2c`, line
  `#d8cab1`. Georgia/serif for the shell. Restrained beauty with consequence.
- **Symbols have jobs.** Profile medallions, the lesson shelf, the status line — each
  mark guides, witnesses, or keeps; nothing is garnish.

The candy-colored Comic Sans shell goes away. Kid-friendliness is preserved through
*scale and clarity* (large type, big touch targets, instant feedback), not through
clutter — and the lessons themselves remain as playful as each kid's prompt dictates.

## User stories

### Reliability — "it never loses my stuff"

1. **As a kid**, if I refresh the page or the laptop sleeps, my conversation and my
   lesson are still there when I come back.
   *Accept: chat transcript persists server-side per profile; reload restores the
   conversation and reopens the last lesson.*
2. **As a kid**, if something goes wrong mid-answer, I see a friendly message and a
   "try again" affordance — never a frozen screen or a spinner that spins forever.
   *Accept: every turn ends in a terminal state (reply, friendly error, or timeout);
   the input always re-enables.*
3. **As a parent**, two kids using it at the same time can't tangle each other's
   sessions — and one kid double-clicking "Go" can't tangle their own.
   *Accept: per-profile turn lock; a second message during a turn gets a gentle
   "still working on the last one" rather than a corrupted session.*
4. **As a parent**, a runaway turn can't run forever.
   *Accept: server-side timeout aborts the agent subprocess (SDK abortController)
   and tells the user; closing the browser tab also cancels the turn.*
5. **As a parent**, the server is a good citizen: clean startup diagnostics, JSON
   errors (never stack traces) to the client, graceful Ctrl-C shutdown, and a
   health endpoint.

### Experience — "it feels considered"

6. **As a kid**, I always know what the tutor is doing: thinking, looking things up,
   or making my lesson — shown quietly, in words I understand.
7. **As a kid**, when my lesson is ready it announces itself clearly (gold pulse,
   shelf updates) without yanking me away from the chat.
8. **As Willem (6)**, the buttons and text are big enough that I can use it without
   help.
9. **As a user on the family tablet or a phone**, the layout adapts and nothing is
   unreachable.
10. **As a user**, I can flip through every lesson I've ever made from the shelf,
    titled properly (from the lesson's own `<title>`), newest first, with the open
    one marked.

### Packaging — "it deploys to the family"

11. **As a parent**, I run `npm start` on one machine and every device in the house
    can use it — the server binds to the LAN and prints the address to share.
12. **As a parent**, startup tells me immediately if auth is missing or the port is
    taken, in words that say what to do next.

## Out of scope (deliberately)

Accounts/passwords, HTTPS, Docker, databases, PWA/offline, analytics, lesson editing.
The workspace directories remain the database; the /teach skill remains the curriculum
engine. Simplicity is the robustness strategy.
