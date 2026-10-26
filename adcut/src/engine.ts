import { useStore, setEngineStop } from './store'
import { ASPECTS, Asset, Segment, TextItem, clamp, findSegment, layout, totalDuration } from './types'

type Ctx = CanvasRenderingContext2D

function wrapLines(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) {
      out.push('')
      continue
    }
    let line = words[0]
    for (let i = 1; i < words.length; i++) {
      const test = line + ' ' + words[i]
      if (ctx.measureText(test).width > maxW) {
        out.push(line)
        line = words[i]
      } else line = test
    }
    out.push(line)
  }
  return out
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Owns the media elements, the playback clock and the canvas renderer.
 * The preview and the exporter both use the same canvas, so what you see is what you export.
 */
class Engine {
  canvas: HTMLCanvasElement | null = null
  ac: AudioContext | null = null
  dest: MediaStreamAudioDestinationNode | null = null
  onEnd: (() => void) | null = null

  private speaker: GainNode | null = null
  private hooked = new WeakSet<HTMLMediaElement>()
  private videos = new Map<string, HTMLVideoElement>()
  private images = new Map<string, HTMLImageElement>()
  private musicEl: HTMLAudioElement | null = null
  private musicAsset = ''
  private voices = new Map<string, HTMLAudioElement>()
  private duck = 1
  /** frames decoded by the fast exporter; used instead of the <video> element while exporting */
  frameOverride = new Map<string, { canvas: CanvasImageSource & { width: number; height: number } }>()
  private small = document.createElement('canvas')
  private raf = 0

  attach(c: HTMLCanvasElement) {
    this.canvas = c
    this.render(useStore.getState().time)
  }

  /* ---------- audio graph (needed so export can capture sound) ---------- */

  ensureAudio() {
    if (!this.ac) {
      this.ac = new AudioContext()
      this.dest = this.ac.createMediaStreamDestination()
      this.speaker = this.ac.createGain()
      this.speaker.connect(this.ac.destination)
      this.videos.forEach((v) => this.hook(v))
      if (this.musicEl) this.hook(this.musicEl)
      this.voices.forEach((v) => this.hook(v))
    }
    if (this.ac.state === 'suspended') void this.ac.resume()
  }

  setSpeakers(on: boolean) {
    if (this.speaker) this.speaker.gain.value = on ? 1 : 0
  }

  private hook(el: HTMLMediaElement) {
    if (!this.ac || !this.dest || !this.speaker || this.hooked.has(el)) return
    const src = this.ac.createMediaElementSource(el)
    src.connect(this.speaker)
    src.connect(this.dest)
    this.hooked.add(el)
  }

  /* ---------- media element registry ---------- */

  private repaintIfPaused = () => {
    const s = useStore.getState()
    if (!s.playing) this.render(s.time)
  }

  private video(a: Asset) {
    let v = this.videos.get(a.id)
    if (!v) {
      v = document.createElement('video')
      v.src = a.url
      v.preload = 'auto'
      v.playsInline = true
      v.addEventListener('seeked', this.repaintIfPaused)
      v.addEventListener('loadeddata', this.repaintIfPaused)
      this.videos.set(a.id, v)
      this.hook(v)
    }
    return v
  }

  private image(a: Asset) {
    let i = this.images.get(a.id)
    if (!i) {
      i = new Image()
      i.src = a.url
      i.onload = this.repaintIfPaused
      this.images.set(a.id, i)
    }
    return i
  }

  private music(): HTMLAudioElement | null {
    const { project, assets } = useStore.getState()
    const m = project.music
    const a = m ? assets[m.assetId] : undefined
    if (!m || !a) {
      if (this.musicEl && !this.musicEl.paused) this.musicEl.pause()
      return null
    }
    if (!this.musicEl || this.musicAsset !== a.id) {
      this.musicEl?.pause()
      const el = new Audio()
      el.src = a.url
      el.loop = true
      el.preload = 'auto'
      this.musicEl = el
      this.musicAsset = a.id
      this.hook(el)
    }
    this.musicEl.volume = clamp(m.volume * this.duck, 0, 1)
    return this.musicEl
  }

  /** Music dips to 30% while a voice line is speaking, and eases back afterwards. */
  private updateDuck(t: number, playing: boolean) {
    const { project, assets } = useStore.getState()
    const on = project.music?.duck !== false
    const speaking = on && project.voice.some((v) => {
      const a = assets[v.assetId]
      return a && t >= v.start && t < v.start + a.duration
    })
    const target = speaking ? 0.3 : 1
    this.duck = playing ? this.duck + (target - this.duck) * 0.2 : 1
    if (Math.abs(this.duck - target) < 0.01) this.duck = target
  }

