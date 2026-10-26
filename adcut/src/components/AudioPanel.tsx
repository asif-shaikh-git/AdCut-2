import { useEffect, useRef, useState } from 'react'
import { engine } from '../engine'
import { importFile } from '../media'
import { useStore } from '../store'
import { totalDuration, uid } from '../types'
import { patchWebmDuration } from '../webm'
import { generateCaptions, type CaptionModel } from '../captions'

const DEV_KEY = 'adcut-mic'
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const isVoice = (name: string) => name.startsWith('voice-')

type Phase = 'idle' | 'countdown' | 'recording' | 'saving'

export default function AudioPanel() {
  const assets = useStore((s) => s.assets)
  const music = useStore((s) => s.project.music)
  const voice = useStore((s) => s.project.voice)
  const hasClips = useStore((s) => s.project.clips.length > 0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(3)
  const [level, setLevel] = useState(0)
  const [msg, setMsg] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [dev, setDev] = useState(() => {
    try {
      return localStorage.getItem(DEV_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const fileRef = useRef<HTMLInputElement>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const S = useStore.getState

  const songs = Object.values(assets).filter((a) => a.kind === 'audio' && !isVoice(a.name))
  const music_a = music ? assets[music.assetId] : undefined

  const loadDevices = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === 'audioinput'))
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    void loadDevices()
    return () => stopRef.current?.()
  }, [])

  async function importAudio(files: FileList) {
    const bad: string[] = []
    for (const f of Array.from(files)) {
      try {
        S().addAsset(await importFile(f))
      } catch {
        bad.push(f.name)
      }
    }
    setMsg(bad.length ? `Couldn't read: ${bad.join(', ')} (try MP3, WAV, M4A or OGG)` : '')
  }

  async function record() {
    if (phase !== 'idle') return
    setMsg('')
    if (!hasClips) {
      setMsg('Add your video clips to the timeline first, then record your voice over them.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMsg('This browser cannot record from a microphone. Use Chrome, Edge or Safari 16+.')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: dev ? { exact: dev } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
    } catch (e) {
      const n = (e as DOMException).name
      setMsg(
        n === 'NotAllowedError'
          ? 'Microphone is blocked. Click the lock icon in the address bar, allow the microphone, and try again.'
          : n === 'NotFoundError'
            ? 'No microphone found. Plug in your headset and try again.'
            : 'Could not open the microphone.',
      )
      return
    }
    void loadDevices()

    const total = totalDuration(S().project)
    const t0 = S().time >= total - 0.3 ? 0 : S().time
    engine.seek(t0)
    engine.ensureAudio()

    // level meter
    const ctx = engine.ac!
    const an = ctx.createAnalyser()
    an.fftSize = 512
    const src = ctx.createMediaStreamSource(stream)
    src.connect(an)
    const buf = new Uint8Array(an.fftSize)
    let meter = 0
    const tick = () => {
      an.getByteTimeDomainData(buf)
      let peak = 0
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
      setLevel(Math.min(1, peak / 90))
      meter = requestAnimationFrame(tick)
    }
    tick()

    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    let startedAt = 0
    let cancelled = false
    let finished = false

    const cleanup = () => {
      cancelAnimationFrame(meter)
      src.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      setLevel(0)
    }

    const finish = async () => {
      if (finished) return
      finished = true
      engine.onEnd = null
      engine.pause()
      const secs = (performance.now() - startedAt) / 1000
      const stopped = new Promise<void>((r) => (rec.onstop = () => r()))
      if (rec.state !== 'inactive') rec.stop()
      await stopped
      cleanup()
      stopRef.current = null
      if (cancelled || secs < 0.4) {
        setPhase('idle')
        setMsg(cancelled ? 'Recording cancelled.' : 'That was too short, nothing was saved.')
        return
      }
      setPhase('saving')
      try {
        const type = rec.mimeType || mime || 'audio/webm'
        const raw = new Blob(chunks, { type })
        const blob = type.includes('webm') ? await patchWebmDuration(raw, secs) : raw
        const n = Object.values(S().assets).filter((a) => isVoice(a.name)).length + 1
        const file = new File([blob], `voice-${n}.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type })
        const asset = await importFile(file)
        S().addAsset(asset)
        S().setVoice([...S().project.voice, { id: uid(), assetId: asset.id, start: t0, volume: 1 }])
        setMsg(`Saved ${asset.name} (${secs.toFixed(1)}s) at ${fmtT(t0)}. Press Space to hear it with the video.`)
      } catch {
        setMsg('Could not save that recording. Please try again.')
      }
      setPhase('idle')
    }

    stopRef.current = () => {
      cancelled = true
      void finish()
    }
    ;(window as unknown as { __stopVoice?: () => void }).__stopVoice = () => void finish()

    setPhase('countdown')
    for (let i = 3; i >= 1; i--) {
      setCount(i)
      await new Promise((r) => setTimeout(r, 800))
      if (cancelled) return
    }
    setPhase('recording')
    startedAt = performance.now()
    rec.start(250)
    engine.onEnd = () => void finish()
    engine.play(t0)
  }

  const nudge = (id: string, d: number) =>
    S().setVoice(S().project.voice.map((v) => (v.id === id ? { ...v, start: Math.max(0, +(v.start + d).toFixed(2)) } : v)))

  const total = totalDuration(S().project)

  const [cap, setCap] = useState({ source: 'voice' as 'voice' | 'video', language: 'hindi' as 'hindi' | 'english', model: 'small' as CaptionModel, replace: true })
  const [capBusy, setCapBusy] = useState(false)
  const [capMsg, setCapMsg] = useState('')
  const [capPct, setCapPct] = useState<number | null>(null)
  async function makeCaptions() {
    setCapBusy(true)
    setCapMsg('')
    setCapPct(null)
    try {
      const n = await generateCaptions({
        ...cap,
        onStatus: (t, p) => {
          setCapMsg(t)
          setCapPct(p ?? null)
        },
      })
      setCapMsg(`Added ${n} caption lines. Check the spelling in the Text tab: Whisper is good but not perfect in Hindi.`)
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Captions failed.'
      setCapMsg(/speech|clip|sound/i.test(m) ? m : `Could not make captions (the speech model needs internet the first time): ${m}`)
    } finally {
      setCapBusy(false)
      setCapPct(null)
    }
  }

  return (
    <div className="tab audio-tab">
      <h4>Voice-over</h4>
      <p className="hint">
        Put on your headphones (so the video sound doesn't leak into the mic), pick your headset mic, press Record, and talk
        while the video plays. Recording starts at the playhead.
      </p>
      <label className="field">
        <span>Microphone</span>
        <select
          value={dev}
          disabled={phase !== 'idle'}
          onChange={(e) => {
            setDev(e.target.value)
            try {
              localStorage.setItem(DEV_KEY, e.target.value)
            } catch {
              /* ignore */
            }
          }}
          onFocus={() => void loadDevices()}
        >
          <option value="">Default microphone</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
      </label>

      {phase === 'idle' && (
        <button className="primary wide" onClick={() => void record()}>
          ● Record voice from the playhead
        </button>
      )}
      {phase === 'countdown' && (
        <button className="wide" onClick={() => stopRef.current?.()}>
          Starting in {count}… (cancel)
        </button>
      )}
      {phase === 'recording' && (
        <>
          <button className="rec-stop wide" onClick={() => (window as unknown as { __stopVoice: () => void }).__stopVoice()}>
            ■ Stop recording
          </button>
          <div className="meter" aria-label="Microphone level">
            <div style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <p className="hint">Recording… {fmtT(useStore.getState().time)} / {fmtT(total)}. It stops by itself at the end of the video.</p>
        </>
      )}
      {phase === 'saving' && <p className="hint">Saving your recording…</p>}
      {msg && <p className="hint">{msg}</p>}

      {voice.length > 0 && (
        <>
          <h5 className="ugc-sub">Voice clips</h5>
          <div className="evs-list">
            {voice.map((v) => {
              const a = assets[v.assetId]
              if (!a) return null
              return (
                <div className="evs-row voice-row" key={v.id}>
                  <div className="evs-main">
                    <strong>🎙 {a.name}</strong>
                    <small>
                      starts {fmtT(v.start)} · {a.duration.toFixed(1)}s
                    </small>
                  </div>
                  <div className="evs-actions">
                    <button title="Earlier by 0.1s" onClick={() => nudge(v.id, -0.1)}>
                      ◀
                    </button>
                    <button title="Later by 0.1s" onClick={() => nudge(v.id, 0.1)}>
                      ▶
                    </button>
                    <button title="Remove from timeline" onClick={() => S().setVoice(voice.filter((x) => x.id !== v.id))}>
                      🗑
                    </button>
                  </div>
                  <label className="vol">
                    Volume {Math.round(v.volume * 100)}%
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={v.volume}
                      onChange={(e) => S().setVoice(voice.map((x) => (x.id === v.id ? { ...x, volume: +e.target.value } : x)), 'voicevol')}
                    />
                  </label>
                </div>
              )
            })}
          </div>
          <p className="hint">If your voice feels slightly late against the picture, nudge it earlier with ◀.</p>
        </>
      )}

      <h4>Captions from your voice</h4>
      <div className="cap-ctl">
        <label>
          Listen to
          <select value={cap.source} onChange={(e) => setCap({ ...cap, source: e.target.value as 'voice' | 'video' })}>
            <option value="voice">My voice clips</option>
            <option value="video">Sound of the video clips</option>
          </select>
        </label>
        <label>
          Language
          <select value={cap.language} onChange={(e) => setCap({ ...cap, language: e.target.value as 'hindi' | 'english' })}>
            <option value="hindi">Hindi / Hinglish (देवनागरी)</option>
            <option value="english">English</option>
          </select>
        </label>
        <label>
          Accuracy
          <select value={cap.model} onChange={(e) => setCap({ ...cap, model: e.target.value as CaptionModel })}>
            <option value="tiny">Fastest (tiny, ~40 MB, rough)</option>
            <option value="base">Balanced (base, ~80 MB)</option>
            <option value="small">Best for Hindi (small, ~250 MB)</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={cap.replace} onChange={(e) => setCap({ ...cap, replace: e.target.checked })} />
          Replace my existing captions
        </label>
        <button className="primary" disabled={capBusy || !hasClips} onClick={() => void makeCaptions()}>
          {capBusy ? 'Working…' : 'Make captions'}
        </button>
        {capPct !== null && (
          <div className="bar">
            <div style={{ width: `${Math.round(capPct * 100)}%` }} />
          </div>
        )}
        {capMsg && <p className="hint">{capMsg}</p>}
        <p className="hint">Runs on your computer. The first time it downloads the speech model once; after that it works offline.</p>
      </div>

      <h4>Music</h4>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importAudio(e.target.files)
          e.target.value = ''
        }}
      />
      <button className="wide" onClick={() => fileRef.current?.click()}>
        + Add a song or sound file (MP3, WAV, M4A)
      </button>
      <p className="hint">
        Download music first (it's a file on your computer), then add it here. Only use music you have the right to use in ads:
        e.g. YouTube Audio Library, Pixabay Music, Free Music Archive, or a paid library. Check each track's licence.
      </p>
      {songs.length === 0 && <p className="hint">No songs added yet.</p>}
      <div className="evs-list">
        {songs.map((a) => (
          <div className="evs-row" key={a.id}>
            <div className="evs-main">
              <strong>♪ {a.name}</strong>
              <small>{fmtT(a.duration)}</small>
            </div>
            <div className="evs-actions">
              <button
                className={music?.assetId === a.id ? 'on' : ''}
                onClick={() => S().setMusic({ assetId: a.id, volume: music?.volume ?? 0.6, duck: music?.duck })}
              >
                {music?.assetId === a.id ? '✓ In use' : 'Use as music'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {music && music_a && (
        <div className="music-ctl">
          <label className="vol">
            Music volume {Math.round(music.volume * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={music.volume}
              onChange={(e) => S().setMusic({ ...music, volume: +e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={music.duck !== false}
              onChange={(e) => S().setMusic({ ...music, duck: e.target.checked })}
            />
            Lower the music automatically while I'm speaking
          </label>
          <button onClick={() => S().setMusic(null)}>Remove music</button>
          <p className="hint">Music repeats if it is shorter than the video and stops when the video ends.</p>
        </div>
      )}
    </div>
  )
}
