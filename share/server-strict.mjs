// OPTIONAL stricter share server (alternative to server.mjs): only ads you register from AdCut (Link button) can be watched,
// and "Stop sharing" really switches the link off. Run: EVS_KEY=evs_... node share/server-strict.mjs
// sessions only for ads you explicitly shared. Viewers never see the key.
//
//   EVS_API=http://localhost:8080 EVS_KEY=evs_... node share/server.mjs
//
// Env: PORT (8090) · HOST (0.0.0.0) · EVS_API · EVS_KEY (needs videos:read + playback:mint)
//      ADMIN_SECRET (optional; if set, sharing needs header x-share-admin; if unset only localhost may share)
//      ALLOWED_ORIGINS (comma list of AdCut origins allowed to call /api/share, default http://localhost:5173,http://localhost:4173)
//      DATA_FILE (shared.json) · HLS_JS (path to hls.min.js, auto-detected)
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8090)
const HOST = process.env.HOST ?? '0.0.0.0'
const EVS_API = (process.env.EVS_API ?? 'http://localhost:8080').replace(/\/$/, '')
const EVS_KEY = process.env.EVS_KEY ?? ''
const ADMIN = process.env.ADMIN_SECRET ?? ''
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173').split(',').map((s) => s.trim())
const DATA = process.env.DATA_FILE ?? join(here, 'shared.json')
const HLS = [process.env.HLS_JS, join(here, 'public/hls.min.js'), join(here, '../node_modules/hls.js/dist/hls.min.js')].find((p) => p && existsSync(p))

if (!EVS_KEY) console.warn('! EVS_KEY is not set: sessions cannot be minted')

const load = () => {
  try {
    return JSON.parse(readFileSync(DATA, 'utf8'))
  } catch {
    return {}
  }
}
const save = (d) => writeFileSync(DATA, JSON.stringify(d, null, 2))
const ID = /^[0-9A-Za-z]{10,40}$/

const evs = (method, path, body) =>
  fetch(`${EVS_API}/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${EVS_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })

const send = (res, code, body, type = 'application/json', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

const page = (id, title) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/[<>&"]/g, '')}</title>
<style>html,body{margin:0;height:100%;background:#0b0b0e;color:#eee;font-family:system-ui,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:12px;box-sizing:border-box}
video{width:min(100%,480px);max-height:82vh;background:#000;border-radius:12px}p{margin:0;opacity:.7;font-size:14px}</style></head>
<body><main><video id="v" controls playsinline></video><p id="m">Loading…</p></main>
<script src="/hls.js"></script><script>
const id=${JSON.stringify(id)},v=document.getElementById('v'),m=document.getElementById('m');let hls=null,retry=0;
async function start(resume){
  const r=await fetch('/api/session/'+id,{method:'POST'});
  if(!r.ok){m.textContent=r.status===404?'This video is not shared or is not ready yet.':'Could not start playback.';return}
  const s=await r.json();m.textContent='';
  if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=s.manifestUrl;if(resume)v.currentTime=resume;return}
  if(!window.Hls||!Hls.isSupported()){m.textContent='This browser cannot play the stream.';return}
  hls&&hls.destroy();hls=new Hls();hls.loadSource(s.manifestUrl);hls.attachMedia(v);
  hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(resume)v.currentTime=resume});
  hls.on(Hls.Events.ERROR,(e,d)=>{if(d.fatal&&d.response&&[401,403].includes(d.response.code)&&retry++<20)start(v.currentTime)});
}
start(0);
</script></body></html>`

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const origin = req.headers.origin ?? ''
  const cors = ORIGINS.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'content-type,x-share-admin', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' }
    : {}
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain', cors)

  try {
    if (url.pathname === '/healthz') return send(res, 200, { ok: true })
    if (url.pathname === '/hls.js') {
      if (!HLS) return send(res, 404, 'hls.js not found: run npm install in adcut/', 'text/plain')
      return send(res, 200, readFileSync(HLS), 'application/javascript', { 'Cache-Control': 'public, max-age=86400' })
    }

    let m = /^\/watch\/([^/]+)$/.exec(url.pathname)
    if (m && req.method === 'GET') {
      const entry = ID.test(m[1]) ? load()[m[1]] : null
      if (!entry) return send(res, 404, 'Not found', 'text/plain')
      return send(res, 200, page(m[1], entry.title || 'Video'), 'text/html; charset=utf-8')
    }

    m = /^\/api\/session\/([^/]+)$/.exec(url.pathname)
    if (m && req.method === 'POST') {
      if (!ID.test(m[1]) || !load()[m[1]]) return send(res, 404, { error: 'not shared' })
      const r = await evs('POST', `/videos/${m[1]}/playback-sessions`, { viewerId: 'guest' })
      if (!r.ok) return send(res, r.status === 404 ? 404 : 502, { error: 'cannot start playback' })
      const s = await r.json()
      return send(res, 200, { manifestUrl: s.manifestUrl, expiresAt: s.expiresAt })
    }

    // management (used by the AdCut Publish tab)
    if (url.pathname === '/api/share' || /^\/api\/share\/[^/]+$/.test(url.pathname)) {
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
      const authed = ADMIN ? req.headers['x-share-admin'] === ADMIN : local
      if (!authed) return send(res, 401, { error: ADMIN ? 'admin secret required' : 'sharing is only allowed from this computer (set ADMIN_SECRET for remote use)' }, 'application/json', cors)
      if (req.method === 'POST' && url.pathname === '/api/share') {
        let raw = ''
        for await (const c of req) raw += c
        const { id } = JSON.parse(raw || '{}')
        if (!ID.test(id ?? '')) return send(res, 400, { error: 'bad id' }, 'application/json', cors)
        const v = await evs('GET', `/videos/${id}`)
        if (!v.ok) return send(res, 404, { error: 'video not found in EVS (is EVS_KEY set and valid?)' }, 'application/json', cors)
        const video = await v.json()
        if (video.status !== 'ready') return send(res, 409, { error: 'video is not ready yet' }, 'application/json', cors)
        const d = load()
        d[id] = { title: video.title, sharedAt: new Date().toISOString() }
        save(d)
        return send(res, 200, { id, path: `/watch/${id}` }, 'application/json', cors)
      }
      m = /^\/api\/share\/([^/]+)$/.exec(url.pathname)
      if (m && req.method === 'DELETE') {
        const d = load()
        delete d[m[1]]
        save(d)
        return send(res, 200, { ok: true }, 'application/json', cors)
      }
      if (m && req.method === 'GET') return send(res, load()[m[1]] ? 200 : 404, { shared: !!load()[m[1]] }, 'application/json', cors)
    }
    send(res, 404, 'Not found', 'text/plain')
  } catch (e) {
    console.error(e)
    send(res, 500, { error: 'server error' })
  }
}).listen(PORT, HOST, () => console.log(`AdCut share server on http://${HOST}:${PORT} -> EVS ${EVS_API}`))