  /** Voice-over lines: each one plays once, at its own start time, over the video. */
  private syncVoice(t: number, playing: boolean) {
    const { project, assets } = useStore.getState()
    const live = new Set(project.voice.map((v) => v.id))
    this.voices.forEach((el, id) => {
      if (!live.has(id)) {
        el.pause()
        this.voices.delete(id)
      }
    })
    for (const v of project.voice) {
      const a = assets[v.assetId]
      if (!a) continue
      let el = this.voices.get(v.id)
      if (!el || el.dataset.asset !== a.id) {
        el?.pause()
        el = new Audio()
        el.src = a.url
        el.preload = 'auto'
        el.dataset.asset = a.id
        this.voices.set(v.id, el)
        this.hook(el)
      }
      el.volume = clamp(v.volume, 0, 1)
      const local = t - v.start
      const inside = local >= 0 && local < a.duration
      if (playing && inside) {
        if (el.paused || Math.abs(el.currentTime - local) > 0.3) {
          el.currentTime = local
          void el.play().catch(() => {})
        }
      } else if (!el.paused) el.pause()
    }
  }

  /** Make sure an image clip is decoded before it is drawn (used by the exporter). */
  async ensureImage(assetId: string) {
    const a = useStore.getState().assets[assetId]
    if (a?.kind !== 'image') return
    const i = this.image(a)
    if (!i.complete) await i.decode().catch(() => undefined)
  }

  /** Drop every cached media element (used when a different project is loaded: ids may get new blob URLs). */
  resetMedia() {
    this.pause()
    this.videos.forEach((v) => {
      v.removeAttribute('src')
      v.load()
    })
    this.videos.clear()
    this.images.clear()
    this.voices.forEach((a) => a.pause())
    this.voices.clear()
    if (this.musicEl) this.musicEl.pause()
    this.musicEl = null
    this.musicAsset = ''
  }

  /* ---------- playback ---------- */

  /** Keeps <video>/<audio> elements aligned with the timeline position. */
  sync(t: number, playing: boolean) {
    const { project, assets } = useStore.getState()
    const seg = findSegment(layout(project), t)
    const active = seg ? assets[seg.clip.assetId] : undefined

    this.videos.forEach((v, id) => {
      if ((!active || active.kind !== 'video' || active.id !== id) && !v.paused) v.pause()
    })

    if (seg && active && active.kind === 'video') {
      const v = this.video(active)
      const want = seg.clip.in + clamp(t - seg.start, 0, seg.end - seg.start) * seg.clip.speed
      v.playbackRate = seg.clip.speed
      if (playing) {
        if (Math.abs(v.currentTime - want) > 0.25) v.currentTime = want
        if (v.paused) void v.play().catch(() => {})
      } else if (Math.abs(v.currentTime - want) > 0.03) {
        v.currentTime = want
      }
    }

    this.syncVoice(t, playing)
    this.updateDuck(t, playing)

    const m = this.music()
    if (m) {
      if (playing) {
        if (m.paused) {
          const d = m.duration
          m.currentTime = isFinite(d) && d > 0 ? t % d : 0
          void m.play().catch(() => {})
        }
      } else if (!m.paused) m.pause()
    }
  }

