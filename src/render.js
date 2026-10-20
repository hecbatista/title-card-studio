// The renderer: turns one title card into an MP4 file.
//
// There are two ways ("engines") to do it. Both open card/card.html, move the
// paused GSAP timeline to each frame's exact time, take a picture, and make an
// H.264 MP4 from the pictures. Nothing plays in real time, so a slow computer
// makes the same video as a fast one.
//
// - "webkit" (the default on a Mac): bin/title-cards-render, a small helper
//   program. It uses WebKit (the engine inside Safari) and AVFoundation
//   (Apple's video library), which come with macOS. Nothing to download.
// - "chrome": a private copy of Chrome (Puppeteer, about 570 MB, downloaded
//   the first time) and ffmpeg (from Homebrew). Use it with --engine chrome,
//   or on computers that are not Macs.

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cardQuery, normalizeCard } from "./card-options.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const TOOL_DIR = path.resolve(here, "..");
const CARD_PAGE = path.join(TOOL_DIR, "card", "card.html");
const HELPER = path.join(TOOL_DIR, "bin", "title-cards-render");

export const ENGINES = ["webkit", "chrome"];

export function defaultEngine() {
  const chosen = process.env.TITLE_CARDS_ENGINE;
  if (chosen) {
    if (!ENGINES.includes(chosen)) throw new Error(`Unknown engine "${chosen}". Use webkit or chrome.`);
    return chosen;
  }
  return process.platform === "darwin" && existsSync(HELPER) ? "webkit" : "chrome";
}

/**
 * Get ready to render cards with one engine.
 * @param {{engine?: "webkit" | "chrome"}} [opts]
 * @returns {Promise<{engine: string, render: Function, close: () => Promise<void>}>}
 *   render(card, outFile, {fps, onProgress}) makes one MP4.
 */
export async function openRenderer({ engine = defaultEngine() } = {}) {
  if (engine === "webkit") {
    if (process.platform !== "darwin") throw new Error("The webkit engine only works on a Mac. Use --engine chrome.");
    return { engine, render: renderWithWebKit, close: async () => {} };
  }
  if (engine === "chrome") {
    await ensureChrome();
    const browser = await launchChrome();
    return {
      engine,
      render: (card, outFile, opts) => renderWithChrome(browser, card, outFile, opts),
      close: () => browser.close(),
    };
  }
  throw new Error(`Unknown engine "${engine}". Use webkit or chrome.`);
}

// ---------------------------------------------------------------------------
// The "webkit" engine: run the helper and read its "frame 12/135" lines.

async function renderWithWebKit(rawCard, outFile, { fps = 30, onProgress } = {}) {
  const card = normalizeCard(rawCard);
  await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
  const helper = spawn(
    HELPER,
    ["--page", CARD_PAGE, "--root", TOOL_DIR, "--query", cardQuery(card), "--out", path.resolve(outFile), "--fps", String(fps)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let errors = "";
  helper.stderr.on("data", (d) => (errors += d));
  let total = 0;
  createInterface({ input: helper.stdout }).on("line", (line) => {
    const m = line.match(/^frame (\d+)\/(\d+)$/);
    if (m) {
      total = Number(m[2]);
      onProgress?.(Number(m[1]), total);
    }
  });
  const code = await new Promise((resolve, reject) => {
    helper.on("error", (err) =>
      reject(new Error(`Could not start the WebKit helper (${err.message}). Try --engine chrome.`)),
    );
    helper.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(errors.trim().replace(/^title-cards-render: /, "") || `The WebKit helper failed (code ${code})`);
  }
  return { file: outFile, frames: total, fps, card };
}

// ---------------------------------------------------------------------------
// The "chrome" engine: Puppeteer screenshots piped into ffmpeg.

export function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  for (const p of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]) {
    if (existsSync(p)) return p;
  }
  return "ffmpeg"; // hope it is on the PATH
}

export function hasFfmpeg() {
  return spawnSync(findFfmpeg(), ["-version"], { stdio: "ignore" }).status === 0;
}

// Download the private Chrome the first time the chrome engine is used.
export async function ensureChrome() {
  const { default: puppeteer } = await import("puppeteer");
  let chrome = "";
  try {
    chrome = await puppeteer.executablePath(); // a promise in new Puppeteer versions
  } catch {}
  if (chrome && existsSync(chrome)) return;
  console.log("Downloading the private copy of Chrome that draws the cards (one time, about 570 MB)…");
  const { downloadBrowsers } = await import("puppeteer/internal/node/install.js");
  await downloadBrowsers();
}

async function launchChrome() {
  const { default: puppeteer } = await import("puppeteer");
  return puppeteer.launch({
    headless: true,
    args: [
      "--force-color-profile=srgb", // the same colors on every Mac screen
      "--hide-scrollbars",
      "--disable-gpu", // software drawing: the same pixels every time
    ],
  });
}

// Encoder settings, chosen so the soft glow does not turn into rings ("banding"):
// - The color conversion (RGB to video YUV) is done at 16 bits and then
//   dithered back to 8 bits ("sws_dither=ed"). Plain conversion rounds the
//   colors and makes visible steps.
// - "-tune grain" and a low CRF (high quality) keep the faint film grain.
function ffmpegArgs(fps, outFile) {
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
    "-vf", "format=rgb48le,scale=out_color_matrix=bt709:out_range=tv:sws_dither=ed,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "grain",
    "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-r", String(fps),
    "-movflags", "+faststart",
    outFile,
  ];
}

async function renderWithChrome(browser, rawCard, outFile, { fps = 30, onProgress } = {}) {
  const card = normalizeCard(rawCard);
  await mkdir(path.dirname(outFile), { recursive: true });

  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const url = `${pathToFileURL(CARD_PAGE).href}?${cardQuery(card)}`;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__cardReady === true, { polling: 100, timeout: 15000 });

    const total = Math.round(card.duration * fps);

    const ffmpeg = spawn(findFfmpeg(), ffmpegArgs(fps, outFile), { stdio: ["pipe", "ignore", "pipe"] });
    let ffmpegErrors = "";
    ffmpeg.stderr.on("data", (d) => (ffmpegErrors += d));
    const finished = new Promise((resolve, reject) => {
      ffmpeg.on("error", (err) =>
        reject(new Error(`Could not start ffmpeg (${err.message}). Install it with: brew install ffmpeg`)),
      );
      ffmpeg.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg failed (code ${code}): ${ffmpegErrors.trim()}`)),
      );
    });
    finished.catch(() => {}); // the error is reported by "await finished" below
    ffmpeg.stdin.on("error", () => {}); // a closed pipe means ffmpeg stopped; "finished" says why
    const write = async (buf) => {
      if (ffmpeg.exitCode !== null) await finished;
      // Wait when ffmpeg is busy, or stop if ffmpeg quits.
      if (!ffmpeg.stdin.write(buf)) await Promise.race([once(ffmpeg.stdin, "drain"), finished]);
    };

    // One throwaway picture first, so images (the grain) are fully decoded.
    await page.screenshot({ type: "png" });

    try {
      for (let i = 0; i < total; i++) {
        await page.evaluate((t) => {
          window.__timelines["title-card"].seek(t, false);
        }, i / fps);
        const png = await page.screenshot({ type: "png", optimizeForSpeed: true });
        await write(png);
        onProgress?.(i + 1, total);
      }
    } finally {
      ffmpeg.stdin.end();
    }
    await finished;
    return { file: outFile, frames: total, fps, card };
  } finally {
    await page.close();
  }
}
