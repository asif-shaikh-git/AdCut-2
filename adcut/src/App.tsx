import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Inspector from './components/Inspector'
import LeftPanel from './components/LeftPanel'
import Preview from './components/Preview'
import Timeline from './components/Timeline'
import { engine } from './engine'
import { exportProgress, startExport } from './exporter'
import LayoutMenu from './components/LayoutMenu'
import Splitter from './components/Splitter'
import { useLayout } from './layoutStore'
import ProjectsMenu, { SaveBadge } from './components/ProjectsMenu'
import { useStore } from './store'
import { ASPECTS, Aspect, totalDuration } from './types'

function ExportOverlay({ cancel }: { cancel: () => void }) {
  const time = useStore((s) => s.time)
  const total = useStore((s) => totalDuration(s.project))
  const fp = useSyncExternalStore(exportProgress.subscribe, exportProgress.get)
  const pct = fp ? Math.round(fp.p * 100) : total > 0 ? Math.min(100, Math.round((time / total) * 100)) : 0
  return (
    <div className="overlay">
      <div className="modal">
        <h3>Exporting your ad…</h3>
        <div className="bar">
          <div style={{ width: `${pct}%` }} />
        </div>
        <p className="hint">
          {fp
            ? `${pct}% · ${fp.label} Faster than real time; keep this tab open.`
            : `${pct}% · The video is recorded in real time (${total.toFixed(1)}s). Keep this tab open and visible until it finishes.`}
        </p>
        <button onClick={cancel}>Cancel</button>
      </div>
    </div>
  )
}

