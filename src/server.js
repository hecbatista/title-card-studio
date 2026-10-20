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
import { pathToFileURL } from "node:url";
import { normalizeCard, slugify } from "./card-options.js";
import { openRenderer, TOOL_DIR } from "./render.js";

const PORT = Number(process.env.PORT) || 4321;
// The "title-cards" command sets TITLE_CARDS_OUT (a folder in Movies).
const OUT_DIR = process.env.TITLE_CARDS_OUT || path.join(TOOL_DIR, "out");

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

// ---- Rendering: one at a time. The renderer stays ready between cards. ----
// The engine comes from TITLE_CARDS_ENGINE (webkit or chrome), or the default.
let rendererPromise = null;
const getRenderer = () => (rendererPromise ??= openRenderer());
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
  const job = { id, status: "waiting", done: 0, total: Math.round(card.duration * fps), file, folder: OUT_DIR, error: null };
  jobs.set(id, job);
  queue = queue.then(async () => {
    job.status = "rendering";
    try {
      const renderer = await getRenderer();
      await renderer.render(card, path.join(OUT_DIR, file), {
        fps,
        onProgress: (done, total) => Object.assign(job, { done, total }),
      });
      job.status = "done";
      console.log(`Saved out/${file}`);
    } catch (err) {
      job.status = "error";
      job.error = err.message;
      console.error(`Render failed: ${err.message}`);
      const old = rendererPromise;
      rendererPromise = null; // start fresh next time
      old?.then((r) => r.close()).catch(() => {});
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

// Start listening. Resolves with the address to open in the browser.
export function startServer() {
  const url = `http://localhost:${PORT}`;
  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code !== "EADDRINUSE") return reject(err);
      console.log(`\n  Port ${PORT} is busy. Title Card Studio is probably open already: ${url}`);
      console.log(`  If that page is not Title Card Studio, start on another port: PORT=4400 title-cards\n`);
      resolve(url);
    });
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`\n  Title Card Studio is running: ${url}\n  Videos are saved in ${OUT_DIR}\n  Press Ctrl+C to stop.\n`);
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      resolve(url);
    });
  });
}

async function shutdown() {
  server.close();
  if (rendererPromise) await (await rendererPromise.catch(() => null))?.close();
  process.exit(0);
}

// "npm start" runs this file directly ("npm start -- --engine chrome" also works).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--engine");
  if (i !== -1) process.env.TITLE_CARDS_ENGINE = process.argv[i + 1] ?? "";
  startServer();
}
