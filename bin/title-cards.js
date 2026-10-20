#!/usr/bin/env node
// The "title-cards" command. After a one-time install
//   npm install -g github:hecbatista/title-card-studio
// an officer types:
//   title-cards              start the tool and open it in the browser
//   title-cards batch [file] make one MP4 for every row of a CSV file
//   title-cards help         show this help
//
// On a Mac it uses the small WebKit helper (bin/title-cards-render), so there
// is nothing else to install. With --engine chrome it uses a private Chrome
// and ffmpeg instead, and installs them the first time.

import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.env.TITLE_CARDS_OUT || path.join(os.homedir(), "Movies", "FirstByte Title Cards");
process.env.TITLE_CARDS_OUT = OUT_DIR;

// Take out the options this file handles: --no-open and --engine.
const args = process.argv.slice(2);
let noOpen = false;
const kept = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--no-open") noOpen = true;
  else if (args[i] === "--engine") process.env.TITLE_CARDS_ENGINE = args[++i] ?? "";
  else if (args[i].startsWith("--engine=")) process.env.TITLE_CARDS_ENGINE = args[i].slice("--engine=".length);
  else kept.push(args[i]);
}
const [command = "start", ...rest] = kept;

const HELP = `
Title Card Studio: animated FirstByte title cards as MP4 videos.

  title-cards               Start the tool and open it in your browser.
  title-cards batch         Make one video for each row of cards.csv.
  title-cards batch FILE    Use a different CSV (or JSON) file.
  title-cards help          Show this help.

Options:
  --no-open          Do not open the browser or Finder.
  --engine chrome    Draw the cards with a private Chrome and ffmpeg instead
                     of Safari's engine (downloads about 570 MB the first time).

Videos are saved in: ${OUT_DIR}
To get the newest version, run the install command again:
  npm install -g github:hecbatista/title-card-studio
`;

// ---- Checks (only for the chrome engine) ----

async function prepare() {
  const { defaultEngine, ensureChrome } = await import("../src/render.js");
  let engine;
  try {
    engine = defaultEngine();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (engine === "chrome") {
    await ensureFfmpeg();
    await ensureChrome();
  }
}

async function ensureFfmpeg() {
  const { hasFfmpeg } = await import("../src/render.js");
  if (hasFfmpeg()) return;
  if (spawnSync("brew", ["--version"], { stdio: "ignore" }).status !== 0) {
    console.error(
      "\nffmpeg is missing. It is the program that makes the video file.\n" +
        "1. Install Homebrew: open https://brew.sh and follow the one step there.\n" +
        "2. Run: title-cards   (it installs ffmpeg for you)\n",
    );
    process.exit(1);
  }
  console.log("ffmpeg is missing. Installing it with Homebrew (one time, a few minutes)…\n");
  if (spawnSync("brew", ["install", "ffmpeg"], { stdio: "inherit" }).status !== 0) {
    console.error("\nCould not install ffmpeg. Try it yourself: brew install ffmpeg");
    process.exit(1);
  }
}

// ---- Commands ----

function openBrowser(url) {
  if (noOpen) return;
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawnSync(opener, [url], { stdio: "ignore" });
}

async function start() {
  await prepare();
  const { startServer } = await import("../src/server.js");
  const url = await startServer();
  openBrowser(url);
}

async function batch() {
  await prepare();
  // The list file is the first word that is not an option or an option's value.
  let file;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out" || rest[i] === "--fps") i++;
    else if (!rest[i].startsWith("--")) {
      file = rest[i];
      break;
    }
  }
  if (!file) {
    // The officer's own list lives next to the videos. Start it from the example.
    file = path.join(OUT_DIR, "cards.csv");
    if (!existsSync(file)) {
      await mkdir(OUT_DIR, { recursive: true });
      await copyFile(path.join(TOOL_DIR, "cards.csv"), file);
      console.log(`\nMade a list of cards for you to edit:\n  ${file}\n`);
      console.log("Open it in Numbers or Excel, change the rows, save it as CSV, then run: title-cards batch\n");
      openBrowser(OUT_DIR);
      return;
    }
    rest.unshift(file);
  }
  process.argv = [process.argv[0], path.join(TOOL_DIR, "src", "batch.js"), ...rest];
  await import("../src/batch.js");
}

if (command === "start") await start();
else if (command === "batch") await batch();
else if (["help", "--help", "-h"].includes(command)) console.log(HELP);
else {
  console.error(`Unknown command "${command}".`);
  console.log(HELP);
  process.exitCode = 1;
}