  play(from?: number) {
    if (this.raf) return
    const st = useStore.getState()
    const total = totalDuration(st.project)
    if (total <= 0) return
    this.ensureAudio()
    const t0 = from ?? (st.time >= total - 0.05 ? 0 : st.time)
    const wall0 = performance.now()
    useStore.setState({ playing: true, time: t0 })
    const tick = () => {
      const t = t0 + (performance.now() - wall0) / 1000
      const end = totalDuration(useStore.getState().project)
      if (t >= end) {
        this.finish(end)
        return
      }
      useStore.setState({ time: t })
      this.sync(t, true)
      this.render(t)
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  pause() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.videos.forEach((v) => {
      if (!v.paused) v.pause()
    })
    if (this.musicEl && !this.musicEl.paused) this.musicEl.pause()
    this.voices.forEach((v) => {
      if (!v.paused) v.pause()
    })
    if (useStore.getState().playing) useStore.setState({ playing: false })
  }

  private finish(end: number) {
    this.pause()
    useStore.setState({ time: end })
    this.render(end)
    const cb = this.onEnd
    this.onEnd = null
    cb?.()
  }

  toggle() {
    if (useStore.getState().playing) this.pause()
    else this.play()
  }

  seek(t: number) {
    if (useStore.getState().playing) this.pause()
    const total = totalDuration(useStore.getState().project)
    useStore.setState({ time: clamp(t, 0, total) })
  }

  nudge(dt: number) {
    this.seek(useStore.getState().time + dt)
  }

  /* ---------- rendering ---------- */

  render(t: number) {
    const c = this.canvas
    if (!c) return
    const { project, assets } = useStore.getState()
    const { w, h } = ASPECTS[project.aspect]
    if (c.width !== w) c.width = w
    if (c.height !== h) c.height = h
    const ctx = c.getContext('2d')!

    const L = layout(project)
    const seg = findSegment(L, t)

    // Work out the picture first; if a video frame isn't decoded yet, keep the last frame on screen.
    let src: CanvasImageSource | null = null
    let sw = 0
    let sh = 0
    if (seg) {
      const a = assets[seg.clip.assetId]
      if (a?.kind === 'image') {
        const i = this.image(a)
        if (i.complete && i.naturalWidth) {
          src = i
          sw = i.naturalWidth
          sh = i.naturalHeight
        }
      } else if (a?.kind === 'video') {
        const ov = this.frameOverride.get(a.id)
        const v = this.video(a)
        if (ov) {
          src = ov.canvas
          sw = ov.canvas.width
          sh = ov.canvas.height
        } else if (v.readyState >= 2) {
          src = v
          sw = v.videoWidth || a.width
          sh = v.videoHeight || a.height
        }
      }
      if (!src) return
    }

    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    if (seg && src) this.drawClip(ctx, seg, src, sw, sh, t, w, h)
    else this.drawEmpty(ctx, w, h)

    for (const tx of project.texts) this.drawText(ctx, tx, t, w, h)

    const lg = project.logo
    const la = lg ? assets[lg.assetId] : undefined
    if (lg && la) {
      const img = this.image(la)
      if (img.complete && img.naturalWidth) {
        const k = Math.min(w, h)
        const lw = k * lg.scale
        const lh = (lw * img.naturalHeight) / img.naturalWidth
        const m = k * 0.04
        const x = lg.corner.endsWith('l') ? m : w - lw - m
        const y = lg.corner.startsWith('t') ? m : h - lh - m
        ctx.drawImage(img, x, y, lw, lh)
      }
    }
  }

  private drawEmpty(ctx: Ctx, w: number, h: number) {
    ctx.fillStyle = '#6b7280'
    ctx.font = `600 ${Math.min(w, h) * 0.05}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Add photos or videos to start', w / 2, h / 2)
  }

  private drawClip(ctx: Ctx, seg: Segment, src: CanvasImageSource, sw: number, sh: number, t: number, w: number, h: number) {
    const dur = seg.end - seg.start
    const local = clamp(t - seg.start, 0, dur)
    ctx.globalAlpha = seg.clip.fade ? clamp(Math.min(local / 0.3, (dur - local) / 0.3), 0, 1) : 1

    if (seg.clip.fit === 'contain') {
      // cheap blurred backdrop: shrink the frame to a tiny canvas, then stretch it back up
      const sc = this.small
      const tw = 36
      const th = Math.max(2, Math.round((tw * h) / w))
      if (sc.width !== tw) sc.width = tw
      if (sc.height !== th) sc.height = th
      const sctx = sc.getContext('2d')!
      const k = Math.max(tw / sw, th / sh)
      sctx.drawImage(src, (tw - sw * k) / 2, (th - sh * k) / 2, sw * k, sh * k)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(sc, 0, 0, w, h)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, 0, w, h)
    }

    const s = seg.clip.fit === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh)
    const dw = sw * s
    const dh = sh * s
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh)
    ctx.globalAlpha = 1
  }

  private drawText(ctx: Ctx, tx: TextItem, t: number, w: number, h: number) {
    const local = t - tx.start
    if (local < 0 || local > tx.duration || !tx.text) return
    const k = Math.min(w, h) / 720
    const size = tx.size * k
    const alpha = clamp(Math.min(local / 0.25, (tx.duration - local) / 0.25), 0, 1)
    const pop = 0.92 + 0.08 * clamp(local / 0.25, 0, 1)

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.font = `800 ${size}px Inter, "Noto Sans Devanagari", "Segoe UI", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const lines = wrapLines(ctx, tx.text, w * 0.86)
    const lh = size * 1.25
    const blockH = lines.length * lh
    ctx.translate(w / 2, tx.y * h)
    ctx.scale(pop, pop)

    if (tx.bg) {
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width))
      const px = size * 0.5
      const py = size * 0.3
      ctx.fillStyle = tx.bg
      roundRectPath(ctx, -widest / 2 - px, -blockH / 2 - py, widest + px * 2, blockH + py * 2, size * 0.3)
      ctx.fill()
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.65)'
      ctx.shadowBlur = size * 0.2
    }
    ctx.fillStyle = tx.color
    lines.forEach((l, i) => ctx.fillText(l, 0, -blockH / 2 + lh * i + lh / 2))
    ctx.restore()
  }
}

export const engine = new Engine()

// When paused, any change to the project, assets or playhead repaints the canvas.
useStore.subscribe((s, prev) => {
  if (s.playing) return
  if (s.project !== prev.project || s.assets !== prev.assets || s.time !== prev.time || s.playing !== prev.playing) {
    engine.sync(s.time, false)
    engine.render(s.time)
  }
})

// Make sure the bundled Hindi (Devanagari) + Latin glyphs are ready before they are drawn on the canvas,
// then repaint. Without this the first frames could use a fallback font.
if (typeof document !== 'undefined' && document.fonts) {
  void Promise.all([
    document.fonts.load('800 40px "Noto Sans Devanagari"', 'हिन्दी कैंडल'),
    document.fonts.load('800 40px "Noto Sans Devanagari"', 'Abc 123'),
  ])
    .then(() => {
      const s = useStore.getState()
      if (!s.playing) engine.render(s.time)
    })
    .catch(() => {})
}

setEngineStop(() => engine.resetMedia())
