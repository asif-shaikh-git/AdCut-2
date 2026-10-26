/**
 * Saving: everything lives in this browser (IndexedDB), nothing is uploaded.
 *  - "autosave": the working project + its media files, written a moment after every change, restored on start.
 *  - named projects: "Save as…" copies the current state; media files are shared between projects by id.
 */
import { useStore } from './store'
import type { Asset, Project } from './types'
import { uid } from './types'
import type { Kit } from './store'

const DB = 'adcut'
const AUTOSAVE = 'autosave'

interface MediaRec {
  id: string
  kind: Asset['kind']
  name: string
  duration: number
  width: number
  height: number
  thumb: string
  size: number
  blob: Blob
}
export interface ProjectRec {
  id: string
  name: string
  updatedAt: number
  project: Project
  kit: Kit
  mediaIds: string[]
}

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('This browser cannot save projects here.'))
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => {
      r.result.createObjectStore('media', { keyPath: 'id' })
      r.result.createObjectStore('projects', { keyPath: 'id' })
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error ?? new Error('Could not open storage.'))
  })
  return dbp
}

function run<T>(store: 'media' | 'projects', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((res, rej) => {
        const t = d.transaction(store, mode)
        const rq = fn(t.objectStore(store))
        t.oncomplete = () => res(rq.result)
        t.onerror = () => rej(t.error ?? new Error('Storage error'))
        t.onabort = () => rej(t.error ?? new Error('Storage is full or blocked.'))
      }),
  )
}

const getAll = <T,>(store: 'media' | 'projects') => run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
const getOne = <T,>(store: 'media' | 'projects', key: string) =>
  run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)

/* ---------------- media ---------------- */

const savedMedia = new Set<string>()

async function putMedia(a: Asset) {
  if (savedMedia.has(a.id)) return
  const blob = await fetch(a.url).then((r) => r.blob())
  const rec: MediaRec = {
    id: a.id,
    kind: a.kind,
    name: a.name,
    duration: a.duration,
    width: a.width,
    height: a.height,
    thumb: a.kind === 'image' ? '' : a.thumb,
    size: blob.size,
    blob,
  }
  await run('media', 'readwrite', (s) => s.put(rec))
  savedMedia.add(a.id)
}

function toAsset(m: MediaRec, existing?: Asset): Asset {
  if (existing) return existing
  const url = URL.createObjectURL(m.blob)
  return {
    id: m.id,
    kind: m.kind,
    name: m.name,
    url,
    duration: m.duration,
    width: m.width,
    height: m.height,
    thumb: m.kind === 'image' ? url : m.thumb,
  }
}

/** Remove stored media no saved project refers to any more. */
async function sweepMedia() {
  const projects = await getAll<ProjectRec>('projects')
  const keep = new Set(projects.flatMap((p) => p.mediaIds))
  const media = await getAll<MediaRec>('media')
  for (const m of media) {
    if (!keep.has(m.id)) {
      await run('media', 'readwrite', (s) => s.delete(m.id))
      savedMedia.delete(m.id)
    }
  }
}

/* ---------------- snapshots ---------------- */

function snapshot(id: string, name: string): ProjectRec {
  const s = useStore.getState()
  return { id, name, updatedAt: Date.now(), project: s.project, kit: s.kit, mediaIds: Object.keys(s.assets) }
}

async function writeProject(id: string, name: string) {
  const assets = Object.values(useStore.getState().assets)
  for (const a of assets) await putMedia(a)
  await run('projects', 'readwrite', (s) => s.put(snapshot(id, name)))
}

