import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
  type WrappedCanvas,
} from 'mediabunny'
import { mixAudio } from './audioMix'
import { engine } from './engine'
import { useStore } from './store'
import { ASPECTS, layout, totalDuration } from './types'
import type { ExportResult } from './exporter'

const FPS = 30
const BITRATE = 6_000_000

export async function fastExportSupported(): Promise<boolean> {
  try {
    if (typeof VideoEncoder === 'undefined' || typeof AudioBuffer === 'undefined') return false
    const { w, h } = ASPECTS[useStore.getState().project.aspect]
    return !!(await getFirstEncodableVideoCodec(['avc', 'vp9'], { width: w, height: h, bitrate: BITRATE }))
  } catch {
    return false
  }
}

export function startFastExport(onProgress: (p: number, label: string) => void) {
  let cancelled = false
  const cancel = () => {
    cancelled = true
  }

  const done = (async (): Promise<ExportResult | null> => {
    const S = useStore.getState()
    const project = S.project
    const total = totalDuration(project)
    if (!engine.canvas || total <= 0) return null
    const { w, h } = ASPECTS[project.aspect]
    engine.pause()
    engine.canvas.width = w
    engine.canvas.height = h

    // 1. pick codecs
    const vcodec = await getFirstEncodableVideoCodec(['avc', 'vp9'], { width: w, height: h, bitrate: BITRATE })
    if (!vcodec) throw new Error('This browser cannot encode video quickly.')
    const mp4 = vcodec === 'avc'
    let acodec: 'aac' | 'opus' = 'opus'
    let note = ''
    if (mp4) {
      if (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 128000 })) acodec = 'aac'
      else note = 'Sound was saved as Opus because this browser cannot make AAC. Some phones/apps may not play it: export from Chrome or Edge on Windows/Mac for the most compatible MP4.'
    }

    // 2. soundtrack (offline, quick)
    onProgress(0, 'Mixing sound…')
    const audio = await mixAudio()
    if (cancelled) return null

    // 3. open every video clip once for fast decoding
    onProgress(0, 'Preparing video…')
    const L = layout(project)
    const sinks = new Map<string, CanvasSink>()
    const inputs: Input[] = []
    for (const seg of L) {
      const a = S.assets[seg.clip.assetId]
      if (!a) continue
      if (a.kind === 'image') await engine.ensureImage(a.id)
      if (a.kind !== 'video' || sinks.has(a.id)) continue
      const blob = await fetch(a.url).then((r) => r.blob())
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
      const track = await input.getPrimaryVideoTrack()
      if (!track) throw new Error(`Could not read the video track of ${a.name}`)
      sinks.set(a.id, new CanvasSink(track))
      inputs.push(input)
    }

    // 4. one timestamp list per clip; each is consumed in order by that clip's decoder
    const n = Math.max(1, Math.round(total * FPS))
    const iters = new Map<number, AsyncGenerator<WrappedCanvas | null, void, unknown>>()
    const segOfFrame: number[] = []
    const perSeg: number[][] = L.map(() => [])
    for (let i = 0; i < n; i++) {
      const t = i / FPS
      const idx = L.findIndex((s) => t >= s.start && t < s.end)
      const si = idx < 0 ? L.length - 1 : idx
      segOfFrame.push(si)
      const seg = L[si]
      perSeg[si].push(Math.max(0, seg.clip.in + (t - seg.start) * seg.clip.speed))
    }
    L.forEach((seg, si) => {
      const sink = sinks.get(seg.clip.assetId)
      if (sink && perSeg[si].length) iters.set(si, sink.canvasesAtTimestamps(perSeg[si]))
    })

    // 5. output
    const output = new Output({
      format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    })
    const vsrc = new CanvasSource(engine.canvas, { codec: vcodec, bitrate: BITRATE, keyFrameInterval: 2 })
    output.addVideoTrack(vsrc, { frameRate: FPS })
    const asrc = audio ? new AudioBufferSource({ codec: acodec, bitrate: 128000 }) : null
    if (asrc) output.addAudioTrack(asrc)
    await output.start()

    try {
      let last: WrappedCanvas | null = null
      let lastSeg = -1
      for (let i = 0; i < n; i++) {
        if (cancelled) {
          await output.cancel()
          return null
        }
        const si = segOfFrame[i]
        const seg = L[si]
        const it = iters.get(si)
        if (it) {
          const r = await it.next()
          const frame: WrappedCanvas | null = r.done ? last : (r.value ?? last)
          if (frame) {
            last = frame
            engine.frameOverride.set(seg.clip.assetId, { canvas: frame.canvas as HTMLCanvasElement })
          }
        }
        if (lastSeg !== si) lastSeg = si
        engine.render(i / FPS)
        await vsrc.add(i / FPS, 1 / FPS)
        if (i % 6 === 0) {
          onProgress(i / n, 'Exporting…')
          useStore.setState({ time: i / FPS })
          await new Promise((r) => setTimeout(r, 0)) // let the page breathe
        }
      }
      if (asrc && audio) await asrc.add(audio)
      onProgress(1, 'Finishing…')
      await output.finalize()
    } finally {
      engine.frameOverride.clear()
      inputs.forEach((i) => i.dispose())
      useStore.setState({ time: 0 })
      engine.render(0)
    }
    const buf = (output.target as BufferTarget).buffer
    if (!buf) throw new Error('The encoder produced no file.')
    return { blob: new Blob([buf], { type: mp4 ? 'video/mp4' : 'video/webm' }), ext: mp4 ? 'mp4' : 'webm', note }
  })()

  return { done, cancel }
}
