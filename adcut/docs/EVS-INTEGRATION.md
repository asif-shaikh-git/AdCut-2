# AdCut + Euron Video System (EVS): what to use, how to connect, how to run

STATUS: built. AdCut has a Publish tab (src/evs.ts, src/components/PublishPanel.tsx) and a WebM duration fix (src/webm.ts). See ../README.md for run steps.

EVS is an open-source (MIT) backend that turns an uploaded video into encrypted adaptive HLS, with API keys, playback
tokens, webhooks, an audit log and an operator console. AdCut is the browser editor that makes the ad.
They fit together as: MAKE (AdCut) -> PUBLISH AND PROTECT (EVS).

## Parts of EVS and whether we use them
| EVS part | What it does | Use for AdCut? |
|---|---|---|
| apps/api | REST control plane, playback tokens, playlist rewriting, key delivery | YES (core) |
| apps/worker | FFmpeg ladder (portrait 720/540 for a 720p source), AES-128 HLS, thumbnails, poster, MP4, optional captions | YES: web-ready adaptive versions of the ad |
| packages/player (EvsPlayer) | React hls.js player: quality menu, thumbnail scrubbing, watermark | YES: reuse to play published ads |
| apps/console | Operator UI: videos, sessions, keys, webhooks, audit, usage | YES as admin panel; copy its look (dark theme, Tailwind tokens) |
| packages/core | config, Postgres queue, S3 storage, envelope crypto | comes with the above |
| apps/orchestrator + Terraform + Packer | EC2 Spot autoscaling on AWS | ONLY for an AWS deployment |
| Floci emulator | fake AWS for laptops (Docker) | optional; any S3-compatible store (MinIO, R2) also works |

## Verified in this session (no Docker, native processes)
Postgres 16 + an S3/KMS emulator (moto) + EVS API + EVS worker + a real AdCut export (45 s, 720x1280):
- upload -> status ready, 2 renditions (720x1280, 540x960), 12 encrypted 4 s segments
- master playlist: 401 without token, 200 with token; key endpoint: 401 without token, 16 bytes with token
- first segment cannot be decoded as delivered; after AES-128 decryption with the delivered key it decodes as H.264 720x1280 + AAC
- all 191 EVS unit tests pass (api 69, worker 35, core 31, console 31, player 16, orchestrator 9)
Not verified: the Docker `make up` path (no Docker daemon in the sandbox), the console UI in a live browser, real AWS.

## Finding (now fixed in AdCut)
AdCut exports come from MediaRecorder WebM, which has no duration header. EVS stored duration as empty and progress sat at
10% until finished. The encode itself worked (about 6.5 min for 45 s on a shared sandbox CPU at the veryfast preset).
Fix options:
1. AdCut patches the duration into the WebM before upload, or
2. the EVS worker probe falls back to counting packets, or
3. AdCut moves to WebCodecs + Mediabunny export (MP4 with a proper duration, and faster).

## Integration design
AdCut (export) -> small backend or local key -> POST /v1/videos -> presigned upload -> browser uploads file to storage ->
POST /v1/videos/{id}/complete -> worker transcodes -> webhook video.ready (or poll) ->
POST /v1/videos/{id}/playback-sessions -> manifestUrl -> EvsPlayer.
Never put a root API key in a public page. For a single-user local setup, a key in the browser (like the EVS console) is fine.

Changes needed in AdCut: an `evs.ts` client (create, upload, complete, poll, mint session); a Publish button; a Published tab
using EvsPlayer; settings for API base and key; the duration fix above.

## Run modes (same code, different config)
1. Browser only (today): AdCut alone, `npm run dev` or any static host. Export stays on your device.
2. Local full: Docker Desktop + `make up` in the EVS repo (console :3000, API :8080) + AdCut dev server.
   Without Docker: native Postgres + S3-compatible store + API and worker started with tsx (what was tested above).
3. Home/office network: PUBLIC_API_BASE=http://<LAN-IP>:8080, CORS_ALLOWED_ORIGINS set to the AdCut/console origins,
   services bound to 0.0.0.0, delivery driver `proxy`.
4. Public hosting without AWS: one VPS (about 4 vCPU / 8 GB) running Postgres, API and worker with Docker Compose,
   MinIO or Cloudflare R2 for storage, HTTPS via Caddy/nginx.
5. AWS production: EVS Terraform (ECS Fargate, RDS, S3 + CloudFront, KMS, Spot workers). Most cost and complexity.
Static AdCut can be hosted free (Netlify, Cloudflare Pages, Vercel) in every mode.

## Caveats
- EVS is access control with encryption, not DRM: a legitimately authorised viewer can extract the key.
- For ads posted on Instagram, YouTube or Shopify you only need the exported MP4. EVS pays off when you host or protect videos yourself.
- EVS captions (Whisper) are not checked for Hindi quality here.
- Keep the MIT licence notice; rebrand the console before showing it to customers.
