import { useStore } from './store'
import { findSegment, layout, totalDuration } from './types'
import type { Asset } from './types'

/**
 * Builds the soundtrack of the whole ad in one go (no real-time playback): video sound, music (looped, dipping under the
 * voice) and voice clips. Used by the fast exporter, and by auto-captions to hear the video's own speech.
 */
const SR = 48000
const cache = new Map<string, ArrayBuffer>()

async function bytes(a: Asset): Promise<ArrayBuffer> {
  const hit = cache.get(a.id)
  const b: ArrayBuffer = hit ?? (await fetch(a.url).then((r) => r.arrayBuffer()))
  if (!hit) cache.set(a.id, b)
  return b.slice(0) // decodeAudioData detaches the buffer it is given
}

async function decode(ctx: BaseAudioContext, a: Asset): Promise<AudioBuffer | null> {
  try {
    return await ctx.decodeAudioData(await bytes(a))
  } catch {
    return null // e.g. a silent video, or a format the browser cannot decode
  }
}

export interface MixParts {
  clips?: boolean
  music?: boolean
  voice?: boolean
}

export async function mixAudio(parts: MixParts = { clips: true, music: true, voice: true }): Promise<AudioBuffer | null> {
  const { project, assets } = useStore.getState()
  const total = totalDuration(project)
  if (total <= 0) return null
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SR), SR)
  let any = false

  if (parts.clips !== false) {
    for (const seg of layout(project)) {
      const a = assets[seg.clip.assetId]
      if (!a || a.kind !== 'video') continue
      const buf = await decode(ctx, a)
      if (!buf) continue
      const s = ctx.createBufferSource()
      s.buffer = buf
      s.playbackRate.value = seg.clip.speed
      s.connect(ctx.destination)
      s.start(seg.start, seg.clip.in, Math.max(0.01, seg.clip.out - seg.clip.in))
      any = true
    }
  }

  const voiceSpans: [number, number][] = []
  if (parts.voice !== false) {
    for (const v of project.voice) {
      const a = assets[v.assetId]
      if (!a) continue
      const buf = await decode(ctx, a)
      if (!buf) continue
      const s = ctx.createBufferSource()
      const g = ctx.createGain()
      s.buffer = buf
      g.gain.value = v.volume
      s.connect(g).connect(ctx.destination)
      s.start(Math.max(0, v.start))
      voiceSpans.push([v.start, v.start + buf.duration])
      any = true
    }
  }

  const m = project.music
  const ma = m ? assets[m.assetId] : undefined
  if (parts.music !== false && m && ma) {
    const buf = await decode(ctx, ma)
    if (buf) {
      const s = ctx.createBufferSource()
      const g = ctx.createGain()
      s.buffer = buf
      s.loop = true
      g.gain.setValueAtTime(m.volume, 0)
      if (m.duck !== false) {
        // merge overlapping voice spans, then dip to 30% with short ramps (same feel as the live preview)
        const spans = voiceSpans.sort((x, y) => x[0] - y[0]).reduce<[number, number][]>((acc, sp) => {
          const last = acc[acc.length - 1]
          if (last && sp[0] <= last[1] + 0.2) last[1] = Math.max(last[1], sp[1])
          else acc.push([...sp])
          return acc
        }, [])
        for (const [a0, a1] of spans) {
          g.gain.setValueAtTime(m.volume, Math.max(0, a0 - 0.05))
          g.gain.linearRampToValueAtTime(m.volume * 0.3, a0 + 0.15)
          g.gain.setValueAtTime(m.volume * 0.3, a1)
          g.gain.linearRampToValueAtTime(m.volume, a1 + 0.3)
        }
      }
      s.connect(g).connect(ctx.destination)
      s.start(0)
      any = true
    }
  }

  if (!any) return null
  return ctx.startRendering()
}

/** Down-mix an AudioBuffer to 16 kHz mono floats, the format speech recognition models want. */
export async function toMono16k(buf: AudioBuffer): Promise<Float32Array> {
  const len = Math.max(1, Math.ceil(buf.duration * 16000))
  const ctx = new OfflineAudioContext(1, len, 16000)
  const s = ctx.createBufferSource()
  s.buffer = buf
  s.connect(ctx.destination)
  s.start()
  return (await ctx.startRendering()).getChannelData(0).slice()
}

/** Decode one imported audio/video asset to 16 kHz mono (for captions from a voice clip). */
export async function assetTo16k(a: Asset): Promise<Float32Array | null> {
  const probe = new OfflineAudioContext(1, 1, 16000)
  const buf = await decode(probe, a)
  return buf ? toMono16k(buf) : null
}

export { findSegment }
