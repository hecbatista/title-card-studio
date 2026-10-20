// The local web server for Title Card Studio.
//   npm start   then open http://localhost:4321
//
// It does three things:
// - serves the web page (ui/) and the card page (card/) to your browser,
// - starts a render when you click "Download MP4" (POST /api/render),
// - reports progress (GET /api/jobs/<id>) and serves the finished file (/out/...).
// It only listens on your own computer (127.0.0.1), not on the network.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { normalizeCard, slugify } from "./card-options.js";
import { launchBrowser, renderCard, TOOL_DIR } from "./render.js";

const PORT = Number(process.env.PORT) || 4321;
const OUT_DIR = path.join(TOOL_DIR, "out");

// Only these folders can be read from the browser.
const PUBLIC = {
  "/ui/": path.join(TOOL_DIR, "ui"),
  "/card/": path.join(TOOL_DIR, "card"),
  "/node_modules/gsap/": path.join(TOOL_DIR, "node_modules", "gsap"),
  "/node_modules/@fontsource/inter/": path.join(TOOL_DIR, "node_modules", "@fontsource", "inter"),
  "/out/": OUT_DIR,
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
};

// ---- Rendering: one at a time, with one browser kept open. ----
let browserPromise = null;
const getBrowser = () => (browserPromise ??= launchBrowser());
const jobs = new Map();
let queue = Promise.resolve();
let nextId = 1;

function startJob(rawCard, fps) {
  const card = normalizeCard(rawCard);
  const id = String(nextId++);
  const now = new Date();
  const two = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const file = `${slugify(card.title)}-${card.theme}-${stamp}.mp4`;
  const job = { id, status: "waiting", done: 0, total: Math.round(card.duration * fps), file, error: null };
  jobs.set(id, job);
  queue = queue.then(async () => {
    job.status = "rendering";
    try {
      const browser = await getBrowser();
      await renderCard(browser, card, path.join(OUT_DIR, file), {
        fps,
        onProgress: (done, total) => Object.assign(job, { done, total }),
      });
      job.status = "done";
      console.log(`Saved out/${file}`);
    } catch (err) {
      job.status = "error";
      job.error = err.message;
      console.error(`Render failed: ${err.message}`);
      browserPromise = null; // start a fresh browser next time
    }
  });
  return job;
}

// ---- HTTP helpers ----
function sendJson(res, code, data) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Request too large");
  }
  return JSON.parse(body || "{}");
}

async function serveFile(req, res, pathname) {
  const prefix = Object.keys(PUBLIC).find((p) => pathname.startsWith(p));
  if (!prefix) return false;
  const root = PUBLIC[prefix];
  const file = path.normalize(path.join(root, decodeURIComponent(pathname.slice(prefix.length))));
  if (!file.startsWith(root + path.sep)) return false; // no "../" tricks
  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  const headers = { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": info.size };
  if (prefix === "/out/" && new URL(req.url, "http://x").searchParams.has("download")) {
    headers["content-disposition"] = `attachment; filename="${path.basename(file)}"`;
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && pathname === "/") {
      res.writeHead(302, { location: "/ui/" });
      return res.end();
    }
    if (req.method === "POST" && pathname === "/api/render") {
      const body = await readJson(req);
      const job = startJob(body, Number(body.fps) === 60 ? 60 : 30);
      return sendJson(res, 202, job);
    }
    const jobMatch = pathname.match(/^\/api\/jobs\/(\d+)$/);
    if (req.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: "No such job" });
    }
    if (req.method === "GET" && (await serveFile(req, res, pathname.endsWith("/") ? pathname + "index.html" : pathname))) {
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Title Card Studio is running: http://localhost:${PORT}\n  Videos are saved in ${OUT_DIR}\n  Press Ctrl+C to stop.\n`);
});

async function shutdown() {
  server.close();
  if (browserPromise) await (await browserPromise.catch(() => null))?.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
