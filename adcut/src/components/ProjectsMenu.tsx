import { useEffect, useState, useSyncExternalStore } from 'react'
import { deleteProjectRec, listProjects, newProject, openProject, saveAs, saveStatus, storageInfo } from '../projects'

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`)
const ago = (t: number) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString()
}

export function SaveBadge() {
  const st = useSyncExternalStore(saveStatus.subscribe, saveStatus.get)
  if (st.kind === 'saving') return <span className="save-badge">Saving…</span>
  if (st.kind === 'saved') return <span className="save-badge ok" title="Your work is saved in this browser">Saved</span>
  if (st.kind === 'error') return <span className="save-badge bad" title={st.message}>Not saved</span>
  return null
}

export default function ProjectsMenu({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Awaited<ReturnType<typeof listProjects>>>([])
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [info, setInfo] = useState<{ used: number; quota: number } | null>(null)

  const refresh = async () => {
    try {
      setList(await listProjects())
      setInfo(await storageInfo())
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not read saved projects.')
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Something went wrong.')
    }
    await refresh()
  }

  return (
    <div className="modal-back" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Projects">
        <div className="modal-head">
          <h3>Projects</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <p className="hint">
          Your current work is saved automatically in this browser (nothing is uploaded). Save a named copy to keep a version
          you can come back to.
        </p>
        <div className="proj-save">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. DIWAAN ad v1" />
          <button
            className="primary"
            onClick={() =>
              void guard(async () => {
                await saveAs(name || 'Untitled ad')
                setName('')
                setMsg('Saved a copy.')
              })
            }
          >
            Save copy
          </button>
        </div>
        <div className="proj-list">
          {list.length === 0 && <p className="hint">No saved copies yet.</p>}
          {list.map((p) => (
            <div className="proj-row" key={p.id}>
              <div className="evs-main">
                <strong>{p.name}</strong>
                <small>
                  {p.project.clips.length} clips · {p.project.aspect} · {mb(p.bytes)} · {ago(p.updatedAt)}
                </small>
              </div>
              <div className="evs-actions">
                <button
                  onClick={() =>
                    void guard(async () => {
                      if (!confirm('Open this project? Your current work stays in autosave only until you change it — save a copy first if you need it.')) return
                      const missing = await openProject(p.id)
                      setMsg(missing ? `Opened. ${missing} media file(s) were missing.` : 'Opened.')
                      onClose()
                    })
                  }
                >
                  Open
                </button>
                <button
                  title="Delete"
                  onClick={() =>
                    void guard(async () => {
                      if (confirm(`Delete “${p.name}”?`)) await deleteProjectRec(p.id)
                    })
                  }
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="proj-foot">
          <button
            onClick={() => {
              if (!confirm('Start a new empty project? The current one remains in autosave until you edit the new one — save a copy first if you need it.')) return
              newProject()
              onClose()
            }}
          >
            + New project
          </button>
          {info && (
            <small>
              Browser storage: {mb(info.used)} used{info.quota ? ` of ${mb(info.quota)}` : ''}
            </small>
          )}
        </div>
        {msg && <p className="hint">{msg}</p>}
      </div>
    </div>
  )
}
