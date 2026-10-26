import { useRef } from 'react'

/** A thin draggable bar between two areas. Arrow keys also work; double-click resets. */
export default function Splitter({
  dir,
  col,
  row,
  onDelta,
  onReset,
  label,
}: {
  dir: 'col' | 'row'
  col?: number
  row?: number
  /** called with the pixels moved since the drag started (positive = right / down) */
  onDelta: (px: number, startOfDrag: boolean) => void
  onReset: () => void
  label: string
}) {
  const start = useRef<number | null>(null)
  const pos = (e: React.PointerEvent) => (dir === 'col' ? e.clientX : e.clientY)
  return (
    <div
      className={`splitter ${dir}`}
      role="separator"
      aria-orientation={dir === 'col' ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={`${label} (drag, double-click to reset)`}
      tabIndex={0}
      style={{ gridColumn: col, gridRow: row }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = pos(e)
        onDelta(0, true)
        document.body.classList.add('resizing', dir)
      }}
      onPointerMove={(e) => {
        if (start.current !== null) onDelta(pos(e) - start.current, false)
      }}
      onPointerUp={() => {
        start.current = null
        document.body.classList.remove('resizing', 'col', 'row')
      }}
      onPointerCancel={() => {
        start.current = null
        document.body.classList.remove('resizing', 'col', 'row')
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const k = dir === 'col' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
        if (e.key === k[0] || e.key === k[1]) {
          e.preventDefault()
          onDelta(e.key === k[0] ? -20 : 20, true)
        }
      }}
    />
  )
}
