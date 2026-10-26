import { assetTo16k, mixAudio, toMono16k } from './audioMix'
import { useStore } from './store'
import { mkText, totalDuration } from './types'

export interface Chunk {
  text: string
  start: number
  end: number
}
export type CaptionModel = 'tiny' | 'base' | 'small'
export interface CaptionOpts {
  source: 'voice' | 'video'
  language: 'hindi' | 'english'
  model: CaptionModel
  replace: boolean
  onStatus: (text: string, progress?: number) => void
}

/** Test seam: set window.__adcutAsr to a function to skip the real model. */
type Hook = (audio: Float32Array) => Promise<Chunk[]>

let worker: Worker | null = null
let seq = 0

function runWhisper(audio: Float32Array, o: CaptionOpts): Promise<Chunk[]> {
  const hook = (window as unknown as { __adcutAsr?: Hook }).__adcutAsr
  if (hook) return hook(audio)
  worker ??= new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  const id = ++seq
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data
      if (m.id !== id) return
      if (m.type === 'status') o.onStatus(m.text)
      else if (m.type === 'download') o.onStatus('Downloading speech model (first time only)…', m.progress)
      else if (m.type === 'done') {
        w.removeEventListener('message', onMsg)
        resolve(m.chunks)
      } else if (m.type === 'error') {
        w.removeEventListener('message', onMsg)
        worker?.terminate()
        worker = null
        reject(new Error(m.message))
      }
    }
    w.addEventListener('message', onMsg)
    const copy = audio.slice() // transfer a copy so the original stays usable
    w.postMessage({ id, audio: copy, model: `Xenova/whisper-${o.model}`, language: o.language }, [copy.buffer])
  })
}

/** Break a recognised phrase into short on-screen lines (about 6 words), spreading the time across them. */
export function splitChunk(c: Chunk, maxWords = 6): Chunk[] {
  const words = c.text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const dur = Math.max(0.3, c.end - c.start)
  const parts = Math.ceil(words.length / maxWords)
  const per = Math.ceil(words.length / parts)
  const out: Chunk[] = []
  for (let i = 0; i < parts; i++) {
    const slice = words.slice(i * per, (i + 1) * per)
    out.push({ text: slice.join(' '), start: c.start + (dur * i * per) / words.length, end: c.start + (dur * Math.min(words.length, (i + 1) * per)) / words.length })
  }
  return out
}

/** Whisper sometimes loops on silence: drop empty and obviously repeated lines. */
function clean(chunks: Chunk[]): Chunk[] {
  const out: Chunk[] = []
  for (const c of chunks) {
    const t = c.text.trim()
    if (!t || /^[\s.,!?…\-–♪\[\]()]+$/.test(t)) continue
    if (out.length >= 2 && out[out.length - 1].text === t && out[out.length - 2].text === t) continue
    out.push({ ...c, text: t })
  }
  return out
}

/** Returns how many caption lines were added. */
export async function generateCaptions(o: CaptionOpts): Promise<number> {
  const { project, assets } = useStore.getState()
  const total = totalDuration(project)
  const lines: Chunk[] = []

  if (o.source === 'voice') {
    if (!project.voice.length) throw new Error('Record or add a voice clip first.')
    for (const [i, v] of project.voice.entries()) {
      const a = assets[v.assetId]
      if (!a) continue
      o.onStatus(`Reading voice clip ${i + 1} of ${project.voice.length}…`)
      const pcm = await assetTo16k(a)
      if (!pcm) continue
      const chunks = clean(await runWhisper(pcm, o))
      for (const c of chunks) for (const s of splitChunk(c)) lines.push({ text: s.text, start: v.start + s.start, end: v.start + s.end })
    }
  } else {
    o.onStatus('Mixing the video sound…')
    const mix = await mixAudio({ clips: true, music: false, voice: false })
    if (!mix) throw new Error('The clips on the timeline have no sound to listen to.')
    const chunks = clean(await runWhisper(await toMono16k(mix), o))
    for (const c of chunks) lines.push(...splitChunk(c))
  }

  if (!lines.length) throw new Error('No speech was found. Try the “small” model, or speak closer to the mic.')

  const texts = lines.map((l, i) => {
    const start = Math.max(0, l.start)
    const next = lines[i + 1]
    let end = Math.min(total, Math.max(l.end, start + 0.8))
    if (next && next.start > start) end = Math.min(end, next.start) // never overlap the next line
    return mkText(l.text, start, Math.max(0.3, end - start), 0.74, 40, '#ffffff', 'rgba(0,0,0,0.6)', 'caption')
  })
  useStore.getState().commit((p) => ({
    ...p,
    texts: [...(o.replace ? p.texts.filter((x) => x.tag !== 'caption') : p.texts), ...texts],
  }))
  return texts.length
}
