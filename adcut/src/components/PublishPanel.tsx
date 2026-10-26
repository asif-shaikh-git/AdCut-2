import { useEffect, useRef, useState } from 'react'
import { startExport } from '../exporter'
import { useStore } from '../store'
import { totalDuration } from '../types'
import {
  EvsSession,
  EvsSettings,
  EvsVideo,
  checkConnection,
  deleteVideo,
  listVideos,
  loadEvs,
  mintSession,
  saveEvs,
  shareVideo,
  unshareVideo,
  uploadVideo,
} from '../evs'

function HlsPlayer({ session, onExpired }: { session: EvsSession; onExpired: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    let hls: { destroy(): void } | null = null
    let dead = false
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = session.manifestUrl
    } else {
      void import('hls.js').then(({ default: Hls }) => {
        if (dead || !Hls.isSupported()) return
        const h = new Hls()
        h.on(Hls.Events.ERROR, (_e, d) => {
          if (d.fatal && d.response && (d.response.code === 401 || d.response.code === 403)) onExpired()
        })
        h.loadSource(session.manifestUrl)
        h.attachMedia(v)
        hls = h
      })
    }
    return () => {
      dead = true
      hls?.destroy()
    }
  }, [session, onExpired])
  return <video ref={ref} className="evs-video" controls playsInline poster={session.posterUrl} />
}

