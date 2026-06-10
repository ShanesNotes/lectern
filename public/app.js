const $ = (id) => document.getElementById(id);

let kid = null;
let busy = false;

init();

async function init() {
  const kids = await fetch("/api/kids").then((r) => r.json());
  const cards = $("kid-cards");
  for (const k of kids) {
    const btn = document.createElement("button");
    btn.className = "kid-card";
    btn.style.setProperty("--kid-color", k.color);
    btn.innerHTML = `<span class="emoji">${k.emoji}</span>
      <span class="name">${escapeHtml(k.name)}</span>
      <span class="age">age ${k.age}</span>`;
    btn.onclick = () => pickKid(k);
    cards.appendChild(btn);
  }

  // Remember last kid so a refresh doesn't lose the session.
  const lastId = localStorage.getItem("lectern-kid");
  const last = kids.find((k) => k.id === lastId);
  if (last) pickKid(last);
}

async function pickKid(k) {
  kid = k;
  localStorage.setItem("lectern-kid", k.id);
  $("kid-label").textContent = `${k.emoji} ${k.name}`;
  $("picker").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("messages").innerHTML = "";
  hideShelf();
  showLesson(null);
  addMsg("tutor", `Hi ${k.name}! ${k.emoji} What do you want to learn about today?`);

  // If they already have lessons, reopen the latest one.
  const lessons = await fetchLessons();
  if (lessons.length) showLesson(lessons[lessons.length - 1]);
  $("chat-input").focus();
}

$("switch-kid").onclick = () => {
  localStorage.removeItem("lectern-kid");
  location.reload();
};

$("chat-form").onsubmit = async (e) => {
  e.preventDefault();
  if (busy || !kid) return;
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  sendMessage(text);
};

async function sendMessage(text) {
  busy = true;
  $("send-btn").disabled = true;
  addMsg("kid", text);

  const typing = addMsg("tutor", "");
  typing.classList.add("typing");
  let gotText = false;
  let statusEl = null;

  try {
    const res = await fetch(`/api/kids/${kid.id}/chat`, {
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
        addMsg("error", data.message);
      }
    }
  } catch {
    addMsg("error", "Oops — couldn't reach the tutor. Is the server running?");
  } finally {
    typing.classList.remove("typing");
    if (!typing.textContent) typing.remove();
    if (statusEl) statusEl.remove();
    busy = false;
    $("send-btn").disabled = false;
    $("chat-input").focus();
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
    frame.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  frame.classList.remove("hidden");
  // Cache-bust: Edit may rewrite the same file mid-turn.
  frame.src = lesson.url + "?t=" + Date.now();
  if (celebrate) {
    const holder = $("lesson-holder");
    holder.classList.remove("flash");
    void holder.offsetWidth;
    holder.classList.add("flash");
  }
}

async function fetchLessons() {
  return fetch(`/api/kids/${kid.id}/lessons`).then((r) => r.json());
}

$("shelf-btn").onclick = async () => {
  const shelf = $("shelf");
  if (!shelf.classList.contains("hidden")) return hideShelf();
  const lessons = await fetchLessons();
  shelf.innerHTML = "";
  if (!lessons.length) {
    shelf.innerHTML = `<p class="shelf-empty">No lessons yet — ask for one! 🎈</p>`;
  }
  for (const lesson of lessons.slice().reverse()) {
    const item = document.createElement("button");
    item.className = "shelf-item";
    item.textContent = `📄 ${lesson.title}`;
    item.onclick = () => showLesson(lesson);
    shelf.appendChild(item);
  }
  shelf.classList.remove("hidden");
};

function hideShelf() {
  $("shelf").classList.add("hidden");
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
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
