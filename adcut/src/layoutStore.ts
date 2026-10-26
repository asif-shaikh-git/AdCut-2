import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Where the panels sit and how big they are. Saved in this browser only. */
export const LIMITS = {
  left: [240, 640],
  right: [220, 460],
  timeline: [170, 620],
} as const

export interface LayoutState {
  leftW: number
  rightW: number
  tlH: number
  /** true = the media/tools panel is on the right and the Project panel on the left */
  swapSides: boolean
  /** true = timeline above the preview instead of under it */
  tlTop: boolean
  hideLeft: boolean
  hideRight: boolean
  hideTl: boolean
  set: (p: Partial<Omit<LayoutState, 'set' | 'reset' | 'preset'>>) => void
  reset: () => void
  preset: (id: PresetId) => void
}

export const PRESETS = {
  prompt: { label: 'Prompt', hint: 'Wide tools panel for scripts and prompts', v: { leftW: 520, rightW: 240, tlH: 220, hideRight: true, hideLeft: false, hideTl: false, swapSides: false, tlTop: false } },
  edit: { label: 'Edit', hint: 'Tall timeline for trimming and rearranging', v: { leftW: 280, rightW: 260, tlH: 440, hideLeft: false, hideRight: false, hideTl: false, swapSides: false, tlTop: false } },
  review: { label: 'Review', hint: 'Just the preview, nothing else', v: { hideLeft: true, hideRight: true, hideTl: true } },
} as const
export type PresetId = keyof typeof PRESETS

const DEFAULTS = { leftW: 320, rightW: 280, tlH: 300, swapSides: false, tlTop: false, hideLeft: false, hideRight: false, hideTl: false }
const clampTo = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Math.round(v)))

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (p) =>
        set((s) => ({
          ...p,
          leftW: clampTo(p.leftW ?? s.leftW, LIMITS.left),
          rightW: clampTo(p.rightW ?? s.rightW, LIMITS.right),
          tlH: clampTo(p.tlH ?? s.tlH, LIMITS.timeline),
        })),
      reset: () => set({ ...DEFAULTS }),
      preset: (id) => set({ ...DEFAULTS, ...PRESETS[id].v }),
    }),
    { name: 'adcut-layout' },
  ),
)
