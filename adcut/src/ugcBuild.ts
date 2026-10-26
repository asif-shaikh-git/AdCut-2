import { useStore } from './store'
import { Clip, TextItem, VoiceItem, mkText, readableOn, uid } from './types'
import { useUgc } from './ugcStore'

export interface BuildResult {
  ok: boolean
  message: string
  warnings: string[]
}

/**
 * Turns the shot list into a real edit:
 *  - one clip per shot, using the clip you assigned to it
 *  - a clip generated for several shots (e.g. one 10s video for two 5s shots) is cut in order: 0–5s, then 5–10s
 *  - on-screen text at the top (brand colour) and the spoken line as a caption at the bottom
 * Everything is one undo step (Ctrl/Cmd+Z).
 */
export function buildTimelineFromScenes(opts: { overlays: boolean; captions: boolean; voice?: boolean }): BuildResult {
  const S = useStore.getState()
  const { scenes } = useUgc.getState()
  const warnings: string[] = []
  const used: Record<string, number> = {}
  const clips: Clip[] = []
  const texts: TextItem[] = []
  const voice: VoiceItem[] = []
  const brand = S.project.brand
  const onBrand = readableOn(brand)
  let t = 0

  scenes.forEach((sc, i) => {
    const n = i + 1
    const a = S.assets[sc.primaryAssetId]
    if (!a || a.kind === 'audio') {
      warnings.push(`Shot ${n} has no clip yet`)
      return
    }

    let inn = 0
    let out = sc.duration
    if (a.kind === 'video') {
      inn = used[a.id] ?? 0
      out = Math.min(inn + sc.duration, a.duration)
      if (out - inn < 0.3) {
        warnings.push(`Shot ${n}: "${a.name}" has no footage left after ${inn.toFixed(1)}s`)
        return
      }
      if (out - inn < sc.duration - 0.25) {
        warnings.push(`Shot ${n}: only ${(out - inn).toFixed(1)}s of footage for a ${sc.duration}s shot`)
      }
      used[a.id] = out
    }

    const d = out - inn
    clips.push({ id: uid(), assetId: a.id, in: inn, out, speed: 1, fit: 'cover', fade: false })
    if (opts.overlays && sc.overlay.trim()) {
      texts.push(mkText(sc.overlay.trim(), t, d, 0.2, 50, onBrand, brand, 'overlay'))
    }
    if (opts.captions && sc.dialogue.trim()) {
      texts.push(mkText(sc.dialogue.trim(), t, d, 0.74, 40, '#ffffff', 'rgba(0,0,0,0.6)', 'caption'))
    }
    const va = opts.voice ? S.assets[sc.voiceAssetId] : undefined
    if (va && va.kind === 'audio') {
      voice.push({ id: uid(), assetId: va.id, start: t, volume: 1 })
      if (va.duration > d + 0.3) warnings.push(`Shot ${n}: voice-over (${va.duration.toFixed(1)}s) is longer than the shot (${d.toFixed(1)}s) and will run into the next shot`)
    }
    t += d
  })

  if (!clips.length) {
    return {
      ok: false,
      message: 'Assign a generated clip or photo to at least one shot first (Primary clip for this shot).',
      warnings,
    }
  }

  S.commit((p) => ({
    ...p,
    aspect: '9:16',
    clips,
    texts: [...p.texts.filter((x) => x.tag !== 'overlay' && x.tag !== 'caption'), ...texts],
    voice: opts.voice ? voice : p.voice,
  }))
  useStore.setState({ selected: null, time: 0 })

  return {
    ok: true,
    message: `Built a ${t.toFixed(1)}s timeline: ${clips.length} clips, ${texts.length} text layers${voice.length ? `, ${voice.length} voice-overs` : ''}. Press Ctrl/Cmd+Z to undo.`,
    warnings,
  }
}
