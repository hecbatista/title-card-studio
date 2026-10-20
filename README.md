# Title Card Studio

Title Card Studio makes animated FirstByte title cards as MP4 videos. You can use them in demo videos and slides.

Each card is 1920×1080 and lasts 4.5 seconds (you can change this). The animation is always the same:

1. The card fades in from black.
2. The FirstByte logo pops in. On the opening card, it takes a bite ("chomp"). On the other cards, the logo is already bitten.
3. The green label wipes in from left to right.
4. The title types in, one letter at a time, with a blinking green cursor.
5. The subtitle fades up.
6. The card fades out to black.

There are two themes: **dark** (the original look) and **light** (off-white background, dark text).

You do not need ScreenKite or any other video app.

## What you need

- A Mac (other computers can work, but we only tested on macOS).
- **Node.js 20 or newer.** To check, type `node -v` in Terminal. To get it, go to https://nodejs.org.
- **ffmpeg**, the program that makes the video file. To get it, install [Homebrew](https://brew.sh), then type:

  ```bash
  brew install ffmpeg
  ```

## Install (one time)

In Terminal, go to this folder and type:

```bash
npm install
```

This also downloads a private copy of Chrome (about 150 MB). The tool uses it to draw the frames. It does not change your normal Chrome.

## Make one card in your browser

1. Type:

   ```bash
   npm start
   ```

2. Open http://localhost:4321 in your browser.
3. Fill in the label, title, and subtitle. The preview on the right updates while you type.
4. Choose the theme. Turn on **Bite animation** only for the first card of a video.
5. Click **Download MP4**. Wait about 15–25 seconds. The video downloads to your computer.

To stop the tool, go back to Terminal and press `Ctrl+C`.

## Make many cards at once (batch mode)

1. Open `cards.csv` in a spreadsheet app (Numbers, Excel, Google Sheets) or a text editor. Each row is one card.
2. Change the rows, then save the file as CSV.
3. Type:

   ```bash
   npm run batch
   ```

Each row becomes one MP4 in `out/batch/`.

The columns in `cards.csv`:

| Column | What to put in it | Needed? |
| --- | --- | --- |
| `label` | The small green text on top, for example `OFFICER VIEW` | Yes |
| `title` | The big title that types in | Yes |
| `subtitle` | The gray line under the title | Yes (can be empty) |
| `chomp` | `yes` for the bite animation, `no` for an already-bitten logo | Yes |
| `theme` | `dark` or `light` | Yes |
| `duration` | Length in seconds. If it is empty, the length is 4.5 | No |
| `file` | The name of the MP4 (without `.mp4`). If it is empty, the name comes from the title | No |

If a cell has a comma in it, put the cell in double quotes, for example `"Create, edit, and duplicate"`. Spreadsheet apps do this for you.

More options:

```bash
npm run batch -- my-cards.csv
```

```bash
npm run batch -- my-cards.csv --out ~/Desktop/cards --fps 60
```

You can also use a JSON file: a list of objects with the same names as the columns.

## Make one card from Terminal

```bash
npm run render -- --label "AT THE MEETING" --title "Check-in" --subtitle "Members scan the QR code"
```

Other options: `--chomp`, `--theme light`, `--duration 5`, `--fps 60`, `--out my-card.mp4`.

## Where the files go

| What | Where |
| --- | --- |
| Videos from the browser page | Your Downloads folder, and a copy in `out/` |
| Videos from batch mode | `out/batch/` (or the folder you give with `--out`) |
| Videos from `npm run render` | `out/` (or the file you give with `--out`) |

The `out/` folder is not saved in Git.

## The video format

- H.264 MP4, 1920×1080, 30 frames per second (or 60 if you choose it).
- Color: yuv420p, BT.709. This plays in QuickTime, browsers, Keynote, Final Cut Pro, iMovie, and on YouTube.
- "Faststart" is on, so the video can start playing before it fully downloads.

## How it works

You do not need to know this to use the tool.

- `card/card.html` is the card. It is a web page with the text, the logo (as SVG), and a [GSAP](https://gsap.com) animation timeline. The timeline is paused. The page reads the text and options from its address, for example `card.html?title=Home&theme=light`.
- `src/render.js` is the renderer. It opens the card in a hidden Chrome window. For each frame, it moves the timeline to that exact time and takes a screenshot. It sends the screenshots to ffmpeg, which makes the MP4. Because nothing plays in real time, a slow computer makes the same video as a fast one.
- `src/server.js` is the small local server for the browser page (`ui/`). It only accepts connections from your own computer.
- `src/batch.js` reads `cards.csv` and renders each row.

Two details keep the cards looking right:

- **No sliding while the title types.** An invisible full copy of the title holds its space, so the label, subtitle, and logo do not move.
- **No rings in the glow.** Smooth dark gradients often show rings ("banding") after video compression. The card has faint film grain, and ffmpeg converts the colors with dithering. Together they keep the glow smooth.

The fonts are [Inter](https://rsms.me/inter/), included with the tool (`@fontsource/inter`), so every computer draws the same letters.

## Problems

| Problem | What to do |
| --- | --- |
| `Could not start ffmpeg` | Install ffmpeg: `brew install ffmpeg`. If ffmpeg is in an unusual place, start the tool with `FFMPEG=/path/to/ffmpeg npm start`. |
| `Could not find Chrome` | Type `npx puppeteer browsers install chrome`. |
| Port 4321 is busy | Start the tool on another port: `PORT=4400 npm start`. Then open http://localhost:4400. |
| The title is too long | Long text is made smaller so it fits the screen. If the title types in too late to read, choose a longer **Length**. |
