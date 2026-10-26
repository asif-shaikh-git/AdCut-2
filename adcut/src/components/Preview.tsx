import { useEffect, useRef, useState } from 'react'
import { engine } from '../engine'
import { useStore } from '../store'
import { ASPECTS, fmt, totalDuration } from '../types'

function Transport() {
  const playing = useStore((s) => s.playing)
  const time = useStore((s) => s.time)
  const total = useStore((s) => totalDuration(s.project))
  return (
    <div className="transport">
      <button className="icon" title="Back to start (Home)" onClick={() => engine.seek(0)}>
        ⏮
      </button>
      <button className="icon" title="Back 0.1s (←)" onClick={() => engine.nudge(-0.1)}>
        ◂
      </button>
      <button className="play" title="Play / pause (Space)" onClick={() => engine.toggle()} disabled={total <= 0}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="icon" title="Forward 0.1s (→)" onClick={() => engine.nudge(0.1)}>
        ▸
      </button>
      <span className="time">
        {fmt(time)} <i>/ {fmt(total)}</i>
      </span>
    </div>
  )
}

function SafeZone({ aspect }: { aspect: string }) {
  const tall = aspect === '9:16'
  const style = tall
    ? { top: '11%', bottom: '19%', left: '4%', right: '13%' }
    : { top: '5%', bottom: '5%', left: '5%', right: '5%' }
  return (
    <div className="safe" style={style}>
      <span>{tall ? 'Safe zone: keep text inside (Reels / Shorts / TikTok UI covers the edges)' : 'Safe margin'}</span>
    </div>
  )
}

export default function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const aspect = useStore((s) => s.project.aspect)
  const showSafe = useStore((s) => s.showSafe)

  useEffect(() => {
    if (canvasRef.current) engine.attach(canvasRef.current)
  }, [])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const { w, h } = ASPECTS[aspect]
  const ratio = w / h
  const dw = Math.max(0, Math.min(box.w - 8, (box.h - 8) * ratio))
  const dh = dw / ratio

  return (
    <section className="preview">
      <div className="stage" ref={boxRef}>
        <div className="frame" style={{ width: dw, height: dh }}>
          <canvas ref={canvasRef} width={w} height={h} />
          {showSafe && <SafeZone aspect={aspect} />}
        </div>
      </div>
      <Transport />
    </section>
  )
}
