// The Title Card Studio page: live preview + "Download MP4".

const form = document.getElementById("form");
const frame = document.getElementById("frame");
const stage = document.getElementById("stage");
const playBtn = document.getElementById("play");
const scrub = document.getElementById("scrub");
const timeLabel = document.getElementById("time");
const downloadBtn = document.getElementById("download");
const progress = document.getElementById("progress");
const statusEl = document.getElementById("status");
const hint = document.getElementById("hint");

// ---- Read the form ----
function readForm() {
  const d = new FormData(form);
  return {
    label: d.get("label"),
    title: d.get("title"),
    subtitle: d.get("subtitle"),
    theme: d.get("theme"),
    chomp: d.get("chomp") === "on",
    duration: Number(d.get("duration")),
    fps: Number(d.get("fps")),
  };
}

function cardQuery(c) {
  return new URLSearchParams({
    label: c.label,
    title: c.title,
    subtitle: c.subtitle,
    theme: c.theme,
    chomp: c.chomp ? "yes" : "no",
    duration: String(c.duration),
  }).toString();
}

// ---- Preview ----
// The card page is always 1920x1080; scale it down to fit the box.
function fitFrame() {
  frame.style.transform = `scale(${stage.clientWidth / 1920})`;
}
new ResizeObserver(fitFrame).observe(stage);

let timeline = null;
let lastQuery = "";

function loadPreview() {
  const card = readForm();
  const query = cardQuery(card);
  showHints(card);
  if (query === lastQuery) return;
  lastQuery = query;
  timeline = null;
  scrub.max = String(card.duration);
  frame.src = `/card/card.html?${query}&autoplay=1`;
}

frame.addEventListener("load", () => {
  const win = frame.contentWindow;
  const attach = () => {
    timeline = win.__timelines["title-card"];
    setPlaying(true);
  };
  if (win.__cardReady) attach();
  else win.addEventListener("card-ready", attach, { once: true });
});

function setPlaying(on) {
  if (!timeline) return;
  if (on) timeline.play();
  else timeline.pause();
  playBtn.textContent = on ? "❚❚" : "▶";
  playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
}
playBtn.addEventListener("click", () => setPlaying(timeline?.paused()));

scrub.addEventListener("input", () => {
  if (!timeline) return;
  setPlaying(false);
  timeline.time(Number(scrub.value));
});

(function tick() {
  if (timeline) {
    const t = Math.min(timeline.time(), Number(scrub.max));
    if (!timeline.paused()) scrub.value = String(t);
    timeLabel.textContent = `${Number(scrub.value).toFixed(1)} s`;
  }
  requestAnimationFrame(tick);
})();

function showHints(card) {
  const typingEnds = (card.chomp ? 1.4 : 1.0) + card.title.length * 0.075;
  const msgs = [];
  if (typingEnds > card.duration - 1.5) msgs.push("This title is long for the card length. Try a longer Length so it can be read.");
  if (!card.title.trim()) msgs.push("Add a title.");
  hint.textContent = msgs.join(" ");
  hint.hidden = msgs.length === 0;
}

let typingTimer = null;
form.addEventListener("input", () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(loadPreview, 250);
});

// ---- Download ----
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const card = readForm();
  if (!card.title.trim()) return;
  downloadBtn.disabled = true;
  statusEl.className = "status";
  statusEl.textContent = "Starting…";
  progress.hidden = false;
  progress.firstElementChild.style.width = "0%";
  try {
    let res = await fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(card),
    });
    let job = await res.json();
    if (!res.ok) throw new Error(job.error || "Could not start the render");
    while (job.status === "waiting" || job.status === "rendering") {
      await new Promise((r) => setTimeout(r, 400));
      res = await fetch(`/api/jobs/${job.id}`);
      job = await res.json();
      const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
      progress.firstElementChild.style.width = `${pct}%`;
      statusEl.textContent = job.status === "waiting" ? "Waiting for the last render to finish…" : `Making frames… ${job.done} of ${job.total}`;
    }
    if (job.status !== "done") throw new Error(job.error || "The render failed");
    progress.firstElementChild.style.width = "100%";
    const url = `/out/${encodeURIComponent(job.file)}`;
    const a = document.createElement("a");
    a.href = `${url}?download=1`;
    a.download = job.file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    statusEl.innerHTML = "";
    statusEl.append("Done. A copy of ");
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.textContent = job.file;
    statusEl.append(link, ` is also saved in ${job.folder}`);
  } catch (err) {
    statusEl.className = "status error";
    statusEl.textContent = `${err.message}. Look at the terminal for details.`;
  } finally {
    downloadBtn.disabled = false;
    setTimeout(() => (progress.hidden = true), 1500);
  }
});

loadPreview();
