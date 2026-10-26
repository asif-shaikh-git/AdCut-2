import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DIWAAN_SCRIPT } from './presets/diwaanScript'
import {
  BlockInfo,
  DEFAULT_OPTIONS,
  Parsed,
  PromptOptions,
  ReferenceSettings,
  Scene,
  defaultRefSettings,
  newScene,
  parseScript,
  quickTemplate,
} from './ugc'
import type { Asset } from './types'

interface UgcState {
  scenes: Scene[]
  blocks: BlockInfo[]
  format: string
  negative: string
  selectedSceneId: string
  refSettings: Record<string, ReferenceSettings>
  opts: PromptOptions

  select(id: string): void
  loadParsed(p: Parsed): void
  loadDiwaan(): void
  loadQuick(): void
  updateScene(id: string, patch: Partial<Scene>): void
  addScene(): void
  removeScene(id: string): void
  toggleRef(sceneId: string, assetId: string): void
  setSceneRefs(sceneId: string, ids: string[]): void
  setAllRefs(ids: string[]): void
  setPrimaryAssets(map: Record<string, string>): void
  setVoiceAssets(map: Record<string, string>): void
  applyRefsToAll(fromSceneId: string): void
  patchRef(asset: Asset, patch: Partial<ReferenceSettings>): void
  setRefs(map: Record<string, ReferenceSettings>): void
  setOpts(patch: Partial<PromptOptions>): void
  setFormat(v: string): void
  setNegative(v: string): void
}

const initial = parseScript(DIWAAN_SCRIPT)

const fromParsed = (p: Parsed) => ({
  scenes: p.scenes,
  blocks: p.blocks,
  format: p.format,
  negative: p.negative,
  selectedSceneId: p.scenes[0]?.id ?? '',
})

/**
 * Scenes, reference settings and prompt options live here (not in the component) so they survive
 * switching tabs, and they are saved in this browser (localStorage) so a refresh keeps your script.
 * Imported media is NOT saved, so after a refresh you re-import the files and the app re-links by name.
 */
export const useUgc = create<UgcState>()(
  persist(
    (set, get) => ({
      ...fromParsed(initial),
      refSettings: {},
      opts: DEFAULT_OPTIONS,

      select: (id) => set({ selectedSceneId: id }),
      loadParsed: (p) => set(fromParsed(p)),
      loadDiwaan: () => set(fromParsed(parseScript(DIWAAN_SCRIPT))),
      loadQuick: () => set(fromParsed(quickTemplate())),

      updateScene: (id, patch) =>
        set((s) => ({ scenes: s.scenes.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

      addScene: () => {
        const s = get()
        const last = s.scenes[s.scenes.length - 1]
        const sc = newScene({
          title: `Shot ${s.scenes.length + 1}`,
          block: last ? last.block : 1,
          lighting: last?.lighting ?? undefined,
          framing: last?.framing ?? undefined,
          referenceIds: last ? [...last.referenceIds] : [],
        })
        set({ scenes: [...s.scenes, sc], selectedSceneId: sc.id })
      },

      removeScene: (id) => {
        const s = get()
        const scenes = s.scenes.filter((x) => x.id !== id)
        set({ scenes, selectedSceneId: scenes.find((x) => x.id === s.selectedSceneId)?.id ?? scenes[0]?.id ?? '' })
      },

      toggleRef: (sceneId, assetId) =>
        set((s) => ({
          scenes: s.scenes.map((x) =>
            x.id !== sceneId
              ? x
              : {
                  ...x,
                  referenceIds: x.referenceIds.includes(assetId)
                    ? x.referenceIds.filter((i) => i !== assetId)
                    : [...x.referenceIds, assetId],
                },
          ),
        })),

      setSceneRefs: (sceneId, ids) =>
        set((s) => ({ scenes: s.scenes.map((x) => (x.id === sceneId ? { ...x, referenceIds: ids } : x)) })),

      setAllRefs: (ids) => set((s) => ({ scenes: s.scenes.map((x) => ({ ...x, referenceIds: [...ids] })) })),

      setPrimaryAssets: (map) =>
        set((s) => ({ scenes: s.scenes.map((x) => (x.id in map ? { ...x, primaryAssetId: map[x.id] } : x)) })),

      setVoiceAssets: (map) =>
        set((s) => ({ scenes: s.scenes.map((x) => (x.id in map ? { ...x, voiceAssetId: map[x.id] } : x)) })),

      applyRefsToAll: (fromSceneId) =>
        set((s) => {
          const from = s.scenes.find((x) => x.id === fromSceneId)
          if (!from) return s
          return { scenes: s.scenes.map((x) => ({ ...x, referenceIds: [...from.referenceIds] })) }
        }),

      patchRef: (asset, patch) =>
        set((s) => ({
          refSettings: {
            ...s.refSettings,
            [asset.id]: { ...(s.refSettings[asset.id] ?? defaultRefSettings(asset)), ...patch },
          },
        })),

      setRefs: (map) => set((s) => ({ refSettings: { ...s.refSettings, ...map } })),
      setOpts: (patch) => set((s) => ({ opts: { ...s.opts, ...patch } })),
      setFormat: (v) => set({ format: v }),
      setNegative: (v) => set({ negative: v }),
    }),
    {
      name: 'adcut-ugc-v1',
      version: 1,
      // media is saved in this browser too (src/projects.ts) with the same ids, so links to clips are kept
      partialize: (s) => ({
        scenes: s.scenes,
        refSettings: s.refSettings,
        blocks: s.blocks,
        format: s.format,
        negative: s.negative,
        selectedSceneId: s.selectedSceneId,
        opts: s.opts,
      }),
    },
  ),
)
