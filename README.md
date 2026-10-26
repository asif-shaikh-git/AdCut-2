# AdCut Studio = AdCut (editor) + EVS (publish & protect) + Share pages

```
adcut-studio/
  adcut/            video-ad editor (React + Vite). Works alone in any browser.
  evs/              Euron Video System (MIT): API, transcode worker, console. Needed for Publish.
  share/            tiny public "watch page" server (Node, no dependencies). Needed for share links.
  start-adcut.sh    install + run the editor          -> http://localhost:5173
  start-evs.sh      start EVS + create an API key     -> API :8080, console :3000
  start-share.sh    start the watch-page server       -> http://localhost:8090/watch/<id>
  docs: adcut/docs/HOW-IT-WORKS.md  adcut/docs/EVS-INTEGRATION.md
```

## Install once
| You need | Why | Get it |
|---|---|---|
| Node.js 20 or newer | editor + share server | https://nodejs.org (LTS) |
| Docker Desktop | runs EVS (database, API, worker, storage emulator) | https://www.docker.com/products/docker-desktop |
| make, openssl, curl, git-bash/WSL on Windows | used by EVS scripts | macOS/Linux have them; Windows: use WSL 2 |
Give Docker 4 CPUs and 6 GB RAM. First `start-evs.sh` builds images (about 10 minutes); later starts take seconds.
Unzip, open a terminal in `adcut-studio/`.

## Run: editor only (nothing else to install but Node)
    ./start-adcut.sh                      # http://localhost:5173. Export saves MP4/WebM to your computer.

## Run: full system (3 terminals)
    ./start-evs.sh                        # prints an API key "evs_..."  (copy it, shown once)
    ./start-adcut.sh
    EVS_KEY=evs_...  ./start-share.sh     # paste the same key
Then in AdCut: **Publish** tab -> address http://localhost:8080, paste key, Connect ->
"Export and publish to EVS" -> wait for *ready* -> **Watch** (in app) or **Link** (copies a public watch link).
Stop: Ctrl+C in each terminal; `cd evs && make down` (this also deletes stored videos).

## Use from phones / other devices on your Wi-Fi
1. Find this computer's IP, e.g. 192.168.1.20.
2. Share server: `HOST=0.0.0.0 EVS_KEY=... ./start-share.sh` and in AdCut set "Share page address" to http://192.168.1.20:8090
3. EVS must be reachable from the phone too: set `EVS_PUBLIC_API_BASE=http://192.168.1.20:8080` before `./start-evs.sh`
   and change the `127.0.0.1:` port bindings in evs/deploy/compose/compose.yaml to `0.0.0.0:`.
4. Editor on the phone: `HOST=0.0.0.0 ./start-adcut.sh`, open http://192.168.1.20:5173 (add it to EVS_CORS_ALLOWED_ORIGINS).
Trusted networks only: these ports have no HTTPS.

## Put it on the internet
- Editor: `cd adcut && npm install && npm run build`, upload `dist/` to Netlify / Cloudflare Pages / Vercel (free).
- EVS + share server: one VPS (about 4 vCPU / 8 GB) with Docker, a domain, HTTPS (Caddy or nginx), real storage (Cloudflare R2, MinIO or S3).
  AWS option: evs/docs/guides/deploy-aws.md. Keep the API key on the server only; the share server is the public face.

## Troubleshooting
- "Cannot reach EVS": is `start-evs.sh` finished? open http://localhost:8080/readyz. Browser blocks other sites: add the editor's address to EVS_CORS_ALLOWED_ORIGINS.
- "Upload was blocked": the storage bucket must allow the editor's address (CORS); the bundled compose already allows :5173 and :4173.
- Stuck at processing: `cd evs && make logs SERVICE=worker`. A 45 s ad can take several minutes on a slow computer.
- Link says "Not ready yet": wait until the row says ready.

## Tested vs not tested
Tested (EVS run as plain processes, no Docker): editor export -> Publish -> EVS API + worker -> ready -> in-app Watch (hls.js);
share link opened by a separate visitor browser: video plays, title shows, EVS key never appears in the page, bad id gives 404.
EVS 191 unit tests pass. NOT tested here: the Docker route and the three start scripts, Wi-Fi/internet modes, real AWS.

## Share server options
- `share/server.mjs` (default, started by `start-share.sh`): read-only; anyone with a video's 26-character id link can watch it; a link cannot be switched off except by deleting the ad.
- `share/server-strict.mjs` (optional, `EVS_KEY=evs_... node share/server-strict.mjs`): only ads you press Link on can be watched, and AdCut's "Stop sharing" really turns the link off. Same port (8090); run only one of them.

## Saving your work
AdCut saves automatically in your browser (IndexedDB): your timeline, text, settings AND your imported photos/videos/audio,
so a refresh or closing the tab loses nothing. 📁 Projects (top bar) saves named copies, opens, deletes and starts a new project.
Notes: it is per browser and per address (localhost:5173 is separate from another address or a private window), clearing site data
deletes it, and big videos use disk space (the menu shows usage). Move a project to another computer by exporting the video;
project files you can download are not built yet. Tested: reload restore, named save/open/delete, export after restore.

## Voice and music (Voice+Music tab)
- Voice: plug in your headset, pick the mic, put the playhead where you want to start, press Record, talk while the video plays
  (3-2-1 countdown; it stops at the end of the video or when you press Stop). Each take becomes a voice clip on the timeline
  (nudge it ◀ ▶ by 0.1 s, change volume, delete). Use headphones so the video sound is not picked up by the mic.
- Music: download a song first, then "+ Add a song or sound file", then "Use as music". Volume slider; the music dips
  automatically while you speak (can be switched off). Only use music you have the right to use in ads.
- Tested with a fake microphone in Chromium: record, save, nudge, export. In the export the voice is present only where
  recorded and the music drops while the voice plays. Not tested with a real headset or on Safari/Firefox.

## New: drag voice clips, fast MP4 export, Hindi captions
- **Drag voice clips**: in the timeline, drag the 🎙 block left or right. It snaps to 0.1 s; hold Shift for free movement. Undo (Ctrl+Z) reverts one drag.
- **Fast export**: Export now encodes with WebCodecs + Mediabunny, faster than real time (a 30 s ad took about 14 s in our headless test; speed depends on your PC). Output is H.264 MP4. If your browser cannot do it, AdCut falls back to the old real-time recorder and tells you. Use Chrome or Edge for best results. In the test browser AAC audio was unavailable, so sound was saved as Opus; desktop Chrome/Edge normally has AAC. Check the audio plays on your phone once.
- **Hindi captions**: Voice+Music tab, "Captions from your voice". Pick Hindi, model "small" (about 250 MB, best for Hindi), press Make captions. Needs internet the first time to download the Whisper model (cached afterwards). Captions are added as normal text on the timeline, so you can fix any wrong word. NOT verified here: real Whisper output (the test machine had no access to the model host), so check accuracy on your own voice and tell us how it does.

## Layout controls
Header → **Layout**: show/hide Tools, Project and Timeline panels; swap left/right; move the timeline to the top; − / + for panel widths and timeline height; Reset. You can also drag the thin bars between panels (double-click a bar to reset it; arrow keys work when focused). Your layout is remembered in this browser.
