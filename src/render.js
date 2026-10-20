// The renderer: turns one title card into an MP4 file.
//
// How it works:
// 1. A headless Chrome (no window) opens card/card.html at 1920x1080.
// 2. For every frame, we move the paused GSAP timeline to that exact time
//    and take a screenshot. Nothing plays in real time, so a slow computer
//    makes the same video as a fast one.
// 3. The screenshots go straight into ffmpeg, which makes an H.264 MP4.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import { cardQuery, normalizeCard } from "./card-options.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const TOOL_DIR = path.resolve(here, "..");
const CARD_PAGE = path.join(TOOL_DIR, "card", "card.html");

export function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  for (const p of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]) {
    if (existsSync(p)) return p;
  }
  return "ffmpeg"; // hope it is on the PATH
}

export function launchBrowser() {
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

/**
 * Render one card to an MP4.
 * @param {import("puppeteer").Browser} browser  from launchBrowser()
 * @param {object} rawCard  label, title, subtitle, chomp, theme, duration
 * @param {string} outFile  where to write the .mp4
 * @param {{fps?: number, onProgress?: (done: number, total: number) => void}} [opts]
 */
export async function renderCard(browser, rawCard, outFile, { fps = 30, onProgress } = {}) {
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
