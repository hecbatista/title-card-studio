// Render one card from the command line.
//   npm run render -- --title "Check-in" --label "AT THE MEETING" --subtitle "Scan the QR code"
//   Other options: --chomp  --theme light  --duration 5  --fps 60  --out out/my-card.mp4

import path from "node:path";
import { parseArgs } from "node:util";
import { slugify } from "./card-options.js";
import { launchBrowser, renderCard, TOOL_DIR } from "./render.js";

const { values } = parseArgs({
  options: {
    label: { type: "string" },
    title: { type: "string" },
    subtitle: { type: "string" },
    chomp: { type: "boolean", default: false },
    theme: { type: "string", default: "dark" },
    duration: { type: "string" },
    fps: { type: "string", default: "30" },
    out: { type: "string" },
  },
});

const fps = Number(values.fps) === 60 ? 60 : 30;
const out = path.resolve(values.out ?? path.join(TOOL_DIR, "out", `${slugify(values.title ?? "card")}.mp4`));

const browser = await launchBrowser();
try {
  const started = Date.now();
  await renderCard(browser, values, out, {
    fps,
    onProgress: (done, total) => process.stdout.write(`\r  frame ${done}/${total}`),
  });
  console.log(`\nSaved ${path.relative(process.cwd(), out)} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
} finally {
  await browser.close();
}
