# How AdCut Studio works

## The three pieces
```
 [1] AdCut (browser)                 [2] EVS (server)                              [3] Share server
 edit clips, text, voice, music      API :8080   Postgres (jobs+state)             public watch page :8090
 UGC Creator -> prompts + timeline   worker      FFmpeg: encode + AES-128 HLS      holds the EVS key
 Export (records canvas + audio)     storage     S3-compatible buckets             hands viewers short tokens
 Publish tab ----------------------> uploads --> transcodes --> ready  <---------- /watch/<id>
```

## Life of one ad
1. **Make:** import AI-generated clips, build the timeline (UGC Creator can build it from your script), add text, captions, voice, music.
2. **Export:** AdCut plays the timeline in real time and records the canvas + mixed audio (MediaRecorder). It writes the real duration into the WebM header (EVS needs it).
3. **Publish:** AdCut asks EVS for an upload slot (`POST /v1/videos`), sends the file straight to storage with a presigned form, then confirms (`/complete`). The API key never goes to storage.
4. **Transcode:** a worker claims the job from Postgres, probes the file, encodes portrait 720p/540p, cuts 4-second segments, encrypts them with a per-video AES-128 key (the key itself is wrapped by KMS), makes thumbnails and a poster, stores everything, marks the video *ready*.
5. **Watch (owner):** AdCut asks for a playback session (`POST .../playback-sessions`), gets a short-lived token and a manifest URL, and plays it with hls.js. Token expired? the player asks for a new one.
6. **Watch (anyone):** the share link `/watch/<id>` opens the share server's page. The page asks the share server for a session; the server (which holds the key) asks EVS and returns only the token URL. Without a valid token the playlist and key return 401, and segments are unreadable without the key.

## Why each part exists
- AdCut alone is enough if you only need an MP4 to post on Instagram/YouTube/Shopify.
- EVS adds hosting, protection, adaptive quality and an admin console; it is the part to run on a server.
- The share server exists so the public never sees an API key. Anyone with a link can watch, so treat links as semi-private; revoke by deleting the video in the Publish tab.

## Limits to know
- Export is real time (a 45 s ad takes about 45 s to record) and the browser tab must stay open.
- EVS encryption is access control, not DRM: a viewer who is allowed to watch can extract the key.
- Imported media is not saved when you refresh AdCut (script text and settings are).