export default function App() {
  const aspect = useStore((s) => s.project.aspect)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const hasClips = useStore((s) => s.project.clips.length > 0)
  const [job, setJob] = useState<{ cancel: () => void } | null>(null)
  const [note, setNote] = useState('')
  const [projectsOpen, setProjectsOpen] = useState(false)
  const L = useLayout()
  const drag = useRef(0)
  // columns: [first panel] [splitter] [preview] [splitter] [last panel]; the "tools" panel goes first unless swapped
  const toolsW = L.hideLeft ? 0 : L.leftW
  const projW = L.hideRight ? 0 : L.rightW
  const firstW = L.swapSides ? projW : toolsW
  const lastW = L.swapSides ? toolsW : projW
  const mainStyle = {
    '--cols': `${firstW}px ${firstW ? 6 : 0}px minmax(0,1fr) ${lastW ? 6 : 0}px ${lastW}px`,
  } as React.CSSProperties
  const tlRows = L.hideTl ? '1fr' : L.tlTop ? `${L.tlH}px 6px minmax(0,1fr)` : `minmax(0,1fr) 6px ${L.tlH}px`
  const wsStyle = { '--rows': tlRows } as React.CSSProperties

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (el && el.tagName === 'BUTTON') el.blur()
      const S = useStore.getState()
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) S.redo()
        else S.undo()
        return
      }
      if (mod && k === 'y') {
        e.preventDefault()
        S.redo()
        return
      }
      if (mod || e.altKey) return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          engine.toggle()
          break
        case 's':
        case 'S':
          S.split()
          break
        case 'd':
        case 'D':
          S.duplicateSelected()
          break
        case 'Delete':
        case 'Backspace':
          S.removeSelected()
          break
        case 'ArrowLeft':
          e.preventDefault()
          engine.nudge(e.shiftKey ? -1 : -0.1)
          break
        case 'ArrowRight':
          e.preventDefault()
          engine.nudge(e.shiftKey ? 1 : 0.1)
          break
        case 'Home':
          engine.seek(0)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function doExport() {
    if (job) return
    setNote('')
    const j = startExport()
    setJob(j)
    try {
      const r = await j.done
      if (r) {
        const url = URL.createObjectURL(r.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `adcut-${Date.now()}.${r.ext}`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 60000)
        setNote(`Saved ${(r.blob.size / 1e6).toFixed(1)} MB .${r.ext} to your downloads.${r.note ? ' ' + r.note : ''}`)
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setJob(null)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo">▶</span> AdCut
          <small>video ad maker</small>
        </div>

        <div className="aspects" role="radiogroup" aria-label="Video format">
          {(Object.keys(ASPECTS) as Aspect[]).map((a) => {
            const [w, h] = a.split(':').map(Number)
            const k = 14 / Math.max(w, h)
            return (
              <button
                key={a}
                role="radio"
                aria-checked={aspect === a}
                className={aspect === a ? 'on' : ''}
                title={ASPECTS[a].label}
                onClick={() => useStore.getState().setAspect(a)}
              >
                <i className="ar" style={{ width: w * k, height: h * k }} />
                {a}
              </button>
            )
          })}
        </div>

        <div className="actions">
          {note && <span className="note-msg">{note}</span>}
          <LayoutMenu />
          <SaveBadge />
          <button onClick={() => setProjectsOpen(true)} title="Saved projects">
            📁 Projects
          </button>
          <button onClick={() => useStore.getState().undo()} disabled={!canUndo} title="Undo">
            ↶
          </button>
          <button onClick={() => useStore.getState().redo()} disabled={!canRedo} title="Redo">
            ↷
          </button>
          <button className="primary" onClick={doExport} disabled={!hasClips || !!job}>
            ⬇ Export video
          </button>
        </div>
      </header>

      <div className="workspace" style={wsStyle}>
        <main className="main" style={{ ...mainStyle, gridRow: L.hideTl ? 1 : L.tlTop ? 3 : 1 }} data-swapped={L.swapSides}>
          {!L.hideLeft && (
            <div className="slot tools" style={{ gridColumn: L.swapSides ? 5 : 1 }}>
              <LeftPanel />
            </div>
          )}
          {!L.hideLeft && (
            <Splitter
              col={L.swapSides ? 4 : 2}
              dir="col"
              label="Resize tools panel"
              onDelta={(d, st) => {
                if (st) drag.current = L.leftW
                L.set({ leftW: drag.current + (L.swapSides ? -d : d) })
              }}
              onReset={() => L.set({ leftW: 320 })}
            />
          )}
          <div className="slot center" style={{ gridColumn: 3 }}>
            <Preview />
          </div>
          {!L.hideRight && (
            <Splitter
              col={L.swapSides ? 2 : 4}
              dir="col"
              label="Resize project panel"
              onDelta={(d, st) => {
                if (st) drag.current = L.rightW
                L.set({ rightW: drag.current + (L.swapSides ? d : -d) })
              }}
              onReset={() => L.set({ rightW: 280 })}
            />
          )}
          {!L.hideRight && (
            <div className="slot proj" style={{ gridColumn: L.swapSides ? 1 : 5 }}>
              <Inspector />
            </div>
          )}
        </main>
        {!L.hideTl && (
          <Splitter
            row={2}
            dir="row"
            label="Resize timeline"
            onDelta={(d, st) => {
              if (st) drag.current = L.tlH
              L.set({ tlH: drag.current + (L.tlTop ? d : -d) })
            }}
            onReset={() => L.set({ tlH: 300 })}
          />
        )}
        {!L.hideTl && (
          <div className="slot tlslot" style={{ gridRow: L.tlTop ? 1 : 3 }}>
            <Timeline />
          </div>
        )}
      </div>
      <div className="dock-hints">
        {L.hideLeft && <button onClick={() => L.set({ hideLeft: false })}>Show tools</button>}
        {L.hideRight && <button onClick={() => L.set({ hideRight: false })}>Show project</button>}
        {L.hideTl && <button onClick={() => L.set({ hideTl: false })}>Show timeline</button>}
      </div>
      {job && <ExportOverlay cancel={job.cancel} />}
      {projectsOpen && <ProjectsMenu onClose={() => setProjectsOpen(false)} />}
    </div>
  )
}