export default function PublishPanel() {
  const [cfg, setCfg] = useState<EvsSettings>(loadEvs)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('My ad')
  const [videos, setVideos] = useState<EvsVideo[]>([])
  const [links, setLinks] = useState<Record<string, string>>({})
  const [watching, setWatching] = useState<{ id: string; session: EvsSession } | null>(null)
  const hasClips = useStore((s) => s.project.clips.length > 0)
  const time = useStore((s) => s.time)
  const exporting = useRef<ReturnType<typeof startExport> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const patch = (p: Partial<EvsSettings>) => {
    const n = { ...cfg, ...p }
    setCfg(n)
    saveEvs(n)
    if ('apiBase' in p || 'apiKey' in p) setConnected(null)
  }

  async function refresh(s = cfg) {
    try {
      const r = await listVideos(s)
      setVideos(r.data)
      setConnected(true)
    } catch (e) {
      setConnected(false)
      setMsg(e instanceof Error ? e.message : 'Could not load videos.')
    }
  }

  async function connect() {
    setMsg('')
    try {
      await checkConnection(cfg)
      setConnected(true)
      setMsg('Connected to EVS.')
      void refresh()
    } catch (e) {
      setConnected(false)
      setMsg(e instanceof Error ? e.message : 'Connection failed.')
    }
  }

  // poll while anything is still being processed
  useEffect(() => {
    if (!connected || !videos.some((v) => v.status !== 'ready' && v.status !== 'failed' && v.status !== 'cancelled')) return
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  })

  useEffect(() => {
    if (cfg.apiKey) void connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function publish(blob: Blob, filename: string) {
    await uploadVideo(cfg, blob, filename, title.trim() || 'My ad', setMsg)
    setMsg('Uploaded. EVS is now making the encrypted streaming version — it appears below when ready.')
    await refresh()
  }

  async function exportAndPublish() {
    if (busy) return
    setBusy(true)
    setMsg('Recording the ad in real time… keep this tab open.')
    try {
      const j = startExport()
      exporting.current = j
      const r = await j.done
      if (!r) {
        setMsg('Export cancelled.')
        return
      }
      await publish(r.blob, `adcut-${Date.now()}.${r.ext}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Publishing failed.')
    } finally {
      exporting.current = null
      setBusy(false)
    }
  }

  async function publishFile(f: File) {
    setBusy(true)
    try {
      await publish(f, f.name)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Publishing failed.')
    } finally {
      setBusy(false)
    }
  }

  async function watch(id: string) {
    try {
      setWatching({ id, session: await mintSession(cfg, id) })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not start playback.')
    }
  }

  const total = totalDuration(useStore.getState().project)

  return (
    <div className="tab publish">
      <h4>Connect to EVS</h4>
      <p className="hint">
        EVS stores your finished ads as protected streaming videos. Start it first (see docs/EVS-INTEGRATION.md), then paste a
        key with video and playback permissions.
      </p>
      <label className="field">
        <span>EVS address</span>
        <input value={cfg.apiBase} onChange={(e) => patch({ apiBase: e.target.value })} placeholder="http://localhost:8080" />
      </label>
      <label className="field">
        <span>API key</span>
        <input type="password" value={cfg.apiKey} onChange={(e) => patch({ apiKey: e.target.value })} placeholder="evs_…" />
      </label>
      <label className="field">
        <span>Viewer name (watermark)</span>
        <input value={cfg.viewerId} onChange={(e) => patch({ viewerId: e.target.value })} />
      </label>
      <label className="field">
        <span>Share page address</span>
        <input value={cfg.shareBase} onChange={(e) => patch({ shareBase: e.target.value })} placeholder="http://localhost:8090" />
      </label>
      <button className="wide" onClick={connect} disabled={!cfg.apiKey}>
        {connected ? '● Connected — test again' : 'Connect'}
      </button>

      <h4>Publish this ad</h4>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button className="primary wide" onClick={exportAndPublish} disabled={busy || !connected || !hasClips}>
        {busy ? `Working… ${total ? Math.round((time / total) * 100) : 0}%` : 'Export and publish to EVS'}
      </button>
      {busy && exporting.current && (
        <button className="wide" onClick={() => exporting.current?.cancel()}>
          Cancel export
        </button>
      )}
      <button className="wide" disabled={busy || !connected} onClick={() => fileRef.current?.click()}>
        Publish a video file from my computer
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void publishFile(f)
        }}
      />
      {msg && <p className="hint publish-msg">{msg}</p>}

      <h4>Published ads</h4>
      {connected && videos.length === 0 && <p className="hint">Nothing published yet.</p>}
      <div className="evs-list">
        {videos.map((v) => (
          <div className="evs-row" key={v.id}>
            <div className="evs-main">
              <strong>{v.title}</strong>
              <small>
                {v.status === 'ready'
                  ? `ready${v.durationSeconds ? ` · ${v.durationSeconds.toFixed(0)}s` : ''}${v.renditions?.length ? ` · ${v.renditions.map((r) => r.height + 'p').join(' / ')}` : ''}`
                  : v.status === 'failed'
                    ? `failed: ${v.error ?? 'unknown error'}`
                    : `${v.status}${v.stage ? ` · ${v.stage}` : ''} · ${v.progress}%`}
              </small>
            </div>
            <div className="evs-actions">
              {v.status === 'ready' && <button onClick={() => void watch(v.id)}>▶ Watch</button>}
              {v.status === 'ready' && (
                <button
                  title="Copy a public watch link"
                  onClick={async () => {
                    try {
                      const link = await shareVideo(cfg, v.id)
                      setLinks((l) => ({ ...l, [v.id]: link }))
                      try {
                        await navigator.clipboard.writeText(link)
                        setMsg('Link copied. Anyone who can reach that address can watch this ad.')
                      } catch {
                        setMsg('Link created — copy it from the box under the ad.')
                      }
                    } catch (e) {
                      setMsg(e instanceof Error ? e.message : 'Could not create a share link.')
                    }
                  }}
                >
                  🔗 Link
                </button>
              )}
              <button
                title="Delete from EVS"
                onClick={async () => {
                  if (!confirm(`Delete “${v.title}” from EVS?`)) return
                  try {
                    await deleteVideo(cfg, v.id)
                    if (watching?.id === v.id) setWatching(null)
                    await refresh()
                  } catch (e) {
                    setMsg(e instanceof Error ? e.message : 'Delete failed.')
                  }
                }}
              >
                🗑
              </button>
            </div>
            {links[v.id] && (
              <div className="evs-link">
                <input readOnly value={links[v.id]} onFocus={(e) => e.currentTarget.select()} />
                <button
                  onClick={async () => {
                    const off = await unshareVideo(cfg, v.id)
                    setLinks((l) => {
                      const n = { ...l }
                      delete n[v.id]
                      return n
                    })
                    setMsg(off ? 'Link turned off.' : 'This share server cannot switch links off. Delete the ad (🗑) to stop access.')
                  }}
                >
                  Stop sharing
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {watching && (
        <div className="evs-player">
          <HlsPlayer session={watching.session} onExpired={() => void watch(watching.id)} />
          <button className="wide" onClick={() => setWatching(null)}>
            Close player
          </button>
        </div>
      )}
    </div>
  )
}