async function loadRec(rec: ProjectRec) {
  const cur = useStore.getState().assets
  const next: Record<string, Asset> = {}
  const missing: string[] = []
  for (const id of rec.mediaIds) {
    if (cur[id]) {
      next[id] = cur[id]
      continue
    }
    const m = await getOne<MediaRec>('media', id)
    if (m) {
      next[id] = toAsset(m)
      savedMedia.add(id)
    } else missing.push(id)
  }
  Object.values(cur).forEach((a) => {
    if (!next[a.id] && a.url.startsWith('blob:')) URL.revokeObjectURL(a.url)
  })
  const p: Project = {
    ...rec.project,
    clips: rec.project.clips.filter((c) => next[c.assetId]),
    voice: (rec.project.voice ?? []).filter((v) => next[v.assetId]),
    music: rec.project.music && next[rec.project.music.assetId] ? rec.project.music : null,
    logo: rec.project.logo && next[rec.project.logo.assetId] ? rec.project.logo : null,
  }
  useStore.getState().loadSnapshot({ assets: next, project: p, kit: rec.kit })
  return missing.length
}

/* ---------------- public API ---------------- */

export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: number } | { kind: 'error'; message: string }
let state: SaveState = { kind: 'idle' }
const listeners = new Set<() => void>()
const setState = (s: SaveState) => {
  state = s
  listeners.forEach((l) => l())
}
export const saveStatus = {
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export async function listProjects(): Promise<(ProjectRec & { bytes: number })[]> {
  const [ps, media] = await Promise.all([getAll<ProjectRec>('projects'), getAll<MediaRec>('media')])
  const size = new Map(media.map((m) => [m.id, m.size]))
  return ps
    .filter((p) => p.id !== AUTOSAVE)
    .map((p) => ({ ...p, bytes: p.mediaIds.reduce((n, id) => n + (size.get(id) ?? 0), 0) }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveAs(name: string): Promise<string> {
  const id = uid() + uid()
  await writeProject(id, name.trim() || 'Untitled ad')
  return id
}
export async function openProject(id: string): Promise<number> {
  const rec = await getOne<ProjectRec>('projects', id)
  if (!rec) throw new Error('That project was not found.')
  return loadRec(rec)
}
export async function deleteProjectRec(id: string) {
  await run('projects', 'readwrite', (s) => s.delete(id))
  await sweepMedia()
}
export function newProject() {
  const cur = useStore.getState().assets
  Object.values(cur).forEach((a) => a.url.startsWith('blob:') && URL.revokeObjectURL(a.url))
  useStore.getState().loadSnapshot({
    assets: {},
    project: { aspect: '9:16', clips: [], texts: [], logo: null, music: null, voice: [], brand: useStore.getState().project.brand },
    kit: { name: '', price: '', offer: '', cta: 'Shop now', script: '' },
  })
}
export async function storageInfo(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage.estimate()
    return { used: e.usage ?? 0, quota: e.quota ?? 0 }
  } catch {
    return null
  }
}

/** Call once at start: restores the last session, then keeps saving it. */
export async function startAutosave(): Promise<{ restored: boolean }> {
  let restored = false
  try {
    void navigator.storage?.persist?.()
    const rec = await getOne<ProjectRec>('projects', AUTOSAVE)
    if (rec && (rec.project.clips.length || rec.mediaIds.length || rec.project.texts.length)) {
      await loadRec(rec)
      restored = true
    }
  } catch {
    /* start empty */
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  let busy = false
  const flush = async () => {
    if (busy) {
      dirty = true
      return
    }
    busy = true
    setState({ kind: 'saving' })
    try {
      do {
        dirty = false
        await writeProject(AUTOSAVE, 'Autosave')
      } while (dirty)
      setState({ kind: 'saved', at: Date.now() })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not save.' })
    } finally {
      busy = false
    }
  }
  let last = { p: useStore.getState().project, a: useStore.getState().assets, k: useStore.getState().kit }
  useStore.subscribe((s) => {
    if (s.project === last.p && s.assets === last.a && s.kit === last.k) return
    last = { p: s.project, a: s.assets, k: s.kit }
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), 400)
  })
  // best effort when the tab is hidden or closed: write right away instead of waiting for the timer
  const now = () => {
    clearTimeout(timer)
    void flush()
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && now())
  window.addEventListener('pagehide', now)
  void flush()
  return { restored }
}
