import { create } from 'zustand'
import {
  Aspect,
  Asset,
  Clip,
  Logo,
  Music,
  VoiceItem,
  Project,
  TextItem,
  TextTag,
  layout,
  mkText,
  readableOn,
  totalDuration,
  uid,
} from './types'

export type Sel = { type: 'clip' | 'text'; id: string } | null

export interface Kit {
  name: string
  price: string
  offer: string
  cta: string
  script: string
}

const HISTORY = 100
let lastKey = ''
let lastAt = 0
/** set by the engine so loading a project can stop playback without a circular import */
let engineStop: (() => void) | null = null
export const setEngineStop = (f: () => void) => {
  engineStop = f
}
let pending: Project | null = null

const emptyProject: Project = {
  aspect: '9:16',
  clips: [],
  texts: [],
  logo: null,
  music: null,
  voice: [],
  brand: '#ffb2b3',
}

function validSel(p: Project, s: Sel): Sel {
  if (!s) return null
  const ok = s.type === 'clip' ? p.clips.some((c) => c.id === s.id) : p.texts.some((t) => t.id === s.id)
  return ok ? s : null
}

interface Store {
  assets: Record<string, Asset>
  project: Project
  past: Project[]
  future: Project[]
  selected: Sel
  time: number
  playing: boolean
  showSafe: boolean
  kit: Kit

  setKit(p: Partial<Kit>): void
  setShowSafe(v: boolean): void
  select(s: Sel): void
  addAsset(a: Asset): void
  loadSnapshot(x: { assets: Record<string, Asset>; project: Project; kit: Kit }): void

  commit(fn: (p: Project) => Project, key?: string): void
  beginEdit(): void
  update(fn: (p: Project) => Project): void
  endEdit(): void
  undo(): void
  redo(): void

  addToTimeline(assetId: string): void
  addAllImages(): void
  split(): boolean
  removeSelected(): void
  duplicateSelected(): void
  moveClip(id: string, to: number): void
  patchClip(id: string, patch: Partial<Clip>): void
  patchText(id: string, patch: Partial<TextItem>): void
  addText(): void
  setAspect(a: Aspect): void
  setLogo(l: Logo | null): void
  setMusic(m: Music | null): void
  setVoice(v: VoiceItem[], key?: string): void
  setBrand(c: string): void
  applyAdKit(): string
  makeCaptions(): string
  clearTag(tag: TextTag): void
}

