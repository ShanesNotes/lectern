const $ = (id) => document.getElementById(id);

let profile = null;
let busy = false;
let lastSent = null; // for the "try again" affordance
let currentLessonFile = null;

init();

async function init() {
  let profiles;
  try {
    profiles = await fetch("/api/profiles").then((r) => r.json());
  } catch {
    document.body.innerHTML =
      '<p style="margin:40px;text-align:center;font-style:italic">Lectern’s server isn’t reachable. Start it with <code>npm start</code> and reload.</p>';
    return;
  }

  const cards = $("kid-cards");
  for (const p of profiles) {
    const btn = document.createElement("button");
    btn.className = "medallion";
    btn.innerHTML = `<span class="emblem">${p.emoji}</span>
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="role">${p.adult ? "grown-up" : `age ${p.age}`}</span>`;
    btn.onclick = () => pickProfile(p);
    cards.appendChild(btn);
  }

  // Remember the last learner so a refresh drops straight back in.
  const last = profiles.find((p) => p.id === localStorage.getItem("lectern-profile"));
  if (last) pickProfile(last);
}

async function pickProfile(p) {
  profile = p;
  localStorage.setItem("lectern-profile", p.id);
  $("kid-label").textContent = `${p.emoji} ${p.name}`;
  $("picker").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("messages").innerHTML = "";
  hideShelf();
  showLesson(null);

  // Restore the conversation and the last lesson they were looking at.
  let history = [];
  try {
    history = await fetch(`/api/profiles/${p.id}/history`).then((r) => r.json());
  } catch { /* a fresh chat is an acceptable fallback */ }

  let lastLesson = null;
  for (const m of history.slice(-40)) {
    addMsg(m.role === "user" ? "kid" : "tutor", m.text);
    for (const lesson of m.lessons || []) lastLesson = lesson;
  }
  if (!history.length) {
    addMsg("tutor", `Hi ${p.name}! ${p.emoji} What do you want to learn about today?`);
  }

  if (!lastLesson) {
    const lessons = await fetchLessons().catch(() => []);
    lastLesson = lessons[lessons.length - 1] || null;
  }
  if (lastLesson) showLesson(lastLesson);
  $("chat-input").focus();
}

$("switch-kid").onclick = () => {
  localStorage.removeItem("lectern-profile");
  location.reload();
};

$("chat-form").onsubmit = (e) => {
  e.preventDefault();
  if (busy || !profile) return;
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  sendMessage(text);
};

async function sendMessage(text) {
  busy = true;
  lastSent = text;
  $("send-btn").disabled = true;
  addMsg("kid", text);

  const typing = addMsg("tutor", "");
  typing.classList.add("typing");
  let gotText = false;
  let statusEl = null;

  try {
    const res = await fetch(`/api/profiles/${profile.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    for await (const { event, data } of sseEvents(res.body)) {
      if (event === "text") {
        if (!gotText) { typing.classList.remove("typing"); gotText = true; }
        if (statusEl) { statusEl.remove(); statusEl = null; }
        typing.textContent += data.text;
        scrollChat();
      } else if (event === "status") {
        if (!statusEl) statusEl = addMsg("status", "");
        statusEl.textContent = data.text;
        scrollChat();
      } else if (event === "lesson") {
        showLesson(data, { celebrate: true });
      } else if (event === "error") {
        showError(data.message, data.retryable);
      }
    }
  } catch {
    showError("Couldn’t reach the tutor. Check the server, then try again.", true);
  } finally {
    typing.classList.remove("typing");
    if (!typing.textContent) typing.remove();
    if (statusEl) statusEl.remove();
    busy = false;
    $("send-btn").disabled = false;
    $("chat-input").focus();
  }
}

function showError(message, retryable) {
  const el = addMsg("error", message);
  if (retryable && lastSent) {
    const again = document.createElement("button");
    again.className = "retry-btn";
    again.textContent = "Try again";
    const failed = lastSent;
    again.onclick = () => {
      el.remove();
      if (!busy) sendMessage(failed);
    };
    el.appendChild(again);
    scrollChat();
  }
}

/* ---------- SSE over fetch ---------- */
async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
        // lines starting with ":" are heartbeats — ignored by design
      }
      if (data) yield { event, data: JSON.parse(data) };
    }
  }
}

/* ---------- Lesson panel ---------- */
function showLesson(lesson, { celebrate } = {}) {
  const frame = $("lesson-frame");
  const empty = $("lesson-empty");
  hideShelf();
  if (!lesson) {
    currentLessonFile = null;
    $("lesson-title").textContent = "";
    frame.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  currentLessonFile = lesson.file;
  $("lesson-title").textContent = lesson.title || "";
  empty.classList.add("hidden");
  frame.classList.remove("hidden");
  // Cache-bust: Edit may rewrite the same file mid-turn.
  frame.src = lesson.url + "?t=" + Date.now();
  if (celebrate) {
    const holder = $("lesson-holder");
    holder.classList.remove("arrived");
    void holder.offsetWidth;
    holder.classList.add("arrived");
  }
}

async function fetchLessons() {
  return fetch(`/api/profiles/${profile.id}/lessons`).then((r) => r.json());
}

$("shelf-btn").onclick = async () => {
  const shelf = $("shelf");
  if (!shelf.classList.contains("hidden")) return hideShelf();
  let lessons = [];
  try { lessons = await fetchLessons(); } catch { /* show empty shelf */ }
  shelf.innerHTML = "";
  if (!lessons.length) {
    shelf.innerHTML = `<p class="shelf-empty">No lessons yet — ask for one.</p>`;
  }
  for (const lesson of lessons.slice().reverse()) {
    const item = document.createElement("button");
    item.className = "shelf-item" + (lesson.file === currentLessonFile ? " current" : "");
    item.innerHTML = `<span>${escapeHtml(lesson.title)}</span>` +
      (lesson.mtime ? `<span class="when">${formatWhen(lesson.mtime)}</span>` : "");
    item.onclick = () => showLesson(lesson);
    shelf.appendChild(item);
  }
  shelf.classList.remove("hidden");
};

function hideShelf() {
  $("shelf").classList.add("hidden");
}

function formatWhen(ms) {
  const d = new Date(ms);
  const days = (Date.now() - ms) / 86400000;
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ---------- Chat helpers ---------- */
function addMsg(kind, text) {
  const el = document.createElement("div");
  el.className = `msg ${kind}`;
  el.textContent = text;
  $("messages").appendChild(el);
  scrollChat();
  return el;
}

function scrollChat() {
  const m = $("messages");
  m.scrollTop = m.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
