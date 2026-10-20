# Title Card Studio

Title Card Studio makes animated FirstByte title cards as MP4 videos. You can use them in demo videos and slides.

Each card is 1920×1080 and lasts 4.5 seconds (you can change this). The animation is always the same:

1. The card fades in from black.
2. The FirstByte logo pops in. On the opening card, it takes a bite ("chomp"). On the other cards, the logo is already bitten.
3. The green label wipes in from left to right.
4. The title types in, one letter at a time, with a blinking green cursor.
5. The subtitle fades up.
6. The card fades out to black.

There are two themes: **dark** (the original look) and **light** (the cream color of the FirstByte website, dark text).

You do not need ScreenKite or any other video app.

## For officers: the quick way

### What you need (one time)

- A Mac (other computers can work, but we only tested on macOS).
- **Node.js 20 or newer.** To check, type `node -v` in Terminal. To get it, go to https://nodejs.org and install the "LTS" version.
- **Homebrew**, from https://brew.sh. The tool uses it to install ffmpeg, the program that makes the video file.

### Install (one time)

Open Terminal and type:

```bash
npm install -g github:hecbatista/title-card-studio
```

### Use it

Type:

```bash
title-cards
```

The first time, this installs ffmpeg and downloads a private copy of Chrome (about 570 MB of disk space). The tool uses Chrome to draw the frames. It does not change your normal Chrome. After the first time, it starts in a few seconds.

Then your browser opens Title Card Studio:

1. Fill in the label, title, and subtitle. The preview on the right updates while you type.
2. Choose the theme. Turn on **Bite animation** only for the first card of a video.
3. Click **Download MP4**. Wait about 15–25 seconds. The video goes to your Downloads folder.

To stop the tool, go back to Terminal and press `Ctrl+C`.

### Make many cards at once

1. Type `title-cards batch`. The first time, this makes a list of example cards, `cards.csv`, and opens its folder.
2. Open `cards.csv` in Numbers or Excel. Each row is one card. Change the rows, then save the file as CSV.
3. Type `title-cards batch` again. Each row becomes one MP4.

To use a different list, type `title-cards batch my-cards.csv`.

### Where the videos go

Everything is saved in the **FirstByte Title Cards** folder in your **Movies** folder:

| What | Where |
| --- | --- |
| Videos from the browser page | Your Downloads folder, and a copy in `Movies/FirstByte Title Cards/` |
| Videos from batch mode | `Movies/FirstByte Title Cards/batch/` |
| Your list of cards | `Movies/FirstByte Title Cards/cards.csv` |

### Get the newest version

Run the install command again:

```bash
npm install -g github:hecbatista/title-card-studio
```

## The list of cards (CSV)

The columns:

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

You can also use a JSON file: a list of objects with the same names as the columns.

## For people who work on the tool

Clone this repository, install ffmpeg (`brew install ffmpeg`), and type `npm install` in the folder. Then:

| Command | What it does |
| --- | --- |
| `npm start` | Starts the browser page at http://localhost:4321 |
| `npm run batch` | Renders every row of `cards.csv` to `out/batch/` |
| `npm run batch -- my-cards.csv --out ~/Desktop/cards --fps 60` | The same, with a different list, folder, and frame rate |
| `npm run render -- --title "Check-in" --label "AT THE MEETING"` | Renders one card to `out/`. Other options: `--subtitle`, `--chomp`, `--theme light`, `--duration 5`, `--fps 60`, `--out my-card.mp4` |

When you run the tool from this folder, videos go to `out/` (not saved in Git), not to the Movies folder. To use a different folder, set `TITLE_CARDS_OUT`, for example `TITLE_CARDS_OUT=~/Desktop/cards npm start`.

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
- `bin/title-cards.js` is the `title-cards` command. It checks for ffmpeg and Chrome, installs what is missing, then starts the server or batch mode.

Two details keep the cards looking right:

- **No sliding while the title types.** An invisible full copy of the title holds its space, so the label, subtitle, and logo do not move.
- **No rings in the glow.** Smooth dark gradients often show rings ("banding") after video compression. The card has faint film grain, and ffmpeg converts the colors with dithering. Together they keep the glow smooth.

The fonts are [Inter](https://rsms.me/inter/), included with the tool (`@fontsource/inter`), so every computer draws the same letters.

## Remove the tool

1. Remove the `title-cards` command:

   ```bash
   npm uninstall -g firstbyte-title-card-studio
   ```

2. Remove the private Chrome. It is in a hidden folder in your home folder, `~/.cache/puppeteer`:

   ```bash
   rm -rf ~/.cache/puppeteer
   ```

   Other tools that use Puppeteer keep their Chrome in the same folder. If you delete it, those tools download it again when they need it.

3. Your videos stay in `Movies/FirstByte Title Cards`. Delete that folder in Finder if you do not want them.

ffmpeg stays installed. To remove it too: `brew uninstall ffmpeg`.

## Problems

| Problem | What to do |
| --- | --- |
| `title-cards: command not found` | Run the install command again. If it still fails, close Terminal and open it again. |
| The install says `git: command not found`, or asks to install developer tools | Click **Install** in the window that opens (the Xcode command line tools), then run the install command again. |
| `ffmpeg is missing` | Install Homebrew from https://brew.sh, then run `title-cards` again. |
| Port 4321 is busy | Title Card Studio is probably open already in another Terminal window. To use another port: `PORT=4400 title-cards`. |
| The title is too long | Long text is made smaller so it fits the screen. If the title types in too late to read, choose a longer **Length**. |
