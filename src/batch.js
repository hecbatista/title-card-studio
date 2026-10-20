// Batch mode: one MP4 for every row of a CSV (or JSON) file.
//   npm run batch                          reads cards.csv, writes to out/batch/
//   npm run batch -- my-cards.csv          a different list
//   npm run batch -- my-cards.json --out ~/Desktop/cards --fps 60
//
// CSV columns: label, title, subtitle, chomp (yes/no), theme (dark/light)
// Optional columns: duration (seconds, default 4.5), file (the output name)

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { slugify } from "./card-options.js";
import { launchBrowser, renderCard, TOOL_DIR } from "./render.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    fps: { type: "string", default: "30" },
  },
});

const listFile = path.resolve(positionals[0] ?? path.join(TOOL_DIR, "cards.csv"));
const outDir = path.resolve(values.out ?? path.join(TOOL_DIR, "out", "batch"));
const fps = Number(values.fps) === 60 ? 60 : 30;

// A small CSV reader: handles "quoted, text", "" inside quotes, and Excel's CRLF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field !== "" || row.length) row.push(field), rows.push(row);

  const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ""));
  const [header, ...body] = nonEmpty;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

async function readCards(file) {
  const text = await readFile(file, "utf8");
  if (file.toLowerCase().endsWith(".json")) {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : data.cards;
  }
  return parseCsv(text);
}

const cards = await readCards(listFile);
if (!cards?.length) {
  console.error(`No cards found in ${listFile}`);
  process.exit(1);
}
console.log(`Rendering ${cards.length} cards from ${path.relative(process.cwd(), listFile)} to ${outDir} at ${fps} fps\n`);

const browser = await launchBrowser();
let failed = 0;
try {
  for (const [i, card] of cards.entries()) {
    const name = card.file?.trim()
      ? card.file.trim().replace(/\.mp4$/i, "")
      : `${String(i + 1).padStart(2, "0")}-${slugify(card.title)}`;
    const out = path.join(outDir, `${name}.mp4`);
    const started = Date.now();
    try {
      await renderCard(browser, card, out, {
        fps,
        onProgress: (done, total) => process.stdout.write(`\r  [${i + 1}/${cards.length}] ${name}  frame ${done}/${total}`),
      });
      console.log(`  done (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    } catch (err) {
      failed++;
      console.log(`\n  FAILED: ${err.message}`);
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${cards.length - failed} of ${cards.length} cards saved in ${outDir}`);
process.exitCode = failed ? 1 : 0;
