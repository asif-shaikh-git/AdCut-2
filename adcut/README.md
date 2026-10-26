# AdCut - video ad maker (browser editor)

A CapCut-style editor for making product ads. Runs entirely in the browser: no server, no GPU, no per-video cost.

## Run it

```bash
npm install
npm run dev        # opens http://localhost:5173
npm run build      # production build in dist/ (host it on any static host: Netlify, Vercel, Cloudflare Pages)
```

Use Chrome, Edge or Safari 16+. Chrome on a phone works for viewing; editing is best on a laptop.

## What it does

**Editing (CapCut-style)**
- Import photos, videos and music (drag and drop or button)
- Drag clips to rearrange, drag clip edges to trim, split at the playhead, duplicate, delete
- Per clip: speed (0.5x to 2x), fill or fit with blurred bars, fade in/out, photo duration
- Text overlays you can move and resize on the timeline, with colour, size, background box and position
- Undo / redo (Ctrl/Cmd+Z), zoomable timeline, formats 9:16, 4:5, 1:1, 16:9

**Made for ads**
- **Ad Kit**: type product name, price, offer and call to action; AdCut lays out hook, price pill and end card in your brand colour
- **Captions from script**: paste a script (English, Hindi or Hinglish); it is split into sentences and timed across the video
- **Logo watermark** with corner and size
- **Safe-zone guide** so text is not hidden by Reels / Shorts / TikTok buttons
- **Slideshow in one click** from all your product photos
- Background music with volume

**Export**: records the timeline (picture + audio) to a downloadable file. MP4 (H.264) where the browser supports it, otherwise WebM.

## Keyboard shortcuts

`Space` play/pause, `S` split, `D` duplicate, `Del` delete, `Left/Right` step 0.1s (`Shift` = 1s), `Home` go to start, `Ctrl/Cmd+Z` undo, `Shift+Ctrl/Cmd+Z` redo.

## How it is built

| Part | File | Notes |
|---|---|---|
| Data model, timeline math | `src/types.ts` | Main track is "magnetic": clips sit back to back, start times are derived |
| State + undo/redo | `src/store.ts` | Zustand; history with coalescing for sliders and one entry per drag |
| Playback + rendering | `src/engine.ts` | Canvas 2D renderer, video/audio sync, WebAudio graph used for export |
| Export | `src/exporter.ts` | MediaRecorder on the canvas stream + mixed audio |
| UI | `src/components/*` | Preview, Timeline, Media/Ad Kit/Captions panel, Inspector |

The preview and the export use the same canvas, so what you see is what you get.

## Known limits (MVP)

- Export runs in real time (a 30s ad takes about 30s) and the tab must stay open and visible.
- Browser recordings (especially WebM) have no seek index; they play fine but some editors want a quick re-mux. MP4/H.264 is what Instagram, WhatsApp and most apps want.
- Clips that jump back to a different place in the same source video cause a brief seek stutter in preview.
- Media is held in memory only. Refreshing the page loses the project (see roadmap).
- No transitions between clips beyond fade in/out.

## Roadmap (suggested order)

1. **Save projects**: store media in IndexedDB and the project JSON locally, reopen later.
2. **Faster, frame-accurate export**: WebCodecs-based encoder (for example with Mediabunny) to export faster than real time, always as H.264 MP4.
3. **Transitions and effects**: move rendering to WebGL (PixiJS) for crossfades, slides, zoom, filters.
4. **Templates**: sale / new arrival / unboxing / testimonial layouts as saved projects.
5. **Backend (NestJS)**: accounts, cloud storage, shared brand kits.
6. **AI helpers** (need API keys and a backend): ad-script writer, text-to-speech voiceover, auto-captions from speech, background removal for product photos, optional AI motion clips from a photo.
7. **Shopify import**: paste a product URL, pull photos, title and price straight into the Ad Kit.


## UGC Ad Creator
See docs/WORKFLOW.md. Accent colour is #ffb2b3 (dark text via --on-accent).
