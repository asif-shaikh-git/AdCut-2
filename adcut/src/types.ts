export type Aspect = '9:16' | '4:5' | '1:1' | '16:9'

export const ASPECTS: Record<Aspect, { w: number; h: number; label: string }> = {
  '9:16': { w: 720, h: 1280, label: 'Reels / Shorts / TikTok' },
  '4:5': { w: 720, h: 900, label: 'Instagram feed' },
  '1:1': { w: 720, h: 720, label: 'Square' },
  '16:9': { w: 1280, h: 720, label: 'YouTube / Web' },
}

export type AssetKind = 'video' | 'image' | 'audio'

export interface Asset {
  id: string
  kind: AssetKind
  name: string
  url: string
  duration: number
  width: number
  height: number
  thumb: string
}

/** One piece on the main video track. `in`/`out` are seconds in the SOURCE media. */
export interface Clip {
  id: string
  assetId: string
  in: number
  out: number
  speed: number
  fit: 'cover' | 'contain'
  fade: boolean
}

export type TextTag = 'adkit' | 'caption' | 'overlay'

export interface TextItem {
  id: string
  text: string
  start: number
  duration: number
  /** vertical position, 0 (top) to 1 (bottom) */
  y: number
  size: number
  color: string
  bg: string | null
  tag?: TextTag
}

export interface Logo {
  assetId: string
  corner: 'tl' | 'tr' | 'bl' | 'br'
  /** fraction of the shorter canvas side */
  scale: number
}

export interface Music {
  assetId: string
  volume: number
  /** lower the music while a voice-over is speaking (default on) */
  duck?: boolean
}

export interface VoiceItem {
  id: string
  assetId: string
  /** where on the timeline (seconds) the voice line starts */
  start: number
  volume: number
}

export interface Project {
  aspect: Aspect
  clips: Clip[]
  texts: TextItem[]
  logo: Logo | null
  music: Music | null
  voice: VoiceItem[]
  brand: string
}

export const uid = () => Math.random().toString(36).slice(2, 9)
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const clipDuration = (c: Clip) => Math.max(0.05, (c.out - c.in) / c.speed)

export interface Segment {
  clip: Clip
  start: number
  end: number
  index: number
}

/** The main track is "magnetic": clips sit back to back, start times are derived. */
export function layout(p: Project): Segment[] {
  let t = 0
  return p.clips.map((clip, index) => {
    const d = clipDuration(clip)
    const seg = { clip, start: t, end: t + d, index }
    t += d
    return seg
  })
}

export const totalDuration = (p: Project) => p.clips.reduce((s, c) => s + clipDuration(c), 0)

export function findSegment(L: Segment[], t: number): Segment | undefined {
  if (!L.length) return undefined
  return L.find((s) => t >= s.start && t < s.end) ?? (t >= L[L.length - 1].end ? L[L.length - 1] : L[0])
}

export const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

export const mkText = (
  text: string,
  start: number,
  duration: number,
  y: number,
  size: number,
  color: string,
  bg: string | null,
  tag?: TextTag,
): TextItem => ({ id: uid(), text, start, duration, y, size, color, bg, tag })

const channel = (v: number) => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of a #rrggbb colour (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const n = parseInt(m[1], 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** Picks white or near-black text, whichever is easier to read on `bg`. */
export function readableOn(bg: string): string {
  const L = luminance(bg)
  const whiteContrast = 1.05 / (L + 0.05)
  const darkContrast = (L + 0.05) / (0.0064 + 0.05)
  return whiteContrast >= darkContrast ? '#ffffff' : '#1a1013'
}
