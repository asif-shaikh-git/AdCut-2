import { useStore } from '../store'
import { clipDuration, fmt, readableOn } from '../types'

function ClipInspector({ id }: { id: string }) {
  const clip = useStore((s) => s.project.clips.find((c) => c.id === id))
  const asset = useStore((s) => (clip ? s.assets[clip.assetId] : undefined))
  const S = useStore.getState
  if (!clip || !asset) return null
  const isImage = asset.kind === 'image'

  return (
    <div className="insp">
      <h3>{isImage ? 'Photo clip' : 'Video clip'}</h3>
      <p className="hint">
        {asset.name} · {fmt(clipDuration(clip))}
      </p>

      {isImage ? (
        <label className="field">
          Duration: {clipDuration(clip).toFixed(1)}s
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.1}
            value={clip.out - clip.in}
            onChange={(e) => S().patchClip(id, { out: clip.in + +e.target.value })}
          />
        </label>
      ) : (
        <label className="field">
          Speed
          <select value={clip.speed} onChange={(e) => S().patchClip(id, { speed: +e.target.value })}>
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
              <option key={v} value={v}>
                {v}x
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="field">
        Fit in frame
        <div className="seg">
          <button className={clip.fit === 'cover' ? 'on' : ''} onClick={() => S().patchClip(id, { fit: 'cover' })}>
            Fill (crop)
          </button>
          <button className={clip.fit === 'contain' ? 'on' : ''} onClick={() => S().patchClip(id, { fit: 'contain' })}>
            Fit (blur bars)
          </button>
        </div>
      </div>

      <label className="check">
        <input type="checkbox" checked={clip.fade} onChange={(e) => S().patchClip(id, { fade: e.target.checked })} />
        Fade in / out
      </label>

      <div className="row">
        <button onClick={() => S().split()}>✂ Split at playhead</button>
        <button onClick={() => S().duplicateSelected()}>⧉ Duplicate</button>
      </div>
      <button className="danger" onClick={() => S().removeSelected()}>
        🗑 Delete clip
      </button>
    </div>
  )
}

function TextInspector({ id }: { id: string }) {
  const t = useStore((s) => s.project.texts.find((x) => x.id === id))
  const brand = useStore((s) => s.project.brand)
  const S = useStore.getState
  if (!t) return null

  return (
    <div className="insp">
      <h3>Text</h3>
      <textarea rows={3} value={t.text} onChange={(e) => S().patchText(id, { text: e.target.value })} />

      <label className="field">
        Size: {t.size}
        <input type="range" min={24} max={140} value={t.size} onChange={(e) => S().patchText(id, { size: +e.target.value })} />
      </label>
      <label className="field">
        Vertical position
        <input
          type="range"
          min={0.05}
          max={0.95}
          step={0.01}
          value={t.y}
          onChange={(e) => S().patchText(id, { y: +e.target.value })}
        />
      </label>

      <div className="row">
        <label className="field">
          Text color
          <input type="color" value={t.color} onChange={(e) => S().patchText(id, { color: e.target.value })} />
        </label>
        <label className="field">
          Background
          <input
            type="color"
            value={t.bg && t.bg.startsWith('#') ? t.bg : brand}
            onChange={(e) => S().patchText(id, { bg: e.target.value })}
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={!!t.bg}
          onChange={(e) => S().patchText(id, e.target.checked ? { bg: brand, color: readableOn(brand) } : { bg: null })}
        />
        Show background box
      </label>

      <div className="row">
        <label className="field">
          Start (s)
          <input
            type="number"
            step={0.1}
            min={0}
            value={Number(t.start.toFixed(2))}
            onChange={(e) => S().patchText(id, { start: Math.max(0, +e.target.value) })}
          />
        </label>
        <label className="field">
          Length (s)
          <input
            type="number"
            step={0.1}
            min={0.3}
            value={Number(t.duration.toFixed(2))}
            onChange={(e) => S().patchText(id, { duration: Math.max(0.3, +e.target.value) })}
          />
        </label>
      </div>

      <div className="row">
        <button onClick={() => S().duplicateSelected()}>⧉ Duplicate</button>
        <button className="danger" onClick={() => S().removeSelected()}>
          🗑 Delete
        </button>
      </div>
    </div>
  )
}

function ProjectInspector() {
  const showSafe = useStore((s) => s.showSafe)
  const music = useStore((s) => s.project.music)
  const assets = useStore((s) => s.assets)
  const S = useStore.getState
  const m = music ? assets[music.assetId] : undefined

  return (
    <div className="insp">
      <h3>Project</h3>
      <label className="check">
        <input type="checkbox" checked={showSafe} onChange={(e) => S().setShowSafe(e.target.checked)} />
        Show safe-zone guide
      </label>

      <h4>Music</h4>
      {music && m ? (
        <>
          <p className="hint">♪ {m.name}</p>
          <label className="field">
            Volume: {Math.round(music.volume * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={music.volume}
              onChange={(e) => S().setMusic({ ...music, volume: +e.target.value })}
            />
          </label>
          <button onClick={() => S().setMusic(null)}>Remove music</button>
        </>
      ) : (
        <p className="hint">Import an audio file and press “Use as music”.</p>
      )}

      <h4>Shortcuts</h4>
      <ul className="keys">
        <li>
          <kbd>Space</kbd> play / pause
        </li>
        <li>
          <kbd>S</kbd> split at playhead
        </li>
        <li>
          <kbd>D</kbd> duplicate
        </li>
        <li>
          <kbd>Del</kbd> delete selected
        </li>
        <li>
          <kbd>←</kbd> <kbd>→</kbd> step 0.1s (<kbd>Shift</kbd> = 1s)
        </li>
        <li>
          <kbd>Ctrl/⌘ Z</kbd> undo, <kbd>Shift</kbd> to redo
        </li>
      </ul>
      <p className="hint">Drag clips to rearrange. Drag clip edges to trim. Click the ruler to move the playhead.</p>
    </div>
  )
}

export default function Inspector() {
  const selected = useStore((s) => s.selected)
  return (
    <aside className="panel right">
      {selected?.type === 'clip' ? (
        <ClipInspector id={selected.id} />
      ) : selected?.type === 'text' ? (
        <TextInspector id={selected.id} />
      ) : (
        <ProjectInspector />
      )}
    </aside>
  )
}
