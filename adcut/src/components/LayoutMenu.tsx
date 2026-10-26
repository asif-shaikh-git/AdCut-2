import { useEffect, useRef, useState } from 'react'
import { LIMITS, PRESETS, useLayout, type PresetId } from '../layoutStore'

const Row = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <div className="lm-row">
    <span>{label}</span>
    <div className="lm-ctl">{children}</div>
  </div>
)

export default function LayoutMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const L = useLayout()

  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', off)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', off)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const Toggle = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )

  return (
    <div className="layout-menu" ref={ref}>
      <button className="tool" aria-expanded={open} title="Arrange panels" onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 2.5v11M6 9h8.5" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <span>Layout</span>
      </button>
      {open && (
        <div className="lm-pop" role="dialog" aria-label="Arrange panels">
          <Row label="Workspace">
            {(Object.keys(PRESETS) as PresetId[]).map((id) => (
              <button key={id} className="chip" title={PRESETS[id].hint} onClick={() => L.preset(id)}>
                {PRESETS[id].label}
              </button>
            ))}
            <button className="chip" title="Back to the standard layout" onClick={() => L.reset()}>Default</button>
          </Row>
          <Row label="Show">
            <Toggle on={!L.hideLeft} onClick={() => L.set({ hideLeft: !L.hideLeft })}>Tools</Toggle>
            <Toggle on={!L.hideRight} onClick={() => L.set({ hideRight: !L.hideRight })}>Project</Toggle>
            <Toggle on={!L.hideTl} onClick={() => L.set({ hideTl: !L.hideTl })}>Timeline</Toggle>
          </Row>
          <Row label="Move">
            <button onClick={() => L.set({ swapSides: !L.swapSides })}>⇄ Swap left / right</button>
            <button onClick={() => L.set({ tlTop: !L.tlTop })}>{L.tlTop ? '⤓ Timeline to bottom' : '⤒ Timeline to top'}</button>
          </Row>
          <Row label="Tools width">
            <button aria-label="Narrower" onClick={() => L.set({ leftW: L.leftW - 40 })} disabled={L.leftW <= LIMITS.left[0]}>−</button>
            <output>{L.leftW}px</output>
            <button aria-label="Wider" onClick={() => L.set({ leftW: L.leftW + 40 })} disabled={L.leftW >= LIMITS.left[1]}>+</button>
          </Row>
          <Row label="Project width">
            <button aria-label="Narrower" onClick={() => L.set({ rightW: L.rightW - 30 })} disabled={L.rightW <= LIMITS.right[0]}>−</button>
            <output>{L.rightW}px</output>
            <button aria-label="Wider" onClick={() => L.set({ rightW: L.rightW + 30 })} disabled={L.rightW >= LIMITS.right[1]}>+</button>
          </Row>
          <Row label="Timeline height">
            <button aria-label="Shorter" onClick={() => L.set({ tlH: L.tlH - 40 })} disabled={L.tlH <= LIMITS.timeline[0]}>−</button>
            <output>{L.tlH}px</output>
            <button aria-label="Taller" onClick={() => L.set({ tlH: L.tlH + 40 })} disabled={L.tlH >= LIMITS.timeline[1]}>+</button>
          </Row>
          <button className="lm-reset" onClick={() => L.reset()}>Reset layout</button>
        </div>
      )}
    </div>
  )
}
