import { useEffect, useMemo, useRef, useState } from 'react'
import { engine } from '../engine'
import { useStore } from '../store'
import { Segment, TextItem, clamp, fmt, layout } from '../types'

function assignLanes(texts: TextItem[]): Map<string, number> {
  const sorted = [...texts].sort((a, b) => a.start - b.start)
  const ends: number[] = []
  const m = new Map<string, number>()
  for (const t of sorted) {
    let i = ends.findIndex((e) => e <= t.start + 1e-6)
    if (i < 0) {
      i = ends.length
      ends.push(0)
    }
    ends[i] = t.start + t.duration
    m.set(t.id, i)
  }
  return m
}

function Playhead({ pps }: { pps: number }) {
  const t = useStore((s) => s.time)
  return <div className="playhead" style={{ transform: `translateX(${t * pps}px)` }} />
}

export default function Timeline() {
  const project = useStore((s) => s.project)
  const assets = useStore((s) => s.assets)
  const selected = useStore((s) => s.selected)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)

  const [pps, setPps] = useState(80)
  const ppsRef = useRef(pps)
  ppsRef.current = pps
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number; idx: number } | null>(null)
  const dragRef = useRef({ dx: 0, idx: 0 })

  const L = useMemo(() => layout(project), [project])
  const total = L.length ? L[L.length - 1].end : 0
  const lanes = useMemo(() => assignLanes(project.texts), [project.texts])
  const laneCount = lanes.size ? Math.max(...lanes.values()) + 1 : 1
  const contentW = Math.max(total + 3, 10) * pps

  // keep the playhead in view while playing
  useEffect(
    () =>
      useStore.subscribe((s) => {
        if (!s.playing) return
        const el = scroller.current
        if (!el) return
        const x = s.time * ppsRef.current
        if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80)
      }),
    [],
  )

  /* ---------- seeking ---------- */
  const seekFrom = (e: React.PointerEvent<HTMLElement>, el: HTMLElement) => {
    const x = e.clientX - el.getBoundingClientRect().left
    engine.seek(clamp(x / ppsRef.current, 0, total))
  }
  const onRulerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    seekFrom(e, el)
  }
  const onRulerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons & 1) seekFrom(e, e.currentTarget)
  }
  const onTrackBgDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    useStore.getState().select(null)
    seekFrom(e, e.currentTarget)
  }

  /* ---------- clip: drag to reorder ---------- */
  const startClipDrag = (e: React.PointerEvent<HTMLDivElement>, seg: Segment) => {
    if (e.button !== 0) return
    e.stopPropagation()
    useStore.getState().select({ type: 'clip', id: seg.clip.id })
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const w = (seg.end - seg.start) * ppsRef.current
    const others = L.filter((s) => s.clip.id !== seg.clip.id)
    let moved = false

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (!moved && Math.abs(dx) < 4) return
      moved = true
      const center = seg.start * ppsRef.current + dx + w / 2
      let idx = 0
      let acc = 0
      for (const o of others) {
        const d = (o.end - o.start) * ppsRef.current
        if (center > acc + d / 2) idx++
        acc += d
      }
      dragRef.current = { dx, idx }
      setDrag({ id: seg.clip.id, dx, idx })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (moved) useStore.getState().moveClip(seg.clip.id, dragRef.current.idx)
      setDrag(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  /* ---------- clip: trim handles ---------- */
  const startTrim = (e: React.PointerEvent<HTMLDivElement>, seg: Segment, side: 'l' | 'r') => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const S = useStore.getState()
    S.select({ type: 'clip', id: seg.clip.id })
    const asset = assets[seg.clip.assetId]
    const c0 = seg.clip
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    S.beginEdit()

    const move = (ev: PointerEvent) => {
      const dSrc = ((ev.clientX - startX) / ppsRef.current) * c0.speed
      useStore.getState().update((p) => ({
        ...p,
        clips: p.clips.map((c) => {
          if (c.id !== c0.id) return c
          if (side === 'l') return { ...c, in: clamp(c0.in + dSrc, 0, c0.out - 0.2) }
          const maxOut = asset?.kind === 'video' ? asset.duration : c0.in + 60
          return { ...c, out: clamp(c0.out + dSrc, c0.in + 0.2, maxOut) }
        }),
      }))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      useStore.getState().endEdit()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  /* ---------- text: move / resize ---------- */
  const startTextDrag = (e: React.PointerEvent<HTMLDivElement>, t0: TextItem, mode: 'move' | 'l' | 'r') => {
    if (e.button !== 0) return
    e.stopPropagation()
    const S = useStore.getState()
    S.select({ type: 'text', id: t0.id })
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    S.beginEdit()

    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - startX) / ppsRef.current
      useStore.getState().update((p) => ({
        ...p,
        texts: p.texts.map((t) => {
          if (t.id !== t0.id) return t
          if (mode === 'move') return { ...t, start: Math.max(0, t0.start + dt) }
          if (mode === 'r') return { ...t, duration: Math.max(0.3, t0.duration + dt) }
          const ns = clamp(t0.start + dt, 0, t0.start + t0.duration - 0.3)
          return { ...t, start: ns, duration: t0.duration - (ns - t0.start) }
        }),
      }))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      useStore.getState().endEdit()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  /* ---------- voice clips: drag to move (snaps to 0.1 s; Shift = free) ---------- */
  const startVoiceDrag = (e: React.PointerEvent<HTMLDivElement>, id: string, start0: number) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    useStore.getState().beginEdit()
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - startX) / ppsRef.current
      let ns = Math.max(0, start0 + dt)
      if (!ev.shiftKey) ns = Math.round(ns * 10) / 10
      useStore.getState().update((p) => ({ ...p, voice: p.voice.map((v) => (v.id === id ? { ...v, start: ns } : v)) }))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      useStore.getState().endEdit()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  /* ---------- ruler ticks ---------- */
  const step = pps >= 100 ? 0.5 : pps >= 50 ? 1 : pps >= 25 ? 2 : 5
  const ticks: number[] = []
  for (let t = 0; t <= contentW / pps; t += step) ticks.push(+t.toFixed(2))

  // where the drop indicator goes while reordering
  let indicatorX = 0
  if (drag) {
    const others = L.filter((s) => s.clip.id !== drag.id)
    indicatorX = others.slice(0, drag.idx).reduce((a, s) => a + (s.end - s.start) * pps, 0)
  }

  const S = useStore.getState
  const musicAsset = project.music ? assets[project.music.assetId] : undefined

  return (
    <section className="timeline">
      <div className="tl-bar">
        <button onClick={() => S().split()} title="Split at playhead (S)">
          ✂ Split
        </button>
        <button onClick={() => S().duplicateSelected()} disabled={!selected} title="Duplicate (D)">
          ⧉ Duplicate
        </button>
        <button onClick={() => S().removeSelected()} disabled={!selected} title="Delete (Del)">
          🗑 Delete
        </button>
        <span className="sep" />
        <button onClick={() => S().addText()} title="Add a text overlay at the playhead">
          T+ Text
        </button>
        <span className="sep" />
        <button onClick={() => S().undo()} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
          ↶
        </button>
        <button onClick={() => S().redo()} disabled={!canRedo} title="Redo (Shift+Ctrl/Cmd+Z)">
          ↷
        </button>
        <span className="grow" />
        <label className="zoom">
          Zoom
          <input type="range" min={30} max={240} value={pps} onChange={(e) => setPps(+e.target.value)} />
        </label>
      </div>

      <div className="tl-scroll" ref={scroller}>
        <div className="tl-content" style={{ width: contentW, minWidth: '100%' }} onPointerDown={onTrackBgDown}>
          <div className="ruler" onPointerDown={onRulerDown} onPointerMove={onRulerMove}>
            {ticks.map((t) => (
              <span key={t} className={`tick ${Number.isInteger(t) ? 'major' : ''}`} style={{ left: t * pps }}>
                {Number.isInteger(t) && (step >= 1 || t % 1 === 0) ? fmt(t).slice(0, 5) : ''}
              </span>
            ))}
          </div>

          {/* main video track */}
          <div className="track video" onPointerDown={onTrackBgDown}>
            {!L.length && <div className="empty-hint">Import media on the left, then click “+ Timeline”</div>}
            {L.map((seg) => {
              const a = assets[seg.clip.assetId]
              const sel = selected?.type === 'clip' && selected.id === seg.clip.id
              const dragging = drag?.id === seg.clip.id
              return (
                <div
                  key={seg.clip.id}
                  className={`clip ${a?.kind ?? ''} ${sel ? 'sel' : ''} ${dragging ? 'dragging' : ''}`}
                  style={{
                    left: seg.start * pps,
                    width: Math.max(10, (seg.end - seg.start) * pps - 2),
                    backgroundImage: a?.thumb ? `url(${a.thumb})` : undefined,
                    transform: dragging ? `translateX(${drag!.dx}px)` : undefined,
                  }}
                  onPointerDown={(e) => startClipDrag(e, seg)}
                >
                  <div className="handle l" onPointerDown={(e) => startTrim(e, seg, 'l')} />
                  <div className="label">
                    {a?.name ?? 'missing'} · {(seg.end - seg.start).toFixed(1)}s
                    {seg.clip.speed !== 1 ? ` · ${seg.clip.speed}x` : ''}
                  </div>
                  <div className="handle r" onPointerDown={(e) => startTrim(e, seg, 'r')} />
                </div>
              )
            })}
            {drag && <div className="drop-line" style={{ left: indicatorX }} />}
          </div>

          {/* text track */}
          <div className="track texts" style={{ height: laneCount * 30 + 8 }} onPointerDown={onTrackBgDown}>
            {project.texts.map((t) => {
              const sel = selected?.type === 'text' && selected.id === t.id
              return (
                <div
                  key={t.id}
                  className={`tblock ${t.tag ? "tag-" + t.tag : ''} ${sel ? 'sel' : ''}`}
                  style={{ left: t.start * pps, width: Math.max(10, t.duration * pps), top: 4 + (lanes.get(t.id) ?? 0) * 30 }}
                  onPointerDown={(e) => startTextDrag(e, t, 'move')}
                >
                  <div className="handle l" onPointerDown={(e) => startTextDrag(e, t, 'l')} />
                  <span>{t.text}</span>
                  <div className="handle r" onPointerDown={(e) => startTextDrag(e, t, 'r')} />
                </div>
              )
            })}
          </div>

          {/* voice-over track */}
          <div className="track voice" onPointerDown={onTrackBgDown}>
            {project.voice.map((v) => {
              const a = assets[v.assetId]
              if (!a) return null
              return (
                <div
                  key={v.id}
                  className="vblock"
                  style={{ left: v.start * pps, width: Math.max(10, a.duration * pps) }}
                  title={`${a.name} — drag to move, double-click to remove`}
                  onPointerDown={(e) => startVoiceDrag(e, v.id, v.start)}
                  onDoubleClick={() => S().setVoice(project.voice.filter((x) => x.id !== v.id))}
                >
                  <span>🎙 {a.name}</span>
                </div>
              )
            })}
          </div>

          {/* music track */}
          <div className="track music" onPointerDown={onTrackBgDown}>
            {musicAsset && <div className="mblock" style={{ width: Math.max(10, total * pps) }}>♪ {musicAsset.name}</div>}
          </div>

          <Playhead pps={pps} />
        </div>
      </div>
    </section>
  )
}