export const useStore = create<Store>((set, get) => {
  const clampTime = (p: Project, time: number) => Math.min(time, totalDuration(p))

  const commit: Store['commit'] = (fn, key) => {
    const s = get()
    const next = fn(s.project)
    if (next === s.project) return
    const now = Date.now()
    const coalesce = !!key && key === lastKey && now - lastAt < 800
    lastKey = key ?? ''
    lastAt = now
    set({
      project: next,
      time: clampTime(next, s.time),
      past: coalesce ? s.past : [...s.past.slice(-(HISTORY - 1)), s.project],
      future: [],
    })
  }

  return {
    assets: {},
    project: emptyProject,
    past: [],
    future: [],
    selected: null,
    time: 0,
    playing: false,
    showSafe: false,
    kit: { name: '', price: '', offer: '', cta: 'Shop now', script: '' },

    setKit: (p) => set((s) => ({ kit: { ...s.kit, ...p } })),
    setShowSafe: (v) => set({ showSafe: v }),
    select: (s) => set({ selected: s }),
    loadSnapshot: ({ assets, project, kit }) => {
      engineStop?.()
      lastKey = ''
      set({ assets, project, kit, past: [], future: [], selected: null, time: 0, playing: false })
    },
    addAsset: (a) => set((s) => ({ assets: { ...s.assets, [a.id]: a } })),

    commit,

    beginEdit: () => {
      pending = get().project
      lastKey = ''
    },
    update: (fn) => {
      const s = get()
      const next = fn(s.project)
      if (next === s.project) return
      set({ project: next, time: clampTime(next, s.time) })
    },
    endEdit: () => {
      const s = get()
      if (pending && pending !== s.project) {
        set({ past: [...s.past.slice(-(HISTORY - 1)), pending], future: [] })
      }
      pending = null
    },

    undo: () => {
      const s = get()
      if (!s.past.length) return
      const prev = s.past[s.past.length - 1]
      lastKey = ''
      set({
        project: prev,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future],
        time: clampTime(prev, s.time),
        selected: validSel(prev, s.selected),
      })
    },
    redo: () => {
      const s = get()
      if (!s.future.length) return
      const next = s.future[0]
      lastKey = ''
      set({
        project: next,
        past: [...s.past, s.project],
        future: s.future.slice(1),
        time: clampTime(next, s.time),
        selected: validSel(next, s.selected),
      })
    },

    addToTimeline: (assetId) => {
      const a = get().assets[assetId]
      if (!a) return
      if (a.kind === 'audio') {
        commit((p) => ({ ...p, music: { assetId, volume: 0.6 } }))
        return
      }
      const clip: Clip = {
        id: uid(),
        assetId,
        in: 0,
        out: a.kind === 'image' ? 2.5 : a.duration,
        speed: 1,
        fit: 'cover',
        fade: false,
      }
      commit((p) => ({ ...p, clips: [...p.clips, clip] }))
      set({ selected: { type: 'clip', id: clip.id } })
    },

    addAllImages: () => {
      const imgs = Object.values(get().assets).filter((a) => a.kind === 'image')
      if (!imgs.length) return
      const clips: Clip[] = imgs.map((a) => ({
        id: uid(),
        assetId: a.id,
        in: 0,
        out: 2.5,
        speed: 1,
        fit: 'cover',
        fade: true,
      }))
      commit((p) => ({ ...p, clips: [...p.clips, ...clips] }))
    },

    split: () => {
      const { project, time } = get()
      const seg = layout(project).find((s) => time > s.start + 0.1 && time < s.end - 0.1)
      if (!seg) return false
      const mid = seg.clip.in + (time - seg.start) * seg.clip.speed
      const a: Clip = { ...seg.clip, out: mid }
      const b: Clip = { ...seg.clip, id: uid(), in: mid }
      commit((p) => ({ ...p, clips: p.clips.flatMap((c) => (c.id === seg.clip.id ? [a, b] : [c])) }))
      set({ selected: { type: 'clip', id: b.id } })
      return true
    },

    removeSelected: () => {
      const sel = get().selected
      if (!sel) return
      if (sel.type === 'clip') commit((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== sel.id) }))
      else commit((p) => ({ ...p, texts: p.texts.filter((t) => t.id !== sel.id) }))
      set({ selected: null })
    },

    duplicateSelected: () => {
      const sel = get().selected
      if (!sel) return
      if (sel.type === 'clip') {
        const i = get().project.clips.findIndex((c) => c.id === sel.id)
        if (i < 0) return
        const copy: Clip = { ...get().project.clips[i], id: uid() }
        commit((p) => {
          const arr = [...p.clips]
          arr.splice(i + 1, 0, copy)
          return { ...p, clips: arr }
        })
        set({ selected: { type: 'clip', id: copy.id } })
      } else {
        const t = get().project.texts.find((x) => x.id === sel.id)
        if (!t) return
        const copy: TextItem = { ...t, id: uid(), start: t.start + t.duration }
        commit((p) => ({ ...p, texts: [...p.texts, copy] }))
        set({ selected: { type: 'text', id: copy.id } })
      }
    },

    moveClip: (id, to) =>
      commit((p) => {
        const i = p.clips.findIndex((c) => c.id === id)
        if (i < 0) return p
        const arr = [...p.clips]
        const [c] = arr.splice(i, 1)
        arr.splice(to, 0, c)
        if (arr.every((x, k) => x === p.clips[k])) return p
        return { ...p, clips: arr }
      }),

    patchClip: (id, patch) =>
      commit(
        (p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
        `clip:${id}:${Object.keys(patch).join(',')}`,
      ),

    patchText: (id, patch) =>
      commit(
        (p) => ({ ...p, texts: p.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
        `text:${id}:${Object.keys(patch).join(',')}`,
      ),

    addText: () => {
      const t = mkText('Your text here', get().time, 2, 0.5, 56, '#ffffff', null)
      commit((p) => ({ ...p, texts: [...p.texts, t] }))
      set({ selected: { type: 'text', id: t.id } })
    },

    setAspect: (aspect) => commit((p) => ({ ...p, aspect })),
    setLogo: (logo) => commit((p) => ({ ...p, logo }), logo ? 'logo' : undefined),
    setVoice: (voice, key) => commit((p) => ({ ...p, voice }), key),
    setMusic: (music) => commit((p) => ({ ...p, music }), music ? 'music' : undefined),
    setBrand: (brand) => commit((p) => ({ ...p, brand }), 'brand'),

    // Ad Kit: hook (product name) -> price/offer -> end card (call to action)
    applyAdKit: () => {
      const { project, kit } = get()
      const total = totalDuration(project)
      if (total <= 0) return 'Add at least one photo or video to the timeline first.'
      const brand = project.brand
      const items: TextItem[] = []
      const endDur = kit.cta.trim() ? Math.min(2.5, total) : 0

      if (kit.name.trim()) {
        items.push(mkText(kit.name.trim(), 0, Math.min(3, total), 0.17, 60, readableOn(brand), brand, 'adkit'))
      }
      const priceLine = [kit.price.trim(), kit.offer.trim()].filter(Boolean).join('   •   ')
      if (priceLine) {
        const start = Math.min(1.2, total * 0.2)
        const dur = Math.max(0.8, total - start - endDur)
        items.push(mkText(priceLine, start, Math.min(dur, total - start), 0.62, 64, readableOn(brand), brand, 'adkit'))
      }
      if (endDur > 0) {
        items.push(mkText(kit.cta.trim(), total - endDur, endDur, 0.5, 72, readableOn(brand), brand, 'adkit'))
      }
      if (!items.length) return 'Fill in at least a product name, price or call to action.'
      commit((p) => ({ ...p, texts: [...p.texts.filter((t) => t.tag !== 'adkit'), ...items] }))
      return `Added ${items.length} text overlay${items.length > 1 ? 's' : ''} to the timeline.`
    },

    // Script -> timed captions, split by sentence and spread by word count
    makeCaptions: () => {
      const { project, kit } = get()
      const total = totalDuration(project)
      if (total <= 0) return 'Add at least one photo or video to the timeline first.'
      const parts = kit.script
        .split(/(?<=[.!?।])\s+|\n+/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (!parts.length) return 'Paste or type a script first.'
      const weights = parts.map((s) => Math.max(1, s.split(/\s+/).length))
      const sum = weights.reduce((a, b) => a + b, 0)
      let t = 0
      const items = parts.map((s, i) => {
        const d = (weights[i] / sum) * total
        const it = mkText(s, t, d, 0.74, 40, '#ffffff', 'rgba(0,0,0,0.6)', 'caption')
        t += d
        return it
      })
      commit((p) => ({ ...p, texts: [...p.texts.filter((x) => x.tag !== 'caption'), ...items] }))
      return `Created ${items.length} caption${items.length > 1 ? 's' : ''} across ${total.toFixed(1)}s.`
    },

    clearTag: (tag) => commit((p) => ({ ...p, texts: p.texts.filter((t) => t.tag !== tag) })),
  }
})
