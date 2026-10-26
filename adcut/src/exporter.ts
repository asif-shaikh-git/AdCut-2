import { engine } from './engine'
import { useStore } from './store'
import { totalDuration } from './types'
import { patchWebmDuration } from './webm'
import { fastExportSupported, startFastExport } from './fastExport'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function pickMime(): string {
  // Only pick MP4 when it is really H.264 + AAC (plays on phones, WhatsApp, Instagram).
  // A bare 'video/mp4' can silently contain VP9, so it is deliberately not listed.
  const options = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

export interface ExportResult {
  blob: Blob
  ext: 'mp4' | 'webm'
  /** something the user should know about the file (e.g. a fallback was used) */
  note?: string
}

/**
 * MVP exporter: plays the timeline in real time and records the canvas + audio.
 * Works everywhere MediaRecorder works. Upgrade path: WebCodecs for faster-than-real-time export.
 */
export function startRealtimeExport() {
  let cancelled = false

  const done = (async (): Promise<ExportResult | null> => {
    if (!engine.canvas) return null
    if (totalDuration(useStore.getState().project) <= 0) return null
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('This browser cannot record video. Try Chrome, Edge or Safari 16+.')
    }

    engine.pause()
    engine.ensureAudio()
    const stream = engine.canvas.captureStream(30)
    engine.dest!.stream.getAudioTracks().forEach((t) => stream.addTrack(t))

    const mime = pickMime()
    const rec = new MediaRecorder(
      stream,
      mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000 } : undefined,
    )
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    const stopped = new Promise<void>((r) => {
      rec.onstop = () => r()
    })

    try {
      engine.setSpeakers(false)
      useStore.setState({ time: 0 })
      await sleep(400) // let the first frame decode
      if (cancelled) return null
      rec.start(500)
      await new Promise<void>((res) => {
        engine.onEnd = res
        engine.play(0)
      })
      await sleep(300) // flush the last frames
    } finally {
      engine.setSpeakers(true)
      if (rec.state !== 'inactive') rec.stop()
      await stopped
      stream.getTracks().forEach((t) => t.stop())
    }

    if (cancelled) return null
    const type = rec.mimeType || mime || 'video/webm'
    const raw = new Blob(chunks, { type })
    const blob = type.includes('webm') ? await patchWebmDuration(raw, totalDuration(useStore.getState().project)) : raw
    return { blob, ext: type.includes('mp4') ? 'mp4' : 'webm' }
  })()

  const cancel = () => {
    cancelled = true
    engine.pause()
    const cb = engine.onEnd
    engine.onEnd = null
    cb?.()
  }

  return { done, cancel }
}

/* ---------- choosing between fast and real-time ---------- */

export type ExportMode = 'fast' | 'realtime'
const MODE_KEY = 'adcut-export-mode'
export const getExportMode = (): ExportMode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'realtime' ? 'realtime' : 'fast'
  } catch {
    return 'fast'
  }
}
export const setExportMode = (m: ExportMode) => {
  try {
    localStorage.setItem(MODE_KEY, m)
  } catch {
    /* ignore */
  }
}

/** Progress of the running export (0..1) for the overlay. null = unknown (real-time mode uses the playhead). */
let prog: { p: number; label: string } | null = null
const subs = new Set<() => void>()
export const exportProgress = {
  get: () => prog,
  subscribe: (f: () => void) => {
    subs.add(f)
    return () => subs.delete(f)
  },
}
const setProg = (p: { p: number; label: string } | null) => {
  prog = p
  subs.forEach((f) => f())
}

/** Fast export (WebCodecs) when the browser can do it, otherwise the real-time recorder. */
export function startExport() {
  let cancelled = false
  let cancelInner: () => void = () => {}
  const done = (async (): Promise<ExportResult | null> => {
    let fallbackNote = ''
    if (getExportMode() === 'fast' && (await fastExportSupported())) {
      const f = startFastExport((p, label) => setProg({ p, label }))
      cancelInner = f.cancel
      try {
        const r = await f.done
        setProg(null)
        return r
      } catch (e) {
        setProg(null)
        if (cancelled) return null
        fallbackNote = `Fast export was not possible here (${e instanceof Error ? e.message : 'unknown reason'}), so the real-time recorder was used.`
      }
    }
    const rt = startRealtimeExport()
    cancelInner = rt.cancel
    const r = await rt.done
    return r ? { ...r, note: fallbackNote || r.note } : r
  })()
  const cancel = () => {
    cancelled = true
    cancelInner()
  }
  return { done, cancel }
}
