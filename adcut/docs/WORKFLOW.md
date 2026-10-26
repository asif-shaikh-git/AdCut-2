# DIWAAN UGC ad: step-by-step workflow in AdCut

AdCut is an EDITOR + PROMPT PLANNER. It does not generate video. The AI video tool (Veo, Kling, Seedance, etc.) generates clips; AdCut assembles them.

## 1. Prepare references (once)
Import in the Media tab: SARA character sheet, DIWAAN kit photo, living-room location photo.
UGC Creator tab -> References -> "Use first 3 images as character / product / location".

## 2. Load the script
UGC Creator -> "DIWAAN script" (9 shots / 5 videos). Edit any shot's visual, spoken line, on-screen text, camera, lighting, end frame.
Script format: `REFERENCES:` block, then `(Shot: 0:00-0:05)` with `- Visual`, `- Spoken Line`, `- On-Screen Text Overlay`, `- Delivery`; optional `END FRAME`, `NEGATIVE PROMPT`.

## 3. Generate (outside AdCut)
Per video: copy its prompt (button "Copy"), open the AI video tool, ATTACH the 3 reference images manually (the prompt lists which), paste prompt, generate 9:16.
Tip: generate each video from its prompt, check face/product consistency, regenerate bad ones. Use "per video" mode for 10s blocks, "per shot" for 5s clips.
Keep on-screen text OUT of the AI video (AI garbles Hindi); AdCut adds it.

## 4. Import + assemble
Import generated clips -> UGC Creator -> Assemble -> "Match imported videos to shots" -> check dropdowns -> "Build timeline from shots".
One 10s clip for 2 shots is cut 0-5s, 5-10s automatically. Whole build = one undo (Ctrl/Cmd+Z).

## 4b. Hindi voice-over (optional)
Make one audio file per shot from the spoken lines with any text-to-speech tool (e.g. Sarvam, ElevenLabs), named with the shot number (shot1.mp3, vo_02.wav...).
Import them -> Assemble -> "Match voice files to shots" -> keep "Add voice-over track" ticked -> Build. Each voice starts at its shot, shows on the orange-ish voice lane, and is mixed into the export. Double-click a voice block to remove it.
Browser speech (speechSynthesis) cannot be recorded into the export, so a real audio file is needed.

## 5. Polish + export
Timeline: trim, split, rearrange, edit text, add music (Music in inspector), Ad Kit for CTA/price pill. Export (real-time; MP4 if the browser supports H.264+AAC, otherwise WebM).

## Limits
- Voice-over uses audio files you generate elsewhere (no built-in TTS); no automatic music ducking yet; voice blocks cannot be dragged yet (rebuild or re-link instead).
- Export runs in real time (45s ad = ~45s).
- Imported media is not saved on refresh; script text and options are (localStorage).

## Upgrade path
WebCodecs / Mediabunny (MPL-2.0) for faster MP4 export; TTS (Sarvam/ElevenLabs) for Hindi voiceover; Shopify product import; backend (NestJS) for saved projects.
