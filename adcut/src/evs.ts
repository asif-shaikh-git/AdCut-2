/**
 * Client for Euron Video System (EVS): upload a finished ad, wait for the encrypted HLS version, get a playback link.
 * Connection settings live in this browser only (localStorage). Use a key scoped to videos:read, videos:write and
 * playback:mint. Never publish AdCut to the open internet with a root key typed into it.
 */
export interface EvsSettings {
  apiBase: string
  apiKey: string
  viewerId: string
  /** address of the share server (see share/ in the bundle) used to build public watch links */
  shareBase: string
}

const KEY = 'adcut-evs-v1'
const DEFAULTS: EvsSettings = { apiBase: 'http://localhost:8080', apiKey: '', viewerId: 'adcut-owner', shareBase: 'http://localhost:8090' }

export function loadEvs(): EvsSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

export function saveEvs(s: EvsSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode: settings just won't persist */
  }
}

export type EvsStatus = 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed' | 'cancelled'

export interface EvsVideo {
  id: string
  title: string
  status: EvsStatus
  stage: string | null
  progress: number
  durationSeconds: number | null
  orientation: string | null
  error: string | null
  createdAt: string
  posterUrl: string | null
  renditions?: { name?: string; width: number; height: number; bitrateKbps?: number }[]
}

export interface EvsSession {
  token: string
  expiresAt: string
  manifestUrl: string
  thumbnailsUrl?: string
  posterUrl?: string
  watermark?: { required: boolean; text?: string }
}

export class EvsError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function call<T>(s: EvsSettings, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${s.apiBase.replace(/\/$/, '')}/v1${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${s.apiKey}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new EvsError(0, 'Cannot reach EVS. Check the address, that the server is running, and that it allows this site (CORS).')
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const m = (json as { error?: { message?: string } } | null)?.error?.message
    throw new EvsError(res.status, m ?? `EVS returned ${res.status}`)
  }
  return json as T
}

export const checkConnection = (s: EvsSettings) => call<{ data: EvsVideo[] }>(s, 'GET', '/videos?limit=1')
export const listVideos = (s: EvsSettings) => call<{ data: EvsVideo[] }>(s, 'GET', '/videos?limit=30')
export const getVideo = (s: EvsSettings, id: string) => call<EvsVideo>(s, 'GET', `/videos/${id}`)
export const deleteVideo = (s: EvsSettings, id: string) => call<void>(s, 'DELETE', `/videos/${id}`)
export const mintSession = (s: EvsSettings, id: string) =>
  call<EvsSession>(s, 'POST', `/videos/${id}/playback-sessions`, { viewerId: s.viewerId || 'adcut-owner', origin: location.origin })

/** create -> upload straight to storage (presigned POST) -> complete. Returns the new video id. */
export async function uploadVideo(
  s: EvsSettings,
  file: Blob,
  filename: string,
  title: string,
  onStep: (m: string) => void,
): Promise<string> {
  onStep('Creating the video record…')
  const created = await call<{ video: EvsVideo; upload: { url: string; fields: Record<string, string> } }>(s, 'POST', '/videos', {
    title,
    filename,
  })
  onStep(`Uploading ${(file.size / 1e6).toFixed(1)} MB…`)
  const mime = file.type || (filename.endsWith('.mp4') ? 'video/mp4' : 'video/webm')
  const form = new FormData()
  Object.entries(created.upload.fields).forEach(([k, v]) => form.append(k, v))
  form.append('Content-Type', mime)
  form.append('file', new File([file], filename, { type: mime })) // file must be the last field
  let up: Response
  try {
    up = await fetch(created.upload.url, { method: 'POST', body: form })
  } catch {
    throw new EvsError(0, 'Upload was blocked. The storage bucket must allow this site (CORS) — see docs/EVS-INTEGRATION.md.')
  }
  if (!up.ok) throw new EvsError(up.status, `Storage rejected the upload (${up.status}).`)
  onStep('Verifying the upload…')
  await call(s, 'POST', `/videos/${created.video.id}/complete`)
  return created.video.id
}

/** Ask the share server to make an ad public at <shareBase>/watch/<id>. Returns the link. */
export async function shareVideo(s: EvsSettings, id: string): Promise<string> {
  const base = s.shareBase.replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/api/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  } catch {
    // A plain read-only share server sends no CORS headers, so the browser blocks the POST even though it is running.
    // An opaque no-cors request tells "running" apart from "not running".
    const up = await fetch(`${base}/healthz`, { mode: 'no-cors' }).then(() => true, () => false)
    if (up) return `${base}/watch/${id}`
    throw new EvsError(0, 'Cannot reach the share server. Start it with ./start-share.sh (needs your EVS key).')
  }
  const j = (await res.json().catch(() => ({}))) as { error?: string }
  // 404/405 = a simple read-only share server (start-share.sh) that has no sharing list: its links work without registering.
  if (!res.ok && res.status !== 404 && res.status !== 405) throw new EvsError(res.status, j.error ?? `Share server returned ${res.status}`)
  return `${base}/watch/${id}`
}

/** true if the link was really switched off; false if this share server cannot do that. */
export async function unshareVideo(s: EvsSettings, id: string): Promise<boolean> {
  const r = await fetch(`${s.shareBase.replace(/\/$/, '')}/api/share/${id}`, { method: 'DELETE' }).catch(() => null)
  return !!r && r.ok
}
