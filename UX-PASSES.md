# UX Passes: playing Lectern as a 6-year-old and a 9-year-old

Two full simulated passes against the live app (real agent turns, real lessons), one per
kid, before and after the progression redesign. The question under test: **when a lesson
ends, what carries the learner to the next one?**

## Round 1 — the friction (pre-redesign)

### Pass A: Willem, 6

Played: finished the sky-blue quiz → typed "i did it!!! i got them all rite" → typed
"how do they stay on" (trains).

| Moment | What happened | Why it fails a 6-year-old |
|---|---|---|
| Lesson ends | "💬 Got another question? Ask me anything!" | A dead end. He must notice the lesson is over, switch panels, *compose* a question, and type it. Continuation depends entirely on his weakest skill. |
| Quiz finished | Score lives only inside the iframe | The tutor never learns how he did unless he transcribes it — so the learning-record loop (the engine of the /teach method) depends on a 6-year-old's self-report. |
| Tutor offers next steps | "how they move, how they stay on the tracks, or something else?" — prose | Good options, untappable. He has to read, choose, and retype a fragment of it. |
| Mid-turn API hiccup | Turn ended with a retryable error | The harness rails held (error + Try again button) — verified live. |

### Pass B: Hazel, 9

Played: "finished the rainbow one, quiz was pretty easy. what else can you teach me".

| Moment | What happened | Why it falls short at 9 |
|---|---|---|
| Asks "what else" | Tutor wrote a *genuinely great* 3-option menu (sky / electricity / volcanoes) | …as prose. The menu begs to be buttons. She retypes "volcanoes". |
| "quiz was pretty easy" | Pure luck she said it | That's zone-of-proximal-development gold — difficulty calibration should not depend on voluntary self-report. |
| Ambitious lesson request | Animated volcano blew the 6-minute turn budget | Friendly timeout + retry worked, but the budget was wrong for age-9 ambitions. |

### The diagnosis

The chat and the lesson were two rooms with no door between them. Every transition ran
through the keyboard — the highest-friction input a child has. And the tutor was blind
to the learner's performance inside the lesson.

## The design: the lesson hands you the next lesson

**Principle: at every moment, the next step is a single tap, and the most exciting next
step is the biggest thing on screen.** Typing remains available everywhere (curiosity
shouldn't be menu-limited) but is never required after the first question.

Three mechanisms, all verified live in Round 2:

1. **The lesson speaks into the chat** (`lecternAsk` bridge). Sandboxed lessons post
   `{ lectern: "ask", text }` to the app, which sends it as the learner's message.
   The system prompt makes a "What's next?" footer mandatory in every lesson:
   - **One ✅ finish button wired to the real quiz state** — tapping it tells the tutor
     the actual score ("I finished! I got 3 out of 3 on the quiz! 🎉"). Performance
     reporting becomes a tap, and the tutor's learning records get honest evidence.
   - **2-3 "next adventure" buttons**, phrased in the kid's own voice, chosen by the
     tutor to sit in the learner's zone of proximal development.
   Taps landing mid-turn queue (one slot) and send when the tutor finishes.
2. **Chat menus become chips.** When the tutor offers choices it ends the message with
   `» choice` lines; the app renders them as large tappable chips (48px+ targets, gold
   rule, chosen-state). Restored conversations re-arm the chips on the last message, so
   a refresh never strands a decision.
3. **Calibrated budgets.** Turn timeout raised to 10 minutes (age-9 lessons are
   legitimately bigger); prompts now demand lean lesson files (~400 lines) because a
   kid is literally watching the status line while the file is written.

## Round 2 — the loop, observed live

**Willem:** "teach me about the moon!" → tutor replied with three *chips* (no lesson
yet — one playful scoping question, as designed) → tap "Why does it change shape?" →
lesson arrived with a ✅ score button and three next-adventure buttons → tap ✅ ("3 out
of 3") → tutor celebrated, wrote a learning record that also noted his *pattern*
("drawn to 'why does X look the way it does' questions — visual/sky science"), and
offered three new chips. **Zero typing after the first question.** The tutor's chat
reply even instructed "hit the ✅ button when you're done" — the affordance is now part
of the tutor's own mental model.

**Hazel:** "volcanoes!! the animated one" → first attempt hit the old 6-minute timeout
→ friendly error + Try again → retry *resumed the same session* and delivered the
erupting-volcano lesson, footer carrying a score reporter and three deeper paths
(underwater volcanoes / earthquakes / cooled lava). The difficulty signal she once had
to volunteer is now a tap.

## What deliberately stayed simple

- One bridge verb (`ask`). Scores, choices, and follow-ups are all just *messages in
  the learner's voice* — no parallel protocol for the tutor to mishandle, and the chat
  transcript remains a faithful, human-readable record of what happened.
- Chips are a text convention (`» `), not structured output — if the model formats them
  imperfectly, the worst case is plain readable text. Graceful degradation over rigor.
- No lesson-completion tracking UI, no progress bars, no gamification layer. The
  workspace files remain the single source of truth; the /teach method remains the
  curriculum engine.
